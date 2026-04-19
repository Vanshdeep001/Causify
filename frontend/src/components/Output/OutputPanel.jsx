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

  const parts = message.split(/(\\[Causify\\]|Successfully|Error|Critical)/i);

  return (
    <div className="log-line-item">
      <span className="log-timestamp">{timestamp}</span>
      <span className={`log-tag ${tagClass}`}>{tagLabel}</span>
      <div className="log-content">
        {parts.map((part, i) => {
          const isHighlight = /\\[Causify\\]|Successfully|Error|Critical/i.test(part);
          return isHighlight ? <span key={i} className="content-highlight">{part}</span> : part;
        })}
      </div>
    </div>
  );
};

/* ── Animated SVG Confidence Ring ── */
const ConfidenceRing = ({ percent, color, size = 52 }) => {
  const r = (size - 8) / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (percent / 100) * circumference;

  return (
    <div className="rca2-ring-wrap" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Track */}
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke="#1a1a1a" strokeWidth="4"
        />
        {/* Progress */}
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke={color} strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset 1s ease', filter: `drop-shadow(0 0 4px ${color})` }}
        />
      </svg>
      <span className="rca2-ring-text" style={{ color }}>{percent}%</span>
    </div>
  );
};

/* ── Smart Root Cause Analysis Card — v2 Redesign ── */
const RootCauseCard = ({ rootCause, code }) => {
  const [expandedSections, setExpandedSections] = useState({
    what: true, location: true, chain: false, fix: true, tip: true
  });

  if (!rootCause) return null;

  const confidence = rootCause.confidence || 0;
  const confidencePercent = Math.round(confidence * 100);
  const confidenceColor = confidence >= 0.8 ? '#c1ff72' : confidence >= 0.5 ? '#fbbf24' : '#ff3e3e';

  const toggleSection = (key) => {
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const getCodeLine = (lineNum) => {
    if (!code || !lineNum || lineNum <= 0) return null;
    const lines = code.split('\n');
    return lineNum <= lines.length ? lines[lineNum - 1] : null;
  };

  const errorLine = rootCause.errorLine;
  const failingCode = getCodeLine(errorLine);

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

  const parseChain = (text) => {
    if (!text) return [];
    return text.split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0)
      .map(l => l.replace(/^\d+[\.)]\\s*/, '').replace(/^\*\\s*/, '').replace(/^-\\s*/, ''));
  };

  const chainSteps = parseChain(rootCause.rootCauseChain);

  /* Section header component */
  const SectionHead = ({ icon, label, color, sectionKey, children }) => (
    <div className="rca2-section">
      <div className="rca2-section-head" onClick={() => toggleSection(sectionKey)}>
        <div className="rca2-section-dot" style={{ background: color, boxShadow: `0 0 8px ${color}40` }} />
        <div className="rca2-section-pipe" />
        <div className="rca2-section-icon" style={{ borderColor: `${color}40`, background: `${color}0a` }}>
          {icon}
        </div>
        <span className="rca2-section-label">{label}</span>
        <svg className="rca2-section-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none"
          stroke="#555" strokeWidth="2.5" style={{ transform: expandedSections[sectionKey] ? 'rotate(180deg)' : 'rotate(0)' }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>
      {expandedSections[sectionKey] && (
        <div className="rca2-section-content">{children}</div>
      )}
    </div>
  );

  return (
    <div className="rca2-card">
      {/* ── Animated border glow ── */}
      <div className="rca2-glow-border" />

      {/* ── Header ── */}
      <div className="rca2-header">
        <div className="rca2-header-left">
          <div className="rca2-badge-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
              <path d="M12 16v-4" />
              <path d="M12 8h.01" />
            </svg>
          </div>
          <div>
            <div className="rca2-header-title">Diagnostic Report</div>
            <div className="rca2-header-meta">
              <span className="rca2-error-type">{rootCause.errorType}</span>
              {errorLine > 0 && <span className="rca2-error-line">Line {errorLine}</span>}
            </div>
          </div>
        </div>
        <ConfidenceRing percent={confidencePercent} color={confidenceColor} />
      </div>

      {/* ── Pipeline Body ── */}
      <div className="rca2-body">

        {/* Section: What Happened */}
        {rootCause.whatHappened && (
          <SectionHead
            icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#c1ff72" strokeWidth="2.5"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>}
            label="WHAT HAPPENED"
            color="#c1ff72"
            sectionKey="what"
          >
            <div className="rca2-explanation">{rootCause.whatHappened}</div>
          </SectionHead>
        )}

        {/* Section: Error Location */}
        {failingCode && (
          <SectionHead
            icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ff3e3e" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>}
            label="ERROR LOCATION"
            color="#ff3e3e"
            sectionKey="location"
          >
            <div className="rca2-code-viewer">
              {errorLine > 1 && getCodeLine(errorLine - 1) && (
                <div className="rca2-code-line rca2-ctx">
                  <span className="rca2-ln">{errorLine - 1}</span>
                  <span className="rca2-lc">{getCodeLine(errorLine - 1)}</span>
                </div>
              )}
              <div className="rca2-code-line rca2-err">
                <span className="rca2-ln">{errorLine}</span>
                <span className="rca2-lc">{failingCode}</span>
                <span className="rca2-err-msg">
                  {rootCause.errorMessage?.length > 40
                    ? rootCause.errorMessage.substring(0, 40) + '...'
                    : rootCause.errorMessage}
                </span>
              </div>
              {getCodeLine(errorLine + 1) && (
                <div className="rca2-code-line rca2-ctx">
                  <span className="rca2-ln">{errorLine + 1}</span>
                  <span className="rca2-lc">{getCodeLine(errorLine + 1)}</span>
                </div>
              )}
            </div>
          </SectionHead>
        )}

        {/* Section: Root Cause Chain */}
        {chainSteps.length > 0 && (
          <SectionHead
            icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2d5bff" strokeWidth="2.5"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>}
            label="CAUSE CHAIN"
            color="#2d5bff"
            sectionKey="chain"
          >
            <div className="rca2-chain">
              {chainSteps.map((step, i) => (
                <div key={i} className="rca2-chain-item">
                  <div className="rca2-chain-connector">
                    <div className="rca2-chain-dot" style={{
                      background: i === chainSteps.length - 1 ? '#ff3e3e' : '#2d5bff',
                      boxShadow: `0 0 6px ${i === chainSteps.length - 1 ? '#ff3e3e' : '#2d5bff'}50`
                    }} />
                    {i < chainSteps.length - 1 && <div className="rca2-chain-line" />}
                  </div>
                  <div className="rca2-chain-content">
                    <span className="rca2-chain-idx">{String(i + 1).padStart(2, '0')}</span>
                    <span className="rca2-chain-text">{step}</span>
                  </div>
                </div>
              ))}
            </div>
          </SectionHead>
        )}

        {/* Section: Suggested Fix */}
        {(fixContent.code || fixContent.explanation) && (
          <SectionHead
            icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#c1ff72" strokeWidth="2.5"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>}
            label="SUGGESTED FIX"
            color="#c1ff72"
            sectionKey="fix"
          >
            {fixContent.explanation && (
              <div className="rca2-fix-text">{fixContent.explanation}</div>
            )}
            {fixContent.code && (
              <div className="rca2-fix-code">
                <div className="rca2-fix-code-bar">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#c1ff72" strokeWidth="2.5"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
                  <span>Corrected Code</span>
                </div>
                <pre className="rca2-fix-pre">{fixContent.code}</pre>
              </div>
            )}
          </SectionHead>
        )}

        {/* Section: Pro Tip */}
        {rootCause.proTip && (
          <SectionHead
            icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2.5"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>}
            label="PRO TIP"
            color="#fbbf24"
            sectionKey="tip"
          >
            <div className="rca2-tip">{rootCause.proTip}</div>
          </SectionHead>
        )}

        {/* Terminal dot at the end of the pipeline */}
        <div className="rca2-pipeline-end">
          <div className="rca2-section-dot" style={{ background: '#333', width: '6px', height: '6px' }} />
        </div>
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
  const code = useEditorStore((s) => s.code);
  const files = useEditorStore((s) => s.files);
  const detectedProjects = useEditorStore((s) => s.detectedProjects);

  const timestamp = new Date().toLocaleTimeString([], { hour12: false });

  // ── Render Dev Server for React/Node projects ──
  // If we have detected projects, OR it looks like a Node project (has package.json)
  const hasPackageJson = files && Object.keys(files).some(p => p.toLowerCase().endsWith('package.json'));
  
  if ((detectedProjects && detectedProjects.length > 0) || hasPackageJson) {
    return <DevServerPanel />;
  }
  
  // ── Render HTML Preview for Static Web projects (only if no package.json) ──
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
