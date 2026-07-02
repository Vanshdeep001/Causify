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

const HudLabel = ({ children }) => (
  <div style={{
    fontFamily: 'var(--font-number)', fontSize: '0.65rem', color: '#666',
    letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: '12px',
    fontWeight: 900
  }}>
    {children}
  </div>
);

const StatusDot = ({ color, pulse }) => (
  <span style={{
    display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%',
    background: color, boxShadow: `0 0 8px ${color}`,
    animation: pulse ? 'pulse-live 1.5s ease-in-out infinite' : 'none',
    marginRight: '8px', flexShrink: 0,
  }} />
);

const RECOMMENDATION_COLORS = {
  'ready-to-merge': '#4ade80',
  'needs-review': '#fbbf24',
  'blocked': '#E5484D',
  'needs-attention': '#818cf8',
};

const CLASSIFICATION_COLORS = {
  active: '#4ade80',
  stale: '#E5484D',
  release: '#818cf8',
  uncertain: '#fbbf24',
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
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0a0a' }}>
        <div style={{ fontFamily: 'var(--font-number)', color: '#888', fontSize: '0.75rem', letterSpacing: '0.2em', animation: 'pulse-live 1.2s ease infinite' }}>
          ⠿ {phase === 'busy' ? busyLabel : 'SCANNING FOR REPOSITORY GUARDIAN...'}
        </div>
        <style>{`@keyframes pulse-live { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }`}</style>
      </div>
    );
  }

  if (phase === 'no-electron' || phase === 'not-installed') {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0a0a', padding: '30px' }}>
        <div style={{ maxWidth: '520px', textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--font-header)', fontSize: '1.3rem', fontWeight: 900, color: '#fff', textTransform: 'uppercase', marginBottom: '12px' }}>
            Repository Guardian Not Detected
          </div>
          <div style={{ fontFamily: 'var(--font-number)', fontSize: '0.7rem', color: '#666', lineHeight: 1.8 }}>
            {phase === 'no-electron'
              ? 'Guardian management needs the desktop app. Start the daemon manually with "gitpilot start" and refresh.'
              : 'Install the Guardian engine first: pip install -e <GitPilot folder>, then reopen this tab.'}
          </div>
          {error && (
            <div style={{
              marginTop: '14px', fontFamily: 'var(--font-number)', fontSize: '0.62rem',
              color: '#E5484D', lineHeight: 1.7, wordBreak: 'break-word',
            }}>
              {error}
            </div>
          )}
          <button onClick={() => { setError(null); setPhase('checking'); detect(); }} style={{
            marginTop: '20px', padding: '8px 24px', background: 'transparent',
            border: '1.5px solid #333', color: '#888', cursor: 'pointer',
            fontFamily: 'var(--font-number)', fontSize: '0.65rem', fontWeight: 900, letterSpacing: '0.1em',
          }}>
            ⟳ RECHECK
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'stopped') {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', padding: '30px 20px', background: '#0a0a0a', overflow: 'auto' }} className="no-scrollbar">
        <div style={{ width: '100%', animation: 'fade-in 0.5s ease-out' }}>
          <div style={{ marginBottom: '26px', borderLeft: '3px solid #FFFFFF', paddingLeft: '20px' }}>
            <div style={{ fontFamily: 'var(--font-number)', fontSize: '0.6rem', color: '#555', letterSpacing: '0.5em', marginBottom: '8px' }}>
              REPOSITORY GUARDIAN MODULE
            </div>
            <div style={{ fontFamily: 'var(--font-header)', fontSize: '1.6rem', fontWeight: 900, color: '#fff', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              Launch Your Repo's Guardian
            </div>
            <div style={{ fontFamily: 'var(--font-number)', fontSize: '0.65rem', color: '#666', marginTop: '8px', lineHeight: 1.7 }}>
              Watches PRs, branches, and releases on GitHub. Observes and recommends — never acts without your approval.
            </div>
          </div>

          <div style={{ border: '1px solid #1a1a1a', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '16px', background: 'rgba(255,255,255,0.01)' }}>
            <div>
              <HudLabel>Repository</HudLabel>
              <input
                type="text"
                value={repoUrlInput}
                onChange={(e) => setRepoUrlInput(e.target.value)}
                placeholder={savedRepoUrl || 'https://github.com/user/repository.git'}
                spellCheck={false}
                style={{
                  width: '100%', background: 'transparent', border: 'none', outline: 'none',
                  color: '#fff', fontSize: '0.95rem', fontFamily: 'var(--font-header)', fontWeight: 700,
                  borderBottom: '1px solid #222', paddingBottom: '8px',
                }}
              />
            </div>

            {needsSetup && (
              <>
                <div>
                  <HudLabel>GitHub Personal Access Token</HudLabel>
                  <input
                    type="password"
                    value={patInput}
                    onChange={(e) => setPatInput(e.target.value)}
                    placeholder="ghp_… (auto-detected from repo URL when embedded)"
                    spellCheck={false}
                    style={{
                      width: '100%', background: 'transparent', border: 'none', outline: 'none',
                      color: '#fff', fontSize: '0.95rem', fontFamily: 'var(--font-header)', fontWeight: 700,
                      borderBottom: '1px solid #222', paddingBottom: '8px',
                    }}
                  />
                </div>
                <div>
                  <HudLabel>OpenRouter Key — optional</HudLabel>
                  <input
                    type="password"
                    value={llmKeyInput}
                    onChange={(e) => setLlmKeyInput(e.target.value)}
                    placeholder="Blank = reuse this machine's key, or run rules-only"
                    spellCheck={false}
                    style={{
                      width: '100%', background: 'transparent', border: 'none', outline: 'none',
                      color: '#fff', fontSize: '0.95rem', fontFamily: 'var(--font-header)', fontWeight: 700,
                      borderBottom: '1px solid #222', paddingBottom: '8px',
                    }}
                  />
                  <div style={{ fontFamily: 'var(--font-number)', fontSize: '0.58rem', color: '#555', marginTop: '6px' }}>
                    Keys are stored in the OS keychain by the Guardian itself — DebugSync never saves them.
                  </div>
                </div>
              </>
            )}

            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <button
                onClick={needsSetup ? handleSetupAndLaunch : handleLaunch}
                style={{
                  padding: '12px 36px', background: '#FFFFFF', color: '#000', border: 'none',
                  cursor: 'pointer', fontFamily: 'var(--font-number)', fontSize: '0.75rem',
                  fontWeight: 900, letterSpacing: '0.15em',
                  boxShadow: '0 0 25px rgba(255,255,255,0.12)',
                }}
              >
                {needsSetup ? '⚙ CONFIGURE & LAUNCH' : '▶ LAUNCH AGENT'}
              </button>
              {!needsSetup && (
                <button
                  onClick={() => setNeedsSetup(true)}
                  style={{
                    padding: '12px 16px', background: 'transparent', border: 'none',
                    color: '#555', cursor: 'pointer', fontFamily: 'var(--font-number)',
                    fontSize: '0.65rem', fontWeight: 900, letterSpacing: '0.1em',
                  }}
                >
                  FIRST-TIME SETUP
                </button>
              )}
            </div>

            {error && (
              <div style={{
                padding: '10px 14px', background: 'rgba(229,72,77,0.05)',
                borderLeft: '3px solid #E5484D', color: '#E5484D',
                fontFamily: 'var(--font-number)', fontSize: '0.68rem', fontWeight: 800,
              }}>
                {error}
              </div>
            )}
          </div>
        </div>
        <style>{`@keyframes pulse-live { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }`}</style>
      </div>
    );
  }

  /* ═══════════ RENDER: running dashboard ═══════════ */

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#0a0a0a' }}>

      {/* ── Status strip ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '14px', padding: '10px 20px',
        borderBottom: '1px solid #1a1a1a', flexShrink: 0, flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <StatusDot color="#4ade80" pulse />
          <span style={{ fontFamily: 'var(--font-number)', fontSize: '0.68rem', color: '#4ade80', fontWeight: 900, letterSpacing: '0.12em' }}>
            GUARDIAN ACTIVE
          </span>
        </div>
        {status?.repo && (
          <span style={{ fontFamily: 'var(--font-number)', fontSize: '0.65rem', color: '#888' }}>
            {status.repo}
          </span>
        )}
        <span style={{ fontFamily: 'var(--font-number)', fontSize: '0.6rem', color: status?.llm_available ? '#818cf8' : '#555' }}>
          AI: {status?.llm_available ? 'ON' : 'RULES ONLY'}
        </span>
        <span style={{ fontFamily: 'var(--font-number)', fontSize: '0.6rem', color: approvals.length > 0 ? '#fbbf24' : '#555' }}>
          {approvals.length} AWAITING APPROVAL
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
          <button onClick={loadLocalData} style={{
            padding: '4px 12px', background: 'transparent', border: '1px solid #333',
            color: '#888', cursor: 'pointer', fontFamily: 'var(--font-number)',
            fontSize: '0.58rem', fontWeight: 900, letterSpacing: '0.1em', borderRadius: '2px',
          }}>
            ⟳ REFRESH
          </button>
          {isElectron() && (
            <button onClick={handleStop} style={{
              padding: '4px 12px', background: 'transparent', border: '1px solid #333',
              color: '#555', cursor: 'pointer', fontFamily: 'var(--font-number)',
              fontSize: '0.58rem', fontWeight: 900, letterSpacing: '0.1em', borderRadius: '2px',
            }}>
              ■ STOP
            </button>
          )}
        </div>
      </div>

      {error && (
        <div style={{
          padding: '8px 20px', background: 'rgba(229,72,77,0.05)', color: '#E5484D',
          fontFamily: 'var(--font-number)', fontSize: '0.65rem', fontWeight: 800, flexShrink: 0,
        }}>
          {error}
        </div>
      )}

      {/* ── Main content: 3 columns ── */}
      <div className="no-scrollbar" style={{ flex: 1, display: 'flex', gap: '0', overflow: 'auto', padding: '16px 10px' }}>

        {/* Approvals inbox */}
        <div className="no-scrollbar" style={{ flex: '0 1 320px', minWidth: '230px', padding: '0 12px', overflowY: 'auto', borderRight: '1px solid #151515' }}>
          <HudLabel>Awaiting Your Approval</HudLabel>
          {approvals.length === 0 ? (
            <div style={{ fontFamily: 'var(--font-number)', fontSize: '0.65rem', color: '#444', fontStyle: 'italic' }}>
              Inbox clear — nothing needs your decision.
            </div>
          ) : approvals.map((a) => (
            <div key={a.id} style={{ border: '1px solid #1a1a1a', marginBottom: '10px', background: 'rgba(255,255,255,0.01)' }}>
              <div
                onClick={() => setExpandedApproval(expandedApproval === a.id ? null : a.id)}
                style={{ padding: '10px 14px', cursor: 'pointer' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontFamily: 'var(--font-number)', fontSize: '0.62rem', color: '#fbbf24', fontWeight: 900, letterSpacing: '0.08em' }}>
                    #{a.id} · {String(a.action_type || '').replace(/_/g, ' ').toUpperCase()}
                  </span>
                  <span style={{
                    fontFamily: 'var(--font-number)', fontSize: '0.55rem', fontWeight: 900,
                    color: a.risk_level === 'high' ? '#E5484D' : a.risk_level === 'moderate' ? '#fbbf24' : '#4ade80',
                  }}>
                    {(a.risk_level || 'low').toUpperCase()}
                  </span>
                </div>
                <div style={{ fontFamily: 'var(--font-header)', fontSize: '0.85rem', color: '#ddd', fontWeight: 700, marginTop: '4px' }}>
                  {a.target}
                </div>
              </div>
              {expandedApproval === a.id && (
                <div style={{ padding: '0 14px 12px' }}>
                  <pre className="no-scrollbar" style={{
                    margin: 0, padding: '10px', background: '#050505', border: '1px solid #151515',
                    color: '#999', fontFamily: 'var(--font-number)', fontSize: '0.62rem',
                    lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    maxHeight: '220px', overflow: 'auto',
                  }}>
                    {typeof a.analysis === 'string' ? a.analysis : JSON.stringify(a.analysis, null, 2)}
                  </pre>
                  <div style={{ fontFamily: 'var(--font-number)', fontSize: '0.56rem', color: '#555', marginTop: '8px' }}>
                    To approve: run <span style={{ color: '#888' }}>gitpilot approve {a.id}</span> in a terminal.
                    In-app approval arrives in Phase 2.
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* PR readiness */}
        <div className="no-scrollbar" style={{ flex: 1, minWidth: 0, padding: '0 16px', overflowY: 'auto', borderRight: '1px solid #151515' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <HudLabel>Pull Request Readiness</HudLabel>
            <button onClick={scanPrs} disabled={scanningPrs} style={{
              padding: '4px 14px', background: 'transparent', border: '1px solid #333',
              color: '#888', cursor: 'pointer', fontFamily: 'var(--font-number)',
              fontSize: '0.58rem', fontWeight: 900, letterSpacing: '0.1em', borderRadius: '2px',
              opacity: scanningPrs ? 0.5 : 1, marginBottom: '12px',
            }}>
              {scanningPrs ? '⠿ SCANNING…' : '◉ SCAN PRS'}
            </button>
          </div>
          {prs === null ? (
            <div style={{ fontFamily: 'var(--font-number)', fontSize: '0.65rem', color: '#444', fontStyle: 'italic' }}>
              Not scanned yet — scanning asks GitHub and (when AI is on) the LLM.
            </div>
          ) : prs.length === 0 ? (
            <div style={{ fontFamily: 'var(--font-number)', fontSize: '0.65rem', color: '#444', fontStyle: 'italic' }}>
              No open pull requests.
            </div>
          ) : prs.map((pr) => (
            <div key={pr.pr_number} style={{ borderBottom: '1px solid #131313', padding: '10px 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontFamily: 'var(--font-number)', fontSize: '0.75rem', color: '#fff', fontWeight: 900 }}>
                  PR #{pr.pr_number}
                </span>
                <span style={{
                  fontFamily: 'var(--font-number)', fontSize: '0.58rem', fontWeight: 900, letterSpacing: '0.08em',
                  color: RECOMMENDATION_COLORS[pr.recommendation] || '#888',
                }}>
                  {String(pr.recommendation || '').toUpperCase()}
                </span>
                {pr.has_conflicts && (
                  <span style={{ fontFamily: 'var(--font-number)', fontSize: '0.55rem', color: '#E5484D', fontWeight: 900 }}>
                    ⚠ CONFLICTS
                  </span>
                )}
                <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-number)', fontSize: '0.58rem', color: '#555' }}>
                  {pr.confidence}% conf
                </span>
              </div>
              {pr.summary && (
                <div style={{ fontFamily: 'var(--font-number)', fontSize: '0.63rem', color: '#999', marginTop: '5px', lineHeight: 1.6 }}>
                  {pr.summary}
                </div>
              )}
              {(pr.blocking_reasons || []).map((reason, i) => (
                <div key={i} style={{ fontFamily: 'var(--font-number)', fontSize: '0.6rem', color: '#E5484D', marginTop: '3px' }}>
                  ✕ {reason}
                </div>
              ))}
              {(pr.warnings || []).map((w, i) => (
                <div key={i} style={{ fontFamily: 'var(--font-number)', fontSize: '0.6rem', color: '#fbbf24', marginTop: '3px' }}>
                  ⚠ {w}
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Branch health */}
        <div className="no-scrollbar" style={{ flex: '0 1 300px', minWidth: '200px', padding: '0 14px', overflowY: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <HudLabel>Branch Health</HudLabel>
            <button onClick={scanBranches} disabled={scanningBranches} style={{
              padding: '4px 14px', background: 'transparent', border: '1px solid #333',
              color: '#888', cursor: 'pointer', fontFamily: 'var(--font-number)',
              fontSize: '0.58rem', fontWeight: 900, letterSpacing: '0.1em', borderRadius: '2px',
              opacity: scanningBranches ? 0.5 : 1, marginBottom: '12px',
            }}>
              {scanningBranches ? '⠿ SCANNING…' : '⌥ SCAN'}
            </button>
          </div>
          {branchList === null ? (
            <div style={{ fontFamily: 'var(--font-number)', fontSize: '0.65rem', color: '#444', fontStyle: 'italic' }}>
              Not scanned yet.
            </div>
          ) : branchList.length === 0 ? (
            <div style={{ fontFamily: 'var(--font-number)', fontSize: '0.65rem', color: '#444', fontStyle: 'italic' }}>
              No branches found.
            </div>
          ) : branchList.map((b) => (
            <div key={b.name} style={{ borderBottom: '1px solid #131313', padding: '8px 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{
                  width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0,
                  background: CLASSIFICATION_COLORS[b.classification] || '#888',
                }} />
                <span style={{ fontFamily: 'var(--font-header)', fontSize: '0.8rem', color: '#ddd', fontWeight: 700, wordBreak: 'break-all' }}>
                  {b.name}
                </span>
                {b.protected && (
                  <span style={{ fontFamily: 'var(--font-number)', fontSize: '0.52rem', color: '#818cf8', fontWeight: 900 }}>🛡</span>
                )}
              </div>
              <div style={{ fontFamily: 'var(--font-number)', fontSize: '0.58rem', color: '#666', marginTop: '3px', paddingLeft: '17px' }}>
                {String(b.classification || '').toUpperCase()}
                {b.age_days > 0 ? ` · ${b.age_days}d` : ''} — {b.recommendation}
              </div>
            </div>
          ))}
        </div>
      </div>

      <style>{`@keyframes pulse-live { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }`}</style>
    </div>
  );
};

export default GuardianPanel;
