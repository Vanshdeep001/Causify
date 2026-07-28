/* -------------------------------------------------------
 * GitAssistantPanel.jsx — Intelligent Git Workspace
 *
 * Three states:
 *  1. NOT CONNECTED → "Connect Repository" form
 *  2. CONNECTED, IDLE → Status dashboard + command bar
 *  3. CONNECTED, SUGGESTION → Commit composer + push capability
 *
 * Visual language: open editorial layout — hairline dividers
 * instead of nested cards, numbered zone labels, display-font
 * accents, pill actions.
 * ------------------------------------------------------- */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import useEditorStore from '../../store/useEditorStore';
import { PixelSprite, MARIO_PAL, MARIO_ROWS } from '../common/pixelArt';
import {
  executeGitCommit, cloneGitRepo, gitPush, gitPull,
  gitStatus, gitLog, gitIsConnected, gitDisconnect,
  gitBranches, gitCheckout, gitUndoCommit
} from '../../services/api';
import { getProjectKey, getSavedRepoUrl, saveRepoUrl, clearSavedRepoUrl } from '../../utils/gitRepoMemory';

/* ═══════════════════════════════════════════════════════
 * GitHub PR Zone — fetches open PRs via the public API
 * ═══════════════════════════════════════════════════════ */

/** Extract { owner, repo, token } from a git URL.
 *  Handles:
 *    https://github.com/owner/repo.git
 *    https://TOKEN@github.com/owner/repo.git
 *    git@github.com:owner/repo.git                     */
const parseGitUrl = (url) => {
  if (!url) return null;
  let token = null;
  let clean = url.trim();

  // HTTPS with embedded token: https://TOKEN@github.com/...
  const tokenMatch = clean.match(/\/\/([^@]+)@github\.com/);
  if (tokenMatch) token = tokenMatch[1];

  // SSH: git@github.com:owner/repo.git
  const sshMatch = clean.match(/github\.com[:\/]([^/]+)\/([^/.]+)/);
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2].replace(/\.git$/, ''), token };
  return null;
};

const timeAgo = (dateStr) => {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
};

const GitHubPrZone = ({ repoUrl, isSplit }) => {
  const [prs, setPrs] = React.useState(null);       // null = not loaded, [] = empty
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);

  const parsed = React.useMemo(() => parseGitUrl(repoUrl), [repoUrl]);

  const fetchPrs = React.useCallback(async () => {
    if (!parsed) return;
    setLoading(true);
    setError(null);
    try {
      const headers = { Accept: 'application/vnd.github.v3+json' };
      if (parsed.token && !parsed.token.includes('***')) {
        headers.Authorization = `token ${parsed.token}`;
      }
      const res = await fetch(
        `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/pulls?state=open&per_page=15&sort=updated&direction=desc`,
        { headers },
      );
      if (!res.ok) throw new Error(`GitHub API ${res.status}`);
      const data = await res.json();
      setPrs(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [parsed]);

  // Fetch on mount + every 3 min
  React.useEffect(() => {
    fetchPrs();
    const interval = setInterval(fetchPrs, 180000);
    return () => clearInterval(interval);
  }, [fetchPrs]);

  const MONO = 'var(--font-number)';
  const BODY = 'var(--font-body)';

  if (!parsed) {
    return (
      <div style={{ fontFamily: BODY, fontSize: '0.7rem', color: 'var(--t4)', lineHeight: 1.6, padding: '4px 0' }}>
        Connect a GitHub repository to see pull requests.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Headline stat */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '13px', marginBottom: '14px', flexShrink: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{
            fontFamily: 'var(--font-header)', fontSize: '2.1rem', fontWeight: 800,
            color: (prs && prs.length > 0) ? '#FFFFFF' : 'var(--t4)', lineHeight: 1, letterSpacing: '-0.02em',
          }}>
            {prs ? String(prs.length).padStart(2, '0') : '--'}
          </span>
          <span style={{
            width: '26px', height: '2px', marginTop: '9px', borderRadius: '2px',
            background: (prs && prs.length > 0) ? '#FFFFFF' : 'var(--line-strong)',
          }} />
        </div>
        <span style={{ fontFamily: BODY, fontSize: '0.66rem', color: 'var(--t3)', paddingBottom: '3px' }}>
          {loading ? 'loading…' : prs ? (prs.length === 1 ? 'open pull request' : 'open pull requests') : '—'}
        </span>
      </div>

      {error && (
        <div style={{
          borderLeft: '2px solid var(--crimson)', paddingLeft: '12px',
          color: 'var(--crimson)', fontFamily: MONO, fontSize: '0.64rem',
          fontWeight: 600, lineHeight: 1.6, marginBottom: '10px',
        }}>
          {error}
        </div>
      )}

      {/* PR list */}
      <div className="no-scrollbar" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {prs && prs.length === 0 && (
          <div style={{ fontFamily: BODY, fontSize: '0.7rem', color: 'var(--t4)' }}>
            No open pull requests.
          </div>
        )}
        {prs && prs.map((pr) => (
          <div
            key={pr.id}
            style={{
              padding: '10px 8px', margin: '0 -8px', borderRadius: '2px',
              borderBottom: '1px solid var(--line-faint)',
              transition: 'background 0.15s ease', cursor: 'default',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.025)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
          >
            {/* Row 1: PR number + title */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
              <span style={{
                fontFamily: MONO, fontSize: '0.62rem', fontWeight: 800,
                color: 'var(--emerald)', flexShrink: 0, marginTop: '1px',
              }}>
                #{pr.number}
              </span>
              <span style={{
                fontFamily: BODY, fontSize: '0.74rem', fontWeight: 600,
                color: 'var(--t1)', lineHeight: 1.4,
                overflow: 'hidden', textOverflow: 'ellipsis',
                display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
              }}>
                {pr.title}
              </span>
            </div>

            {/* Row 2: author · time ago · review stats */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap',
              marginTop: '6px', paddingLeft: '0',
            }}>
              {/* Avatar + author */}
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <img
                  src={pr.user?.avatar_url}
                  alt=""
                  style={{ width: '14px', height: '14px', borderRadius: '50%', flexShrink: 0 }}
                />
                <span style={{ fontFamily: MONO, fontSize: '0.58rem', color: 'var(--t2)', fontWeight: 600 }}>
                  {pr.user?.login}
                </span>
              </span>

              <span style={{ width: '1px', height: '10px', background: 'var(--line-strong)', flexShrink: 0 }} />

              {/* Time */}
              <span style={{ fontFamily: MONO, fontSize: '0.54rem', color: 'var(--t4)', whiteSpace: 'nowrap' }}>
                {timeAgo(pr.created_at)}
              </span>

              {/* Comments */}
              {(pr.comments > 0 || pr.review_comments > 0) && (
                <>
                  <span style={{ width: '1px', height: '10px', background: 'var(--line-strong)', flexShrink: 0 }} />
                  <span style={{ fontFamily: MONO, fontSize: '0.54rem', color: 'var(--t4)' }}>
                    💬 {(pr.comments || 0) + (pr.review_comments || 0)}
                  </span>
                </>
              )}

              {/* Draft badge */}
              {pr.draft && (
                <span style={{
                  fontFamily: MONO, fontSize: '0.46rem', fontWeight: 800,
                  letterSpacing: '0.12em', color: 'var(--t4)',
                  padding: '1px 6px', borderRadius: '2px',
                  border: '1px solid var(--line-strong)',
                }}>
                  DRAFT
                </span>
              )}
            </div>

            {/* Row 3: labels */}
            {pr.labels && pr.labels.length > 0 && (
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '6px' }}>
                {pr.labels.map((label) => (
                  <span
                    key={label.id}
                    style={{
                      fontFamily: MONO, fontSize: '0.46rem', fontWeight: 700,
                      letterSpacing: '0.1em', color: `#${label.color}`,
                      padding: '1px 7px', borderRadius: '999px',
                      border: `1px solid #${label.color}44`,
                      background: `#${label.color}11`,
                    }}
                  >
                    {label.name.toUpperCase()}
                  </span>
                ))}
              </div>
            )}

            {/* Row 4: head → base */}
            <div style={{
              fontFamily: MONO, fontSize: '0.52rem', color: 'var(--t4)',
              marginTop: '5px', display: 'flex', alignItems: 'center', gap: '6px',
            }}>
              <span style={{ color: '#818cf8' }}>{pr.head?.ref}</span>
              <span>→</span>
              <span>{pr.base?.ref}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};


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
const fileStatusMeta = (code, path) => {
  const c = (code || '').trim();
  // The backend asks git to list untracked files individually, so directory
  // entries should not appear. Kept as a fallback: an older backend still
  // collapses a new folder into one entry ending in "/", and calling that a
  // single new file would misrepresent it.
  if (typeof path === 'string' && path.trimEnd().endsWith('/')) {
    return { label: 'NEW DIR', color: 'var(--emerald)' };
  }
  if (c === '??' || c.includes('A')) return { label: 'NEW', color: 'var(--emerald)' };
  if (c.includes('D')) return { label: 'DEL', color: 'var(--crimson)' };
  if (c.includes('R')) return { label: 'MOVED', color: '#818cf8' };
  if (c.includes('M')) return { label: 'EDIT', color: 'var(--amber)' };
  return { label: c || '•', color: '#818cf8' };
};

/* Small pill: status dot + micro-caps label, thin-bordered. */
const FileBadge = ({ code, path }) => {
  const m = fileStatusMeta(code, path);
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
  const storeSessionId = useEditorStore(s => s.sessionId);
  const workspaceRoot = useEditorStore(s => s.workspaceRoot);

  // Git works against a "scope": the user's own repository when a folder is open
  // from disk, otherwise the session's cloned sandbox. The backend accepts either
  // in the same field, so everything below is written once.
  const isLocalRepo = Boolean(workspaceRoot);
  const sessionId = workspaceRoot || storeSessionId;
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
  // True number of changed files, straight from git. The visible list can be
  // trimmed for very large working trees, so the count is tracked separately.
  const [changeCount, setChangeCount] = useState(null);
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
      // gitStatus is a GET and carries no body — the backend reads the working
      // tree itself. Passing files here looked like it did something and didn't.
      const res = await gitStatus(sessionId);
      setGitStatus(res.output || '');
      // The backend trims very long listings but always reports the true total,
      // so the headline number stays right even when the list below is clipped.
      setChangeCount(typeof res.changeCount === 'number' ? res.changeCount : null);
    } catch (e) { /* silent */ }
  }, [sessionId, files]);

  const refreshLog = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await gitLog(sessionId, 8);
      // Git merges stderr into stdout, so a failed `git log` — most commonly
      // "does not have any commits yet" in a freshly initialised repo — would
      // otherwise be stored and drawn as if it were a commit. Only keep output
      // that actually succeeded; anything else means there is no history to show.
      setGitLog(res.success === false ? '' : (res.output || ''));
    } catch (e) { /* silent */ }
  }, [sessionId]);

  const sessionName = useEditorStore(s => s.sessionName);
  const projectKey = getProjectKey(files, sessionName, workspaceRoot);
  const autoConnectAttemptedRef = useRef(false);

  // Check connection on mount; if not connected but this project has a
  // saved repo URL, silently reconnect it so the user never re-enters it.
  useEffect(() => {
    if (!sessionId) return;
    gitIsConnected(sessionId).then(async (res) => {
      if (res.connected) {
        /* Prefer the remote git itself reports. That lives in .git/config, so a
         * connected folder stays connected across restarts and even a cleared
         * browser store — nothing here has to remember it. The locally saved URL
         * is only a fallback for session sandboxes, which have no folder to
         * carry the answer. */
        const savedUrl = getSavedRepoUrl(projectKey) || '';
        const safeUrl = res.remoteUrl || savedUrl.replace(/\/\/[^@]+@/, '//***@');
        setGitRepoConnected(true, safeUrl);
        refreshStatus();
        refreshLog();
        return;
      }

      // An open folder either is a git repository or it isn't — there is nothing
      // to clone into it, and attempting to would be destructive. Leave the panel
      // showing that this folder has no repository yet.
      if (isLocalRepo) {
        setGitRepoConnected(false, '');
        return;
      }

      // Backend has no clone for this session.
      const savedUrl = getSavedRepoUrl(projectKey);
      if (!savedUrl) {
        // Nothing to reconnect from — clear any stale persisted "connected"
        // so the connect form shows (a genuine, non-transient disconnect).
        setGitRepoConnected(false, '');
        return;
      }
      if (autoConnectAttemptedRef.current) return;
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
          // Saved URL no longer works (revoked token, deleted repo) — the
          // persisted "connected" is stale, so drop to the connect form,
          // prefilled. The saved URL is kept, so retry is one click; only a
          // manual disconnect forgets it.
          setGitRepoConnected(false, '');
          setRepoUrlInput(savedUrl);
        }
      } catch {
        setGitRepoConnected(false, '');
        setRepoUrlInput(savedUrl);
      } finally {
        setGitLoading(false);
      }
    }).catch(() => {});
  }, [sessionId, isLocalRepo, projectKey, refreshStatus, refreshLog, setGitRepoConnected, setGitLoading]);

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
        height: '100%', display: 'flex', alignItems: 'stretch',
        justifyContent: 'center', padding: '12px 16px', overflow: 'hidden',
      }}>
        <div style={{
          width: '100%', display: 'flex', alignItems: 'stretch',
          border: '1px solid var(--line)',
          borderRadius: '6px',
          background: 'rgba(255,255,255,0.015)',
          animation: 'fade-in 0.4s ease-out',
          overflow: 'hidden',
          position: 'relative',
        }}>

          {/* Left decorative panel — Mario × Git Commit */}
          <div style={{
            width: '180px', flexShrink: 0,
            borderRight: '1px solid var(--line)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            position: 'relative',
            background: 'rgba(255,255,255,0.01)',
            overflow: 'hidden',
          }}>
            {/* Grid dot pattern */}
            <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, opacity: 0.15 }}>
              <pattern id="marioGitDots" x="0" y="0" width="16" height="16" patternUnits="userSpaceOnUse">
                <circle cx="1" cy="1" r="0.5" fill="var(--t4)" />
              </pattern>
              <rect width="100%" height="100%" fill="url(#marioGitDots)" />
            </svg>

            <style>{`
              /* 3-second loop animation */
              /* Much punchier, without changing the height.
                 -30px is fixed by the geometry: Mario's head sits at y≈88 and
                 the block's underside at y=58, so that is exactly the distance
                 at which he connects. Going further would send him through it.
                 The energy therefore comes from timing and squash — a deeper
                 crouch, a faster launch, a harder landing — which is what sells
                 weight anyway. The 35% keyframe stays put because the block's
                 bump is timed to it. */
              @keyframes panel-mario-jump {
                0%   { transform: translateY(0) scaleY(1); }
                12%  { transform: translateY(0) scaleY(0.6); }
                18%  { transform: translateY(-6px) scaleY(1.25); }
                35%  { transform: translateY(-30px) scaleY(1.05); } /* hits block underside exactly at 35% */
                42%  { transform: translateY(-28px) scaleY(0.85); }
                58%  { transform: translateY(0) scaleY(0.65); }
                68%  { transform: translateY(0) scaleY(1.15); }
                76%  { transform: translateY(0) scaleY(0.95); }
                84%, 100% { transform: translateY(0) scaleY(1); }
              }

              @keyframes panel-block-bump {
                0%, 34% { transform: translateY(0); }
                35%     { transform: translateY(-6px); }
                42%     { transform: translateY(1.5px); }
                50%, 100% { transform: translateY(0); }
              }

              @keyframes panel-commit-rise {
                0%, 35% { transform: translateY(0); opacity: 0; }
                55%     { transform: translateY(-16px); opacity: 1; }
                85%     { transform: translateY(-16px); opacity: 1; }
                95%, 100% { transform: translateY(-16px) scale(0.8); opacity: 0; }
              }
            `}</style>

            <svg width="120" height="120" viewBox="0 0 120 120" shapeRendering="crispEdges" style={{ position: 'relative', zIndex: 1 }}>

              {/* ── Git Commit Tag (Rises from block) ── */}
              <g style={{ animation: 'panel-commit-rise 3s infinite' }}>
                {/* Border box for hash */}
                <rect x="36" y="16" width="48" height="12" fill="#1e1e24" stroke="rgba(255,255,255,0.4)" strokeWidth="0.8" rx="2" />
                <text x="60" y="24" textAnchor="middle" fill="#fff" fontSize="5" fontFamily="var(--font-number)" letterSpacing="0.04em">c4e6727</text>
              </g>

              {/* ── Git Commit Block (looks like a ? block) ── */}
              <g style={{ animation: 'panel-block-bump 3s infinite', transformOrigin: 'center center' }}>
                <rect x="48" y="34" width="24" height="24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="1" />
                {/* Inner question mark shape */}
                <rect x="58" y="39" width="4" height="1" fill="rgba(255,255,255,0.6)" />
                <rect x="57" y="40" width="2" height="1" fill="rgba(255,255,255,0.6)" />
                <rect x="61" y="40" width="2" height="1" fill="rgba(255,255,255,0.6)" />
                <rect x="60" y="41" width="2" height="2" fill="rgba(255,255,255,0.6)" />
                <rect x="59" y="43" width="2" height="1" fill="rgba(255,255,255,0.6)" />
                <rect x="59" y="45" width="2" height="2" fill="rgba(255,255,255,0.6)" />
              </g>

              {/* ── Jumping Mario (aligned under the block) ── */}
              <g style={{ animation: 'panel-mario-jump 3s infinite', transformOrigin: 'bottom center' }}>
                <g transform="translate(52, 86)">
                  <rect x="4" y="4" width="8" height="8" fill="#FFFFFF" />
                  <rect x="5" y="5" width="6" height="4" fill="var(--s0)" />
                  <rect x="6" y="6" width="1" height="2" fill="#FFFFFF" />
                  <rect x="9" y="6" width="1" height="2" fill="#FFFFFF" />
                  <rect x="7" y="9" width="2" height="1" fill="#FFFFFF" />
                  <rect x="3" y="3" width="10" height="1" fill="#FFFFFF" />
                  <rect x="5" y="2" width="6" height="1" fill="#FFFFFF" />
                  <rect x="4" y="12" width="2" height="2" fill="#FFFFFF" />
                  <rect x="10" y="12" width="2" height="2" fill="#FFFFFF" />
                </g>
              </g>
            </svg>
          </div>

          {/* Right content area */}
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            justifyContent: 'center', padding: '20px 32px',
            minWidth: 0,
          }}>
            {/* Top section: label + heading */}
            <div style={{ marginBottom: '16px' }}>
              <div style={{
                fontFamily: MONO, fontSize: '0.48rem', fontWeight: 700,
                letterSpacing: '0.32em', color: 'var(--t4)', marginBottom: '6px',
              }}>
                REMOTE REPOSITORY
              </div>
              <div style={{
                fontFamily: HEADER, fontSize: '0.95rem', fontWeight: 700,
                color: 'var(--t1)', letterSpacing: '0.01em', marginBottom: '4px',
              }}>
                Connect a repository
              </div>
              <div style={{
                fontFamily: BODY, fontSize: '0.6rem', color: 'var(--t4)',
                lineHeight: 1.6,
              }}>
                Link a remote over HTTPS or SSH to enable intelligent commits, push and pull.
              </div>
            </div>

            {/* Input row */}
            <div style={{ display: 'flex', alignItems: 'stretch', gap: '0' }}>
              <div style={{
                flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '10px',
                border: '1px solid var(--line-strong)', borderRight: 'none',
                borderRadius: '4px 0 0 4px', padding: '0 14px',
                background: 'rgba(255,255,255,0.025)',
                transition: 'border-color 0.2s ease',
              }}>
                <span style={{ fontFamily: MONO, fontSize: '0.68rem', color: 'var(--t4)', flexShrink: 0, userSelect: 'none' }}>›</span>
                <input
                  type="text"
                  value={repoUrlInput}
                  onChange={(e) => setRepoUrlInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
                  onFocus={(e) => { e.currentTarget.parentElement.style.borderColor = 'rgba(255,255,255,0.3)'; }}
                  onBlur={(e) => { e.currentTarget.parentElement.style.borderColor = 'var(--line-strong)'; }}
                  placeholder="https://github.com/user/repo.git"
                  spellCheck={false}
                  style={{
                    flex: 1, minWidth: 0, background: 'transparent', border: 'none',
                    outline: 'none', color: 'var(--t1)', fontSize: '0.72rem',
                    fontFamily: MONO, fontWeight: 500, padding: '9px 0',
                  }}
                />
              </div>
              <button
                onClick={handleConnect}
                disabled={gitLoading || !repoUrlInput.trim()}
                style={{
                  padding: '0 22px',
                  background: 'transparent',
                  color: 'var(--t2)',
                  border: '1px solid var(--line-strong)',
                  borderRadius: '0 4px 4px 0',
                  cursor: (gitLoading || !repoUrlInput.trim()) ? 'default' : 'pointer',
                  fontFamily: MONO, fontSize: '0.56rem', fontWeight: 700,
                  letterSpacing: '0.16em', whiteSpace: 'nowrap',
                  opacity: (gitLoading || !repoUrlInput.trim()) ? 0.35 : 1,
                  transition: 'background 0.15s ease, color 0.15s ease, border-color 0.15s ease',
                }}
                onMouseEnter={e => {
                  if (gitLoading || !repoUrlInput.trim()) return;
                  e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.3)';
                  e.currentTarget.style.color = 'var(--t1)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.borderColor = 'var(--line-strong)';
                  e.currentTarget.style.color = 'var(--t2)';
                }}
              >
                {gitLoading ? 'CONNECTING…' : 'CONNECT'}
              </button>
            </div>

            {/* Bottom hint row */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: '16px',
              marginTop: '10px',
            }}>
              <div style={{
                fontFamily: MONO, fontSize: '0.48rem', color: 'var(--t4)',
                letterSpacing: '0.08em',
              }}>
                HTTPS · SSH · TOKEN AUTH
              </div>
              <div style={{ flex: 1, height: '1px', background: 'linear-gradient(90deg, var(--line), transparent)' }} />
            </div>

            {gitError && (
              <ErrorLine style={{ marginTop: '12px' }}>
                {gitError}
              </ErrorLine>
            )}
          </div>
        </div>
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
      // Session mode sends the editor's live files so unsaved buffers are
      // committed too. Local mode commits the working tree as it stands on
      // disk — sending contents would only overwrite the user's own files.
      const res = await executeGitCommit({
        sessionId,
        message: inlineCommitMsg.trim(),
        files: isLocalRepo
          ? undefined
          : Object.entries(files).map(([path, content]) => ({ path, content })),
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
  // git now lists untracked files individually (-uall), so a line is a file.
  // Prefer the backend's count, which stays accurate even if the list was
  // trimmed for a very large working tree.
  const totalChanges = changeCount ?? actualChanges.length;
  const hasChanges = totalChanges > 0;

  const branchLine = statusLines.find(l => l.startsWith('##')) || '';
  const isAhead = branchLine.includes('[ahead');
  /* The porcelain branch header comes in several shapes, and taking the first
   * word only works for one of them:
   *   ## master...origin/master [ahead 1]   → master
   *   ## master                             → master
   *   ## No commits yet on master           → master   (first word was "No")
   *   ## HEAD (no branch)                   → detached
   */
  const parseBranch = (line) => {
    const header = line.replace(/^##\s*/, '').trim();
    if (!header) return '';

    const noCommitsYet = header.match(/^No commits yet on (.+)$/i);
    if (noCommitsYet) return noCommitsYet[1].split('...')[0].trim();

    if (/^HEAD\b/.test(header) && header.includes('(no branch)')) return 'detached';

    return header.split('...')[0].split(' ')[0].trim();
  };

  const currentBranch = parseBranch(branchLine);

  // Parse log lines. `git log --oneline` gives "<abbrev-hash> <subject>", but the
  // hash length varies with repository size, so a fixed slice would clip or keep
  // part of the wrong field. Keep only lines that genuinely look like commits.
  const logLines = String(gitLogData || '')
    .split('\n')
    .map(l => l.trim())
    .filter(l => /^[0-9a-f]{7,40}\s+/i.test(l));

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

      const getRepoName = (url) => {
        if (!url) return '';
        let clean = url.trim().replace(/\.git$/, '');
        const segments = clean.split(/[\/:]/);
        return segments[segments.length - 1] || '';
      };
      const repoName = getRepoName(gitRepoUrl).toUpperCase();

      return {
        type: 'commit',
        color: '#FFFFFF',
        title: repoName || 'READY TO COMMIT',
        detail: `${totalChanges} file${totalChanges === 1 ? '' : 's'} changed — ${summary}`,
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
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '12px' }}>
              {/* The changed-files list polls every 15s, which is a long time to
                  stare at a stale count — and the other zones already offer this. */}
              <TextButton
                onClick={() => { refreshStatus(); setCommandOutput(null); }}
                style={{ fontSize: '0.66rem', letterSpacing: 0 }}
                title="Refresh changed files"
              >
                ⟳
              </TextButton>
              <TextButton onClick={handleDisconnect} danger style={{ fontSize: '0.52rem' }}>
                DISCONNECT
              </TextButton>
            </span>
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
                  {String(totalChanges).padStart(2, '0')}
                </span>
                <span style={{
                  width: '26px', height: '2px', marginTop: '9px', borderRadius: '2px',
                  background: hasChanges ? '#FFFFFF' : 'var(--line-strong)',
                }} />
              </div>
              <span style={{ fontFamily: BODY, fontSize: '0.66rem', color: 'var(--t3)', paddingBottom: '3px' }}>
                {hasChanges
                  ? `file${totalChanges === 1 ? '' : 's'} changed`
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
                    <FileBadge code={status} path={file} />
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

        {/* ZONE 02: Pull Requests — live from GitHub */}
        <div className="no-scrollbar" style={{
          flex: 1, minWidth: 0, minHeight: isSplit ? '180px' : 0,
          display: 'flex', flexDirection: 'column',
          paddingRight: isSplit ? 0 : '24px',
          overflowY: 'auto', ...zoneDivider,
        }}>
          <ZoneLabel index="02" right={
            <TextButton
              onClick={() => {
                /* trigger a re-fetch by remounting */
                const el = document.querySelector('[data-pr-zone]');
                if (el) el.dispatchEvent(new Event('refetch'));
              }}
              style={{ fontSize: '0.66rem', letterSpacing: 0 }}
            >
              ⟳
            </TextButton>
          }>
            Pull Requests
          </ZoneLabel>
          <GitHubPrZone repoUrl={getSavedRepoUrl(projectKey) || gitRepoUrl} isSplit={isSplit} />
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
                // Split on the first run of whitespace rather than a fixed
                // offset, so the subject survives whatever hash length git chose.
                const msg = line.replace(/^[0-9a-f]{7,40}\s+/i, '');
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
 * pull requests (zone 02), history (zone 03).
 * ═══════════════════════════════════════════════════════ */

const GitAssistantPanel = () => (
  <div style={{ height: '100%', overflow: 'hidden', background: 'var(--s0)' }}>
    <GitAssistantCore />
  </div>
);

export default GitAssistantPanel;
