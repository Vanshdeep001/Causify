/* -------------------------------------------------------
 * OutputPanel.jsx — Execution Output with Smart Root Cause Analysis
 * ------------------------------------------------------- */

import React, { useState, useEffect } from 'react';
import useEditorStore from '../../store/useEditorStore';
import HtmlPreview from '../Preview/HtmlPreview';
import DevServerPanel from '../Terminal/DevServerPanel';
import { getAiStatus, saveAiKey } from '../../services/api';

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
/**
 * A collapsible section of the diagnostic report.
 *
 * Declared at module scope on purpose. Defined inside the panel it would be a
 * new component type on every render, so React would discard the existing DOM
 * and rebuild it — restarting the content's entry animation each time the panel
 * re-rendered, which showed up as flickering.
 */
const RcaSection = ({ label, expanded, onToggle, children }) => (
  <div className={`rca2-section ${expanded ? 'is-expanded' : ''}`}>
    <div className="rca2-section-head" onClick={onToggle}>
      <span className="rca2-section-label">{label}</span>
      <svg className="rca2-section-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2.5"
        style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0)' }}>
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </div>
    {expanded && <div className="rca2-section-content">{children}</div>}
  </div>
);

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

/* ── AI Key Setup — shown inside the diagnosis report when no
 *    OpenRouter key is configured on the backend ── */
const AiKeySetupCard = () => {
  const [visible, setVisible] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [status, setStatus] = useState('idle'); // 'idle' | 'saving' | 'success' | 'error'
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    let cancelled = false;
    getAiStatus()
      .then((res) => {
        if (!cancelled && res && res.configured === false) setVisible(true);
      })
      .catch(() => { /* backend unreachable — keep the card hidden */ });
    return () => { cancelled = true; };
  }, []);

  if (!visible) return null;

  const handleActivate = async () => {
    const key = keyInput.trim();
    if (!key || status === 'saving') return;
    setStatus('saving');
    setErrorMsg('');
    try {
      const res = await saveAiKey(key);
      if (res && res.success) {
        // On desktop, also persist encrypted (OS keychain) so the key
        // is re-injected into the backend on every future launch.
        if (window.electronAPI?.setApiKey) {
          try { await window.electronAPI.setApiKey(key); } catch { /* non-fatal */ }
        }
        setStatus('success');
      } else {
        setStatus('error');
        setErrorMsg(res?.error || 'OpenRouter rejected this key.');
      }
    } catch (err) {
      setStatus('error');
      setErrorMsg(err.response?.data?.error || 'Could not verify the key. Check your connection.');
    }
  };

  if (status === 'success') {
    return (
      <div className="rca2-keysetup is-success">
        <div className="rca2-keysetup-head">
          <span className="rca2-keysetup-check">✓</span>
          <span className="rca2-keysetup-title">AI Diagnosis Activated</span>
        </div>
        <div className="rca2-keysetup-sub">
          Your key is verified and live. Run your code again to generate a full AI-powered diagnosis.
        </div>
      </div>
    );
  }

  return (
    <div className="rca2-keysetup">
      <div className="rca2-keysetup-head">
        <span className="rca2-keysetup-title">Unlock AI Diagnosis</span>
        <span className="rca2-keysetup-badge">API Key Required</span>
      </div>
      <div className="rca2-keysetup-sub">
        This report used rule-based analysis only. Add an OpenRouter API key to unlock
        AI-powered explanations, cause chains, and fix suggestions.{' '}
        <a
          className="rca2-keysetup-link"
          href="https://openrouter.ai/keys"
          target="_blank"
          rel="noreferrer"
        >
          Get your free key at openrouter.ai/keys →
        </a>
      </div>
      <div className="rca2-keysetup-row">
        <input
          type="password"
          className="rca2-keysetup-input"
          placeholder="sk-or-v1-..."
          value={keyInput}
          onChange={(e) => {
            setKeyInput(e.target.value);
            if (status === 'error') { setStatus('idle'); setErrorMsg(''); }
          }}
          onKeyDown={(e) => { if (e.key === 'Enter') handleActivate(); }}
          spellCheck={false}
        />
        <button
          className="rca2-keysetup-btn"
          onClick={handleActivate}
          disabled={!keyInput.trim() || status === 'saving'}
        >
          {status === 'saving' ? 'Verifying…' : 'Activate'}
        </button>
      </div>
      {status === 'error' && <div className="rca2-keysetup-error">{errorMsg}</div>}
      <div className="rca2-keysetup-note">
        {window.electronAPI
          ? 'Verified with OpenRouter · Stored encrypted on this device · Never shared'
          : 'Verified with OpenRouter · Held by your local backend for this session'}
      </div>
    </div>
  );
};

/* ── Smart Root Cause Analysis Card — v2 Redesign ── */
const RootCauseCard = ({ rootCause, code }) => {
  const [isReportExpanded, setIsReportExpanded] = useState(false);
  const [expandedSections, setExpandedSections] = useState({
    what: true, location: true, chain: false, fix: true, tip: true
  });
  const [copied, setCopied] = useState(false);

  if (!rootCause) return null;

  const toggleSection = (key) => {
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleCopyCode = (text) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
      .map(l => l.replace(/^\d+[\.)]\s*/, '').replace(/^\*\s*/, '').replace(/^-\s*/, ''));
  };

  const chainSteps = parseChain(rootCause.rootCauseChain);


  return (
    <div className="rca2-wrapper">
      {/* Dashed separator divider */}
      <div className="rca2-divider" />

      {/* Typographic Collapse Trigger */}
      <div className="rca2-collapse-trigger" onClick={() => setIsReportExpanded(!isReportExpanded)}>
        <span className="rca2-trigger-symbol">{isReportExpanded ? '▼' : '▶'}</span>
        <span className="rca2-trigger-text">
          <span className="rca2-title-fill">AI Diagnostic&nbsp;</span>
          <span className="rca2-title-stroke">Intelligence</span>
          <span className="rca2-trigger-subtext">
            {isReportExpanded ? '(Click to collapse)' : '(Click to expand)'}
          </span>
        </span>
      </div>

      {isReportExpanded && (
        <div className="rca2-card">
          {/* ── Minimalist Header ── */}

          {/* ── Body ── */}
          <div className="rca2-body">

            {/* AI key onboarding — only when this report ran without AI */}
            {rootCause.aiGenerated === false && <AiKeySetupCard />}

            {/* Section: What Happened */}
            {rootCause.whatHappened && (
              <RcaSection label="What Happened" expanded={Boolean(expandedSections.what)}
                onToggle={() => toggleSection('what')}>
                <div className="rca2-explanation">{rootCause.whatHappened}</div>
              </RcaSection>
            )}

            {/* Section: Error Location */}
            {failingCode && (
              <RcaSection label="Error Location" expanded={Boolean(expandedSections.location)}
                onToggle={() => toggleSection('location')}>
                <div className="rca2-code-viewer">
                  <div className="rca2-code-header">
                    <span className="rca2-code-file-label">main.cpp</span>
                  </div>
                  <div className="rca2-code-body">
                    {errorLine > 1 && getCodeLine(errorLine - 1) && (
                      <div className="rca2-code-line rca2-ctx">
                        <span className="rca2-ln">{errorLine - 1}</span>
                        <span className="rca2-lc">{getCodeLine(errorLine - 1)}</span>
                      </div>
                    )}
                    <div className="rca2-code-line rca2-err">
                      <span className="rca2-ln">{errorLine}</span>
                      <span className="rca2-lc">{failingCode}</span>
                      <div className="rca2-err-msg">
                        {rootCause.errorMessage}
                      </div>
                    </div>
                    {getCodeLine(errorLine + 1) && (
                      <div className="rca2-code-line rca2-ctx">
                        <span className="rca2-ln">{errorLine + 1}</span>
                        <span className="rca2-lc">{getCodeLine(errorLine + 1)}</span>
                      </div>
                    )}
                  </div>
                </div>
              </RcaSection>
            )}

            {/* Section: Root Cause Chain */}
            {chainSteps.length > 0 && (
              <RcaSection label="Cause Chain" expanded={Boolean(expandedSections.chain)}
                onToggle={() => toggleSection('chain')}>
                <div className="rca2-chain">
                  {chainSteps.map((step, i) => (
                    <div key={i} className="rca2-chain-item">
                      <div className="rca2-chain-content">
                        <span className="rca2-chain-idx">{String(i + 1).padStart(2, '0')}</span>
                        <span className="rca2-chain-text">{step}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </RcaSection>
            )}

            {/* Section: Suggested Fix */}
            {(fixContent.code || fixContent.explanation) && (
              <RcaSection label="Suggested Fix" expanded={Boolean(expandedSections.fix)}
                onToggle={() => toggleSection('fix')}>
                {fixContent.explanation && (
                  <div className="rca2-fix-text">{fixContent.explanation}</div>
                )}
                {fixContent.code && (
                  <div className="rca2-fix-code">
                    <div className="rca2-code-header">
                      <span className="rca2-code-file-label">fixed_solution</span>
                      <button className="rca2-copy-btn" onClick={() => handleCopyCode(fixContent.code)}>
                        {copied ? 'Copied!' : 'Copy'}
                      </button>
                    </div>
                    <pre className="rca2-fix-pre">{fixContent.code}</pre>
                  </div>
                )}
              </RcaSection>
            )}

            {/* Section: Pro Tip */}
            {rootCause.proTip && (
              <RcaSection label="Pro Tip" expanded={Boolean(expandedSections.tip)}
                onToggle={() => toggleSection('tip')}>
                <div className="rca2-tip">{rootCause.proTip}</div>
              </RcaSection>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const TELEMETRY_LINES = [
  'INITIALIZING SYMBOL RESOLVER',
  'PARSING CALL GRAPH TRAVERSALS',
  'MAPPING EVENT EMITTER SCHEMAS',
  'EVALUATING CAUSALITY GRADIENTS',
  'CORRELATING METRICS & LOG ENTRIES',
  'ISOLATING ROOT CAUSE SEQUENCE',
  'GENERATING INTELLIGENCE REPORT'
];

const ScanningSegment = () => {
  const [telemetryIndex, setTelemetryIndex] = useState(0);
  const [traceId] = useState(() => Math.random().toString(36).substring(7).toUpperCase());

  useEffect(() => {
    const timer = setInterval(() => {
      setTelemetryIndex((prev) => (prev + 1) % TELEMETRY_LINES.length);
    }, 1600);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="output-placeholder terminal-window-pane" style={{
      position: 'relative',
      overflow: 'hidden',
      background: 'var(--s0)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      padding: '24px'
    }}>
      <style>{`
        @keyframes character-jump {
          0%, 100% { transform: translateY(0) scaleY(1) scaleX(1); }
          20% { transform: translateY(0) scaleY(0.75) scaleX(1.25); }
          26% { transform: translateY(0) scaleY(1.15) scaleX(0.85); }
          50% { transform: translateY(-38px) scaleY(1) scaleX(1); }
          72% { transform: translateY(0) scaleY(1) scaleX(1); }
          76% { transform: translateY(0) scaleY(0.7) scaleX(1.3); }
          84% { transform: translateY(0) scaleY(1.05) scaleX(0.95); }
          90% { transform: translateY(0) scaleY(1) scaleX(1); }
        }
        @keyframes block-bounce {
          0%, 48%, 62%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
          56% { transform: translateY(2px); }
        }
        @keyframes particle-tl {
          0%, 49% { transform: translate(0, 0); opacity: 0; }
          50% { opacity: 1; }
          75% { transform: translate(-28px, -20px); opacity: 0; }
          100% { opacity: 0; }
        }
        @keyframes particle-tr {
          0%, 49% { transform: translate(0, 0); opacity: 0; }
          50% { opacity: 1; }
          75% { transform: translate(28px, -20px); opacity: 0; }
          100% { opacity: 0; }
        }
        @keyframes particle-bl {
          0%, 49% { transform: translate(0, 0); opacity: 0; }
          50% { opacity: 1; }
          75% { transform: translate(-20px, 16px); opacity: 0; }
          100% { opacity: 0; }
        }
        @keyframes particle-br {
          0%, 49% { transform: translate(0, 0); opacity: 0; }
          50% { opacity: 1; }
          75% { transform: translate(20px, 16px); opacity: 0; }
          100% { opacity: 0; }
        }
        @keyframes particle-top {
          0%, 49% { transform: translate(0, 0); opacity: 0; }
          50% { opacity: 1; }
          75% { transform: translate(0, -32px); opacity: 0; }
          100% { opacity: 0; }
        }
        .pixel-particle {
          position: absolute;
          background: #FFFFFF;
        }
        .p-tl { width: 4px; height: 4px; animation: particle-tl 1.6s infinite; }
        .p-tr { width: 5px; height: 5px; animation: particle-tr 1.6s infinite; }
        .p-bl { width: 3px; height: 3px; animation: particle-bl 1.6s infinite; }
        .p-br { width: 4px; height: 4px; animation: particle-br 1.6s infinite; }
        .p-top { width: 5px; height: 5px; animation: particle-top 1.6s infinite; }
      `}</style>

      {/* Retro Animation Stage */}
      <div style={{
        position: 'relative',
        width: '180px',
        height: '140px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-end',
        marginBottom: '28px'
      }}>
        {/* Pixel Question Block */}
        <div style={{
          position: 'absolute',
          top: '16px',
          left: 'calc(50% - 20px)',
          width: '40px',
          height: '40px',
          animation: 'block-bounce 1.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) infinite'
        }}>
          <svg width="40" height="40" viewBox="0 0 16 16" shapeRendering="crispEdges">
            {/* Outer border */}
            <rect x="0" y="0" width="16" height="16" fill="none" stroke="#FFFFFF" strokeWidth="1"/>
            {/* Corner dots */}
            <rect x="2" y="2" width="1" height="1" fill="#FFFFFF"/>
            <rect x="13" y="2" width="1" height="1" fill="#FFFFFF"/>
            <rect x="2" y="13" width="1" height="1" fill="#FFFFFF"/>
            <rect x="13" y="13" width="1" height="1" fill="#FFFFFF"/>
            {/* Question mark */}
            <rect x="6" y="4" width="4" height="1" fill="#FFFFFF"/>
            <rect x="5" y="5" width="2" height="1" fill="#FFFFFF"/>
            <rect x="9" y="5" width="2" height="1" fill="#FFFFFF"/>
            <rect x="8" y="6" width="2" height="2" fill="#FFFFFF"/>
            <rect x="7" y="8" width="2" height="1" fill="#FFFFFF"/>
            <rect x="7" y="10" width="2" height="2" fill="#FFFFFF"/>
          </svg>
        </div>

        {/* Particles */}
        <div style={{ position: 'absolute', top: '36px', left: '50%', width: '0', height: '0' }}>
          <div className="pixel-particle p-tl" />
          <div className="pixel-particle p-tr" />
          <div className="pixel-particle p-bl" />
          <div className="pixel-particle p-br" />
          <div className="pixel-particle p-top" />
        </div>

        {/* Character */}
        <div style={{
          position: 'absolute',
          bottom: '0',
          left: 'calc(50% - 20px)',
          width: '40px',
          height: '40px',
          transformOrigin: 'bottom center',
          animation: 'character-jump 1.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) infinite'
        }}>
          <svg width="40" height="40" viewBox="0 0 16 16" shapeRendering="crispEdges">
            {/* Cute Pixel Robot/Character */}
            <rect x="4" y="4" width="8" height="8" fill="#FFFFFF"/>
            <rect x="5" y="5" width="6" height="4" fill="var(--s0)"/>
            {/* Eyes */}
            <rect x="6" y="6" width="1" height="2" fill="#FFFFFF"/>
            <rect x="9" y="6" width="1" height="2" fill="#FFFFFF"/>
            {/* Mouth */}
            <rect x="7" y="9" width="2" height="1" fill="#FFFFFF"/>
            {/* Cap/Hat */}
            <rect x="3" y="3" width="10" height="1" fill="#FFFFFF"/>
            <rect x="5" y="2" width="6" height="1" fill="#FFFFFF"/>
            {/* Feet */}
            <rect x="4" y="12" width="2" height="2" fill="#FFFFFF"/>
            <rect x="10" y="12" width="2" height="2" fill="#FFFFFF"/>
          </svg>
        </div>
      </div>

      {/* Platform under the character */}
      <div style={{
        width: '140px',
        height: '1px',
        background: '#FFFFFF',
        opacity: 0.15,
        marginTop: '-28px',
        marginBottom: '28px'
      }} />

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
        {/* Title */}
        <div style={{
          fontFamily: 'var(--font-header)',
          fontSize: '0.82rem',
          fontWeight: 900,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: '#FFFFFF',
          lineHeight: 1.2,
          marginBottom: '8px'
        }}>
          Scanning Execution Flow
        </div>

        {/* Live Telemetry Message */}
        <div style={{
          fontFamily: 'var(--font-number)',
          fontSize: '0.55rem',
          fontWeight: 500,
          color: 'var(--t2)',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          height: '14px',
          marginBottom: '8px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '4px'
        }}>
          <span style={{ color: 'var(--t4)' }}>▶</span> {TELEMETRY_LINES[telemetryIndex]}
        </div>

        {/* Trace ID Tag */}
        <div style={{
          fontFamily: 'var(--font-number)',
          fontSize: '0.52rem',
          letterSpacing: '0.04em',
          color: 'var(--t4)',
          textTransform: 'uppercase'
        }}>
          TRACE_ID: {traceId}
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
    return <ScanningSegment />;
  }

  if (!output && !error) {
    return (
      <div className="output-placeholder terminal-window-pane" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="terminal-scanlines" />
        <div className="dep-graph-empty" style={{ background: 'transparent', gap: '8px' }}>
          <div style={{ textAlign: 'center' }}>
            <div className="dep-empty-title" style={{ fontSize: '0.8rem', fontWeight: 900, letterSpacing: '0.08em', color: 'var(--t2)', textTransform: 'uppercase', marginBottom: '6px' }}>SYSTEM_IDLE</div>
            <div className="dep-empty-sub" style={{ fontSize: '0.58rem', letterSpacing: '0.12em', color: 'var(--t4)', textTransform: 'uppercase' }}>AWAITING_SEQUENCE_EXECUTION</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="terminal-window-pane">
      <div className="terminal-scanlines" />

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
