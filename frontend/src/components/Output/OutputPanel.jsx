/* -------------------------------------------------------
 * OutputPanel.jsx — Execution Output with Smart Root Cause Analysis
 * ------------------------------------------------------- */

import React, { useState } from 'react';
import useEditorStore from '../../store/useEditorStore';
import HtmlPreview from '../Preview/HtmlPreview';
import DevServerPanel from '../Terminal/DevServerPanel';

const LogLine = ({ type, message, timestamp }) => {
  const tagClass =
    type === 'stdout' ? 'tag-stdout' :
      type === 'stderr' ? 'tag-stderr' : 'tag-system';

  const tagLabel =
    type === 'stdout' ? 'out' :
      type === 'stderr' ? 'err' : 'sys';

  const parts = message.split(/(\[Causify\]|Successfully|Error|Critical)/i);

  return (
    <div className="log-line-item">
      <span className="log-timestamp">{timestamp}</span>
      <span className={`log-tag ${tagClass}`}>{tagLabel}</span>
      <div className="log-content">
        {parts.map((part, i) => {
          const isHighlight = /\[Causify\]|Successfully|Error|Critical/i.test(part);
          return isHighlight ? <span key={i} className="content-highlight">{part}</span> : part;
        })}
      </div>
    </div>
  );
};

/* ── Smart Root Cause Analysis Card ── */
const RootCauseCard = ({ rootCause, code }) => {
  const [isExpanded, setIsExpanded] = useState(true);

  if (!rootCause) return null;

  const hasAi = rootCause.fullAiAnalysis || rootCause.whatHappened;
  const confidence = rootCause.confidence || 0;
  const confidencePercent = Math.round(confidence * 100);
  const confidenceColor = confidence >= 0.8 ? '#c1ff72' : confidence >= 0.5 ? '#fbbf24' : '#ff3e3e';

  // Get the failing line from code
  const getCodeLine = (lineNum) => {
    if (!code || !lineNum || lineNum <= 0) return null;
    const lines = code.split('\n');
    return lineNum <= lines.length ? lines[lineNum - 1] : null;
  };

  const errorLine = rootCause.errorLine;
  const failingCode = getCodeLine(errorLine);

  // Parse howToFix to extract code blocks
  const parseFixContent = (text) => {
    if (!text) return { explanation: '', code: '' };
    const codeMatch = text.match(/```[\w]*\n?([\s\S]*?)```/);
    if (codeMatch) {
      const explanation = text.substring(0, text.indexOf('```')).trim();
      const codeBlock = codeMatch[1].trim();
      return { explanation, code: codeBlock };
    }
    return { explanation: text, code: '' };
  };

  const fixContent = parseFixContent(rootCause.howToFix);

  // Parse rootCauseChain into steps
  const parseChain = (text) => {
    if (!text) return [];
    return text.split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0)
      .map(l => l.replace(/^\d+[\.\)]\s*/, '').replace(/^\*\s*/, '').replace(/^-\s*/, ''));
  };

  const chainSteps = parseChain(rootCause.rootCauseChain);

  return (
    <div className="rca-card">
      {/* Accent top bar */}
      <div className="rca-accent-bar" />

      {/* Header */}
      <div className="rca-header" onClick={() => setIsExpanded(!isExpanded)}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
          <div className="rca-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#c1ff72" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </div>
          <div>
            <div className="rca-title">
              ROOT CAUSE ANALYSIS
            </div>
            <div className="rca-subtitle">
              {rootCause.errorType}
              {errorLine > 0 && <span> · Line {errorLine}</span>}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* Confidence badge */}
          <div className="rca-confidence" style={{ borderColor: confidenceColor, color: confidenceColor }}>
            <div className="rca-confidence-bar" style={{ width: `${confidencePercent}%`, background: confidenceColor }} />
            <span>{confidencePercent}%</span>
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="2"
            style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s' }}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </div>

      {isExpanded && (
        <div className="rca-body">

          {/* ── Section 1: What Happened ── */}
          {rootCause.whatHappened && (
            <div className="rca-section" style={{ animationDelay: '0.05s' }}>
              <div className="rca-section-label">
                <span className="rca-section-icon">»</span> WHAT HAPPENED
              </div>
              <div className="rca-what-happened">
                {rootCause.whatHappened}
              </div>
            </div>
          )}

          {/* ── Section 2: Error Location (code snippet) ── */}
          {failingCode && (
            <div className="rca-section" style={{ animationDelay: '0.1s' }}>
              <div className="rca-section-label">
                <span className="rca-section-icon">&gt;</span> ERROR LOCATION
              </div>
              <div className="rca-code-viewer">
                {errorLine > 1 && getCodeLine(errorLine - 1) && (
                  <div className="rca-code-line rca-code-context">
                    <span className="rca-line-num">{errorLine - 1}</span>
                    <span className="rca-line-code">{getCodeLine(errorLine - 1)}</span>
                  </div>
                )}
                <div className="rca-code-line rca-code-error">
                  <span className="rca-line-num">{errorLine}</span>
                  <span className="rca-line-code">{failingCode}</span>
                  <span className="rca-error-tag">← {rootCause.errorMessage?.length > 40 ? rootCause.errorMessage.substring(0, 40) + '...' : rootCause.errorMessage}</span>
                </div>
                {getCodeLine(errorLine + 1) && (
                  <div className="rca-code-line rca-code-context">
                    <span className="rca-line-num">{errorLine + 1}</span>
                    <span className="rca-line-code">{getCodeLine(errorLine + 1)}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Section 3: Root Cause Chain ── */}
          {chainSteps.length > 0 && (
            <div className="rca-section" style={{ animationDelay: '0.15s' }}>
              <div className="rca-section-label">
                <span className="rca-section-icon">&gt;</span> ROOT CAUSE CHAIN
              </div>
              <div className="rca-chain">
                {chainSteps.map((step, i) => (
                  <div key={i} className="rca-chain-step">
                    <div className="rca-chain-num">{i + 1}</div>
                    <div className="rca-chain-text">{step}</div>
                    {i < chainSteps.length - 1 && (
                      <div className="rca-chain-arrow">↓</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Section 4: Suggested Fix ── */}
          {(fixContent.code || fixContent.explanation) && (
            <div className="rca-section" style={{ animationDelay: '0.2s' }}>
              <div className="rca-section-label">
                <span className="rca-section-icon">&gt;</span> SUGGESTED FIX
              </div>
              {fixContent.explanation && (
                <div className="rca-fix-explanation">{fixContent.explanation}</div>
              )}
              {fixContent.code && (
                <div className="rca-fix-code">
                  <div className="rca-fix-code-header">
                    <span>CORRECTED CODE</span>
                  </div>
                  <pre className="rca-fix-pre">{fixContent.code}</pre>
                </div>
              )}
            </div>
          )}

          {/* ── Section 5: Pro Tip ── */}
          {rootCause.proTip && (
            <div className="rca-section" style={{ animationDelay: '0.25s' }}>
              <div className="rca-pro-tip">
                <span className="rca-pro-tip-icon">TIP</span>
                <span>{rootCause.proTip}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const OutputPanel = () => {
  const output = useEditorStore((s) => s.output);
  const error = useEditorStore((s) => s.error);
  const isRunning = useEditorStore((s) => s.isRunning);
  const rootCause = useEditorStore((s) => s.rootCause);
  const sessionId = useEditorStore((s) => s.sessionId);
  const code = useEditorStore((s) => s.code);
  const files = useEditorStore((s) => s.files);
  const detectedProjects = useEditorStore((s) => s.detectedProjects);

  const timestamp = new Date().toLocaleTimeString([], { hour12: false });

  // ── Render Dev Server for React/Node projects ──
  if (detectedProjects && detectedProjects.length > 0) {
    return <DevServerPanel />;
  }

  // ── Render HTML Preview for Static Web projects ──
  const hasHtmlFile = files && Object.keys(files).some(p => p.toLowerCase().endsWith('.html'));
  if (hasHtmlFile) {
    return <HtmlPreview />;
  }

  if (isRunning) {
    return (
      <div className="output-placeholder terminal-window-pane" style={{ position: 'relative', overflow: 'hidden' }}>
        <div className="terminal-scanlines"></div>
        <div className="diagnostic-loading">
          <div className="loading-spinner" style={{ width: 40, height: 40, borderWidth: '4px', borderColor: 'var(--accent-toxic-green) transparent' }}></div>
          <div style={{ marginTop: 24, letterSpacing: '0.2em' }} className="ai-header-glitch">SCANNING EXECUTION FLOW...</div>
          <div style={{ fontSize: '0.6rem', opacity: 0.5, marginTop: 8, fontFamily: 'var(--font-number)' }}>TRACE_ID: {Math.random().toString(36).substring(7).toUpperCase()}</div>
        </div>
      </div>
    );
  }

  if (!output && !error) {
    return (
      <div className="output-placeholder terminal-window-pane">
        <div className="terminal-scanlines" />
        <div style={{ textAlign: 'center', opacity: 0.3 }}>
          <div style={{ fontSize: '2rem', marginBottom: 12 }}>⚡</div>
          <div className="tech-label" style={{ border: 'none', background: 'transparent' }}>SYSTEM_IDLE // AWAITING_SEQUENCE</div>
        </div>
      </div>
    );
  }

  return (
    <div className="terminal-window-pane">
      <div className="terminal-scanlines" />

      {/* System Meta Header */}
      <div className="terminal-meta-header">
        <div><span className="status-pulse" /> TERMINAL_ACTIVE</div>
        <div>SESSION_ID: {sessionId?.substring(0, 12)}</div>
      </div>

      <div className="terminal-log-area" style={{ flex: 1, overflowY: 'auto', padding: '12px 0' }}>
        {output && output.split('\n').filter(l => l.trim()).map((line, idx) => (
          <LogLine key={`out-${idx}`} type="stdout" message={line} timestamp={timestamp} />
        ))}

        {error && error.split('\n').filter(l => l.trim()).map((line, idx) => (
          <LogLine key={`err-${idx}`} type="stderr" message={line} timestamp={timestamp} />
        ))}

        {rootCause && (
          <div style={{ padding: '0 12px', marginTop: '16px' }}>
            <RootCauseCard rootCause={rootCause} code={code} />
          </div>
        )}
      </div>
    </div>
  );
};

export default OutputPanel;
