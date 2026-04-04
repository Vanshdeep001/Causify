/* -------------------------------------------------------
 * impactAnalyzer.js — Cross-File Impact Detection Engine
 *
 * Detects when a change in one file breaks references in
 * other files (HTML ↔ CSS ↔ JS dependency analysis).
 * Uses simple regex pattern matching — NOT a full parser.
 * ------------------------------------------------------- */

// ── File-type detection ──────────────────────────────────
const getFileType = (path) => {
  if (!path) return 'unknown';
  if (path.endsWith('.html') || path.endsWith('.htm')) return 'html';
  if (path.endsWith('.css')) return 'css';
  if (path.endsWith('.js') || path.endsWith('.jsx') || path.endsWith('.ts')) return 'js';
  return 'unknown';
};

// ── Extract identifiers from a file ─────────────────────

/**
 * Extract all IDs and classes referenced in an HTML file.
 * Returns { ids: Set, classes: Set }
 */
const extractHtmlIdentifiers = (content) => {
  const ids = new Set();
  const classes = new Set();

  // Match id="..." or id='...'
  const idRegex = /\bid\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = idRegex.exec(content)) !== null) {
    ids.add(m[1]);
  }

  // Match class="..." or class='...' (space-separated)
  const classRegex = /\bclass\s*=\s*["']([^"']+)["']/gi;
  while ((m = classRegex.exec(content)) !== null) {
    m[1].split(/\s+/).forEach(c => { if (c) classes.add(c); });
  }

  return { ids, classes };
};

/**
 * Extract all ID and class selectors from a CSS file.
 * Returns { idSelectors: Set, classSelectors: Set }
 */
const extractCssSelectors = (content) => {
  const idSelectors = new Set();
  const classSelectors = new Set();

  // Remove comments
  const cleaned = content.replace(/\/\*[\s\S]*?\*\//g, '');

  // Match #id selectors (before { or ,)
  const idRegex = /#([a-zA-Z_-][a-zA-Z0-9_-]*)/g;
  let m;
  while ((m = idRegex.exec(cleaned)) !== null) {
    idSelectors.add(m[1]);
  }

  // Match .class selectors
  const classRegex = /\.([a-zA-Z_-][a-zA-Z0-9_-]*)/g;
  while ((m = classRegex.exec(cleaned)) !== null) {
    classSelectors.add(m[1]);
  }

  return { idSelectors, classSelectors };
};

/**
 * Extract all DOM selectors from a JS file.
 * Returns { idRefs: Set, classRefs: Set, selectorRefs: Set }
 */
const extractJsSelectors = (content) => {
  const idRefs = new Set();
  const classRefs = new Set();
  const selectorRefs = new Set();

  // Remove comments
  const cleaned = content
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  // getElementById("...")
  const getByIdRegex = /getElementById\s*\(\s*["']([^"']+)["']\s*\)/g;
  let m;
  while ((m = getByIdRegex.exec(cleaned)) !== null) {
    idRefs.add(m[1]);
  }

  // getElementsByClassName("...")
  const getByClassRegex = /getElementsByClassName\s*\(\s*["']([^"']+)["']\s*\)/g;
  while ((m = getByClassRegex.exec(cleaned)) !== null) {
    m[1].split(/\s+/).forEach(c => { if (c) classRefs.add(c); });
  }

  // querySelector / querySelectorAll("...")
  const qsRegex = /querySelector(?:All)?\s*\(\s*["']([^"']+)["']\s*\)/g;
  while ((m = qsRegex.exec(cleaned)) !== null) {
    const sel = m[1];
    selectorRefs.add(sel);
    // Also extract individual IDs and classes from compound selectors
    const ids = sel.match(/#([a-zA-Z_-][a-zA-Z0-9_-]*)/g);
    if (ids) ids.forEach(id => idRefs.add(id.slice(1)));
    const cls = sel.match(/\.([a-zA-Z_-][a-zA-Z0-9_-]*)/g);
    if (cls) cls.forEach(c => classRefs.add(c.slice(1)));
  }

  return { idRefs, classRefs, selectorRefs };
};

// ── Build dependency map ────────────────────────────────

/**
 * Build a map of which files depend on which other files.
 * Returns { [path]: Set<dependentPath> }
 */
export const buildDependencyMap = (files) => {
  const deps = {};
  const paths = Object.keys(files);

  // First pass: collect all identifiers per file
  const fileInfo = {};
  for (const path of paths) {
    const type = getFileType(path);
    const content = files[path] || '';
    if (type === 'html') {
      fileInfo[path] = { type, ...extractHtmlIdentifiers(content) };
    } else if (type === 'css') {
      fileInfo[path] = { type, ...extractCssSelectors(content) };
    } else if (type === 'js') {
      fileInfo[path] = { type, ...extractJsSelectors(content) };
    }
  }

  // Second pass: find cross-references
  for (const path of paths) {
    deps[path] = new Set();
    const info = fileInfo[path];
    if (!info) continue;

    for (const otherPath of paths) {
      if (otherPath === path) continue;
      const otherInfo = fileInfo[otherPath];
      if (!otherInfo) continue;

      let linked = false;

      // HTML defines IDs/classes → CSS/JS references them
      if (info.type === 'html') {
        if (otherInfo.type === 'css') {
          for (const id of info.ids) { if (otherInfo.idSelectors?.has(id)) linked = true; }
          for (const cls of info.classes) { if (otherInfo.classSelectors?.has(cls)) linked = true; }
        }
        if (otherInfo.type === 'js') {
          for (const id of info.ids) { if (otherInfo.idRefs?.has(id)) linked = true; }
          for (const cls of info.classes) { if (otherInfo.classRefs?.has(cls)) linked = true; }
        }
      }

      // CSS references IDs/classes → HTML defines them
      if (info.type === 'css') {
        if (otherInfo.type === 'html') {
          for (const id of info.idSelectors) { if (otherInfo.ids?.has(id)) linked = true; }
          for (const cls of info.classSelectors) { if (otherInfo.classes?.has(cls)) linked = true; }
        }
      }

      // JS references IDs/classes → HTML defines them
      if (info.type === 'js') {
        if (otherInfo.type === 'html') {
          for (const id of info.idRefs) { if (otherInfo.ids?.has(id)) linked = true; }
          for (const cls of info.classRefs) { if (otherInfo.classes?.has(cls)) linked = true; }
        }
      }

      if (linked) deps[path].add(otherPath);
    }
  }

  return deps;
};

// ── Main impact analysis ────────────────────────────────

/**
 * Analyze the impact of a change in one file on all other files.
 *
 * @param {string} changedPath - Path of the file that changed
 * @param {string} oldContent  - Previous content
 * @param {string} newContent  - New content after change
 * @param {Object} allFiles    - Map of { path: content } for all files
 * @returns {{ impacts: Array, summary: string }}
 */
export const analyzeImpact = (changedPath, oldContent, newContent, allFiles) => {
  const type = getFileType(changedPath);
  if (type === 'unknown') return { impacts: [], summary: '' };

  // Don't analyze if content is the same
  if (oldContent === newContent) return { impacts: [], summary: '' };

  const impacts = [];

  if (type === 'html') {
    // Extract IDs and classes before and after
    const oldIds = extractHtmlIdentifiers(oldContent || '');
    const newIds = extractHtmlIdentifiers(newContent || '');

    // Find removed or renamed IDs
    const removedIds = [...oldIds.ids].filter(id => !newIds.ids.has(id));
    const removedClasses = [...oldIds.classes].filter(cls => !newIds.classes.has(cls));

    // Check which other files reference these removed IDs/classes
    for (const [path, content] of Object.entries(allFiles)) {
      if (path === changedPath || !content) continue;
      const ft = getFileType(path);

      if (ft === 'css') {
        const { idSelectors, classSelectors } = extractCssSelectors(content);
        for (const id of removedIds) {
          if (idSelectors.has(id)) {
            impacts.push({
              file: path,
              type: 'css_broken_id',
              identifier: `#${id}`,
              severity: 'warning',
              predictedError: `CSS rule #${id} { ... } will have no effect — the element was removed/renamed`,
              description: `Selector #${id} in ${path.split('/').pop()} references a removed element`,
            });
          }
        }
        for (const cls of removedClasses) {
          if (classSelectors.has(cls)) {
            impacts.push({
              file: path,
              type: 'css_broken_class',
              identifier: `.${cls}`,
              severity: 'warning',
              predictedError: `CSS rule .${cls} { ... } will have no effect — the class was removed`,
              description: `Selector .${cls} in ${path.split('/').pop()} references a removed class`,
            });
          }
        }
      }

      if (ft === 'js') {
        const { idRefs, classRefs } = extractJsSelectors(content);
        for (const id of removedIds) {
          if (idRefs.has(id)) {
            impacts.push({
              file: path,
              type: 'js_broken_id',
              identifier: id,
              severity: 'error',
              predictedError: `Cannot read properties of null — getElementById("${id}") will return null`,
              description: `JS in ${path.split('/').pop()} uses getElementById("${id}") but the element was removed`,
            });
          }
        }
        for (const cls of removedClasses) {
          if (classRefs.has(cls)) {
            impacts.push({
              file: path,
              type: 'js_broken_class',
              identifier: cls,
              severity: 'warning',
              predictedError: `getElementsByClassName("${cls}") will return an empty collection`,
              description: `JS in ${path.split('/').pop()} queries class "${cls}" but it was removed`,
            });
          }
        }
      }
    }
  }

  if (type === 'css') {
    // CSS changed → check if new selectors reference IDs/classes that don't exist in HTML
    const oldSel = extractCssSelectors(oldContent || '');
    const newSel = extractCssSelectors(newContent || '');

    // Find newly added selectors
    const addedIds = [...newSel.idSelectors].filter(s => !oldSel.idSelectors.has(s));
    const addedClasses = [...newSel.classSelectors].filter(s => !oldSel.classSelectors.has(s));

    // Find removed selectors (existing HTML elements lose styling)
    const removedIds = [...oldSel.idSelectors].filter(s => !newSel.idSelectors.has(s));
    const removedClasses = [...oldSel.classSelectors].filter(s => !newSel.classSelectors.has(s));

    for (const [path, content] of Object.entries(allFiles)) {
      if (path === changedPath || !content) continue;
      if (getFileType(path) !== 'html') continue;

      const htmlIds = extractHtmlIdentifiers(content);

      for (const id of removedIds) {
        if (htmlIds.ids.has(id)) {
          impacts.push({
            file: path,
            type: 'css_removed_rule',
            identifier: `#${id}`,
            severity: 'warning',
            predictedError: `Element #${id} in ${path.split('/').pop()} will lose its CSS styling`,
            description: `CSS rule for #${id} was removed`,
          });
        }
      }

      for (const cls of removedClasses) {
        if (htmlIds.classes.has(cls)) {
          impacts.push({
            file: path,
            type: 'css_removed_rule',
            identifier: `.${cls}`,
            severity: 'warning',
            predictedError: `Elements with class .${cls} in ${path.split('/').pop()} will lose styling`,
            description: `CSS rule for .${cls} was removed`,
          });
        }
      }
    }
  }

  if (type === 'js') {
    // JS changed → check if new DOM selectors reference IDs that exist
    const oldSel = extractJsSelectors(oldContent || '');
    const newSel = extractJsSelectors(newContent || '');

    // Find newly added selectors that don't match any HTML
    const addedIds = [...newSel.idRefs].filter(s => !oldSel.idRefs.has(s));

    for (const [path, content] of Object.entries(allFiles)) {
      if (path === changedPath || !content) continue;
      if (getFileType(path) !== 'html') continue;

      const htmlIds = extractHtmlIdentifiers(content);

      for (const id of addedIds) {
        if (!htmlIds.ids.has(id)) {
          impacts.push({
            file: path,
            type: 'js_missing_element',
            identifier: id,
            severity: 'error',
            predictedError: `getElementById("${id}") will return null — element doesn't exist in HTML`,
            description: `JS references #${id} but it doesn't exist in ${path.split('/').pop()}`,
          });
        }
      }
    }
  }

  // Build summary
  const affectedFiles = [...new Set(impacts.map(i => i.file.split('/').pop()))];
  const errorCount = impacts.filter(i => i.severity === 'error').length;
  const warningCount = impacts.filter(i => i.severity === 'warning').length;

  let summary = '';
  if (impacts.length > 0) {
    const parts = [];
    if (errorCount > 0) parts.push(`${errorCount} error${errorCount > 1 ? 's' : ''}`);
    if (warningCount > 0) parts.push(`${warningCount} warning${warningCount > 1 ? 's' : ''}`);
    summary = `May cause ${parts.join(' and ')} in ${affectedFiles.join(', ')}`;
  }

  return { impacts, summary, affectedFiles };
};

export default analyzeImpact;
