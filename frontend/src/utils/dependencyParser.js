/* -------------------------------------------------------
 * dependencyParser.js — Project Dependency Scanner
 *
 * Scans all project files to extract import/require/link
 * relationships and produces a normalized dependency graph.
 * Supports: ES Modules, CommonJS, CSS @import, HTML refs.
 * ------------------------------------------------------- */

// ── File-type helpers ────────────────────────────────────

const EXT_MAP = {
  '.js': 'js', '.jsx': 'js', '.ts': 'js', '.tsx': 'js', '.mjs': 'js',
  '.css': 'css', '.scss': 'css', '.less': 'css',
  '.html': 'html', '.htm': 'html',
  '.json': 'json',
};

const getFileType = (path) => {
  if (!path) return 'unknown';
  const ext = '.' + path.split('.').pop().toLowerCase();
  return EXT_MAP[ext] || 'unknown';
};

const getFolder = (path) => {
  const parts = path.replace(/\\/g, '/').split('/');
  if (parts.length <= 1) return '/';
  return parts.slice(0, -1).join('/');
};

const getFileName = (path) => {
  return path.replace(/\\/g, '/').split('/').pop();
};

// ── Resolve relative import paths ────────────────────────

const EXTENSIONS = ['', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.css', '.scss', '.json'];

/**
 * Resolve an import specifier relative to the importing file.
 * Tries multiple extensions and index files.
 */
/**
 * Try a resolved path against the project, with extensions and as a directory
 * index — the same order a bundler would.
 */
const matchPath = (resolved, allPaths) => {
  for (const ext of EXTENSIONS) {
    const candidate = resolved + ext;
    if (allPaths.has(candidate)) return candidate;
  }
  for (const indexName of ['index.js', 'index.jsx', 'index.ts', 'index.tsx']) {
    const candidate = resolved + '/' + indexName;
    if (allPaths.has(candidate)) return candidate;
  }
  return null;
};

/**
 * Resolve an aliased or root-relative import by matching the tail of a path.
 *
 * `@/components/Button` is a path alias — configured in vite.config or
 * tsconfig, which we do not parse. Rather than read every possible bundler
 * config, match on the suffix: the alias target is a real path tail, so
 * `components/Button` finds `src/components/Button.jsx`.
 *
 * Where several files could match, the shortest path wins: an alias points at
 * one root, and the shallowest candidate is the one nearest it. Genuinely
 * ambiguous cases are rare and a wrong edge is better than the graph being
 * empty, which is what happened before.
 */
const resolveByTail = (target, allPaths) => {
  let best = null;
  for (const ext of EXTENSIONS) {
    const tail = '/' + target + ext;
    for (const path of allPaths) {
      if (!path.endsWith(tail)) continue;
      if (!best || path.length < best.length) best = path;
    }
    if (best) return best;
  }

  for (const indexName of ['index.js', 'index.jsx', 'index.ts', 'index.tsx']) {
    const tail = '/' + target + '/' + indexName;
    for (const path of allPaths) {
      if (!path.endsWith(tail)) continue;
      if (!best || path.length < best.length) best = path;
    }
    if (best) return best;
  }

  return null;
};

const resolveImport = (specifier, importerPath, allPaths) => {
  if (!specifier) return null;
  const spec = specifier.replace(/\\/g, '/').trim();
  const importerDir = getFolder(importerPath);

  // 1. Direct relative match in importer directory (e.g. "script.js", "style.css", "./script.js")
  let cleanSpec = spec.startsWith('./') ? spec.slice(2) : spec;
  if (importerDir && importerDir !== '/') {
    const candidate = importerDir + '/' + cleanSpec;
    const directRel = matchPath(candidate, allPaths);
    if (directRel) return directRel;
  }

  // 2. Direct match against project root
  const directRoot = matchPath(cleanSpec, allPaths);
  if (directRoot) return directRoot;

  // 3. Relative & absolute navigation paths (e.g. "../utils/helper", "/src/main.js")
  if (spec.startsWith('.') || spec.startsWith('/')) {
    let resolved = spec;

    if (resolved.startsWith('.')) {
      const parts = importerDir && importerDir !== '/' ? importerDir.split('/') : [];
      for (const seg of resolved.split('/')) {
        if (seg === '.') continue;
        if (seg === '..') parts.pop();
        else parts.push(seg);
      }
      resolved = parts.join('/');
    } else {
      resolved = resolved.replace(/^\/+/, '');
    }

    const direct = matchPath(resolved, allPaths);
    if (direct) return direct;

    return resolveByTail(resolved, allPaths);
  }

  /* Path aliases — `@/x`, `~/x`, `#/x` — and root-relative specifiers like
   * `src/components/Button`. */
  const aliased = spec.match(/^[@~#]\/(.+)$/);
  if (aliased) return resolveByTail(aliased[1], allPaths);

  // A bare specifier that names a real folder in this project (`src/...`, `app/...`)
  if (spec.includes('/')) {
    const asRoot = matchPath(spec, allPaths) || resolveByTail(spec, allPaths);
    if (asRoot) return asRoot;
  }

  // Tail match for any local project file name match
  const tail = resolveByTail(spec, allPaths);
  if (tail) return tail;

  return null;
};

// ── Extract imports from JS/JSX/TS files ─────────────────

const extractJsImports = (content) => {
  const imports = [];

  // Remove block & line comments to avoid false matches
  const cleaned = content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  // ES Module: import ... from '...'
  const esImportRegex = /import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  let m;
  while ((m = esImportRegex.exec(cleaned)) !== null) {
    imports.push({ specifier: m[1], type: 'es-import' });
  }

  // Dynamic import: import('...')
  const dynamicRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = dynamicRegex.exec(cleaned)) !== null) {
    imports.push({ specifier: m[1], type: 'dynamic-import' });
  }

  // CommonJS: require('...')
  const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = requireRegex.exec(cleaned)) !== null) {
    imports.push({ specifier: m[1], type: 'require' });
  }

  // Re-export: export ... from '...'
  const reExportRegex = /export\s+(?:\{[^}]*\}|\*)\s+from\s+['"]([^'"]+)['"]/g;
  while ((m = reExportRegex.exec(cleaned)) !== null) {
    imports.push({ specifier: m[1], type: 're-export' });
  }

  return imports;
};

// ── Extract imports from CSS/SCSS files ──────────────────

const extractCssImports = (content) => {
  const imports = [];

  // @import '...' or @import url('...')
  const importRegex = /@import\s+(?:url\s*\(\s*)?['"]([^'"]+)['"]\s*\)?/g;
  let m;
  while ((m = importRegex.exec(content)) !== null) {
    imports.push({ specifier: m[1], type: 'css-import' });
  }

  return imports;
};

// ── Extract refs from HTML files ─────────────────────────

const extractHtmlImports = (content) => {
  const imports = [];

  // <script src="...">
  const scriptRegex = /<script[^>]+src\s*=\s*['"]([^'"]+)['"]/gi;
  let m;
  while ((m = scriptRegex.exec(content)) !== null) {
    if (!m[1].startsWith('http')) {
      imports.push({ specifier: m[1], type: 'html-script' });
    }
  }

  // <link href="..." rel="stylesheet">
  const linkRegex = /<link[^>]+href\s*=\s*['"]([^'"]+)['"]/gi;
  while ((m = linkRegex.exec(content)) !== null) {
    if (!m[1].startsWith('http')) {
      imports.push({ specifier: m[1], type: 'html-link' });
    }
  }

  return imports;
};

// ── Extract internal symbols from a JS file ──────────────
// Used for Level 3 (File internals) drill-down

export const extractSymbols = (content, filePath) => {
  const symbols = [];
  if (!content) return symbols;

  const cleaned = content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  // Named function declarations: function foo() {}
  const funcRegex = /(?:export\s+)?(?:default\s+)?function\s+(\w+)/g;
  let m;
  while ((m = funcRegex.exec(cleaned)) !== null) {
    symbols.push({ name: m[1], type: 'function', exported: /export/.test(m[0]) });
  }

  // Arrow / const functions: const Foo = (...) => ...
  const arrowRegex = /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:\([^)]*\)|[a-zA-Z_$]\w*)\s*=>/g;
  while ((m = arrowRegex.exec(cleaned)) !== null) {
    const name = m[1];
    // Detect React components (PascalCase) vs hooks (useFoo) vs regular
    let type = 'function';
    if (/^use[A-Z]/.test(name)) type = 'hook';
    else if (/^[A-Z]/.test(name)) type = 'component';
    symbols.push({ name, type, exported: /export/.test(m[0]) });
  }

  // React components: const Foo = React.memo(...), forwardRef, etc.
  const memoRegex = /(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:React\.)?(?:memo|forwardRef|lazy)\(/g;
  while ((m = memoRegex.exec(cleaned)) !== null) {
    symbols.push({ name: m[1], type: 'component', exported: /export/.test(m[0]) });
  }

  // Class declarations
  const classRegex = /(?:export\s+)?(?:default\s+)?class\s+(\w+)/g;
  while ((m = classRegex.exec(cleaned)) !== null) {
    symbols.push({ name: m[1], type: 'class', exported: /export/.test(m[0]) });
  }

  // Default export detection (for unnamed)
  if (/export\s+default\s+/.test(cleaned) && !symbols.some(s => s.exported)) {
    const fileName = getFileName(filePath).replace(/\.[^.]+$/, '');
    if (!symbols.find(s => s.name === fileName)) {
      symbols.push({ name: fileName, type: 'default-export', exported: true });
    }
  }

  // Deduplicate by name
  const seen = new Set();
  return symbols.filter(s => {
    if (seen.has(s.name)) return false;
    seen.add(s.name);
    return true;
  });
};

// ── Main: Build dependency graph from all files ──────────

/**
 * Parse all project files and produce a normalized dependency graph.
 *
 * @param {Object} files — Map of { path: content }
 * @returns {{
 *   nodes: Map<string, NodeInfo>,
 *   folders: Map<string, Set<string>>,
 *   edges: Array<{ source: string, target: string, type: string }>
 * }}
 */
export const buildDependencyMap = (files) => {
  if (!files || Object.keys(files).length === 0) {
    return { nodes: new Map(), folders: new Map(), edges: [] };
  }

  const allPaths = new Set(Object.keys(files));
  const nodes = new Map();
  const folders = new Map();
  const edges = [];

  // Initialize nodes
  for (const path of allPaths) {
    const folder = getFolder(path);
    const fileName = getFileName(path);
    const fileType = getFileType(path);

    nodes.set(path, {
      path,
      folder,
      fileName,
      fileType,
      imports: new Set(),
      importedBy: new Set(),
      inDegree: 0,
      isEntryPoint: false,
    });

    if (!folders.has(folder)) folders.set(folder, new Set());
    folders.get(folder).add(path);
  }

  // Detect entry points
  const entryPatterns = [
    /^index\.(js|jsx|ts|tsx)$/i,
    /^app\.(js|jsx|ts|tsx)$/i,
    /^main\.(js|jsx|ts|tsx)$/i,
    /^server\.(js|ts)$/i,
    /^index\.html$/i,
  ];

  // Check package.json for main field
  if (files['package.json']) {
    try {
      const pkg = JSON.parse(files['package.json']);
      const mainFile = pkg.main || pkg.module;
      if (mainFile && nodes.has(mainFile)) {
        nodes.get(mainFile).isEntryPoint = true;
      }
    } catch (e) { /* ignore parse errors */ }
  }

  for (const [path, node] of nodes) {
    if (entryPatterns.some(p => p.test(node.fileName))) {
      node.isEntryPoint = true;
    }
  }

  // Extract imports and build edges
  for (const [path, content] of Object.entries(files)) {
    const fileType = getFileType(path);
    let rawImports = [];

    if (fileType === 'js') rawImports = extractJsImports(content || '');
    else if (fileType === 'css') rawImports = extractCssImports(content || '');
    else if (fileType === 'html') rawImports = extractHtmlImports(content || '');

    for (const imp of rawImports) {
      const resolved = resolveImport(imp.specifier, path, allPaths);
      if (!resolved) continue;

      const sourceNode = nodes.get(path);
      const targetNode = nodes.get(resolved);
      if (!sourceNode || !targetNode) continue;

      sourceNode.imports.add(resolved);
      targetNode.importedBy.add(path);
      targetNode.inDegree++;

      edges.push({
        source: path,
        target: resolved,
        type: imp.type,
      });
    }
  }

  return { nodes, folders, edges };
};

export default buildDependencyMap;
