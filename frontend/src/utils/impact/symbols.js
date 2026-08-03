/* -------------------------------------------------------
 * symbols.js — cross-file symbol breakage, for every language
 *
 * The case this exists for: two people are in different files, nothing
 * collides, the text merges perfectly — and the code is broken anyway,
 * because one of them renamed something the other calls. No merge algorithm
 * can catch that; it is not a conflict, it is a consequence.
 *
 * The engine is language-agnostic. Providers in ./languages.js say what a file
 * PROVIDES and what it CONSUMES; everything below is the same three steps
 * regardless of language:
 *
 *   1. diff the changed file's declarations, before vs after
 *   2. for each name that disappeared, scan the other files for uses
 *   3. rank by how sure we are it is really broken
 *
 * Confidence matters more than reach here. A warning that fires on every
 * common method name teaches people to dismiss warnings, so an explicit import
 * of a vanished name is an error, while a bare call that merely shares its
 * name is a warning.
 * ------------------------------------------------------- */

import { providerFor } from './languages';

/* ── Limits ──
 * Generated bundles and dependency trees are not somebody's work in progress,
 * and scanning them costs real time on every keystroke batch. */

const MAX_FILE_BYTES = 400_000;

const IGNORED_PATH = /(^|\/)(node_modules|bower_components|dist|build|out|target|coverage|venv|\.venv|__pycache__|\.git|vendor|migrations)(\/|$)/i;
const GENERATED_FILE = /\.(min|bundle|chunk)\.(js|css)$|\.d\.ts$|-lock\.json$/i;

/** Worth reading at all? */
export function isAnalyzable(path, content) {
  if (!path || typeof content !== 'string') return false;
  if (content.length > MAX_FILE_BYTES) return false;
  if (IGNORED_PATH.test(path)) return false;
  if (GENERATED_FILE.test(path)) return false;
  return Boolean(providerFor(path));
}

/* ── Extraction cache ──
 *
 * A change to one file re-scans every other file, but those others did not
 * change — and in a session most of them never do.
 *
 * Keyed by PATH, holding the content it was built from. Keying by content
 * instead looks equivalent and is not: it needs a size cap, and on any project
 * larger than that cap the entries evict each other before they are ever
 * reused, so the cache does nothing precisely when it is needed most. One
 * entry per file is bounded by the project itself and never thrashes. */

const cache = new Map();   // path -> { content, declarations, references }

function run(provider, content) {
  const cleaned = provider.strip(content);
  return {
    declarations: provider.declarations(cleaned),
    references: provider.references(cleaned),
  };
}

function extractCached(provider, path, content) {
  const hit = cache.get(path);
  if (hit && hit.content === content) return hit;

  const result = { content, ...run(provider, content) };
  cache.set(path, result);
  return result;
}

/** Drop everything — call when a session ends so old projects are not held. */
export function clearSymbolCache() {
  cache.clear();
}

/* ── Analysis ── */

/**
 * Names that vanished from `changedPath`, and who still uses them.
 *
 * @param {string} changedPath
 * @param {string} oldContent   content before the change
 * @param {string} newContent   content after the change
 * @param {Object} allFiles     { path: content } for the whole project
 * @returns {Array} impacts in the shape the analyzer already reports
 */
export function analyzeSymbolImpact(changedPath, oldContent, newContent, allFiles) {
  const provider = providerFor(changedPath);
  if (!provider) return [];
  if (oldContent === newContent) return [];
  if (String(newContent || '').length > MAX_FILE_BYTES) return [];

  // The changed file is extracted twice, uncached: two versions of one path
  // cannot share a path-keyed entry, and it is two scans either way.
  const before = run(provider, String(oldContent || '')).declarations;
  const after = run(provider, String(newContent || '')).declarations;

  const removed = [...before].filter((name) => !after.has(name));
  if (removed.length === 0) return [];

  const added = [...after].filter((name) => !before.has(name));

  /* One name out, one name in, nothing else touched — almost always a rename.
   * Saying so turns "why is this undefined" into a one-word fix. */
  const renamedTo = removed.length === 1 && added.length === 1 ? added[0] : null;

  const changedFile = changedPath.split('/').pop();
  const impacts = [];

  for (const [path, content] of Object.entries(allFiles)) {
    if (path === changedPath) continue;
    if (!isAnalyzable(path, content)) continue;

    // Only compare within one language. A Python `calculate` and a Java
    // `calculate` have nothing to do with each other.
    const otherProvider = providerFor(path);
    if (!otherProvider || otherProvider.id !== provider.id) continue;

    const { references: { imported, called } } = extractCached(otherProvider, path, content);
    const otherFile = path.split('/').pop();

    for (const name of removed) {
      const isImported = imported.has(name);
      const isCalled = called.has(name);
      if (!isImported && !isCalled) continue;

      const detail = renamedTo
        ? `it was renamed to ${renamedTo} in ${changedFile}`
        : `it no longer exists in ${changedFile}`;

      impacts.push({
        file: path,
        type: renamedTo ? 'symbol_renamed' : 'symbol_removed',
        identifier: name,
        language: provider.id,
        // An explicit import asked for this exact name and it is gone; a bare
        // call might just be a name that happens to match.
        severity: isImported ? 'error' : 'warning',
        confidence: isImported ? 'high' : 'low',
        predictedError: isImported
          ? `Cannot import ${name} — ${detail}`
          : `${name} may be undefined — ${detail}`,
        description: isImported
          ? `${otherFile} imports ${name}, which ${renamedTo ? `was renamed to ${renamedTo}` : 'was removed'}`
          : `${otherFile} calls ${name}(), which ${renamedTo ? `was renamed to ${renamedTo}` : 'was removed'}`,
      });
    }
  }

  // Certain breakage first — that is what someone should read and act on.
  impacts.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
  return impacts;
}
