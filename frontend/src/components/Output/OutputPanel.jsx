/* -------------------------------------------------------
 * OutputPanel.jsx — Execution Output
 * ------------------------------------------------------- */

import React from 'react';
import useEditorStore from '../../store/useEditorStore';

const OutputPanel = () => {
  const output = useEditorStore((s) => s.output);
  const error = useEditorStore((s) => s.error);
  const isRunning = useEditorStore((s) => s.isRunning);
  const rootCause = useEditorStore((s) => s.rootCause);

  if (isRunning) {
    return (
      <div className="output-placeholder">
        <div className="loading-spinner" style={{ width: 24, height: 24 }}></div>
        <div className="tech-label" style={{ marginTop: 12, color: '#888' }}>EXECUTING_FABRIC...</div>
      </div>
    );
  }

  if (!output && !error) {
    return (
      <div className="output-placeholder">
        <div className="tech-label" style={{ color: '#444' }}>TERMINAL_READY</div>
      </div>
    );
  }

  return (
    <div className="terminal-log-area" style={{ 
      fontFamily: 'monospace', 
      fontSize: '0.9rem', 
      lineHeight: '1.4',
      color: '#ddd'
    }}>
      {output && (
        <div className="log-entry" style={{ marginBottom: '1rem' }}>
          <span style={{ color: 'var(--accent-toxic-green)', marginRight: '8px' }}>[STDOUT]</span>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', display: 'inline' }}>{output}</pre>
        </div>
      )}

      {error && (
        <div className="log-entry" style={{ marginBottom: '1rem' }}>
          <span style={{ color: 'var(--accent-crimson)', marginRight: '8px' }}>[STDERR]</span>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', color: 'var(--accent-crimson)', display: 'inline' }}>{error}</pre>
        </div>
      )}

      {rootCause && (
        <div className="terminal-analysis-card" style={{ 
          marginTop: '2rem', 
          border: '1px solid #333', 
          padding: '1rem',
          background: '#111'
        }}>
          <div className="impact-text" style={{ fontSize: '1.2rem', color: 'var(--accent-toxic-green)', marginBottom: '1rem' }}>
            // ROOT_CAUSE_ANALYSIS
          </div>
          
          <div style={{ color: '#fff', marginBottom: '1rem', background: '#222', padding: '8px' }}>
            {rootCause.errorType}: {rootCause.errorMessage}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {rootCause.steps?.map((step, idx) => (
              <div key={idx} style={{ display: 'flex', gap: '12px', fontSize: '0.8rem' }}>
                <span style={{ color: '#555' }}>[{step.step}]</span>
                <span style={{ color: 'var(--accent-electric-blue)' }}>{step.label}:</span>
                <span>{step.detail}</span>
              </div>
            ))}
          </div>
          
          {rootCause.explanation && (
            <div style={{ marginTop: '1rem', fontSize: '0.8rem', color: '#888', fontStyle: 'italic' }}>
              &gt; {rootCause.explanation}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default OutputPanel;
