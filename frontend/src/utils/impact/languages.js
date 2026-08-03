/* -------------------------------------------------------
 * languages.js — per-language symbol extraction
 *
 * The impact analyzer answers one question: someone changed a file, does that
 * break a file I have open? Answering it needs two things from each language —
 * the names a file PROVIDES and the names a file CONSUMES. Everything else
 * (diffing, cross-referencing, deciding who to warn) is language-agnostic and
 * lives in the engine.
 *
 * Providers live here so a new language is one entry in this table rather than
 * another branch threaded through the analyzer.
 *
 * These are regexes, not parsers, and that is the deliberate trade-off the
 * whole feature rests on: this runs on every keystroke batch, and a real parser
 * throws on incomplete syntax — which is what code looks like almost all of the
 * time while someone is typing. Regex degrades quietly instead.
 *
 * References come back in two buckets because they are not equally trustworthy:
 *
 *   imported — the file names the symbol explicitly (`from x import foo`).
 *              Near-certain: it asked for that exact name and it is gone.
 *   called   — the name merely appears as a call. Could be a local, a method
 *              on an unrelated object, or a coincidence of naming.
 *
 * The engine reports the first as an error and the second as a warning, which
 * is what keeps a broad net from turning into noise.
 * ------------------------------------------------------- */

/* ── Shared noise removal ──────────────────────────────── */

/**
 * C-family: line comments, block comments and string bodies, in one pass.
 *
 * Chained regex replaces cannot do this correctly, because comments and
 * strings can contain each other. Stripping comments first eats the tail of
 * `"https://example.com"` and leaves an unterminated quote that swallows the
 * next line of real code; stripping strings first lets the apostrophe in a
 * `// don't` comment open a string that runs into the following function.
 * Either way declarations quietly go missing.
 *
 * Walking once with a little state has neither problem. Newlines are kept so
 * line-anchored patterns still line up.
 */
const stripCLike = (content) => {
  const src = String(content || '');
  const n = src.length;
  let out = '';
  let i = 0;

  while (i < n) {
    const c = src[i];
    const d = src[i + 1];

    if (c === '/' && d === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      for (let k = i; k < stop; k++) if (src[k] === '\n') out += '\n';
      i = stop;
      continue;
    }

    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }

    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      i++;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === quote) { i++; break; }
        // An unterminated single-line string is a typo mid-edit, not a string
        // that runs to the end of the file — stop at the newline.
        if (quote !== '`' && src[i] === '\n') break;
        if (src[i] === '\n') out += '\n';
        i++;
      }
      out += '""';
      continue;
    }

    out += c;
    i++;
  }
  return out;
};

/** Python: docstrings first (they are strings), then # comments, then strings. */
const stripPython = (content) => String(content || '')
  .replace(/"""[\s\S]*?"""/g, '""')
  .replace(/'''[\s\S]*?'''/g, "''")
  .replace(/#.*$/gm, ' ')
  .replace(/(['"])(?:\\.|(?!\1)[^\\])*\1/g, '""');

/** Collect every capture-group-1 match of `pattern` into `out`, minus builtins. */
const collect = (pattern, text, out, skip) => {
  let m;
  pattern.lastIndex = 0;
  while ((m = pattern.exec(text)) !== null) {
    const name = m[m.length - 1];
    if (name && !skip.has(name)) out.add(name);
  }
};

/* ── JavaScript / TypeScript ───────────────────────────── */

const JS_SKIP = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'instanceof',
  'new', 'delete', 'void', 'in', 'of', 'do', 'else', 'try', 'finally', 'throw',
  'function', 'class', 'const', 'let', 'var', 'await', 'async', 'yield',
  'console', 'window', 'document', 'Math', 'JSON', 'Object', 'Array', 'String',
  'Number', 'Boolean', 'Date', 'Promise', 'Set', 'Map', 'RegExp', 'Error',
  'parseInt', 'parseFloat', 'isNaN', 'setTimeout', 'setInterval', 'require',
  'module', 'exports', 'alert', 'fetch', 'localStorage', 'this', 'super',
  'constructor', 'get', 'set', 'push', 'map', 'filter', 'forEach', 'then',
]);

const javascript = {
  id: 'javascript',
  label: 'JavaScript',
  test: (path) => /\.(jsx?|tsx?|mjs|cjs)$/i.test(path),
  strip: stripCLike,

  declarations(text) {
    const out = new Set();
    collect(/\bfunction\s+([A-Za-z_$][\w$]*)/g, text, out, JS_SKIP);
    collect(/\bclass\s+([A-Za-z_$][\w$]*)/g, text, out, JS_SKIP);
    collect(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/g, text, out, JS_SKIP);
    collect(/\bexport\s+(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g, text, out, JS_SKIP);
    collect(/\bexport\s+(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)/g, text, out, JS_SKIP);
    collect(/\bmodule\.exports\.([A-Za-z_$][\w$]*)\s*=/g, text, out, JS_SKIP);
    collect(/\bexports\.([A-Za-z_$][\w$]*)\s*=/g, text, out, JS_SKIP);

    /* React and TypeScript shapes the plain patterns above miss.
     *
     * A component is far more often a const than a function declaration, and
     * in real codebases that const is usually annotated or wrapped — so
     * without these three, the commonest way to declare a component is
     * invisible and renaming it reports nothing. */
    // const Button: React.FC<Props> = (…) => …
    collect(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*:[^=\n]*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g, text, out, JS_SKIP);
    // const Button = React.memo(…) / forwardRef(…) / lazy(…) / styled.div`…`
    collect(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]*)?=\s*(?:React\.)?(?:memo|forwardRef|lazy|observer)\s*\(/g, text, out, JS_SKIP);
    collect(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]*)?=\s*styled[.(]/g, text, out, JS_SKIP);
    return out;
  },

  references(text) {
    const imported = new Set();
    const called = new Set();

    // import { a, b as c } from '…'   /   const { a, b } = require('…')
    let m;
    const named = /(?:\bimport\s*\{([^}]*)\}|\b(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\s*\()/g;
    while ((m = named.exec(text)) !== null) {
      (m[1] || m[2] || '').split(',').forEach((part) => {
        const name = part.trim().split(/\s+as\s+/)[0].trim();
        if (name && !JS_SKIP.has(name)) imported.add(name);
      });
    }
    collect(/\bimport\s+([A-Za-z_$][\w$]*)\s+from\b/g, text, imported, JS_SKIP);

    // foo(…) but not obj.foo(…) — a method on something else is not our symbol
    collect(/(?:^|[^\w$.])([A-Za-z_$][\w$]*)\s*\(/g, text, called, JS_SKIP);

    /* JSX element usage. A component is used as <Button /> and never called
     * with parentheses, so the call pattern above cannot see it at all.
     * Capitalisation is the reliable signal: lowercase tags are HTML. */
    collect(/<([A-Z][\w$]*)/g, text, called, JS_SKIP);
    return { imported, called };
  },
};

/* ── Python ────────────────────────────────────────────── */

const PY_SKIP = new Set([
  'print', 'len', 'range', 'str', 'int', 'float', 'bool', 'list', 'dict',
  'set', 'tuple', 'open', 'super', 'isinstance', 'type', 'input', 'sum',
  'min', 'max', 'abs', 'round', 'sorted', 'reversed', 'enumerate', 'zip',
  'map', 'filter', 'any', 'all', 'getattr', 'setattr', 'hasattr', 'format',
  'if', 'for', 'while', 'with', 'return', 'def', 'class', 'import', 'from',
  'and', 'or', 'not', 'in', 'is', 'lambda', 'self', 'cls', 'None', 'True',
  'False', 'Exception', 'ValueError', 'TypeError', 'KeyError', 'property',
  'staticmethod', 'classmethod', 'dataclass', 'append', 'join', 'split',
]);

const python = {
  id: 'python',
  label: 'Python',
  test: (path) => /\.pyi?$/i.test(path),
  strip: stripPython,

  /*
   * Only column-0 definitions count. Indentation is Python's scoping, so a
   * `def` inside a class is a method reachable through an instance, not a name
   * another module can import — and treating the two alike would fire on every
   * common method name in the project.
   */
  declarations(text) {
    const out = new Set();
    text.split('\n').forEach((line) => {
      let m;
      if ((m = /^(?:async\s+)?def\s+([A-Za-z_]\w*)/.exec(line))) { if (!PY_SKIP.has(m[1])) out.add(m[1]); return; }
      if ((m = /^class\s+([A-Za-z_]\w*)/.exec(line))) { if (!PY_SKIP.has(m[1])) out.add(m[1]); return; }
      // Module-level constants and lambdas — the assignments other files import
      if ((m = /^([A-Z_][A-Z0-9_]*)\s*[:=]/.exec(line))) { out.add(m[1]); return; }
      if ((m = /^([A-Za-z_]\w*)\s*=\s*lambda\b/.exec(line))) { if (!PY_SKIP.has(m[1])) out.add(m[1]); }
    });
    return out;
  },

  references(text) {
    const imported = new Set();
    const called = new Set();
    let m;

    // from module import a, b as c   /   from module import (a, b)
    const fromImport = /^[ \t]*from\s+[\w.]+\s+import\s+\(?([^\n)]+)\)?/gm;
    while ((m = fromImport.exec(text)) !== null) {
      m[1].split(',').forEach((part) => {
        const name = part.trim().split(/\s+as\s+/)[0].trim();
        if (name && name !== '*' && !PY_SKIP.has(name)) imported.add(name);
      });
    }

    // import module, module.sub as alias — the module name itself can vanish
    const plainImport = /^[ \t]*import\s+([\w.,\s]+)$/gm;
    while ((m = plainImport.exec(text)) !== null) {
      m[1].split(',').forEach((part) => {
        const name = part.trim().split(/\s+as\s+/)[0].trim().split('.')[0];
        if (name && !PY_SKIP.has(name)) imported.add(name);
      });
    }

    collect(/(?:^|[^\w.])([A-Za-z_]\w*)\s*\(/g, text, called, PY_SKIP);
    collect(/^[ \t]*@([A-Za-z_]\w*)/gm, text, called, PY_SKIP);   // decorators
    return { imported, called };
  },
};

/* ── Java ──────────────────────────────────────────────── */

const JAVA_SKIP = new Set([
  'get', 'set', 'add', 'put', 'remove', 'size', 'length', 'toString', 'equals',
  'hashCode', 'valueOf', 'println', 'print', 'format', 'main', 'run', 'close',
  'next', 'hasNext', 'iterator', 'stream', 'forEach', 'map', 'filter', 'collect',
  'if', 'for', 'while', 'switch', 'catch', 'return', 'new', 'this', 'super',
  'try', 'else', 'do', 'throw', 'throws', 'class', 'interface', 'enum', 'record',
  'String', 'Integer', 'Long', 'Double', 'Boolean', 'Object', 'List', 'Map',
  'Set', 'ArrayList', 'HashMap', 'HashSet', 'Optional', 'Exception', 'System',
  'Override', 'Math', 'Arrays', 'Collections', 'Objects', 'StringBuilder',
]);

const java = {
  id: 'java',
  label: 'Java',
  test: (path) => /\.java$/i.test(path),
  strip: stripCLike,

  declarations(text) {
    const out = new Set();
    // Types
    collect(/\b(?:public|protected|private)?\s*(?:static\s+)?(?:final\s+)?(?:abstract\s+)?(?:class|interface|enum|record)\s+([A-Z]\w*)/g, text, out, JAVA_SKIP);
    // Methods — a modifier, a return type, then the name
    collect(/\b(?:public|protected|private)\s+(?:static\s+)?(?:final\s+)?(?:synchronized\s+)?[\w<>\[\],.?\s]+?\s+([a-z]\w*)\s*\(/g, text, out, JAVA_SKIP);
    // Visible constants
    collect(/\b(?:public|protected)\s+(?:static\s+)?(?:final\s+)?[\w<>\[\].]+\s+([A-Z_][A-Z0-9_]*)\s*[=;]/g, text, out, JAVA_SKIP);
    return out;
  },

  references(text) {
    const imported = new Set();
    const called = new Set();

    // import com.example.Thing;  →  the last segment is the name in use
    let m;
    const imports = /^[ \t]*import\s+(?:static\s+)?([\w.]+)\s*;/gm;
    while ((m = imports.exec(text)) !== null) {
      const name = m[1].split('.').pop();
      if (name && name !== '*' && !JAVA_SKIP.has(name)) imported.add(name);
    }

    collect(/\bnew\s+([A-Z]\w*)\s*\(/g, text, called, JAVA_SKIP);
    collect(/\b([A-Z]\w*)\s*\.\s*[a-z]\w*\s*\(/g, text, called, JAVA_SKIP);  // static call
    collect(/\b([A-Z]\w*)\s+[a-z]\w*\s*[=;)]/g, text, called, JAVA_SKIP);    // declared type
    /* Java is method-call heavy, and unlike JS the dot form is the normal way
     * to reach another class's code — so instance calls have to count, even
     * though the name alone cannot prove which class owns it. The skip list
     * above carries the common collisions, and these land as warnings. */
    collect(/(?:^|[^\w.])([a-z]\w*)\s*\(/g, text, called, JAVA_SKIP);
    collect(/\.\s*([a-z]\w*)\s*\(/g, text, called, JAVA_SKIP);
    return { imported, called };
  },
};

/* ── Registry ──────────────────────────────────────────── */

export const LANGUAGES = [javascript, python, java];

/** The provider that owns `path`, or null if we do not analyze that type. */
export function providerFor(path) {
  if (!path) return null;
  return LANGUAGES.find((lang) => lang.test(path)) || null;
}

/** Human name for a language id, used in warning text. */
export function labelFor(id) {
  return (LANGUAGES.find((l) => l.id === id) || {}).label || id;
}
