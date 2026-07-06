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

const TYPE_META = {
  fix:      { fg: '#E5484D', label: 'BUG FIX' },
  feat:     { fg: '#FFFFFF', label: 'FEATURE' },
  style:    { fg: '#818cf8', label: 'UI STYLE' },
  refactor: { fg: '#FFB224', label: 'REFACTOR' },
  default:  { fg: '#FFFFFF', label: 'CHANGE' },
};

/* ═══════════════════════════════════════════════════════
 * GIT module
 * ═══════════════════════════════════════════════════════ */

const parseCommitText = (text) => {
  const result = {
    branch: '',
    hash: '',
    message: '',
    filesChanged: 0,
    insertions: 0,
    deletions: 0
  };
  
  if (!text) return result;
  
  // Try to parse first line: [branch hash] message
  const firstLineMatch = text.match(/^\[(.*?)\s+([a-f0-9]{7,40})\]\s+(.*)/);
  if (firstLineMatch) {
    result.branch = firstLineMatch[1].trim();
    result.hash = firstLineMatch[2].trim();
    result.message = firstLineMatch[3].trim();
  } else {
    // Fallback: search for hash
    const hashMatch = text.match(/\[(?:.*\s+)?([a-f0-9]{7,40})\]/);
    if (hashMatch) result.hash = hashMatch[1];
  }

  // Parse stats: X files changed, Y insertions(+), Z deletions(-)
  const statsMatch = text.match(/(\d+)\s+file[s]?\s+changed(?:,\s+(\d+)\s+insertion[s]?\(\+\))?(?:,\s+(\d+)\s+deletion[s]?\(-\))?/);
  if (statsMatch) {
    result.filesChanged = parseInt(statsMatch[1], 10) || 0;
    result.insertions = parseInt(statsMatch[2], 10) || 0;
    result.deletions = parseInt(statsMatch[3], 10) || 0;
  }

  return result;
};

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
  const [commitMessage, setCommitMessage] = useState('');
  const [isCommitting, setIsCommitting] = useState(false);
  const [commitResult, setCommitResult] = useState(null);
  const [commandOutput, setCommandOutput] = useState(null);
  const [pullConflict, setPullConflict] = useState(null); // { files: [...] }
  const [showCommitInput, setShowCommitInput] = useState(false);
  const [inlineCommitMsg, setInlineCommitMsg] = useState('');
  const [showBranchInput, setShowBranchInput] = useState(false);
  const [branchInput, setBranchInput] = useState('');
  const [branches, setBranches] = useState([]);

  // Sync commit message from suggestion
  useEffect(() => {
    if (suggestion && suggestion.message) {
      setCommitMessage(suggestion.message);
      setCommitResult(null);
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

  if (suggestion) {
    const meta = TYPE_META[suggestion.type] || TYPE_META.default;

    const handleCommit = async () => {
      if (!commitMessage.trim()) return;
      setIsCommitting(true);
      try {
        const res = await executeGitCommit({
          sessionId,
          message: commitMessage,
          files: Object.entries(files).map(([path, content]) => ({ path, content }))
        });
        if (res.success !== false) {
          setCommitResult({ success: true, text: res.output || res.message || 'Committed' });
          refreshStatus();
          refreshLog();
        } else {
          // If git says nothing to commit, treat as success so user can proceed to push or dismiss
          if (res.error && res.error.toLowerCase().includes("nothing to commit")) {
            setCommitResult({ success: true, text: 'Clean tree: nothing to commit.' });
            refreshStatus();
            refreshLog();
          } else {
            setCommitResult({ success: false, text: res.error || 'Commit failed' });
          }
        }
      } catch (err) {
        setCommitResult({ success: false, text: err.response?.data?.error || err.message });
      } finally {
        setIsCommitting(false);
      }
    };

    const handlePushAfterCommit = async () => {
      setGitLoading(true);
      try {
        const res = await gitPush(sessionId);
        if (res.success) {
          setCommitResult({ success: true, text: '✓ Pushed to remote' });
          setTimeout(() => setCommitSuggestion(null), 2500);
        } else {
          setCommitResult({ success: false, text: res.error || 'Push failed' });
        }
      } catch (err) {
        setCommitResult({ success: false, text: err.response?.data?.error || err.message });
      } finally {
        setGitLoading(false);
      }
    };

    // Post-commit success state
    if (commitResult && commitResult.success) {
      const parsed = parseCommitText(commitResult.text);
      const isSplit = terminalLayoutMode === 'split';

      const displayMessage = parsed.message || commitResult.text || 'Changes committed successfully';
      const displayHash = parsed.hash || '';
      const displayBranch = parsed.branch || '';

      return (
        <div className="no-scrollbar" style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--s0)',
          overflowY: 'auto',
          boxSizing: 'border-box',
          position: 'relative'
        }}>
          {/* Ambient background glow */}
          <div style={{
            position: 'absolute',
            top: 0,
            left: '10%',
            width: '80%',
            height: '140px',
            background: 'radial-gradient(120px circle at 50% 0px, rgba(61,214,140,0.06), transparent 80%)',
            pointerEvents: 'none',
            zIndex: 0
          }} />

          {/* Main Content Area */}
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: isSplit ? 'column' : 'row',
            padding: '24px 28px',
            gap: isSplit ? '16px' : '32px',
            zIndex: 1,
            minHeight: 0
          }}>
            {/* Left Column: Summary & Stats */}
            <div style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              minWidth: 0
            }}>
              {/* Branch & Hash Badges */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px', flexWrap: 'wrap' }}>
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '3px 10px',
                  borderRadius: '999px',
                  background: 'rgba(61,214,140,0.08)',
                  border: '1px solid rgba(61,214,140,0.15)',
                  color: 'var(--emerald)',
                  fontFamily: MONO,
                  fontSize: '0.62rem',
                  fontWeight: 700,
                  letterSpacing: '0.04em'
                }}>
                  <span style={{ display: 'inline-block', width: '5px', height: '5px', borderRadius: '50%', background: 'var(--emerald)' }} />
                  COMMIT SECURED
                </span>
                {displayBranch && (
                  <span style={{
                    fontFamily: MONO,
                    fontSize: '0.62rem',
                    color: 'var(--t2)',
                    background: 'var(--s2)',
                    padding: '3px 10px',
                    borderRadius: '6px',
                    border: '1px solid var(--line)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}>
                    ⎇ {displayBranch}
                  </span>
                )}
                {displayHash && (
                  <span style={{
                    fontFamily: MONO,
                    fontSize: '0.62rem',
                    color: 'var(--t3)',
                    letterSpacing: '0.05em'
                  }}>
                    #{displayHash}
                  </span>
                )}
              </div>

              {/* Commit Message Heading */}
              <h2 style={{
                fontFamily: HEADER,
                color: 'var(--t1)',
                fontSize: '1.15rem',
                fontWeight: 800,
                lineHeight: 1.35,
                letterSpacing: '-0.01em',
                margin: '0 0 24px 0',
                wordBreak: 'break-word',
                display: '-webkit-box',
                WebkitLineClamp: 3,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden'
              }}>
                {displayMessage}
              </h2>

              {/* Statistics Grid */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '12px',
                marginBottom: '16px'
              }}>
                {/* Stat Item 1 */}
                <div style={{
                  background: 'rgba(255, 255, 255, 0.01)',
                  border: '1px solid var(--line-faint)',
                  borderRadius: '8px',
                  padding: '12px 16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px'
                }}>
                  <span style={{ fontFamily: MONO, fontSize: '0.52rem', color: 'var(--t4)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                    Files Changed
                  </span>
                  <span style={{ fontFamily: HEADER, fontSize: '1.2rem', fontWeight: 700, color: 'var(--t1)' }}>
                    {parsed.filesChanged || '0'}
                  </span>
                </div>

                {/* Stat Item 2 */}
                <div style={{
                  background: 'rgba(255, 255, 255, 0.01)',
                  border: '1px solid var(--line-faint)',
                  borderRadius: '8px',
                  padding: '12px 16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px'
                }}>
                  <span style={{ fontFamily: MONO, fontSize: '0.52rem', color: 'var(--t4)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                    Insertions
                  </span>
                  <span style={{ fontFamily: HEADER, fontSize: '1.2rem', fontWeight: 700, color: 'var(--emerald)' }}>
                    +{parsed.insertions ? parsed.insertions.toLocaleString() : '0'}
                  </span>
                </div>

                {/* Stat Item 3 */}
                <div style={{
                  background: 'rgba(255, 255, 255, 0.01)',
                  border: '1px solid var(--line-faint)',
                  borderRadius: '8px',
                  padding: '12px 16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px'
                }}>
                  <span style={{ fontFamily: MONO, fontSize: '0.52rem', color: 'var(--t4)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                    Deletions
                  </span>
                  <span style={{ fontFamily: HEADER, fontSize: '1.2rem', fontWeight: 700, color: 'var(--crimson)' }}>
                    -{parsed.deletions ? parsed.deletions.toLocaleString() : '0'}
                  </span>
                </div>
              </div>

              {/* Action buttons embedded here in split mode */}
              {isSplit && (
                <div style={{ display: 'flex', gap: '14px', alignItems: 'center', marginTop: '16px' }}>
                  <PrimaryButton onClick={handlePushAfterCommit} disabled={gitLoading} style={{ flex: 1, padding: '12px 20px' }}>
                    {gitLoading ? 'PUSHING…' : '↑ PUSH TO REMOTE'}
                  </PrimaryButton>
                  <TextButton onClick={() => setCommitSuggestion(null)} style={{ padding: '12px' }}>
                    DISMISS
                  </TextButton>
                </div>
              )}
            </div>

            {/* Right Column: Files & Raw Terminal Outputs (Only in non-split layout) */}
            {!isSplit && (
              <div style={{
                flex: '0 0 380px',
                display: 'flex',
                flexDirection: 'column',
                borderLeft: '1px solid var(--line-faint)',
                paddingLeft: '32px',
                minHeight: 0
              }}>
                <div style={{
                  fontFamily: MONO,
                  fontSize: '0.58rem',
                  fontWeight: 700,
                  letterSpacing: '0.24em',
                  textTransform: 'uppercase',
                  color: 'var(--t3)',
                  marginBottom: '14px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}>
                  <span>COMMIT READOUT</span>
                  <span style={{ fontSize: '0.52rem', color: 'var(--t4)' }}>
                    RAW OUTPUT
                  </span>
                </div>

                {/* Scrollable console block for git output */}
                <div className="no-scrollbar" style={{
                  flex: 1,
                  overflowY: 'auto',
                  background: 'rgba(255, 255, 255, 0.01)',
                  border: '1px solid var(--line-faint)',
                  borderRadius: '8px',
                  padding: '14px 18px',
                  minHeight: '120px'
                }}>
                  <pre style={{
                    margin: 0,
                    fontFamily: MONO,
                    color: 'var(--t2)',
                    fontSize: '0.64rem',
                    lineHeight: 1.65,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all'
                  }}>
                    {commitResult.text}
                  </pre>
                </div>
              </div>
            )}
          </div>

          {/* Bottom Action Dock (Only in non-split layout) */}
          {!isSplit && (
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '16px 28px',
              borderTop: '1px solid var(--line-faint)',
              background: 'rgba(17, 17, 17, 0.3)',
              zIndex: 1,
              flexShrink: 0
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: 'var(--emerald)' }} />
                <span style={{ fontFamily: BODY, fontSize: '0.68rem', color: 'var(--t3)' }}>
                  Working tree clean. Ready to sync with remote server.
                </span>
              </div>
              <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
                <TextButton onClick={() => setCommitSuggestion(null)}>
                  DISMISS
                </TextButton>
                <PrimaryButton onClick={handlePushAfterCommit} disabled={gitLoading} style={{ padding: '11px 32px' }}>
                  {gitLoading ? 'PUSHING…' : '↑ PUSH TO REMOTE'}
                </PrimaryButton>
              </div>
            </div>
          )}
          <style>{`
            @keyframes scale-in { 0% { transform: scale(0.95); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
          `}</style>
        </div>
      );
    }

    const isSplit = terminalLayoutMode === 'split';
    const confidencePct = suggestion.confidence === 'HIGH' ? '90%' : suggestion.confidence === 'MEDIUM' ? '60%' : '30%';
    const stagedCount = suggestion.modifiedFiles?.length || 0;

    return (
      <div style={{
        height: '100%', display: 'flex', flexDirection: 'column',
        padding: '16px 22px', gap: '16px', overflow: 'hidden',
      }}>

        {/* ── Analysis strip: classification · confidence · link ── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '22px',
          paddingBottom: '14px', borderBottom: '1px solid var(--line-faint)',
          flexShrink: 0, flexWrap: 'wrap',
        }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '10px' }}>
            <StatusDot color={meta.fg} pulse />
            <span style={{
              fontFamily: HEADER, fontSize: '0.78rem', fontWeight: 800,
              letterSpacing: '0.08em', color: meta.fg,
            }}>
              {meta.label}
            </span>
          </span>

          <span style={{ width: '1px', height: '16px', background: 'var(--line-faint)' }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontFamily: MONO, fontSize: '0.54rem', fontWeight: 700, letterSpacing: '0.2em', color: 'var(--t4)' }}>
              CONFIDENCE
            </span>
            <div style={{ width: '70px', height: '3px', background: 'var(--s3)', borderRadius: '2px', overflow: 'hidden' }}>
              <div style={{ width: confidencePct, height: '100%', background: meta.fg, borderRadius: '2px' }} />
            </div>
            <span style={{ fontFamily: MONO, fontSize: '0.58rem', color: meta.fg, fontWeight: 800, letterSpacing: '0.1em' }}>
              {suggestion.confidence}
            </span>
          </div>

          <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
            <StatusDot color="var(--emerald)" />
            <span style={{ fontFamily: MONO, fontSize: '0.54rem', color: 'var(--t3)', letterSpacing: '0.16em', fontWeight: 700 }}>
              REPO LINKED
            </span>
          </span>
        </div>

        {/* ── Body: composer + staged files ── */}
        <div style={{
          flex: 1, minHeight: 0, display: 'flex',
          flexDirection: isSplit ? 'column' : 'row',
          gap: isSplit ? '18px' : 0,
        }}>

          {/* Commit composer */}
          <div style={{
            flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column',
            paddingRight: isSplit ? 0 : '26px',
          }}>
            <ZoneLabel index="01">Commit Message</ZoneLabel>
            <div style={{ fontFamily: MONO, fontSize: '0.64rem', color: 'var(--t4)', marginBottom: '12px', userSelect: 'none' }}>
              $ git commit -m "
            </div>
            <textarea
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              spellCheck={false}
              onFocus={e => { e.currentTarget.style.borderLeftColor = 'rgba(255,255,255,0.45)'; }}
              onBlur={e => { e.currentTarget.style.borderLeftColor = 'var(--line-strong)'; }}
              style={{
                flex: 1, minHeight: '64px', background: 'transparent',
                border: 'none', outline: 'none', resize: 'none',
                color: 'var(--t1)', fontSize: '0.94rem', fontFamily: MONO,
                fontWeight: 500, lineHeight: 1.65,
                paddingLeft: '16px', borderLeft: '2px solid var(--line-strong)',
                transition: 'border-color 0.2s ease',
              }}
            />
            <div style={{ fontFamily: MONO, fontSize: '0.64rem', color: 'var(--t4)', marginTop: '12px', userSelect: 'none' }}>
              "
            </div>

            {commitResult && !commitResult.success && (
              <ErrorLine style={{ marginTop: '14px' }}>
                {commitResult.text}
              </ErrorLine>
            )}
          </div>

          {/* Staged files */}
          <div className="no-scrollbar" style={{
            flex: isSplit ? '0 0 auto' : '0 0 270px',
            maxHeight: isSplit ? '190px' : 'none',
            minHeight: 0, display: 'flex', flexDirection: 'column',
            borderLeft: isSplit ? 'none' : '1px solid var(--line-faint)',
            borderTop: isSplit ? '1px solid var(--line-faint)' : 'none',
            paddingLeft: isSplit ? 0 : '26px',
            paddingTop: isSplit ? '16px' : 0,
            overflow: 'hidden',
          }}>
            <ZoneLabel index="02" right={
              <span style={{ fontFamily: MONO, fontSize: '0.56rem', color: 'var(--t4)' }}>{stagedCount}</span>
            }>
              Staged Files
            </ZoneLabel>
            <div className="no-scrollbar" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
              {suggestion.modifiedFiles?.map((file) => (
                <div key={file} style={{
                  display: 'flex', alignItems: 'center', gap: '12px', padding: '7px 0',
                }}>
                  <span style={{ fontFamily: MONO, fontSize: '0.62rem', color: 'var(--emerald)', fontWeight: 700, flexShrink: 0 }}>+</span>
                  <span style={{
                    color: 'var(--t2)', fontSize: '0.76rem', fontFamily: MONO,
                    fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {file}
                  </span>
                </div>
              ))}
              {suggestion.affectedFiles?.length > 0 && (
                <div style={{ marginTop: '20px' }}>
                  <ZoneLabel>Impact Predictions</ZoneLabel>
                  {suggestion.affectedFiles.map(file => (
                    <div key={file} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '5px 0' }}>
                      <span style={{ fontFamily: MONO, fontSize: '0.62rem', color: 'var(--crimson)', flexShrink: 0 }}>!</span>
                      <span style={{
                        color: 'var(--crimson)', fontSize: '0.74rem', fontFamily: MONO,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {file}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Footer actions ── */}
        <div style={{
          display: 'flex', justifyContent: 'flex-end', alignItems: 'center',
          gap: '22px', paddingTop: '14px', borderTop: '1px solid var(--line-faint)',
          flexShrink: 0,
        }}>
          <TextButton onClick={() => setCommitSuggestion(null)}>
            DISCARD
          </TextButton>
          <PrimaryButton
            onClick={handleCommit}
            disabled={isCommitting || !commitMessage.trim()}
            style={{ padding: '11px 36px' }}
          >
            {isCommitting ? 'EXECUTING…' : 'CONFIRM COMMIT'}
          </PrimaryButton>
        </div>

        <style>{`
          @keyframes scale-in { 0% { transform: scale(0.95); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
        `}</style>
      </div>
    );
  }

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

  const statusGlyphColor = (status) =>
    status.includes('M') ? 'var(--amber)'
      : status.includes('A') ? 'var(--emerald)'
        : status.includes('D') ? 'var(--crimson)'
          : '#818cf8';

  /* Zone separation: vertical hairlines in row mode, horizontal in split */
  const zoneDivider = isSplit
    ? { borderTop: '1px solid var(--line-faint)', paddingTop: '18px' }
    : { borderLeft: '1px solid var(--line-faint)', paddingLeft: '24px' };

  return (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    }}>

      {/* ── Smart Recommendation Strip ── */}
      {recommendation && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '18px',
          padding: '13px 22px',
          background: 'linear-gradient(90deg, rgba(255,255,255,0.035), transparent 55%)',
          borderBottom: '1px solid var(--line-faint)',
          flexShrink: 0, animation: 'scale-in 0.25s ease',
        }}>
          <StatusDot color={recommendation.color} pulse />
          <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: '16px', flexWrap: 'wrap' }}>
            <span style={{
              fontFamily: HEADER, fontSize: '0.72rem', color: recommendation.color,
              fontWeight: 800, letterSpacing: '0.08em', whiteSpace: 'nowrap',
            }}>
              {recommendation.title}
            </span>
            <span style={{ fontFamily: BODY, fontSize: '0.68rem', color: 'var(--t3)' }}>
              {recommendation.detail}
            </span>
            {currentBranch && (
              <span style={{ fontFamily: MONO, fontSize: '0.6rem', color: 'var(--t2)', whiteSpace: 'nowrap' }}>
                ⎇ {currentBranch}
              </span>
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
            style={{ padding: '8px 22px', fontSize: '0.58rem' }}
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

          {/* Connection */}
          <div style={{ marginBottom: '20px', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '9px', marginBottom: '7px' }}>
              <StatusDot color="var(--emerald)" pulse />
              <span style={{ fontFamily: MONO, fontSize: '0.62rem', color: 'var(--t1)', fontWeight: 800, letterSpacing: '0.18em' }}>
                CONNECTED
              </span>
            </div>
            <div style={{
              fontFamily: MONO, fontSize: '0.6rem', color: 'var(--t4)',
              wordBreak: 'break-all', lineHeight: 1.7, paddingLeft: '15px',
            }}>
              {gitRepoUrl || 'Repository URL hidden'}
            </div>
          </div>

          {/* Working tree — headline stat + change list.
              minHeight keeps the numeral from being crushed under the
              action buttons when the panel is short — the zone scrolls
              instead of collapsing. */}
          <div style={{ flex: 1, minHeight: '104px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', marginBottom: '12px', flexShrink: 0 }}>
              <span style={{
                fontFamily: HEADER, fontSize: '2rem', fontWeight: 800,
                color: hasChanges ? '#FFFFFF' : 'var(--t4)', lineHeight: 1, letterSpacing: '-0.02em',
              }}>
                {String(actualChanges.length).padStart(2, '0')}
              </span>
              <span style={{ fontFamily: BODY, fontSize: '0.66rem', color: 'var(--t3)' }}>
                {hasChanges
                  ? `file${actualChanges.length > 1 ? 's' : ''} changed`
                  : 'clean working tree'}
              </span>
            </div>
            <div className="no-scrollbar" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
              {actualChanges.slice(0, 8).map((line, i) => {
                const status = line.substring(0, 2).trim();
                const file = line.substring(3).trim();
                return (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: '12px', padding: '5px 0',
                    fontFamily: MONO, fontSize: '0.68rem',
                  }}>
                    <span style={{ color: statusGlyphColor(status), fontWeight: 700, width: '16px', flexShrink: 0 }}>{status}</span>
                    <span style={{ color: 'var(--t2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file}</span>
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
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '12px', padding: '0 6px' }}>
              <TextButton onClick={() => handleCommand('push')} disabled={gitLoading}>↑ PUSH</TextButton>
              <TextButton onClick={() => handleCommand('pull')} disabled={gitLoading}>↓ PULL</TextButton>
              <TextButton onClick={() => { refreshStatus(); refreshLog(); setCommandOutput(null); }} disabled={gitLoading}>⟳ SYNC</TextButton>
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
                const hash = line.substring(0, 7);
                const msg = line.substring(8);
                const isLast = i === logLines.length - 1;
                const isHead = i === 0;
                return (
                  <div key={i} style={{ display: 'flex', gap: '14px' }}>
                    {/* timeline spine */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '7px', flexShrink: 0 }}>
                      <span style={{
                        width: '5px', height: '5px', borderRadius: '50%', marginTop: '5px', flexShrink: 0,
                        background: isHead ? '#FFFFFF' : 'var(--t4)',
                      }} />
                      {!isLast && <span style={{ width: '1px', flex: 1, background: 'var(--line-faint)', margin: '4px 0' }} />}
                    </div>
                    <div style={{ paddingBottom: isLast ? 0 : '14px', minWidth: 0, flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', marginBottom: '3px' }}>
                        <span style={{ fontFamily: MONO, fontSize: '0.56rem', color: 'var(--t4)', letterSpacing: '0.08em' }}>
                          {hash}
                        </span>
                        {isHead && (
                          <span style={{ fontFamily: MONO, fontSize: '0.5rem', color: 'var(--t3)', letterSpacing: '0.16em', fontWeight: 700 }}>
                            HEAD
                          </span>
                        )}
                      </div>
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
