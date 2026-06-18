/* -------------------------------------------------------
 * codeShotRenderer.js — CodeShot Image Renderer
 *
 * Renders a styled code card as a DOM element, captures it
 * to PNG using html-to-image, and returns the result as a
 * Blob + data URL.
 *
 * Uses Monaco's `editor.colorize()` for syntax highlighting
 * so the output matches the editor theme exactly.
 * ------------------------------------------------------- */

import { toPng, toBlob } from 'html-to-image';

/**
 * Colorize code using Monaco's built-in tokenizer.
 * Falls back to plain-text wrapping if Monaco isn't available.
 *
 * @param {string} code     - The code string to colorize
 * @param {string} language - Monaco language ID (e.g. 'javascript')
 * @returns {Promise<string>} HTML string with syntax highlighting
 */
async function colorizeCode(code, language) {
  // Monaco exposes a global via @monaco-editor/react
  const monaco = window.monaco || (await import('monaco-editor')).default;

  if (monaco?.editor?.colorize) {
    try {
      const html = await monaco.editor.colorize(code, language, {
        tabSize: 2,
      });
      return html;
    } catch (err) {
      console.warn('[CodeShot] Monaco colorize failed, using plain text:', err);
    }
  }

  // Fallback: escape HTML and wrap in a <pre>-friendly span
  const escaped = code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<span style="color:#D4D4D4">${escaped}</span>`;
}

/**
 * Build the line numbers HTML for a code block.
 *
 * @param {number} startLine - 1-indexed start line
 * @param {number} lineCount - Number of lines
 * @returns {string} HTML string for line numbers column
 */
function buildLineNumbers(startLine, lineCount) {
  const lines = [];
  for (let i = 0; i < lineCount; i++) {
    lines.push(`<div style="text-align:right;color:#3E3E3E;font-size:12px;line-height:20px;padding-right:12px;user-select:none;">${startLine + i}</div>`);
  }
  return lines.join('');
}

/**
 * Render a CodeShot card as a PNG.
 *
 * @param {Object} config
 * @param {string}  config.code       - Selected code text
 * @param {string}  config.language   - Language ID for highlighting
 * @param {string}  config.filePath   - File path to display
 * @param {number}  config.startLine  - Start line number (1-indexed)
 * @param {number}  config.endLine    - End line number (1-indexed)
 * @param {string}  config.branch     - Git branch name
 * @param {string}  config.timestamp  - Formatted timestamp string
 * @returns {Promise<{ blob: Blob, dataUrl: string }>}
 */
export async function renderCodeShot({
  code,
  language,
  filePath,
  startLine,
  endLine,
  branch,
  timestamp,
}) {
  // Colorize the code
  const colorizedHtml = await colorizeCode(code, language);
  const lineCount = code.split('\n').length;
  const lineNumbersHtml = buildLineNumbers(startLine, lineCount);

  // File name for the title bar
  const fileName = filePath.split('/').pop() || filePath;

  // Build the card DOM
  const card = document.createElement('div');
  card.setAttribute('id', 'codeshot-capture-target');
  card.style.cssText = `
    position: fixed;
    left: -9999px;
    top: -9999px;
    z-index: -1;
    width: 720px;
    background: #0A0A0A;
    border-radius: 12px;
    border: 1px solid #2E2E2E;
    overflow: hidden;
    font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
    box-shadow: 0 24px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.05);
  `;

  card.innerHTML = `
    <!-- Title bar -->
    <div style="
      display: flex;
      align-items: center;
      padding: 12px 16px;
      background: #111111;
      border-bottom: 1px solid #1E1E1E;
      gap: 10px;
    ">
      <!-- Window dots -->
      <div style="display:flex;gap:6px;flex-shrink:0;">
        <div style="width:10px;height:10px;border-radius:50%;background:#FF5F57;"></div>
        <div style="width:10px;height:10px;border-radius:50%;background:#FEBC2E;"></div>
        <div style="width:10px;height:10px;border-radius:50%;background:#28C840;"></div>
      </div>
      <!-- File name -->
      <div style="
        flex: 1;
        text-align: center;
        font-size: 12px;
        font-weight: 600;
        color: #A0A0A0;
        letter-spacing: 0.02em;
        font-family: 'Space Grotesk', 'Inter', sans-serif;
      ">${fileName}</div>
      <!-- Causify brand -->
      <div style="
        font-size: 9px;
        font-weight: 700;
        letter-spacing: 0.1em;
        color: #3E3E3E;
        text-transform: uppercase;
        flex-shrink: 0;
      ">CAUSIFY</div>
    </div>

    <!-- Code area -->
    <div style="
      display: flex;
      padding: 16px 0;
      overflow: hidden;
    ">
      <!-- Line numbers -->
      <div style="
        padding: 0 0 0 16px;
        flex-shrink: 0;
        border-right: 1px solid #1E1E1E;
      ">${lineNumbersHtml}</div>

      <!-- Code content -->
      <div style="
        flex: 1;
        padding: 0 16px;
        overflow: hidden;
        font-size: 13px;
        line-height: 20px;
        white-space: pre;
        color: #D4D4D4;
        tab-size: 2;
      ">${colorizedHtml}</div>
    </div>

    <!-- Metadata footer -->
    <div style="
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 16px;
      background: #080808;
      border-top: 1px solid #1E1E1E;
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      color: #4A4A4A;
      letter-spacing: 0.03em;
    ">
      <div style="display:flex;align-items:center;gap:8px;overflow:hidden;">
        <span style="color:#6E6E6E;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${filePath}</span>
        <span style="color:#2E2E2E;">·</span>
        <span style="color:#A0A0A0;font-weight:600;">L${startLine}–L${endLine}</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
        ${branch ? `<span style="color:#6E6E6E;display:flex;align-items:center;gap:4px;">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="3" x2="6" y2="15"></line><circle cx="18" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><path d="M18 9a9 9 0 0 1-9 9"></path></svg>
          ${branch}
        </span>` : ''}
        <span style="color:#2E2E2E;">·</span>
        <span>${timestamp}</span>
      </div>
    </div>
  `;

  // Append offscreen, capture, remove
  document.body.appendChild(card);

  try {
    // Give Monaco colorize HTML a frame to paint
    await new Promise((r) => requestAnimationFrame(r));

    const dataUrl = await toPng(card, {
      pixelRatio: 2, // Retina-quality
      cacheBust: true,
      style: {
        // Override the offscreen positioning for capture
        position: 'static',
        left: 'auto',
        top: 'auto',
      },
    });

    const blob = await toBlob(card, {
      pixelRatio: 2,
      cacheBust: true,
      style: {
        position: 'static',
        left: 'auto',
        top: 'auto',
      },
    });

    return { blob, dataUrl };
  } finally {
    document.body.removeChild(card);
  }
}
