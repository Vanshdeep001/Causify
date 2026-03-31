/* -------------------------------------------------------
 * diffUtils.js — Line-Level Diff Computation
 * 
 * Computes the differences between two code strings.
 * Used to track what changed between snapshots.
 * ------------------------------------------------------- */

// Compare two code strings line by line and return diffs
export function computeDiff(oldCode, newCode) {
  const oldLines = (oldCode || '').split('\n');
  const newLines = (newCode || '').split('\n');
  const diffs = [];

  const maxLen = Math.max(oldLines.length, newLines.length);

  for (let i = 0; i < maxLen; i++) {
    const oldLine = i < oldLines.length ? oldLines[i] : undefined;
    const newLine = i < newLines.length ? newLines[i] : undefined;

    if (oldLine === undefined) {
      // Line was added
      diffs.push({ type: 'added', line: i + 1, content: newLine });
    } else if (newLine === undefined) {
      // Line was removed
      diffs.push({ type: 'removed', line: i + 1, content: oldLine });
    } else if (oldLine !== newLine) {
      // Line was modified
      diffs.push({ type: 'modified', line: i + 1, oldContent: oldLine, newContent: newLine });
    }
  }

  return diffs;
}

// Extract variable names from a line of code (simple heuristic)
export function extractVariables(line) {
  // Remove strings and comments
  const cleaned = line
    .replace(/"[^"]*"/g, '')
    .replace(/'[^']*'/g, '')
    .replace(/`[^`]*`/g, '')
    .replace(/\/\/.*$/, '')
    .replace(/\/\*.*\*\//g, '');

  // Match variable-like identifiers (exclude common keywords)
  const keywords = new Set([
    'var', 'let', 'const', 'function', 'return', 'if', 'else', 'for',
    'while', 'do', 'switch', 'case', 'break', 'continue', 'new', 'this',
    'class', 'import', 'export', 'default', 'from', 'try', 'catch',
    'throw', 'typeof', 'instanceof', 'null', 'undefined', 'true', 'false',
    'console', 'log', 'error', 'warn', 'Math', 'String', 'Number',
    'Array', 'Object', 'JSON', 'parseInt', 'parseFloat', 'async', 'await',
  ]);

  const matches = cleaned.match(/[a-zA-Z_$][a-zA-Z0-9_$]*/g) || [];
  return [...new Set(matches.filter((m) => !keywords.has(m)))];
}

// Find which variables were modified in a diff
export function findModifiedVariables(diffs) {
  const variables = new Set();
  for (const diff of diffs) {
    if (diff.type === 'added' || diff.type === 'modified') {
      const content = diff.newContent || diff.content;
      // Look for assignment patterns: varName = ...
      const assignmentMatch = content.match(/(?:let|const|var)?\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=/);
      if (assignmentMatch) {
        variables.add(assignmentMatch[1]);
      }
    }
  }
  return [...variables];
}

// Format a diff for display
export function formatDiff(diff) {
  switch (diff.type) {
    case 'added':
      return `+ Line ${diff.line}: ${diff.content}`;
    case 'removed':
      return `- Line ${diff.line}: ${diff.content}`;
    case 'modified':
      return `~ Line ${diff.line}: ${diff.oldContent} → ${diff.newContent}`;
    default:
      return '';
  }
}
