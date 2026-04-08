/* -------------------------------------------------------
 * OutputPanel.jsx — Execution Output
 * ------------------------------------------------------- */

import React from 'react';
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

  // Highlight [Causify] or specific success/error keywords
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

const OutputPanel = () => {
  const output = useEditorStore((s) => s.output);
  const error = useEditorStore((s) => s.error);
  const isRunning = useEditorStore((s) => s.isRunning);
  const rootCause = useEditorStore((s) => s.rootCause);
  const sessionId = useEditorStore((s) => s.sessionId);
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
          <div style={{ padding: '0 12px', marginTop: '20px' }}>
            <div className={rootCause.fullAiAnalysis ? "ai-analysis-card" : "terminal-analysis-card"}>
              <div className={rootCause.fullAiAnalysis ? "ai-header-glitch" : "impact-text"} style={!rootCause.fullAiAnalysis ? { fontSize: '1.2rem', color: 'var(--accent-toxic-green)', marginBottom: '1rem' } : {}}>
                {rootCause.fullAiAnalysis ? "✨ AI DIAGNOSTIC REPORT" : "ROOT CAUSE ANALYSIS"}
              </div>

              {/* AI Analysis Content remains same as previous but integrated into new theme */}
              <div style={{ color: '#fff', marginBottom: '1.5rem', background: '#222', padding: '12px', border: '1px solid #333' }}>
                <span style={{ color: 'var(--accent-crimson)', fontWeight: 'bold' }}>{rootCause.errorType}</span>: {rootCause.errorMessage}
              </div>

              {rootCause.whatHappened && (
                <div className="ai-section">
                  <div className="ai-section-title">🔍 DIAGNOSTIC OVERVIEW</div>
                  <div className="ai-content" style={{ fontSize: '1.1rem', fontWeight: '500', color: '#fff' }}>
                    {rootCause.whatHappened}
                  </div>
                </div>
              )}

              {rootCause.howToFix && (
                <div className="ai-section">
                  <div className="ai-section-title">🛠️ PROPOSED FIX</div>
                  <div className="ai-fix-block">
                    <pre>{rootCause.howToFix.replace(/```[a-z]*\n/g, '').replace(/```/g, '')}</pre>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default OutputPanel;
