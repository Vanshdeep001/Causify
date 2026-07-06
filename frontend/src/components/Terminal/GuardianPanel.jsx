/* -------------------------------------------------------
 * GuardianPanel.jsx — Repository Guardian HUD
 *
 * Read-only observer view over the Repository Guardian
 * daemon: repo health, PR readiness, branch hygiene, and the
 * pending-approvals inbox. The Guardian only recommends —
 * approving still happens via `gitpilot approve <id>` until
 * Phase 2 brings approval into this panel.
 *
 * "Git Assistant executes. Repository Guardian observes."
 * ------------------------------------------------------- */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import useEditorStore from '../../store/useEditorStore';
import { getProjectKey, getSavedRepoUrl } from '../../utils/gitRepoMemory';
import {
  guardianHealth, guardianStatus, guardianApprovals, guardianPrs,
  guardianBranches, guardianDetect, guardianSetup, guardianStart,
  guardianStop, resetGuardianToken, isElectron,
} from '../../services/guardian';

/* ── Design primitives — shared visual language with GitAssistantPanel ── */

const MONO = 'var(--font-number)';
const HEADER = 'var(--font-header)';
const BODY = 'var(--font-body)';

/* Numbered editorial section label with trailing hairline */
const ZoneLabel = ({ index, children, right }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px', flexShrink: 0 }}>
    {index && (
      <span style={{ fontFamily: MONO, fontSize: '0.54rem', color: 'var(--t4)', fontWeight: 500 }}>
        {index}
      </span>
    )}
    <span style={{
      fontFamily: MONO, fontSize: '0.58rem', fontWeight: 700,
      letterSpacing: '0.24em', textTransform: 'uppercase', color: 'var(--t3)',
      whiteSpace: 'nowrap',
    }}>
      {children}
    </span>
    <span style={{ flex: 1, height: '1px', background: 'var(--line-faint)' }} />
    {right}
  </div>
);

const StatusDot = ({ color }) => (
  <span style={{
    display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%',
    background: color, flexShrink: 0,
  }} />
);

const PrimaryButton = ({ children, onClick, disabled, style }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    style={{
      padding: '10px 26px', background: '#FFFFFF', color: '#000',
      border: 'none', borderRadius: '999px',
      cursor: disabled ? 'default' : 'pointer',
      fontFamily: MONO, fontSize: '0.64rem', fontWeight: 800,
      letterSpacing: '0.12em', whiteSpace: 'nowrap',
      opacity: disabled ? 0.35 : 1,
      transition: 'filter 0.15s ease, transform 0.1s ease, box-shadow 0.2s ease',
      ...style,
    }}
    onMouseEnter={e => {
      if (disabled) return;
      e.currentTarget.style.filter = 'brightness(0.85)';
      e.currentTarget.style.boxShadow = '0 4px 24px rgba(255,255,255,0.12)';
    }}
    onMouseLeave={e => {
      e.currentTarget.style.filter = 'none';
      e.currentTarget.style.transform = 'none';
      e.currentTarget.style.boxShadow = 'none';
    }}
    onMouseDown={e => { if (!disabled) e.currentTarget.style.transform = 'scale(0.97)'; }}
    onMouseUp={e => { e.currentTarget.style.transform = 'none'; }}
  >
    {children}
  </button>
);

/* Quiet text action — no chrome, just type */
const TextButton = ({ children, onClick, disabled, danger, style }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    style={{
      background: 'none', border: 'none', padding: '4px 0',
      color: 'var(--t3)', cursor: disabled ? 'default' : 'pointer',
      fontFamily: MONO, fontSize: '0.6rem', fontWeight: 700,
      letterSpacing: '0.14em', whiteSpace: 'nowrap',
      opacity: disabled ? 0.35 : 1, transition: 'color 0.15s ease',
      ...style,
    }}
    onMouseEnter={e => { if (!disabled) e.currentTarget.style.color = danger ? 'var(--crimson)' : '#FFFFFF'; }}
    onMouseLeave={e => { e.currentTarget.style.color = 'var(--t3)'; }}
  >
    {children}
  </button>
);

/* Minimal error line — crimson bar, no box */
const ErrorLine = ({ children, style }) => (
  <div style={{
    borderLeft: '2px solid var(--crimson)', paddingLeft: '12px',
    color: 'var(--crimson)', fontFamily: MONO, fontSize: '0.64rem',
    fontWeight: 600, lineHeight: 1.6, wordBreak: 'break-word', ...style,
  }}>
    {children}
  </div>
);

/* Focus helpers for underline inputs */
const focusLine = e => { e.currentTarget.style.borderBottomColor = 'rgba(255,255,255,0.45)'; };
const blurLine = e => { e.currentTarget.style.borderBottomColor = 'var(--line-strong)'; };

/* Underline form field */
const Field = ({ label, hint, ...inputProps }) => (
  <div>
    <div style={{
      fontFamily: MONO, fontSize: '0.54rem', fontWeight: 700,
      letterSpacing: '0.2em', color: 'var(--t4)', marginBottom: '8px',
      textTransform: 'uppercase',
    }}>
      {label}
    </div>
    <input
      spellCheck={false}
      onFocus={focusLine}
      onBlur={blurLine}
      style={{
        width: '100%', background: 'transparent', border: 'none', outline: 'none',
        color: 'var(--t1)', fontSize: '0.82rem', fontFamily: MONO, fontWeight: 500,
        borderBottom: '1px solid var(--line-strong)', paddingBottom: '9px',
        transition: 'border-color 0.2s ease',
      }}
      {...inputProps}
    />
    {hint && (
      <div style={{ fontFamily: BODY, fontSize: '0.62rem', color: 'var(--t4)', marginTop: '7px', lineHeight: 1.5 }}>
        {hint}
      </div>
    )}
  </div>
);

const RECOMMENDATION_COLORS = {
  'ready-to-merge': 'var(--emerald)',
  'needs-review': 'var(--amber)',
  'blocked': 'var(--crimson)',
  'needs-attention': '#818cf8',
};

const CLASSIFICATION_COLORS = {
  active: 'var(--emerald)',
  stale: 'var(--crimson)',
  release: '#818cf8',
  uncertain: 'var(--amber)',
};

const GuardianPanel = () => {
  const files = useEditorStore(s => s.files);
  const sessionName = useEditorStore(s => s.sessionName);
  const gitRepoUrl = useEditorStore(s => s.gitRepoUrl);

  const projectKey = getProjectKey(files, sessionName);
  const savedRepoUrl = getSavedRepoUrl(projectKey) || gitRepoUrl || '';

  // 'checking' | 'no-electron' | 'not-installed' | 'stopped' | 'busy' | 'running'
  const [phase, setPhase] = useState('checking');
  const [error, setError] = useState(null);
  const [busyLabel, setBusyLabel] = useState('');

  const [status, setStatus] = useState(null);
  const [approvals, setApprovals] = useState([]);
  const [prs, setPrs] = useState(null);          // null = not scanned yet
  const [branchList, setBranchList] = useState(null);
  const [scanningPrs, setScanningPrs] = useState(false);
  const [scanningBranches, setScanningBranches] = useState(false);
  const [expandedApproval, setExpandedApproval] = useState(null);

  // First-time setup fields (shown only when needed)
  const [needsSetup, setNeedsSetup] = useState(false);
  const [repoUrlInput, setRepoUrlInput] = useState(savedRepoUrl);
  const [patInput, setPatInput] = useState('');
  const [llmKeyInput, setLlmKeyInput] = useState('');

  // Re-arm on every mount: StrictMode dev runs mount → cleanup → mount,
  // and a cleanup-only effect would leave this permanently false,
  // stranding detect() on the scanning screen.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  /* ── Fast local data (SQLite-backed — safe to auto-load) ── */
  const loadLocalData = useCallback(async () => {
    try {
      const [st, ap] = await Promise.all([guardianStatus(), guardianApprovals()]);
      if (!mountedRef.current) return;
      setStatus(st);
      setApprovals(ap.approvals || []);
      setError(null);
    } catch (err) {
      if (mountedRef.current) setError(err.message);
    }
  }, []);

  /* ── Detection on mount ── */
  const detect = useCallback(async () => {
    try {
      if (!isElectron()) {
        // Browser mode: can still see the daemon if it's up, but can't manage it
        const up = await guardianHealth();
        setPhase(up ? 'running' : 'no-electron');
        if (up) loadLocalData();
        return;
      }
      // Never let detection strand the panel on the scanning screen: a dead
      // IPC bridge (e.g. stale main process after a renderer hot-reload in
      // dev) rejects immediately, and slow child processes get 15s max.
      const res = await Promise.race([
        guardianDetect(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('detection timed out after 15s')), 15000)),
      ]);
      if (!mountedRef.current) return;
      if (!res.installed) { setPhase('not-installed'); return; }
      if (res.running) {
        setPhase('running');
        loadLocalData();
      } else {
        setPhase('stopped');
      }
    } catch (err) {
      // IPC failed — fall back to a direct health probe so a running daemon
      // is still visible read-only, exactly like browser mode.
      const up = await guardianHealth().catch(() => false);
      if (!mountedRef.current) return;
      if (up) {
        setPhase('running');
        loadLocalData();
        return;
      }
      setError(`Desktop bridge unavailable (${err.message}). Fully restart the app to re-enable Guardian management.`);
      setPhase('no-electron');
    }
  }, [loadLocalData]);

  useEffect(() => { detect(); }, [detect]);

  // Refresh local data every 20s while running
  useEffect(() => {
    if (phase !== 'running') return;
    const interval = setInterval(loadLocalData, 20000);
    return () => clearInterval(interval);
  }, [phase, loadLocalData]);

  /* ── Actions ── */
  const handleLaunch = async () => {
    setError(null);
    setPhase('busy');
    setBusyLabel('LAUNCHING AGENT...');
    const url = repoUrlInput.trim() || savedRepoUrl;
    let res = await guardianStart(url);

    if (res.needsSetup || (res.error && needsSetup === false && !res.running)) {
      if (res.needsSetup) {
        setNeedsSetup(true);
        setPhase('stopped');
        return;
      }
    }
    if (res.error && !res.running) {
      setError(res.error);
      setPhase('stopped');
      return;
    }
    resetGuardianToken(); // token may have been generated on first start
    setPhase('running');
    loadLocalData();
  };

  const handleSetupAndLaunch = async () => {
    setError(null);
    const url = repoUrlInput.trim() || savedRepoUrl;
    if (!url) { setError('Connect a repository in the GIT view first, or paste its URL here.'); return; }
    setPhase('busy');
    setBusyLabel('CONFIGURING GUARDIAN...');

    const setupRes = await guardianSetup({
      repoUrl: url,
      githubToken: patInput.trim() || undefined,
      openrouterKey: llmKeyInput.trim() || undefined,
    });
    if (setupRes.error) {
      setError(setupRes.error);
      setNeedsSetup(true);
      setPhase('stopped');
      return;
    }

    setBusyLabel('LAUNCHING AGENT...');
    const startRes = await guardianStart(url);
    if (startRes.error && !startRes.running) {
      setError(startRes.error);
      setPhase('stopped');
      return;
    }
    setPatInput('');
    setLlmKeyInput('');
    setNeedsSetup(false);
    resetGuardianToken();
    setPhase('running');
    loadLocalData();
  };

  const handleStop = async () => {
    setPhase('busy');
    setBusyLabel('STOPPING AGENT...');
    await guardianStop();
    setStatus(null); setPrs(null); setBranchList(null); setApprovals([]);
    setPhase('stopped');
  };

  const scanPrs = async () => {
    setScanningPrs(true);
    setError(null);
    try {
      const res = await guardianPrs();
      setPrs(res.prs || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setScanningPrs(false);
    }
  };

  const scanBranches = async () => {
    setScanningBranches(true);
    setError(null);
    try {
      const res = await guardianBranches();
      setBranchList(res.branches || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setScanningBranches(false);
    }
  };

  /* ═══════════ RENDER: non-running states ═══════════ */

  if (phase === 'checking' || phase === 'busy') {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontFamily: MONO, color: 'var(--t3)', fontSize: '0.66rem', letterSpacing: '0.24em', animation: 'pulse-live 1.2s ease infinite' }}>
          ⠿ {phase === 'busy' ? busyLabel : 'SCANNING FOR REPOSITORY GUARDIAN…'}
        </div>
        <style>{`@keyframes pulse-live { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }`}</style>
      </div>
    );
  }

  if (phase === 'no-electron' || phase === 'not-installed') {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '30px' }}>
        <div style={{ maxWidth: '520px', textAlign: 'center', animation: 'fade-in 0.4s ease-out' }}>
          <div style={{
            fontFamily: MONO, fontSize: '0.56rem', fontWeight: 700,
            letterSpacing: '0.3em', color: 'var(--t4)', marginBottom: '14px',
          }}>
            REPOSITORY GUARDIAN
          </div>
          <div style={{ fontFamily: HEADER, fontSize: '1.15rem', fontWeight: 800, color: 'var(--t1)', marginBottom: '10px' }}>
            Guardian not detected
          </div>
          <div style={{ fontFamily: BODY, fontSize: '0.74rem', color: 'var(--t3)', lineHeight: 1.7 }}>
            {phase === 'no-electron'
              ? 'Guardian management needs the desktop app. Start the daemon manually with "gitpilot start" and refresh.'
              : 'Install the Guardian engine first: pip install -e <GitPilot folder>, then reopen this tab.'}
          </div>
          {error && (
            <ErrorLine style={{ marginTop: '16px', textAlign: 'left', display: 'inline-block' }}>
              {error}
            </ErrorLine>
          )}
          <div style={{ marginTop: '24px' }}>
            <button
              onClick={() => { setError(null); setPhase('checking'); detect(); }}
              style={{
                padding: '9px 26px', background: 'transparent',
                border: '1px solid var(--line-strong)', borderRadius: '999px',
                color: 'var(--t2)', cursor: 'pointer', fontFamily: MONO,
                fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.14em',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#FFFFFF'; e.currentTarget.style.color = '#FFFFFF'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--line-strong)'; e.currentTarget.style.color = 'var(--t2)'; }}
            >
              ⟳ RECHECK
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'stopped') {
    return (
      <div className="no-scrollbar" style={{
        height: '100%', display: 'flex', alignItems: 'center',
        justifyContent: 'center', padding: '28px', overflow: 'auto',
      }}>
        <div style={{ width: '100%', maxWidth: '560px', animation: 'fade-in 0.4s ease-out' }}>
          <div style={{
            fontFamily: MONO, fontSize: '0.56rem', fontWeight: 700,
            letterSpacing: '0.3em', color: 'var(--t4)', marginBottom: '14px',
          }}>
            REPOSITORY GUARDIAN
          </div>
          <div style={{
            fontFamily: HEADER, fontSize: '1.3rem', fontWeight: 800,
            color: 'var(--t1)', letterSpacing: '0.01em', marginBottom: '8px',
          }}>
            Launch your repo's Guardian
          </div>
          <div style={{
            fontFamily: BODY, fontSize: '0.74rem', color: 'var(--t3)',
            lineHeight: 1.7, marginBottom: '30px', maxWidth: '440px',
          }}>
            Watches PRs, branches, and releases on GitHub. Observes and
            recommends — never acts without your approval.
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
            <Field
              label="Repository"
              type="text"
              value={repoUrlInput}
              onChange={(e) => setRepoUrlInput(e.target.value)}
              placeholder={savedRepoUrl || 'https://github.com/user/repository.git'}
            />

            {needsSetup && (
              <>
                <Field
                  label="GitHub Personal Access Token"
                  type="password"
                  value={patInput}
                  onChange={(e) => setPatInput(e.target.value)}
                  placeholder="ghp_… (auto-detected from repo URL when embedded)"
                />
                <Field
                  label="OpenRouter Key — optional"
                  type="password"
                  value={llmKeyInput}
                  onChange={(e) => setLlmKeyInput(e.target.value)}
                  placeholder="Blank = reuse this machine's key, or run rules-only"
                  hint="Keys are stored in the OS keychain by the Guardian itself — DebugSync never saves them."
                />
              </>
            )}

            <div style={{ display: 'flex', gap: '20px', alignItems: 'center', marginTop: '4px' }}>
              <PrimaryButton onClick={needsSetup ? handleSetupAndLaunch : handleLaunch} style={{ padding: '11px 34px' }}>
                {needsSetup ? 'CONFIGURE & LAUNCH' : '▶ LAUNCH AGENT'}
              </PrimaryButton>
              {!needsSetup && (
                <TextButton onClick={() => setNeedsSetup(true)}>
                  FIRST-TIME SETUP
                </TextButton>
              )}
            </div>

            {error && <ErrorLine>{error}</ErrorLine>}
          </div>
        </div>
        <style>{`@keyframes pulse-live { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }`}</style>
      </div>
    );
  }

  /* ═══════════ RENDER: running dashboard ═══════════ */

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* ── Status strip ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '20px', padding: '13px 22px',
        background: 'linear-gradient(90deg, rgba(255,255,255,0.035), transparent 55%)',
        borderBottom: '1px solid var(--line-faint)', flexShrink: 0, flexWrap: 'wrap',
      }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '10px' }}>
          <StatusDot color="var(--emerald)" pulse />
          {/* Solid + outline wordmark — the app's signature type treatment */}
          <span style={{ fontFamily: HEADER, fontSize: '0.78rem', fontWeight: 800, letterSpacing: '0.02em', whiteSpace: 'nowrap', lineHeight: 1 }}>
            <span style={{ color: '#FFFFFF' }}>GUARDIAN</span>
            <span style={{
              marginLeft: '7px', color: 'transparent',
              WebkitTextStroke: '1px rgba(255,255,255,0.55)',
            }}>
              ACTIVE
            </span>
          </span>
        </span>
        {status?.repo && (
          <>
            <span style={{ width: '1px', height: '16px', background: 'var(--line-faint)' }} />
            <span style={{ fontFamily: MONO, fontSize: '0.62rem', color: 'var(--t2)' }}>
              {status.repo}
            </span>
          </>
        )}
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: '20px' }}>
          <span style={{
            fontFamily: MONO, fontSize: '0.54rem', fontWeight: 700, letterSpacing: '0.16em',
            color: status?.llm_available ? '#818cf8' : 'var(--t4)',
          }}>
            AI {status?.llm_available ? 'ON' : 'RULES ONLY'}
          </span>
          <span style={{
            fontFamily: MONO, fontSize: '0.54rem', fontWeight: 700, letterSpacing: '0.16em',
            color: approvals.length > 0 ? 'var(--amber)' : 'var(--t4)',
          }}>
            {approvals.length} PENDING
          </span>
          <TextButton onClick={loadLocalData}>⟳ REFRESH</TextButton>
          {isElectron() && (
            <TextButton danger onClick={handleStop}>■ STOP</TextButton>
          )}
        </span>
      </div>

      {error && (
        <ErrorLine style={{ margin: '14px 22px 0', flexShrink: 0 }}>
          {error}
        </ErrorLine>
      )}

      {/* ── Main content: 3 zones divided by hairlines ── */}
      <div className="no-scrollbar" style={{ flex: 1, display: 'flex', overflow: 'auto', padding: '18px 22px' }}>

        {/* ZONE 01: Approvals inbox */}
        <div className="no-scrollbar" style={{
          flex: '0 1 320px', minWidth: '240px', paddingRight: '24px',
          overflowY: 'auto', display: 'flex', flexDirection: 'column',
        }}>
          <ZoneLabel index="01">Approvals</ZoneLabel>

          {/* Headline stat */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', marginBottom: '14px', flexShrink: 0 }}>
            <span style={{
              fontFamily: HEADER, fontSize: '2rem', fontWeight: 800, lineHeight: 1,
              letterSpacing: '-0.02em',
              color: approvals.length > 0 ? 'var(--amber)' : 'var(--t4)',
            }}>
              {String(approvals.length).padStart(2, '0')}
            </span>
            <span style={{ fontFamily: BODY, fontSize: '0.66rem', color: 'var(--t3)' }}>
              {approvals.length > 0 ? 'awaiting your decision' : 'inbox clear'}
            </span>
          </div>

          {approvals.map((a) => (
            <div key={a.id} style={{ borderBottom: '1px solid var(--line-faint)', padding: '10px 0' }}>
              <div
                onClick={() => setExpandedApproval(expandedApproval === a.id ? null : a.id)}
                style={{ cursor: 'pointer' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontFamily: MONO, fontSize: '0.6rem', color: 'var(--amber)', fontWeight: 800 }}>
                    #{a.id}
                  </span>
                  <span style={{ fontFamily: MONO, fontSize: '0.56rem', color: 'var(--t3)', fontWeight: 700, letterSpacing: '0.1em' }}>
                    {String(a.action_type || '').replace(/_/g, ' ').toUpperCase()}
                  </span>
                  <span style={{
                    marginLeft: 'auto', fontFamily: MONO, fontSize: '0.52rem', fontWeight: 800, letterSpacing: '0.14em',
                    color: a.risk_level === 'high' ? 'var(--crimson)' : a.risk_level === 'moderate' ? 'var(--amber)' : 'var(--emerald)',
                  }}>
                    {(a.risk_level || 'low').toUpperCase()}
                  </span>
                </div>
                <div style={{ fontFamily: BODY, fontSize: '0.76rem', color: 'var(--t1)', fontWeight: 500, marginTop: '5px', lineHeight: 1.4 }}>
                  {a.target}
                </div>
              </div>
              {expandedApproval === a.id && (
                <div style={{ marginTop: '10px' }}>
                  <pre className="no-scrollbar" style={{
                    margin: 0, paddingLeft: '14px',
                    borderLeft: '1px solid var(--line-faint)',
                    color: 'var(--t2)', fontFamily: MONO, fontSize: '0.62rem',
                    lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    maxHeight: '220px', overflow: 'auto',
                  }}>
                    {typeof a.analysis === 'string' ? a.analysis : JSON.stringify(a.analysis, null, 2)}
                  </pre>
                  <div style={{ fontFamily: MONO, fontSize: '0.54rem', color: 'var(--t4)', marginTop: '8px', lineHeight: 1.6 }}>
                    To approve: run <span style={{ color: 'var(--t2)' }}>gitpilot approve {a.id}</span> in a terminal.
                    In-app approval arrives in Phase 2.
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* ZONE 02: PR readiness */}
        <div className="no-scrollbar" style={{
          flex: 1, minWidth: 0, overflowY: 'auto',
          borderLeft: '1px solid var(--line-faint)', paddingLeft: '24px', paddingRight: '24px',
        }}>
          <ZoneLabel index="02" right={
            <TextButton onClick={scanPrs} disabled={scanningPrs}>
              {scanningPrs ? '⠿ SCANNING…' : 'SCAN PRS'}
            </TextButton>
          }>
            Pull Requests
          </ZoneLabel>
          {prs === null ? (
            <div style={{ fontFamily: BODY, fontSize: '0.7rem', color: 'var(--t4)', lineHeight: 1.6 }}>
              Not scanned yet — scanning asks GitHub and (when AI is on) the LLM.
            </div>
          ) : prs.length === 0 ? (
            <div style={{ fontFamily: BODY, fontSize: '0.7rem', color: 'var(--t4)' }}>
              No open pull requests.
            </div>
          ) : prs.map((pr) => (
            <div key={pr.pr_number} style={{ borderBottom: '1px solid var(--line-faint)', padding: '11px 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontFamily: MONO, fontSize: '0.72rem', color: 'var(--t1)', fontWeight: 800 }}>
                  #{pr.pr_number}
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '7px' }}>
                  <StatusDot color={RECOMMENDATION_COLORS[pr.recommendation] || 'var(--t3)'} />
                  <span style={{
                    fontFamily: MONO, fontSize: '0.54rem', fontWeight: 800, letterSpacing: '0.14em',
                    color: RECOMMENDATION_COLORS[pr.recommendation] || 'var(--t3)',
                  }}>
                    {String(pr.recommendation || '').replace(/-/g, ' ').toUpperCase()}
                  </span>
                </span>
                {pr.has_conflicts && (
                  <span style={{ fontFamily: MONO, fontSize: '0.52rem', color: 'var(--crimson)', fontWeight: 800, letterSpacing: '0.12em' }}>
                    CONFLICTS
                  </span>
                )}
                <span style={{ marginLeft: 'auto', fontFamily: MONO, fontSize: '0.56rem', color: 'var(--t4)' }}>
                  {pr.confidence}%
                </span>
              </div>
              {pr.summary && (
                <div style={{ fontFamily: BODY, fontSize: '0.72rem', color: 'var(--t2)', marginTop: '6px', lineHeight: 1.55 }}>
                  {pr.summary}
                </div>
              )}
              {(pr.blocking_reasons || []).map((reason, i) => (
                <div key={i} style={{ fontFamily: MONO, fontSize: '0.6rem', color: 'var(--crimson)', marginTop: '4px', lineHeight: 1.5 }}>
                  ✕ {reason}
                </div>
              ))}
              {(pr.warnings || []).map((w, i) => (
                <div key={i} style={{ fontFamily: MONO, fontSize: '0.6rem', color: 'var(--amber)', marginTop: '4px', lineHeight: 1.5 }}>
                  ⚠ {w}
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* ZONE 03: Branch health */}
        <div className="no-scrollbar" style={{
          flex: '0 1 300px', minWidth: '210px', overflowY: 'auto',
          borderLeft: '1px solid var(--line-faint)', paddingLeft: '24px',
        }}>
          <ZoneLabel index="03" right={
            <TextButton onClick={scanBranches} disabled={scanningBranches}>
              {scanningBranches ? '⠿ SCANNING…' : 'SCAN'}
            </TextButton>
          }>
            Branches
          </ZoneLabel>
          {branchList === null ? (
            <div style={{ fontFamily: BODY, fontSize: '0.7rem', color: 'var(--t4)' }}>
              Not scanned yet.
            </div>
          ) : branchList.length === 0 ? (
            <div style={{ fontFamily: BODY, fontSize: '0.7rem', color: 'var(--t4)' }}>
              No branches found.
            </div>
          ) : branchList.map((b) => (
            <div key={b.name} style={{ borderBottom: '1px solid var(--line-faint)', padding: '9px 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <StatusDot color={CLASSIFICATION_COLORS[b.classification] || 'var(--t3)'} />
                <span style={{ fontFamily: MONO, fontSize: '0.72rem', color: 'var(--t1)', fontWeight: 600, wordBreak: 'break-all' }}>
                  {b.name}
                </span>
                {b.protected && (
                  <span style={{ fontFamily: MONO, fontSize: '0.5rem', color: '#818cf8', fontWeight: 800, letterSpacing: '0.14em', flexShrink: 0 }}>
                    PROTECTED
                  </span>
                )}
              </div>
              <div style={{ fontFamily: MONO, fontSize: '0.56rem', color: 'var(--t4)', marginTop: '4px', paddingLeft: '16px', lineHeight: 1.5 }}>
                {String(b.classification || '').toUpperCase()}
                {b.age_days > 0 ? ` · ${b.age_days}D` : ''} — {b.recommendation}
              </div>
            </div>
          ))}
        </div>
      </div>

      <style>{`@keyframes pulse-live { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }`}</style>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════
 * GuardianPrZone — compact PR-readiness scanner
 *
 * Embedded inside the Git Assistant dashboard (zone 02).
 * Read-only: probes the daemon, scans PRs on demand. No
 * daemon management here — that stays with the CLI/daemon.
 * ═══════════════════════════════════════════════════════ */

// Module-level so StrictMode's double-mount can't spawn the daemon twice
let autoStartInFlight = false;

export const GuardianPrZone = () => {
  // 'checking' | 'starting' | 'offline' | 'ready'
  const [state, setState] = useState('checking');
  const [prs, setPrs] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState(null);

  const files = useEditorStore(s => s.files);
  const sessionName = useEditorStore(s => s.sessionName);
  const gitRepoUrl = useEditorStore(s => s.gitRepoUrl);
  const repoUrl = getSavedRepoUrl(getProjectKey(files, sessionName)) || gitRepoUrl || '';

  const check = useCallback(async () => {
    setState('checking');
    if (await guardianHealth()) {
      setState('ready');
      return;
    }
    // Desktop app: auto-start the daemon for this repo (best-effort).
    // Needs the repo's workspace config from a previous Guardian setup.
    if (isElectron() && repoUrl && !autoStartInFlight) {
      autoStartInFlight = true;
      setState('starting');
      try {
        const res = await guardianStart(repoUrl);
        if (res?.running) {
          setState('ready');
          return;
        }
      } catch { /* fall through to offline */ } finally {
        autoStartInFlight = false;
      }
    }
    setState('offline');
  }, [repoUrl]);

  useEffect(() => { check(); }, [check]);

  const scan = async () => {
    setScanning(true);
    setError(null);
    try {
      const res = await guardianPrs();
      setPrs(res.prs || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setScanning(false);
    }
  };

  return (
    <>
      <ZoneLabel index="02" right={
        state === 'ready' ? (
          <TextButton onClick={scan} disabled={scanning}>
            {scanning ? '⠿ SCANNING…' : 'SCAN PRS'}
          </TextButton>
        ) : state === 'offline' ? (
          <TextButton onClick={check}>⟳ RETRY</TextButton>
        ) : null
      }>
        Guardian · Pull Requests
      </ZoneLabel>

      {(state === 'checking' || state === 'starting') && (
        <div style={{
          fontFamily: MONO, fontSize: '0.58rem', color: 'var(--t4)',
          letterSpacing: '0.18em', animation: 'pulse-live 1.2s ease infinite',
        }}>
          {state === 'starting' ? '⠿ STARTING GUARDIAN…' : '⠿ LOOKING FOR GUARDIAN…'}
        </div>
      )}

      {state === 'offline' && (
        <div style={{ fontFamily: BODY, fontSize: '0.7rem', color: 'var(--t4)', lineHeight: 1.6 }}>
          Repository Guardian is offline — start the daemon
          (<span style={{ fontFamily: MONO, color: 'var(--t3)' }}>gitpilot start</span>)
          to scan pull requests.
        </div>
      )}

      {state === 'ready' && (
        <>
          {error && <ErrorLine style={{ marginBottom: '12px' }}>{error}</ErrorLine>}
          {prs === null ? (
            <div style={{ fontFamily: BODY, fontSize: '0.7rem', color: 'var(--t4)', lineHeight: 1.6 }}>
              Not scanned yet — scanning asks GitHub and (when AI is on) the LLM.
            </div>
          ) : prs.length === 0 ? (
            <div style={{ fontFamily: BODY, fontSize: '0.7rem', color: 'var(--t4)' }}>
              No open pull requests.
            </div>
          ) : prs.map((pr) => (
            <div key={pr.pr_number} style={{ borderBottom: '1px solid var(--line-faint)', padding: '11px 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontFamily: MONO, fontSize: '0.72rem', color: 'var(--t1)', fontWeight: 800 }}>
                  #{pr.pr_number}
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '7px' }}>
                  <StatusDot color={RECOMMENDATION_COLORS[pr.recommendation] || 'var(--t3)'} />
                  <span style={{
                    fontFamily: MONO, fontSize: '0.54rem', fontWeight: 800, letterSpacing: '0.14em',
                    color: RECOMMENDATION_COLORS[pr.recommendation] || 'var(--t3)',
                  }}>
                    {String(pr.recommendation || '').replace(/-/g, ' ').toUpperCase()}
                  </span>
                </span>
                {pr.has_conflicts && (
                  <span style={{ fontFamily: MONO, fontSize: '0.52rem', color: 'var(--crimson)', fontWeight: 800, letterSpacing: '0.12em' }}>
                    CONFLICTS
                  </span>
                )}
                <span style={{ marginLeft: 'auto', fontFamily: MONO, fontSize: '0.56rem', color: 'var(--t4)' }}>
                  {pr.confidence}%
                </span>
              </div>
              {pr.title && (
                <div style={{ fontFamily: BODY, fontSize: '0.78rem', fontWeight: 600, color: 'var(--t1)', marginTop: '6px', lineHeight: 1.4 }}>
                  {pr.title}
                </div>
              )}
              {(pr.author || pr.head_branch) && (
                <div style={{ fontFamily: MONO, fontSize: '0.56rem', color: 'var(--t4)', marginTop: '4px', letterSpacing: '0.04em' }}>
                  {pr.author && <>by {pr.author}</>}
                  {pr.age_days > 0 && <> · opened {pr.age_days}d ago</>}
                  {pr.head_branch && <> · ⎇ {pr.head_branch} → {pr.base_branch}</>}
                </div>
              )}
              {pr.summary && (
                <div style={{ fontFamily: BODY, fontSize: '0.72rem', color: 'var(--t2)', marginTop: '6px', lineHeight: 1.55 }}>
                  {pr.summary}
                </div>
              )}
              {pr.merge_impact && (
                <div style={{
                  display: 'flex', gap: '8px', marginTop: '6px',
                  fontFamily: MONO, fontSize: '0.62rem', lineHeight: 1.55,
                  color: 'var(--emerald)',
                }}>
                  <span style={{ flexShrink: 0 }}>⇄</span>
                  <span>{pr.merge_impact}</span>
                </div>
              )}
              {(pr.blocking_reasons || []).map((reason, i) => (
                <div key={i} style={{ fontFamily: MONO, fontSize: '0.6rem', color: 'var(--crimson)', marginTop: '4px', lineHeight: 1.5 }}>
                  ✕ {reason}
                </div>
              ))}
              {(pr.warnings || []).map((w, i) => (
                <div key={i} style={{ fontFamily: MONO, fontSize: '0.6rem', color: 'var(--amber)', marginTop: '4px', lineHeight: 1.5 }}>
                  ⚠ {w}
                </div>
              ))}
            </div>
          ))}
        </>
      )}
    </>
  );
};

export default GuardianPanel;
