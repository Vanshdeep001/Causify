/* -------------------------------------------------------
 * GitAssistantPanel.jsx — Intelligent Git Workspace
 *
 * Three states:
 *  1. NOT CONNECTED → "Connect Repository" form
 *  2. CONNECTED, IDLE → Status dashboard + command bar
 *  3. CONNECTED, SUGGESTION → Commit composer + push capability
 *
 * Wrapper separates the two modules cleanly:
 *  GIT      → the hands: commit / push / pull on your code
 *  GUARDIAN → the eyes: Repository Guardian observing the
 *             whole repo (PRs, branches, approvals)
 *
 * Visual language: open editorial layout — hairline dividers
 * instead of nested cards, numbered zone labels, display-font
 * accents, pill actions.
 * ------------------------------------------------------- */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import useEditorStore from '../../store/useEditorStore';
import {
  executeGitCommit, cloneGitRepo, gitPush, gitPull,
  gitStatus, gitLog, gitIsConnected, gitDisconnect,
  gitBranches, gitCheckout, gitUndoCommit
} from '../../services/api';
import { getProjectKey, getSavedRepoUrl, saveRepoUrl, clearSavedRepoUrl } from '../../utils/gitRepoMemory';
import { GuardianPrZone } from './GuardianPanel';

/* ═══════════════════════════════════════════════════════
 * Panel-local design primitives
 * ═══════════════════════════════════════════════════════ */

const MONO = 'var(--font-number)';
const HEADER = 'var(--font-header)';
const BODY = 'var(--font-body)';

/* Numbered editorial section label — accent tick, index, fading hairline */
const ZoneLabel = ({ index, children, right }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: '11px', marginBottom: '16px', flexShrink: 0 }}>
    <span style={{ width: '3px', height: '12px', borderRadius: '2px', background: 'var(--line-strong)', flexShrink: 0 }} />
    {index && (
      <span style={{ fontFamily: MONO, fontSize: '0.5rem', color: 'var(--t4)', fontWeight: 700, letterSpacing: '0.1em' }}>
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
    <span style={{ flex: 1, height: '1px', background: 'linear-gradient(90deg, var(--line), transparent)' }} />
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
    boxShadow: '0 0 0 rgba(255,255,255,0)',
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
      e.currentTarget.style.boxShadow = '0 0 0 rgba(255,255,255,0)';
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
    fontWeight: 600, lineHeight: 1.6, animation: 'scale-in 0.2s ease',
    wordBreak: 'break-word', ...style,
  }}>
    {children}
  </div>
);

/* Focus helpers for underline inputs */
const focusLine = e => { e.currentTarget.parentElement.style.borderBottomColor = 'rgba(255,255,255,0.45)'; };
const blurLine = e => { e.currentTarget.parentElement.style.borderBottomColor = 'var(--line-strong)'; };

/* Git porcelain status code → classy badge descriptor.
 * XY columns: '??' untracked, 'A' added, 'M' modified, 'D' deleted,
 * 'R' renamed. Untracked/added read as NEW, the rest map to intent. */
const fileStatusMeta = (code) => {
  const c = (code || '').trim();
  if (c === '??' || c.includes('A')) return { label: 'NEW', color: 'var(--emerald)' };
  if (c.includes('D')) return { label: 'DEL', color: 'var(--crimson)' };
  if (c.includes('R')) return { label: 'MOVED', color: '#818cf8' };
  if (c.includes('M')) return { label: 'EDIT', color: 'var(--amber)' };
  return { label: c || '•', color: '#818cf8' };
};

/* Small pill: status dot + micro-caps label, thin-bordered. */
const FileBadge = ({ code }) => {
  const m = fileStatusMeta(code);
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '6px',
      padding: '2px 8px', borderRadius: '2px', flexShrink: 0,
      border: '1px solid var(--line)', background: 'rgba(255,255,255,0.02)',
    }}>
      <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: m.color, flexShrink: 0 }} />
      <span style={{ fontFamily: MONO, fontSize: '0.5rem', fontWeight: 700, letterSpacing: '0.12em', color: m.color }}>
        {m.label}
      </span>
    </span>
  );
};

/* Ghost action button — used in the segmented push/pull/sync group */
const GhostAction = ({ icon, label, onClick, disabled }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    style={{
      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '7px',
      padding: '9px 8px', background: 'transparent', border: 'none',
      color: 'var(--t3)', cursor: disabled ? 'default' : 'pointer',
      fontFamily: MONO, fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.1em',
      opacity: disabled ? 0.4 : 1, transition: 'color 0.15s ease, background 0.15s ease',
    }}
    onMouseEnter={e => { if (!disabled) { e.currentTarget.style.color = '#fff'; e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; } }}
    onMouseLeave={e => { e.currentTarget.style.color = 'var(--t3)'; e.currentTarget.style.background = 'transparent'; }}
  >
    <span style={{ fontSize: '0.74rem' }}>{icon}</span>{label}
  </button>
);

/* ═══════════════════════════════════════════════════════
 * Super Mario commit-history graph pieces
 * Mario marks HEAD; older commits are checkpoint flags on a
 * flagpole; the first commit plants into a brick ground block.
 * ═══════════════════════════════════════════════════════ */

const MARIO_PAL = { R: '#E52521', S: '#FCB985', N: '#5C2E00', B: '#2A6DE0', Y: '#FBD000' };
const MARIO_ROWS = [
  '....RRRRRRR.....',
  '...RRRRRRRRR....',
  '..RRRRRRRRRRR...',
  '..NNNSSSSNSS....',
  '.NSNSSSSSNSSS...',
  '.NSNNSSSSNNNN...',
  '.NNSSSSSSNNN....',
  '...SSSSSSSS.....',
  '..RRRBBBBRRR....',
  '.RRRRBYBBYBRRRR.',
  '.SSRBBBBBBBBSS..',
  '.SSBBBBBBBBBBSS.',
  '..BBBBB..BBBBB..',
  '..BBB......BBB..',
  '.NNNN......NNNN.',
  '.NNNN......NNNN.',
];

/* Render a character-grid sprite as crisp 1×1 pixel rects. */
const PixelSprite = ({ rows, palette, px = 1.5, style }) => {
  const w = rows[0].length, h = rows.length;
  const cells = [];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const fill = palette[row[x]];
      if (fill) cells.push(<rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={fill} />);
    }
  });
  return (
    <svg width={w * px} height={h * px} viewBox={`0 0 ${w} ${h}`} shapeRendering="crispEdges" style={{ display: 'block', ...style }}>
      {cells}
    </svg>
  );
};

/* Checkpoint flag on a silver pole — marks each past commit. */
const CheckpointFlag = ({ active }) => (
  <svg width="22" height="22" viewBox="0 0 22 22" shapeRendering="crispEdges" style={{ display: 'block' }}>
    <rect x="10" y="1" width="2" height="20" fill="#9aa0a6" />
    <rect x="10" y="1" width="1" height="20" fill="#cdd2d7" />
    <rect x="9" y="0" width="4" height="2" fill="#FBD000" />
    <path d="M12 3 L20 5.5 L12 8 Z" fill={active ? '#E52521' : '#43B047'} />
    <rect x="14" y="5" width="2" height="1" fill="#ffffff" />
  </svg>
);

/* Brick ground block — where the flagpole plants at the first commit. */
const GroundBase = () => (
  <svg width="26" height="12" viewBox="0 0 26 12" shapeRendering="crispEdges" style={{ display: 'block', marginTop: '3px' }}>
    <rect x="0" y="0" width="26" height="12" fill="#8B3A0E" />
    <rect x="0" y="0" width="26" height="1" fill="#C05A1E" />
    <rect x="0" y="5" width="26" height="1" fill="#4A1E06" />
    <rect x="6" y="1" width="1" height="4" fill="#4A1E06" />
    <rect x="13" y="1" width="1" height="4" fill="#4A1E06" />
    <rect x="20" y="1" width="1" height="4" fill="#4A1E06" />
    <rect x="3" y="6" width="1" height="6" fill="#4A1E06" />
    <rect x="10" y="6" width="1" height="6" fill="#4A1E06" />
    <rect x="17" y="6" width="1" height="6" fill="#4A1E06" />
    <rect x="23" y="6" width="1" height="6" fill="#4A1E06" />
  </svg>
);

/* ═══════════════════════════════════════════════════════
 * GIT module
 * ═══════════════════════════════════════════════════════ */

const GitAssistantCore = () => {
  const sessionId = useEditorStore(s => s.sessionId);
  const suggestion = useEditorStore(s => s.commitSuggestion);
  const setCommitSuggestion = useEditorStore(s => s.setCommitSuggestion);
  const terminalLayoutMode = useEditorStore(s => s.terminalLayoutMode);

  const gitRepoConnected = useEditorStore(s => s.gitRepoConnected);
  const gitRepoUrl = useEditorStore(s => s.gitRepoUrl);
  const gitStatusData = useEditorStore(s => s.gitStatus);
  const gitLogData = useEditorStore(s => s.gitLog);
  const gitLoading = useEditorStore(s => s.gitLoading);
  const gitError = useEditorStore(s => s.gitError);
  const files = useEditorStore(s => s.files);

  const setGitRepoConnected = useEditorStore(s => s.setGitRepoConnected);
  const setGitStatus = useEditorStore(s => s.setGitStatus);
  const setGitLog = useEditorStore(s => s.setGitLog);
  const setGitLoading = useEditorStore(s => s.setGitLoading);
  const setGitError = useEditorStore(s => s.setGitError);
  const resetGit = useEditorStore(s => s.resetGit);

  const [repoUrlInput, setRepoUrlInput] = useState('');
  const [commandOutput, setCommandOutput] = useState(null);
  const [pullConflict, setPullConflict] = useState(null); // { files: [...] }
  const [showCommitInput, setShowCommitInput] = useState(false);
  const [inlineCommitMsg, setInlineCommitMsg] = useState('');
  const [showBranchInput, setShowBranchInput] = useState(false);
  const [branchInput, setBranchInput] = useState('');
  const [branches, setBranches] = useState([]);

  // When an AI commit suggestion arrives, pre-fill the main panel's commit
  // composer instead of taking over the view — the git tab always lands on
  // the main panel (git actions + Repository Guardian).
  useEffect(() => {
    if (suggestion && suggestion.message) {
      setInlineCommitMsg(suggestion.message);
    }
  }, [suggestion]);

  const refreshStatus = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await gitStatus(sessionId, Object.entries(files).map(([path, content]) => ({ path, content })));
      setGitStatus(res.output || '');
    } catch (e) { /* silent */ }
  }, [sessionId, files]);

  const refreshLog = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await gitLog(sessionId, 8);
      setGitLog(res.output || '');
    } catch (e) { /* silent */ }
  }, [sessionId]);

  const sessionName = useEditorStore(s => s.sessionName);
  const projectKey = getProjectKey(files, sessionName);
  const autoConnectAttemptedRef = useRef(false);

  // Check connection on mount; if not connected but this project has a
  // saved repo URL, silently reconnect it so the user never re-enters it.
  useEffect(() => {
    if (!sessionId) return;
    gitIsConnected(sessionId).then(async (res) => {
      if (res.connected) {
        setGitRepoConnected(true);
        refreshStatus();
        refreshLog();
        return;
      }
      const savedUrl = getSavedRepoUrl(projectKey);
      if (!savedUrl || autoConnectAttemptedRef.current) return;
      autoConnectAttemptedRef.current = true;
      setGitLoading(true);
      try {
        const result = await cloneGitRepo(sessionId, savedUrl);
        if (result.success) {
          const safeUrl = savedUrl.replace(/\/\/[^@]+@/, '//***@');
          setGitRepoConnected(true, safeUrl);
          refreshStatus();
          refreshLog();
        } else {
          // Saved URL no longer works (revoked token, deleted repo) —
          // fall back to the connect form, prefilled for editing.
          setRepoUrlInput(savedUrl);
        }
      } catch {
        setRepoUrlInput(savedUrl);
      } finally {
        setGitLoading(false);
      }
    }).catch(() => {});
  }, [sessionId, projectKey, refreshStatus, refreshLog, setGitRepoConnected, setGitLoading]);

  // Prefill the connect form with this project's saved repo URL
  useEffect(() => {
    if (gitRepoConnected || repoUrlInput) return;
    const saved = getSavedRepoUrl(projectKey);
    if (saved) setRepoUrlInput(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectKey, gitRepoConnected]);

  // Auto-refresh status every 15s when connected
  useEffect(() => {
    if (!gitRepoConnected || !sessionId) return;
    const interval = setInterval(() => {
      refreshStatus();
    }, 15000);
    return () => clearInterval(interval);
  }, [gitRepoConnected, sessionId, refreshStatus]);

  // ═══════════════════════════════════════════════════════
  // STATE 1: NOT CONNECTED — Connect Repository Form
  // ═══════════════════════════════════════════════════════

  if (!gitRepoConnected) {
    const handleConnect = async () => {
      if (!repoUrlInput.trim() || !sessionId) return;
      setGitLoading(true);
      setGitError(null);
      try {
        const result = await cloneGitRepo(sessionId, repoUrlInput.trim());
        if (result.success) {
          // Remember the repo for this project so it's never asked again
          saveRepoUrl(projectKey, repoUrlInput.trim());
          // Store safe URL (strip token for display)
          const safeUrl = repoUrlInput.replace(/\/\/[^@]+@/, '//***@');
          setGitRepoConnected(true, safeUrl);
          setRepoUrlInput('');
          refreshStatus();
          refreshLog();
        } else {
          setGitError(result.error || 'Clone failed');
        }
      } catch (err) {
        setGitError(err.response?.data?.error || err.message || 'Connection failed');
      } finally {
        setGitLoading(false);
      }
    };

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
            REMOTE REPOSITORY
          </div>
          <div style={{
            fontFamily: HEADER, fontSize: '1.3rem', fontWeight: 800,
            color: 'var(--t1)', letterSpacing: '0.01em', marginBottom: '8px',
          }}>
            Connect a repository
          </div>
          <div style={{
            fontFamily: BODY, fontSize: '0.74rem', color: 'var(--t3)',
            lineHeight: 1.7, marginBottom: '30px', maxWidth: '420px',
          }}>
            Link a remote over HTTPS or SSH to enable intelligent commits,
            push and pull directly from this workspace.
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{
              flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '12px',
              borderBottom: '1px solid var(--line-strong)', paddingBottom: '10px',
              transition: 'border-color 0.2s ease',
            }}>
              <span style={{ fontFamily: MONO, fontSize: '0.78rem', color: 'var(--t4)', flexShrink: 0 }}>❯</span>
              <input
                type="text"
                value={repoUrlInput}
                onChange={(e) => setRepoUrlInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
                onFocus={focusLine}
                onBlur={blurLine}
                placeholder="https://github.com/user/repository.git"
                spellCheck={false}
                style={{
                  flex: 1, minWidth: 0, background: 'transparent', border: 'none',
                  outline: 'none', color: 'var(--t1)', fontSize: '0.82rem',
                  fontFamily: MONO, fontWeight: 500,
                }}
              />
            </div>
            <PrimaryButton onClick={handleConnect} disabled={gitLoading || !repoUrlInput.trim()}>
              {gitLoading ? 'CONNECTING…' : 'CONNECT'}
            </PrimaryButton>
          </div>

          {gitError && (
            <ErrorLine style={{ marginTop: '18px' }}>
              {gitError}
            </ErrorLine>
          )}
        </div>

        <style>{`
          @keyframes pulse-live {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.3; }
          }
        `}</style>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════
  // STATE 3: CONNECTED + COMMIT SUGGESTION ACTIVE
  // ═══════════════════════════════════════════════════════


  // ═══════════════════════════════════════════════════════
  // STATE 2: CONNECTED, IDLE — Dashboard + Command Bar
  // ═══════════════════════════════════════════════════════

  // ── Inline commit handler (from dashboard) ──
  const handleInlineCommit = async () => {
    if (!inlineCommitMsg.trim()) return;
    setGitLoading(true);
    setGitError(null);
    try {
      // Send the editor's live files so unsaved buffers are committed too
      const res = await executeGitCommit({
        sessionId,
        message: inlineCommitMsg.trim(),
        files: Object.entries(files).map(([path, content]) => ({ path, content })),
      });
      if (res.success !== false) {
        setCommandOutput({ command: 'commit', output: res.output || 'Committed successfully' });
        setInlineCommitMsg('');
        setShowCommitInput(false);
        refreshStatus();
        refreshLog();
      } else {
        // If git says nothing to commit, don't show a scary red error
        if (res.error && res.error.includes("nothing to commit")) {
          setCommandOutput({ command: 'commit', output: 'Clean tree: nothing to commit.' });
          setInlineCommitMsg('');
          setShowCommitInput(false);
        } else {
          setGitError(res.error || 'Commit failed. Check output for details.');
        }
      }
    } catch (err) {
      setGitError(err.response?.data?.error || err.message);
    } finally {
      setGitLoading(false);
    }
  };

  // ── Branch switching (from the banner button) ──
  const openBranchSwitcher = async () => {
    setShowBranchInput(true);
    setShowCommitInput(false);
    try {
      const res = await gitBranches(sessionId);
      if (res.success !== false) {
        const list = String(res.output || '')
          .split('\n')
          .map(l => l.trim())
          .filter(Boolean)
          .map(l => ({ current: l.startsWith('*'), name: l.replace(/^\*\s*/, '') }));
        setBranches(list);
      }
    } catch { /* branch list is optional — manual input still works */ }
  };

  const handleCheckout = async (name, create = false) => {
    const branch = (name || branchInput).trim();
    if (!branch || gitLoading) return;
    setGitLoading(true);
    setGitError(null);
    try {
      const res = await gitCheckout(sessionId, branch, create);
      if (res.success !== false) {
        setCommandOutput({ command: 'checkout', output: res.output || `Switched to '${branch}'` });
        setShowBranchInput(false);
        setBranchInput('');
        refreshStatus();
        refreshLog();
      } else {
        setGitError(res.error || 'Checkout failed');
      }
    } catch (err) {
      setGitError(err.response?.data?.error || err.message);
    } finally {
      setGitLoading(false);
    }
  };

  // One-click git action (push / pull) — output surfaces under the actions
  const handleCommand = async (command) => {
    setCommandOutput(null);
    setPullConflict(null);
    setGitLoading(true);
    setGitError(null);
    try {
      const res = command === 'push' ? await gitPush(sessionId) : await gitPull(sessionId);
      if (res.success !== false) {
        setCommandOutput({ command, output: res.output || '(no output)' });
        refreshStatus();
        refreshLog();
      } else if (res.conflict) {
        // Backend aborted the merge — workspace is untouched. Guide the user.
        setPullConflict({ files: res.conflictFiles || [] });
      } else {
        setGitError(res.error || `${command} failed`);
      }
    } catch (err) {
      const data = err.response?.data;
      if (data?.conflict) {
        setPullConflict({ files: data.conflictFiles || [] });
      } else {
        setGitError(data?.error || err.message);
      }
    } finally {
      setGitLoading(false);
    }
  };

  // Undo the last (unpushed) commit — soft reset, files keep their content
  const handleUndoCommit = async () => {
    setCommandOutput(null);
    setPullConflict(null);
    setGitLoading(true);
    setGitError(null);
    try {
      const res = await gitUndoCommit(sessionId);
      if (res.success !== false) {
        setCommandOutput({
          command: 'undo',
          output: 'Last commit undone — your changes are back in the working tree, nothing was lost.',
        });
        refreshStatus();
        refreshLog();
      } else {
        setGitError(res.error || 'Undo failed');
      }
    } catch (err) {
      setGitError(err.response?.data?.error || err.message);
    } finally {
      setGitLoading(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await gitDisconnect(sessionId);
    } catch (e) { /* best effort */ }
    // Explicit disconnect: forget the saved repo so we don't auto-reconnect
    clearSavedRepoUrl(projectKey);
    autoConnectAttemptedRef.current = false;
    resetGit();
  };

  const isSplit = terminalLayoutMode === 'split';

  // Parse status lines
  const statusLines = String(gitStatusData || '').split('\n').filter(l => l.trim());
  const actualChanges = statusLines.filter(l => !l.startsWith('##'));
  const hasChanges = actualChanges.length > 0;

  const branchLine = statusLines.find(l => l.startsWith('##')) || '';
  const isAhead = branchLine.includes('[ahead');
  const currentBranch = branchLine.replace(/^##\s*/, '').split('...')[0].split(' ')[0].trim();

  // Parse log lines
  const logLines = String(gitLogData || '').split('\n').filter(l => l.trim());

  // Smart recommendation logic
  const getRecommendation = () => {
    if (hasChanges) {
      const modifiedCount = actualChanges.filter(l => l.trim().startsWith('M')).length;
      const addedCount = actualChanges.filter(l => l.trim().startsWith('A') || l.trim().startsWith('?')).length;
      const deletedCount = actualChanges.filter(l => l.trim().startsWith('D')).length;

      const parts = [];
      if (modifiedCount > 0) parts.push(`${modifiedCount} modified`);
      if (addedCount > 0) parts.push(`${addedCount} new`);
      if (deletedCount > 0) parts.push(`${deletedCount} deleted`);
      const summary = parts.join(', ');

      return {
        type: 'commit',
        color: '#FFFFFF',
        title: 'READY TO COMMIT',
        detail: `${actualChanges.length} file${actualChanges.length > 1 ? 's' : ''} changed — ${summary}`,
        action: 'branch',
        actionLabel: '⎇ SWITCH BRANCH',
      };
    }
    // After commit, if branch is ahead, suggest push
    if (logLines.length > 0 && !hasChanges && isAhead) {
      return {
        type: 'push',
        color: '#818cf8',
        title: 'CLEAN WORKING TREE',
        detail: 'All changes committed — you can push to remote',
        action: 'push',
        actionLabel: 'PUSH TO REMOTE',
      };
    }
    return null;
  };

  const recommendation = getRecommendation();

  /* Zone separation: vertical hairlines in row mode, horizontal in split */
  const zoneDivider = isSplit
    ? { borderTop: '1px solid var(--line-faint)', paddingTop: '18px' }
    : { borderLeft: '1px solid var(--line-faint)', paddingLeft: '24px' };

  return (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    }}>

      {/* ── Command Bar: status chip · change tokens · action ── */}
      {recommendation && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '16px',
          padding: '12px 22px',
          background: 'var(--s1)',
          borderBottom: '1px solid var(--line)',
          flexShrink: 0, animation: 'scale-in 0.25s ease',
        }}>
          {/* Status chip */}
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: '9px',
            padding: '6px 13px', borderRadius: '2px', flexShrink: 0,
            border: '1px solid var(--line-strong)', background: 'rgba(255,255,255,0.02)',
          }}>
            <span style={{
              width: '6px', height: '6px', borderRadius: '50%', background: recommendation.color,
              boxShadow: `0 0 7px ${recommendation.color}55`,
              animation: 'pulse-live 1.4s ease infinite',
            }} />
            <span style={{
              fontFamily: HEADER, fontSize: '0.64rem', color: recommendation.color,
              fontWeight: 800, letterSpacing: '0.09em', whiteSpace: 'nowrap',
            }}>
              {recommendation.title}
            </span>
          </span>

          {/* Change + branch tokens */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
            <span style={{ fontFamily: MONO, fontSize: '0.62rem', color: 'var(--t3)', letterSpacing: '0.02em' }}>
              {recommendation.detail}
            </span>
            {currentBranch && (
              <>
                <span style={{ width: '1px', height: '12px', background: 'var(--line-strong)' }} />
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: '6px',
                  fontFamily: MONO, fontSize: '0.62rem', color: 'var(--t2)', whiteSpace: 'nowrap',
                }}>
                  <span style={{ color: 'var(--t4)' }}>⎇</span>{currentBranch}
                </span>
              </>
            )}
          </div>

          {recommendation.action === 'push' && (
            <TextButton onClick={handleUndoCommit} disabled={gitLoading}>
              ↶ UNDO COMMIT
            </TextButton>
          )}
          <PrimaryButton
            onClick={() => {
              if (recommendation.action === 'branch') {
                openBranchSwitcher();
              } else {
                handleCommand(recommendation.action);
              }
            }}
            disabled={gitLoading}
            style={{ padding: '8px 20px', fontSize: '0.56rem' }}
          >
            {recommendation.actionLabel} →
          </PrimaryButton>
        </div>
      )}

      {/* ── Branch Switcher (slides down from the banner) ── */}
      {showBranchInput && (
        <div style={{
          padding: '13px 22px', background: 'rgba(255,255,255,0.015)',
          borderBottom: '1px solid var(--line-faint)',
          flexShrink: 0, animation: 'scale-in 0.2s ease',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <span style={{
              fontFamily: MONO, fontSize: '0.54rem', fontWeight: 700,
              letterSpacing: '0.2em', color: 'var(--t4)', flexShrink: 0,
            }}>
              BRANCH
            </span>
            <div style={{
              flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '12px',
              borderBottom: '1px solid var(--line-strong)', paddingBottom: '7px',
              transition: 'border-color 0.2s ease',
            }}>
              <span style={{ color: 'var(--t4)', fontFamily: MONO, fontSize: '0.72rem', flexShrink: 0 }}>⎇</span>
              <input
                type="text"
                value={branchInput}
                onChange={e => setBranchInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleCheckout();
                  if (e.key === 'Escape') { setShowBranchInput(false); setBranchInput(''); }
                }}
                onFocus={focusLine}
                onBlur={blurLine}
                placeholder="branch name — switch to it, or create it"
                autoFocus
                spellCheck={false}
                style={{
                  flex: 1, minWidth: 0, background: 'transparent', border: 'none',
                  outline: 'none', color: 'var(--t1)', fontSize: '0.82rem',
                  fontFamily: MONO, fontWeight: 500,
                }}
              />
            </div>
            <PrimaryButton
              onClick={() => handleCheckout()}
              disabled={gitLoading || !branchInput.trim()}
              style={{ padding: '8px 22px', fontSize: '0.58rem' }}
            >
              {gitLoading ? 'SWITCHING…' : 'SWITCH'}
            </PrimaryButton>
            <TextButton onClick={() => handleCheckout(null, true)} disabled={gitLoading || !branchInput.trim()}>
              + CREATE
            </TextButton>
            <TextButton onClick={() => { setShowBranchInput(false); setBranchInput(''); }}>
              ✕
            </TextButton>
          </div>

          {/* Existing branches — click to switch */}
          {branches.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '12px', paddingLeft: '64px' }}>
              {branches.map(b => (
                <button
                  key={b.name}
                  onClick={() => !b.current && handleCheckout(b.name)}
                  disabled={gitLoading || b.current}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: '7px',
                    padding: '4px 12px', borderRadius: '999px',
                    background: b.current ? 'rgba(255,255,255,0.08)' : 'transparent',
                    border: '1px solid var(--line)',
                    color: b.current ? '#fff' : 'var(--t3)',
                    cursor: b.current ? 'default' : 'pointer',
                    fontFamily: MONO, fontSize: '0.56rem', fontWeight: 700, letterSpacing: '0.08em',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={e => { if (!b.current && !gitLoading) { e.currentTarget.style.borderColor = '#fff'; e.currentTarget.style.color = '#fff'; } }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--line)'; e.currentTarget.style.color = b.current ? '#fff' : 'var(--t3)'; }}
                >
                  {b.current && <StatusDot color="var(--emerald)" />}
                  {b.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Inline Commit Input (slides down when committing) ── */}
      {showCommitInput && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '14px',
          padding: '13px 22px', background: 'rgba(255,255,255,0.015)',
          borderBottom: '1px solid var(--line-faint)',
          flexShrink: 0, animation: 'scale-in 0.2s ease',
        }}>
          <span style={{
            fontFamily: MONO, fontSize: '0.54rem', fontWeight: 700,
            letterSpacing: '0.2em', color: 'var(--t4)', flexShrink: 0,
          }}>
            COMMIT
          </span>
          <div style={{
            flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '12px',
            borderBottom: '1px solid var(--line-strong)', paddingBottom: '7px',
            transition: 'border-color 0.2s ease',
          }}>
            <span style={{ color: 'var(--t4)', fontFamily: MONO, fontSize: '0.72rem', flexShrink: 0 }}>❯</span>
            <input
              type="text"
              value={inlineCommitMsg}
              onChange={e => setInlineCommitMsg(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleInlineCommit(); if (e.key === 'Escape') { setShowCommitInput(false); setInlineCommitMsg(''); } }}
              onFocus={focusLine}
              onBlur={blurLine}
              placeholder="fix: resolve null pointer exception"
              autoFocus
              spellCheck={false}
              style={{
                flex: 1, minWidth: 0, background: 'transparent', border: 'none',
                outline: 'none', color: 'var(--t1)', fontSize: '0.82rem',
                fontFamily: MONO, fontWeight: 500,
              }}
            />
          </div>
          <PrimaryButton
            onClick={handleInlineCommit}
            disabled={gitLoading || !inlineCommitMsg.trim()}
            style={{ padding: '8px 22px', fontSize: '0.58rem' }}
          >
            {gitLoading ? 'COMMITTING…' : 'COMMIT'}
          </PrimaryButton>
          <TextButton onClick={() => { setShowCommitInput(false); setInlineCommitMsg(''); }}>
            ✕
          </TextButton>
        </div>
      )}

      {/* ── Main Dashboard ── */}
      <div className="no-scrollbar" style={{
        flex: 1, display: 'flex', flexDirection: isSplit ? 'column' : 'row',
        padding: '18px 22px', gap: isSplit ? '18px' : 0,
        overflow: isSplit ? 'auto' : 'hidden',
      }}>

        {/* ZONE 01: Repository */}
        <div className="no-scrollbar" style={{
          flex: isSplit ? '0 0 auto' : '0 1 300px',
          minWidth: isSplit ? undefined : '230px',
          display: 'flex', flexDirection: 'column',
          paddingRight: isSplit ? 0 : '24px',
          overflow: isSplit ? 'visible' : 'auto',
        }}>
          <ZoneLabel index="01" right={
            <TextButton onClick={handleDisconnect} danger style={{ fontSize: '0.52rem' }}>
              DISCONNECT
            </TextButton>
          }>
            Repository
          </ZoneLabel>

          {/* Connection identity card */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '12px',
            marginBottom: '22px', flexShrink: 0,
            padding: '11px 13px', borderRadius: '2px',
            border: '1px solid var(--line)', background: 'rgba(255,255,255,0.015)',
          }}>
            <span style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: '30px', height: '30px', borderRadius: '2px', flexShrink: 0,
              border: '1px solid var(--line-strong)', background: 'var(--s2)', color: 'var(--emerald)',
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="6" cy="6" r="2.5" /><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="8" r="2.5" />
                <path d="M6 8.5v7" /><path d="M18 10.5c0 3.5-4 3.5-6 3.5" />
              </svg>
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{
                  width: '6px', height: '6px', borderRadius: '50%', flexShrink: 0,
                  background: 'var(--emerald)', boxShadow: '0 0 6px rgba(70,227,183,0.5)',
                }} />
                <span style={{ fontFamily: MONO, fontSize: '0.6rem', color: 'var(--t1)', fontWeight: 800, letterSpacing: '0.16em' }}>
                  CONNECTED
                </span>
              </div>
              <div style={{
                fontFamily: MONO, fontSize: '0.56rem', color: 'var(--t4)',
                wordBreak: 'break-all', lineHeight: 1.5, marginTop: '4px',
              }}>
                {gitRepoUrl || 'Repository URL hidden'}
              </div>
            </div>
          </div>

          {/* Working tree — headline stat + change list.
              minHeight keeps the numeral from being crushed under the
              action buttons when the panel is short — the zone scrolls
              instead of collapsing. */}
          <div style={{ flex: 1, minHeight: '104px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '13px', marginBottom: '14px', flexShrink: 0 }}>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{
                  fontFamily: HEADER, fontSize: '2.1rem', fontWeight: 800,
                  color: hasChanges ? '#FFFFFF' : 'var(--t4)', lineHeight: 1, letterSpacing: '-0.02em',
                }}>
                  {String(actualChanges.length).padStart(2, '0')}
                </span>
                <span style={{
                  width: '26px', height: '2px', marginTop: '9px', borderRadius: '2px',
                  background: hasChanges ? '#FFFFFF' : 'var(--line-strong)',
                }} />
              </div>
              <span style={{ fontFamily: BODY, fontSize: '0.66rem', color: 'var(--t3)', paddingBottom: '3px' }}>
                {hasChanges
                  ? `file${actualChanges.length > 1 ? 's' : ''} changed`
                  : 'clean working tree'}
              </span>
            </div>
            <div className="no-scrollbar" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
              {actualChanges.slice(0, 8).map((line, i) => {
                const status = line.substring(0, 2).trim();
                // git quotes paths containing spaces ("Ayush Portfolio/") — unwrap.
                const file = line.substring(3).trim().replace(/^"|"$/g, '');
                return (
                  <div key={i}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '11px',
                      padding: '6px 8px', margin: '0 -8px', borderRadius: '2px',
                      transition: 'background 0.15s ease',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.025)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <FileBadge code={status} />
                    <span style={{
                      fontFamily: MONO, fontSize: '0.7rem', color: 'var(--t2)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {file}
                    </span>
                  </div>
                );
              })}
              {statusLines.length > 8 && (
                <div style={{ fontFamily: MONO, fontSize: '0.58rem', color: 'var(--t4)', marginTop: '6px' }}>
                  +{statusLines.length - 8} more files
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div style={{ marginTop: '18px', flexShrink: 0 }}>
            <PrimaryButton
              onClick={() => { setShowCommitInput(true); setShowBranchInput(false); }}
              disabled={gitLoading}
              style={{
                width: '100%', padding: '10px 12px', fontSize: '0.6rem',
                background: hasChanges ? '#FFFFFF' : 'transparent',
                color: hasChanges ? '#000' : 'var(--t2)',
                border: hasChanges ? 'none' : '1px solid var(--line-strong)',
              }}
            >
              COMMIT CHANGES
            </PrimaryButton>
            <div style={{
              display: 'flex', marginTop: '12px',
              border: '1px solid var(--line)', borderRadius: '2px', overflow: 'hidden',
            }}>
              <GhostAction icon="↑" label="PUSH" onClick={() => handleCommand('push')} disabled={gitLoading} />
              <span style={{ width: '1px', background: 'var(--line)', flexShrink: 0 }} />
              <GhostAction icon="↓" label="PULL" onClick={() => handleCommand('pull')} disabled={gitLoading} />
              <span style={{ width: '1px', background: 'var(--line)', flexShrink: 0 }} />
              <GhostAction icon="⟳" label="SYNC" onClick={() => { refreshStatus(); refreshLog(); setCommandOutput(null); }} disabled={gitLoading} />
            </div>

            {/* Action feedback */}
            {gitLoading && (
              <div style={{
                fontFamily: MONO, fontSize: '0.54rem', color: 'var(--t3)',
                letterSpacing: '0.16em', marginTop: '10px',
                animation: 'pulse-live 1s ease infinite',
              }}>
                ⠿ RUNNING
              </div>
            )}
            {!gitLoading && pullConflict && (
              <div style={{ marginTop: '12px', borderLeft: '2px solid var(--crimson)', paddingLeft: '12px' }}>
                <div style={{ fontFamily: MONO, fontSize: '0.58rem', fontWeight: 800, letterSpacing: '0.14em', color: 'var(--crimson)' }}>
                  PULL BLOCKED — MERGE CONFLICT
                </div>
                <div style={{ fontFamily: BODY, fontSize: '0.66rem', color: 'var(--t3)', marginTop: '5px', lineHeight: 1.55 }}>
                  Remote changes collide with yours{pullConflict.files.length > 0 ? ' in:' : '.'}
                </div>
                {pullConflict.files.map((f) => (
                  <div key={f} style={{ fontFamily: MONO, fontSize: '0.62rem', color: 'var(--t2)', marginTop: '3px', wordBreak: 'break-all' }}>
                    · {f}
                  </div>
                ))}
                <div style={{ fontFamily: BODY, fontSize: '0.66rem', color: 'var(--t3)', marginTop: '7px', lineHeight: 1.55 }}>
                  Nothing was changed. Resolve on GitHub (open a PR → “Resolve conflicts”)
                  or in the terminal:
                </div>
                <pre className="no-scrollbar" style={{
                  margin: '7px 0 0', padding: '9px 11px',
                  background: 'var(--s0)', border: '1px solid var(--line-faint)',
                  borderRadius: '7px', overflow: 'auto',
                  fontFamily: MONO, fontSize: '0.6rem', color: 'var(--t2)', lineHeight: 1.8,
                }}>
{`git pull --no-rebase
# open each listed file and fix the <<<<<<< / ======= / >>>>>>> sections
git add .
git commit -m "merge: resolve conflicts"
git push`}
                </pre>
                <div style={{ marginTop: '6px' }}>
                  <TextButton onClick={() => setPullConflict(null)}>DISMISS</TextButton>
                </div>
              </div>
            )}
            {!gitLoading && !pullConflict && gitError && (
              <ErrorLine style={{ marginTop: '10px' }}>{gitError}</ErrorLine>
            )}
            {!gitLoading && !gitError && commandOutput && (
              <div style={{ marginTop: '10px' }}>
                <div style={{ fontFamily: MONO, fontSize: '0.52rem', color: 'var(--t4)', letterSpacing: '0.16em', marginBottom: '4px' }}>
                  → GIT {commandOutput.command.toUpperCase()}
                </div>
                <pre className="no-scrollbar" style={{
                  margin: 0, fontFamily: MONO, fontSize: '0.6rem', color: 'var(--t3)',
                  lineHeight: 1.6, whiteSpace: 'pre-wrap', maxHeight: '72px', overflow: 'auto',
                }}>
                  {commandOutput.output}
                </pre>
              </div>
            )}
          </div>
        </div>

        {/* ZONE 02: Guardian — pull request readiness */}
        <div className="no-scrollbar" style={{
          flex: 1, minWidth: 0, minHeight: isSplit ? '180px' : 0,
          display: 'flex', flexDirection: 'column',
          paddingRight: isSplit ? 0 : '24px',
          overflowY: 'auto', ...zoneDivider,
        }}>
          <GuardianPrZone />
        </div>

        {/* ZONE 03: History — commit timeline */}
        <div style={{
          flex: isSplit ? '0 0 auto' : '0 1 290px',
          minWidth: isSplit ? undefined : '210px',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden', ...zoneDivider,
        }}>
          <ZoneLabel index="03" right={
            <TextButton
              onClick={() => { refreshStatus(); refreshLog(); setCommandOutput(null); }}
              style={{ fontSize: '0.66rem', letterSpacing: 0 }}
            >
              ⟳
            </TextButton>
          }>
            History
          </ZoneLabel>
          <div className="no-scrollbar" style={{
            flex: 1, minHeight: 0, overflowY: 'auto',
            maxHeight: isSplit ? '220px' : 'none',
          }}>
            {logLines.length > 0 ? (
              logLines.map((line, i) => {
                const msg = line.substring(8);
                const isLast = i === logLines.length - 1;
                const isHead = i === 0;
                return (
                  <div key={i} style={{ display: 'flex', gap: '14px' }}>
                    {/* Mario level path — Mario at HEAD, checkpoint flags below, planted in brick */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '30px', flexShrink: 0 }}>
                      {isHead
                        ? <PixelSprite rows={MARIO_ROWS} palette={MARIO_PAL} px={1.5} style={{ animation: 'mario-bob 1.5s ease-in-out infinite' }} />
                        : <CheckpointFlag />}
                      {!isLast
                        ? <span style={{
                            width: '3px', flex: 1, minHeight: '16px', margin: '3px 0',
                            background: 'linear-gradient(90deg, #6f757b, #cdd2d7 45%, #6f757b)',
                          }} />
                        : <GroundBase />}
                    </div>
                    <div style={{ paddingBottom: isLast ? 0 : '16px', minWidth: 0, flex: 1 }}>
                      {isHead && (
                        <div style={{ marginBottom: '5px' }}>
                          <span style={{
                            fontFamily: MONO, fontSize: '0.46rem', color: '#FBD000',
                            letterSpacing: '0.14em', fontWeight: 800,
                            padding: '1px 6px', borderRadius: '2px',
                            border: '1px solid rgba(251,208,0,0.4)',
                          }}>
                            ★ HEAD
                          </span>
                        </div>
                      )}
                      <div style={{
                        fontFamily: BODY, fontSize: '0.72rem', fontWeight: 500,
                        color: isHead ? 'var(--t1)' : 'var(--t2)', lineHeight: 1.5,
                        overflow: 'hidden', textOverflow: 'ellipsis',
                        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                      }}>
                        {msg}
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <div style={{ fontFamily: BODY, fontSize: '0.7rem', color: 'var(--t4)', padding: '8px 0' }}>
                No commit history available
              </div>
            )}
          </div>
        </div>

      </div>{/* end main dashboard flex */}

      <style>{`
        @keyframes pulse-live {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        @keyframes scale-in {
          0% { transform: translateY(-4px); opacity: 0; }
          100% { transform: translateY(0); opacity: 1; }
        }
        @keyframes mario-bob {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-2px); }
        }
      `}</style>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════
 * Wrapper — single unified panel: git actions (zone 01),
 * Guardian PR readiness (zone 02), history (zone 03).
 * ═══════════════════════════════════════════════════════ */

const GitAssistantPanel = () => (
  <div style={{ height: '100%', overflow: 'hidden', background: 'var(--s0)' }}>
    <GitAssistantCore />
  </div>
);

export default GitAssistantPanel;
