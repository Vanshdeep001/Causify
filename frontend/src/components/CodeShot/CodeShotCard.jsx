/* -------------------------------------------------------
 * CodeShotCard.jsx — Visual Code Card Component
 *
 * Renders the styled code card used both as the live preview
 * inside the CodeShot modal AND as the DOM element captured
 * to PNG by codeShotRenderer.js.
 *
 * Uses Monaco's editor.colorize() for syntax highlighting,
 * keeping the output consistent with the editor theme.
 * ------------------------------------------------------- */

import React, { useEffect, useState, useRef } from 'react';

const CodeShotCard = ({ code, language, filePath, startLine, endLine, branch, timestamp }) => {
  const [colorizedHtml, setColorizedHtml] = useState('');
  const cardRef = useRef(null);

  const fileName = filePath ? filePath.split('/').pop() : 'untitled';
  const lines = code ? code.split('\n') : [];
  const lineCount = lines.length;

  // Colorize code using Monaco's tokenizer
  useEffect(() => {
    let cancelled = false;

    const colorize = async () => {
      const monaco = window.monaco;
      if (monaco?.editor?.colorize) {
        try {
          const html = await monaco.editor.colorize(code || '', language || 'plaintext', {
            tabSize: 2,
          });
          if (!cancelled) setColorizedHtml(html);
          return;
        } catch (err) {
          console.warn('[CodeShotCard] Monaco colorize failed:', err);
        }
      }

      // Fallback: plain text with escaping
      const escaped = (code || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      if (!cancelled) setColorizedHtml(`<span style="color:#D4D4D4">${escaped}</span>`);
    };

    colorize();
    return () => { cancelled = true; };
  }, [code, language]);

  return (
    <div
      ref={cardRef}
      className="codeshot-card"
      style={{
        width: '100%',
        maxWidth: '720px',
        background: '#0A0A0A',
        borderRadius: '12px',
        border: '1px solid #2E2E2E',
        overflow: 'hidden',
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
        boxShadow: '0 24px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.05)',
      }}
    >
      {/* ── Title Bar ── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        padding: '12px 16px',
        background: '#111111',
        borderBottom: '1px solid #1E1E1E',
        gap: '10px',
      }}>
        {/* Window dots */}
        <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
          <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#FF5F57' }} />
          <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#FEBC2E' }} />
          <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#28C840' }} />
        </div>
        {/* File name */}
        <div style={{
          flex: 1,
          textAlign: 'center',
          fontSize: '12px',
          fontWeight: 600,
          color: '#A0A0A0',
          letterSpacing: '0.02em',
          fontFamily: "'Space Grotesk', 'Inter', sans-serif",
        }}>
          {fileName}
        </div>
        {/* Brand */}
        <div style={{
          fontSize: '9px',
          fontWeight: 700,
          letterSpacing: '0.1em',
          color: '#3E3E3E',
          textTransform: 'uppercase',
          flexShrink: 0,
        }}>
          CAUSIFY
        </div>
      </div>

      {/* ── Code Area ── */}
      <div style={{
        display: 'flex',
        padding: '16px 0',
        overflow: 'hidden',
      }}>
        {/* Line numbers */}
        <div style={{
          padding: '0 0 0 16px',
          flexShrink: 0,
          borderRight: '1px solid #1E1E1E',
        }}>
          {Array.from({ length: lineCount }, (_, i) => (
            <div
              key={i}
              style={{
                textAlign: 'right',
                color: '#3E3E3E',
                fontSize: '13px',
                lineHeight: '20px',
                paddingRight: '12px',
                userSelect: 'none',
              }}
            >
              {startLine + i}
            </div>
          ))}
        </div>

        {/* Code content */}
        <div
          style={{
            flex: 1,
            padding: '0 16px',
            overflow: 'hidden',
            fontSize: '13px',
            lineHeight: '20px',
            whiteSpace: 'pre',
            color: '#D4D4D4',
            tabSize: 2,
          }}
          dangerouslySetInnerHTML={{ __html: colorizedHtml }}
        />
      </div>

      {/* ── Metadata Footer ── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 16px',
        background: '#080808',
        borderTop: '1px solid #1E1E1E',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '10px',
        color: '#4A4A4A',
        letterSpacing: '0.03em',
        flexWrap: 'wrap',
        gap: '4px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
          <span style={{
            color: '#6E6E6E',
            maxWidth: '300px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {filePath}
          </span>
          <span style={{ color: '#2E2E2E' }}>·</span>
          <span style={{ color: '#A0A0A0', fontWeight: 600 }}>
            L{startLine}–L{endLine}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          {branch && (
            <>
              <span style={{ color: '#6E6E6E', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="6" y1="3" x2="6" y2="15" />
                  <circle cx="18" cy="6" r="3" />
                  <circle cx="6" cy="18" r="3" />
                  <path d="M18 9a9 9 0 0 1-9 9" />
                </svg>
                {branch}
              </span>
              <span style={{ color: '#2E2E2E' }}>·</span>
            </>
          )}
          <span>{timestamp}</span>
        </div>
      </div>
    </div>
  );
};

export default CodeShotCard;
