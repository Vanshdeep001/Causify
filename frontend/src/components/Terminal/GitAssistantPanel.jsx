/* -------------------------------------------------------
 * GitAssistantPanel.jsx — Intelligent Git Workspace HUD
 * 
 * Three states:
 *  1. NOT CONNECTED → "Connect Repository" form
 *  2. CONNECTED, IDLE → Status dashboard + command bar
 *  3. CONNECTED, SUGGESTION → Commit HUD + push capability
 * ------------------------------------------------------- */

import React, { useState, useEffect, useCallback } from 'react';
import useEditorStore from '../../store/useEditorStore';
import { 
  executeGitCommit, cloneGitRepo, gitPush, gitPull, 
  gitStatus, gitLog, gitIsConnected, gitDisconnect 
} from '../../services/api';

// ── Shared styled micro-components ──

const HudLabel = ({ children }) => (
  <div style={{ 
    fontFamily: 'var(--font-number)', fontSize: '0.65rem', color: '#666', 
    letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: '12px',
    fontWeight: 900 
  }}>
    {typeof children === 'string' ? children.replace(/_/g, ' ') : children}
  </div>
);

const PowerLine = () => (
  <div style={{ width: '1px', background: 'linear-gradient(to bottom, transparent, #222, #222, transparent)', margin: '0 40px' }} />
);

const StatusDot = ({ color, pulse }) => (
  <span style={{
    display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%',
    background: color, boxShadow: `0 0 8px ${color}`,
    animation: pulse ? 'pulse-live 1.5s ease-in-out infinite' : 'none',
    marginRight: '8px', flexShrink: 0,
  }} />
);

const GitAssistantPanel = () => {
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
  const [commandInput, setCommandInput] = useState('');
  const [commandOutput, setCommandOutput] = useState(null);
  const [showCommitInput, setShowCommitInput] = useState(false);
  const [inlineCommitMsg, setInlineCommitMsg] = useState('');

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

  // Check connection on mount
  useEffect(() => {
    if (sessionId) {
      gitIsConnected(sessionId).then(res => {
        if (res.connected) {
          setGitRepoConnected(true);
          refreshStatus();
          refreshLog();
        }
      }).catch(() => {});
    }
  }, [sessionId, refreshStatus, refreshLog]);

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
      <div style={{ 
        height: '100%', display: 'flex', flexDirection: 'column', 
        alignItems: 'center', justifyContent: 'center', padding: '40px',
        background: '#0a0a0a'
      }}>
        <div style={{ maxWidth: '520px', width: '100%' }}>
          {/* Header */}
          <div style={{ textAlign: 'center', marginBottom: '40px' }}>
            <div style={{ 
              fontFamily: 'var(--font-number)', fontSize: '0.65rem', color: '#555',
              letterSpacing: '0.3em', marginBottom: '12px'
            }}>
              GIT WORKSPACE
            </div>
            <div style={{ 
              fontFamily: 'var(--font-header)', fontSize: '1.8rem', fontWeight: 900,
              color: '#fff', letterSpacing: '-0.02em'
            }}>
              Connect Repository
            </div>
            <div style={{ width: '60px', height: '2px', background: '#c1ff72', margin: '16px auto 0' }} />
          </div>

          {/* URL Input */}
          <div style={{ 
            border: '2px solid #222', padding: '20px',
            position: 'relative', background: '#111'
          }}>
            <div style={{ position: 'absolute', top: '-1px', left: '-1px', width: '12px', height: '12px', borderTop: '3px solid #c1ff72', borderLeft: '3px solid #c1ff72' }} />
            <div style={{ position: 'absolute', bottom: '-1px', right: '-1px', width: '12px', height: '12px', borderBottom: '3px solid #c1ff72', borderRight: '3px solid #c1ff72' }} />
            
            <HudLabel>Repository URL</HudLabel>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ color: '#c1ff72', fontFamily: 'var(--font-number)', fontSize: '0.85rem', fontWeight: 700 }}>▶</span>
              <input
                type="text"
                value={repoUrlInput}
                onChange={(e) => setRepoUrlInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
                placeholder="https://<token>@github.com/user/repo.git"
                spellCheck={false}
                style={{
                  flex: 1, background: 'transparent', border: 'none', outline: 'none',
                  color: '#fff', fontSize: '0.95rem', fontFamily: 'var(--font-header)',
                  fontWeight: 700, letterSpacing: '-0.01em'
                }}
              />
            </div>
          </div>

          {/* Hint */}
          <div style={{ 
            fontFamily: 'var(--font-number)', fontSize: '0.6rem', color: '#444',
            letterSpacing: '0.1em', marginTop: '12px', lineHeight: 1.8
          }}>
            🔒 TOKEN NEVER PERSISTED — Held in memory only for this session
          </div>

          {/* Error */}
          {gitError && (
            <div style={{ 
              marginTop: '16px', padding: '12px', background: 'rgba(255,62,62,0.08)',
              border: '1px solid rgba(255,62,62,0.3)', color: '#ff3e3e',
              fontFamily: 'var(--font-number)', fontSize: '0.75rem', fontWeight: 700
            }}>
              ✕ {gitError}
            </div>
          )}

          {/* Connect Button */}
          <button
            onClick={handleConnect}
            disabled={gitLoading || !repoUrlInput.trim()}
            style={{
              width: '100%', marginTop: '24px', padding: '14px',
              background: gitLoading ? '#333' : '#c1ff72', color: '#000',
              border: 'none', cursor: gitLoading ? 'wait' : 'pointer',
              fontFamily: 'var(--font-number)', fontSize: '0.85rem', fontWeight: 900,
              letterSpacing: '0.1em',
              boxShadow: gitLoading ? 'none' : '0 0 30px rgba(193, 255, 114, 0.15)',
              opacity: gitLoading || !repoUrlInput.trim() ? 0.5 : 1,
              transition: 'all 0.15s ease',
            }}
          >
            {gitLoading ? '⠿ CLONING REPOSITORY...' : 'CONNECT'}
          </button>
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
    const getBadgeColors = (type) => {
      switch(type) {
        case 'fix': return { bg: 'rgba(255, 62, 62, 0.05)', fg: '#ff3e3e', icon: '🐞', label: 'BUG_FIX' };
        case 'feat': return { bg: 'rgba(193, 255, 114, 0.05)', fg: '#c1ff72', icon: '✨', label: 'FEATURE' };
        case 'style': return { bg: 'rgba(129, 140, 248, 0.05)', fg: '#818cf8', icon: '🎨', label: 'UI_STYLE' };
        case 'refactor': return { bg: 'rgba(251, 191, 36, 0.05)', fg: '#fbbf24', icon: '🔧', label: 'REFACTOR' };
        default: return { bg: 'rgba(255,255,255,0.05)', fg: '#fff', icon: '📝', label: 'SYSTEM' };
      }
    };

    const colors = getBadgeColors(suggestion.type);

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
      return (
        <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0a0a' }}>
          <div style={{ textAlign: 'center', animation: 'scale-in 0.3s ease' }}>
            <div style={{ fontFamily: 'var(--font-number)', color: '#c1ff72', fontSize: '1.5rem', fontWeight: 900 }}>EXECUTION_COMPLETE</div>
            <div style={{ fontFamily: 'var(--font-body)', color: '#666', fontSize: '0.8rem', marginTop: '5px' }}>{commitResult.text}</div>
            <div style={{ marginTop: '20px', display: 'flex', gap: '12px', justifyContent: 'center' }}>
              <button
                onClick={handlePushAfterCommit}
                disabled={gitLoading}
                style={{
                  padding: '10px 30px', background: 'transparent', 
                  border: '2px solid #c1ff72', color: '#c1ff72', cursor: 'pointer',
                  fontFamily: 'var(--font-number)', fontSize: '0.75rem', fontWeight: 900,
                  letterSpacing: '0.1em', opacity: gitLoading ? 0.5 : 1,
                  transition: 'all 0.15s ease',
                }}
              >
                {gitLoading ? 'PUSHING...' : '↑ PUSH'}
              </button>
              <button
                onClick={() => setCommitSuggestion(null)}
                style={{
                  padding: '10px 20px', background: 'transparent', border: 'none',
                  color: '#555', cursor: 'pointer', fontFamily: 'var(--font-number)',
                  fontSize: '0.75rem', fontWeight: 900
                }}
              >
                DISMISS
              </button>
            </div>
          </div>
          <style>{`
            @keyframes scale-in { 0% { transform: scale(0.95); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
          `}</style>
        </div>
      );
    }

    const isSplit = terminalLayoutMode === 'split';

    return (
      <div style={{ 
        height: '100%', display: 'flex', flexDirection: isSplit ? 'column' : 'row',
        padding: '15px 0', position: 'relative', overflow: 'hidden'
      }}>
        {/* 1. STATUS ZONE */}
        <div style={{ flex: isSplit ? '0 0 auto' : '0 0 280px', display: 'flex', flexDirection: 'column', padding: '10px' }}>
          <HudLabel>Intelligence Classification</HudLabel>
          <div style={{ position: 'relative', padding: '20px', border: `2.5px solid ${colors.fg}`, background: `${colors.bg}` }}>
            <div style={{ position: 'absolute', top: '-1px', left: '-1px', width: '12px', height: '12px', borderTop: `4px solid ${colors.fg}`, borderLeft: `4px solid ${colors.fg}` }} />
            <div style={{ position: 'absolute', bottom: '-1px', right: '-1px', width: '12px', height: '12px', borderBottom: `4px solid ${colors.fg}`, borderRight: `4px solid ${colors.fg}` }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
              <span style={{ fontSize: '1.8rem' }}>{colors.icon}</span>
              <div style={{ fontFamily: 'var(--font-header)', fontSize: '1.5rem', fontWeight: 900, color: colors.fg, textTransform: 'uppercase', letterSpacing: '-0.02em' }}>
                {colors.label}
              </div>
            </div>
          </div>

          <div style={{ marginTop: '30px' }}>
            <HudLabel>Confidence Matrix</HudLabel>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ flex: 1, height: '6px', background: '#1a1a1a', borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{ 
                  width: suggestion.confidence === 'HIGH' ? '90%' : suggestion.confidence === 'MEDIUM' ? '60%' : '30%', 
                  height: '100%', background: colors.fg, boxShadow: `0 0 15px ${colors.fg}`
                }} />
              </div>
              <span style={{ fontFamily: 'var(--font-number)', fontSize: '0.75rem', color: colors.fg, fontWeight: 900 }}>{suggestion.confidence}</span>
            </div>
          </div>

          {/* Repo indicator */}
          <div style={{ marginTop: '20px', padding: '8px 0', borderTop: '1px solid #1a1a1a' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <StatusDot color="#c1ff72" pulse={false} />
              <span style={{ fontFamily: 'var(--font-number)', fontSize: '0.6rem', color: '#555', letterSpacing: '0.1em' }}>REPO LINKED</span>
            </div>
          </div>
        </div>

        {!isSplit && <PowerLine />}

        {/* 2. ACTION ZONE */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ background: '#0a0a0a', padding: '25px', border: '1.5px solid #1a1a1a', flex: 1, position: 'relative' }}>
            <HudLabel>Commit Terminal Buffer</HudLabel>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', color: '#c1ff72', fontFamily: 'var(--font-number)', fontSize: '1.1rem', fontWeight: 700 }}>
              <span style={{ marginTop: '4px', opacity: 0.8, color: '#fff' }}>▶</span>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                <div style={{ opacity: 0.3, fontSize: '0.8rem' }}>git commit -m "</div>
                <textarea
                  value={commitMessage}
                  onChange={(e) => setCommitMessage(e.target.value)}
                  spellCheck={false}
                  style={{
                    background: 'transparent', border: 'none', outline: 'none',
                    color: '#fff', fontSize: '1.25rem', fontFamily: 'var(--font-header)', 
                    fontWeight: 700, width: '100%', height: '110px', resize: 'none', margin: '8px 0',
                    lineHeight: 1.2, paddingLeft: '20px', borderLeft: '3px solid #222'
                  }}
                />
                <div style={{ opacity: 0.3, fontSize: '0.8rem' }}>"</div>
              </div>
            </div>

            {/* Error inline */}
            {commitResult && !commitResult.success && (
              <div style={{ 
                marginTop: '10px', padding: '8px 12px', background: 'rgba(255,62,62,0.08)',
                border: '1px solid rgba(255,62,62,0.3)', color: '#ff3e3e',
                fontFamily: 'var(--font-number)', fontSize: '0.7rem', fontWeight: 700
              }}>
                ✕ {commitResult.text}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '20px' }}>
            <button 
              onClick={() => setCommitSuggestion(null)}
              style={{ 
                background: 'transparent', border: 'none', color: '#555', 
                padding: '10px 20px', cursor: 'pointer', fontFamily: 'var(--font-number)', 
                fontSize: '0.75rem', fontWeight: 900, letterSpacing: '0.1em'
              }}
            >
              DISCARD
            </button>
            <button 
              onClick={handleCommit}
              disabled={isCommitting || !commitMessage.trim()}
              style={{ 
                background: '#c1ff72', color: '#000', border: 'none', 
                padding: '12px 40px', cursor: 'pointer', fontFamily: 'var(--font-number)', 
                fontSize: '0.85rem', fontWeight: 900,
                boxShadow: '0 0 30px rgba(193, 255, 114, 0.15)',
                opacity: isCommitting ? 0.6 : 1,
                transition: 'transform 0.1s ease',
              }}
              onMouseDown={e => e.currentTarget.style.transform = 'scale(0.96)'}
              onMouseUp={e => e.currentTarget.style.transform = 'scale(1)'}
            >
              {isCommitting ? 'EXECUTING...' : 'CONFIRM COMMIT'}
            </button>
          </div>
        </div>

        {!isSplit && <PowerLine />}

        {/* 3. STAGING ZONE */}
        <div style={{ flex: isSplit ? '0 0 auto' : '0 0 240px', display: 'flex', flexDirection: 'column' }}>
          <HudLabel>Staged Blueprint</HudLabel>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {suggestion.modifiedFiles?.map((file) => (
              <div key={file} style={{ 
                display: 'flex', alignItems: 'center', gap: '15px', padding: '12px 0',
                borderBottom: '1px solid #111'
              }}>
                <div style={{ width: '8px', height: '8px', background: '#c1ff72', borderRadius: '1px', transform: 'rotate(45deg)' }} />
                <span style={{ color: '#fff', fontSize: '1rem', fontFamily: 'var(--font-header)', fontWeight: 700 }}>
                  {file}
                </span>
              </div>
            ))}
            {suggestion.affectedFiles?.length > 0 && (
              <div style={{ marginTop: '30px' }}>
                <HudLabel>Impact Predictions</HudLabel>
                {suggestion.affectedFiles.map(file => (
                  <div key={file} style={{ 
                    color: '#ff3e3e', fontSize: '0.85rem', padding: '6px 0', 
                    fontFamily: 'var(--font-header)', fontWeight: 700 
                  }}>
                     {'>'} {file}
                  </div>
                ))}
              </div>
            )}
          </div>
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
      const res = await executeGitCommit({ sessionId, message: inlineCommitMsg.trim() });
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

  const handleCommand = async (cmd) => {
    const rawCommand = (cmd || commandInput).trim();
    const command = rawCommand.toLowerCase();
    if (!command) return;
    setCommandInput('');
    setCommandOutput(null);
    setGitLoading(true);
    setGitError(null);

    try {
      let res;
      // Support "commit <message>" syntax
      if (command.startsWith('commit')) {
        const msg = rawCommand.substring(6).trim();
        if (!msg) {
          setShowCommitInput(true);
          setGitLoading(false);
          return;
        }
        res = await executeGitCommit({ 
          sessionId, 
          message: msg,
          files: Object.entries(files).map(([path, content]) => ({ path, content }))
        });
      } else {
        switch (command) {
          case 'push':
            res = await gitPush(sessionId);
            break;
          case 'pull':
            res = await gitPull(sessionId);
            break;
          case 'status':
            res = await gitStatus(sessionId);
            break;
          case 'log':
            res = await gitLog(sessionId, 10);
            break;
          default:
            setGitError(`Unknown command: "${command}". Use: commit, push, pull, status, log`);
            setGitLoading(false);
            return;
        }
      }

      if (res.success !== false) {
        setCommandOutput({ command: command.split(' ')[0], output: res.output || '(no output)' });
        refreshStatus();
        refreshLog();
      } else {
        setGitError(res.error || `${command} failed`);
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
    resetGit();
  };

  const isSplit = terminalLayoutMode === 'split';

  // Parse status lines
  const statusLines = String(gitStatusData || '').split('\n').filter(l => l.trim());
  const actualChanges = statusLines.filter(l => !l.startsWith('##'));
  const hasChanges = actualChanges.length > 0;
  
  const branchLine = statusLines.find(l => l.startsWith('##')) || '';
  const isAhead = branchLine.includes('[ahead');

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
        color: '#c1ff72',
        icon: '●',
        title: 'READY TO COMMIT',
        detail: `${actualChanges.length} file${actualChanges.length > 1 ? 's' : ''} changed (${summary})`,
        action: 'commit',
        actionLabel: 'COMMIT CHANGES',
      };
    }
    // After commit, if branch is ahead, suggest push  
    if (logLines.length > 0 && !hasChanges && isAhead) {
      return {
        type: 'push',
        color: '#818cf8',
        icon: '↑',
        title: 'CLEAN WORKING TREE',
        detail: 'All changes committed — you can push to remote',
        action: 'push', 
        actionLabel: 'PUSH TO REMOTE',
      };
    }
    return null;
  };

  const recommendation = getRecommendation();

  return (
    <div style={{ 
      height: '100%', display: 'flex', flexDirection: 'column',
      overflow: 'hidden'
    }}>

      {/* ── Smart Recommendation Banner ── */}
      {recommendation && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '16px',
          padding: '10px 20px', background: `${recommendation.color}08`,
          borderBottom: `2px solid ${recommendation.color}25`,
          flexShrink: 0, animation: 'scale-in 0.25s ease',
        }}>
          <span style={{ color: recommendation.color, fontSize: '1rem', animation: 'pulse-live 2s ease infinite' }}>{recommendation.icon}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: 'var(--font-number)', fontSize: '0.65rem', color: recommendation.color, fontWeight: 900, letterSpacing: '0.15em' }}>
              {recommendation.title}
            </div>
            <div style={{ fontFamily: 'var(--font-number)', fontSize: '0.6rem', color: '#666', marginTop: '2px' }}>
              {recommendation.detail}
            </div>
          </div>
          <button
            onClick={() => {
              if (recommendation.action === 'commit') {
                setShowCommitInput(true);
              } else {
                handleCommand(recommendation.action);
              }
            }}
            disabled={gitLoading}
            style={{
              padding: '6px 20px', background: recommendation.color, color: '#000',
              border: 'none', cursor: 'pointer', fontFamily: 'var(--font-number)',
              fontSize: '0.65rem', fontWeight: 900, letterSpacing: '0.1em',
              borderRadius: '2px', opacity: gitLoading ? 0.5 : 1,
              boxShadow: `0 0 15px ${recommendation.color}20`,
            }}
          >
            {recommendation.actionLabel}
          </button>
        </div>
      )}

      {/* ── Inline Commit Input (slides down when committing) ── */}
      {showCommitInput && (
        <div style={{
          padding: '12px 20px', background: '#0d0d0d',
          borderBottom: '2px solid #c1ff7225', flexShrink: 0,
          animation: 'scale-in 0.2s ease',
        }}>
          <div style={{ fontFamily: 'var(--font-number)', fontSize: '0.6rem', color: '#666', letterSpacing: '0.2em', marginBottom: '8px' }}>COMMIT MESSAGE</div>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <span style={{ color: '#c1ff72', fontFamily: 'var(--font-number)', fontSize: '0.8rem' }}>▶</span>
            <input
              type="text"
              value={inlineCommitMsg}
              onChange={e => setInlineCommitMsg(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleInlineCommit(); if (e.key === 'Escape') { setShowCommitInput(false); setInlineCommitMsg(''); } }}
              placeholder="fix: resolve null pointer exception"
              autoFocus
              spellCheck={false}
              style={{
                flex: 1, background: 'transparent', border: 'none', outline: 'none',
                color: '#fff', fontSize: '1rem', fontFamily: 'var(--font-header)',
                fontWeight: 700, borderBottom: '2px solid #222', paddingBottom: '6px',
              }}
            />
            <button
              onClick={handleInlineCommit}
              disabled={gitLoading || !inlineCommitMsg.trim()}
              style={{
                padding: '8px 24px', background: '#c1ff72', color: '#000',
                border: 'none', cursor: 'pointer', fontFamily: 'var(--font-number)',
                fontSize: '0.7rem', fontWeight: 900, borderRadius: '2px',
                opacity: (gitLoading || !inlineCommitMsg.trim()) ? 0.4 : 1,
              }}
            >
              {gitLoading ? '⠿' : '✓'} COMMIT
            </button>
            <button
              onClick={() => { setShowCommitInput(false); setInlineCommitMsg(''); }}
              style={{
                padding: '8px 12px', background: 'transparent', border: 'none',
                color: '#555', cursor: 'pointer', fontFamily: 'var(--font-number)',
                fontSize: '0.7rem', fontWeight: 900,
              }}
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* ── Main Dashboard ── */}
      <div style={{ 
        flex: 1, display: 'flex', flexDirection: isSplit ? 'column' : 'row',
        padding: '10px 0', overflow: 'hidden'
      }}>

      {/* LEFT: Status Dashboard */}
      <div style={{ flex: isSplit ? '0 0 auto' : '0 0 300px', display: 'flex', flexDirection: 'column', padding: '10px', overflow: 'auto' }}>
        
        {/* Connection status */}
        <HudLabel>Repository Status</HudLabel>
        <div style={{ 
          padding: '14px', border: '2px solid #1a1a1a', marginBottom: '20px',
          position: 'relative', background: '#0a0a0a'
        }}>
          <div style={{ position: 'absolute', top: '-1px', left: '-1px', width: '10px', height: '10px', borderTop: '3px solid #c1ff72', borderLeft: '3px solid #c1ff72' }} />
          <div style={{ position: 'absolute', bottom: '-1px', right: '-1px', width: '10px', height: '10px', borderBottom: '3px solid #c1ff72', borderRight: '3px solid #c1ff72' }} />
          
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <StatusDot color="#c1ff72" />
              <span style={{ fontFamily: 'var(--font-number)', fontSize: '0.75rem', color: '#c1ff72', fontWeight: 900, letterSpacing: '0.1em' }}>
                CONNECTED
              </span>
            </div>
            <button
              onClick={handleDisconnect}
              style={{
                padding: '4px 8px', background: 'transparent',
                border: '1px solid #333', color: '#555', cursor: 'pointer',
                fontFamily: 'var(--font-number)', fontSize: '0.55rem', fontWeight: 900,
                letterSpacing: '0.1em', borderRadius: '2px',
                transition: 'all 0.12s ease',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#ff3e3e'; e.currentTarget.style.color = '#ff3e3e'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#333'; e.currentTarget.style.color = '#555'; }}
            >
              DISCONNECT
            </button>
          </div>
          <div style={{ 
            fontFamily: 'var(--font-number)', fontSize: '0.65rem', color: '#555',
            wordBreak: 'break-all', lineHeight: 1.6
          }}>
            {gitRepoUrl || 'Repository URL hidden'}
          </div>
        </div>

        {/* Working tree status */}
        <HudLabel>Working Tree</HudLabel>
        <div style={{ marginBottom: '16px' }}>
          {hasChanges ? (
            actualChanges.slice(0, 8).map((line, i) => {
              const status = line.substring(0, 2).trim();
              const file = line.substring(3).trim();
              const statusColor = status.includes('M') ? '#fbbf24' : status.includes('A') ? '#c1ff72' : status.includes('D') ? '#ff3e3e' : '#818cf8';
              return (
                <div key={i} style={{ 
                  display: 'flex', alignItems: 'center', gap: '10px', padding: '5px 0',
                  fontFamily: 'var(--font-number)', fontSize: '0.7rem'
                }}>
                  <span style={{ color: statusColor, fontWeight: 900, width: '18px', textAlign: 'center' }}>{status}</span>
                  <span style={{ color: '#aaa' }}>{file}</span>
                </div>
              );
            })
          ) : (
            <div style={{ fontFamily: 'var(--font-number)', fontSize: '0.7rem', color: '#444', fontStyle: 'italic' }}>
              Clean — no uncommitted changes
            </div>
          )}
          {statusLines.length > 8 && (
            <div style={{ fontFamily: 'var(--font-number)', fontSize: '0.6rem', color: '#555', marginTop: '4px' }}>
              +{statusLines.length - 8} more files
            </div>
          )}
        </div>

        {/* Quick actions — now includes COMMIT */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: 'auto' }}>
          {/* Commit button — prominent when changes exist */}
          <button
            onClick={() => setShowCommitInput(true)}
            disabled={gitLoading}
            style={{
              padding: '8px 16px',
              background: hasChanges ? '#c1ff72' : 'transparent',
              border: hasChanges ? '1.5px solid #c1ff72' : '1.5px solid #333',
              color: hasChanges ? '#000' : '#888', cursor: 'pointer',
              fontFamily: 'var(--font-number)', fontSize: '0.65rem', fontWeight: 900,
              letterSpacing: '0.1em', textTransform: 'uppercase',
              transition: 'all 0.12s ease', borderRadius: '2px',
              opacity: gitLoading ? 0.4 : 1,
              boxShadow: hasChanges ? '0 0 12px rgba(193,255,114,0.15)' : 'none',
              gridColumn: 'span 2'
            }}
          >
            ✓ COMMIT CHANGES
          </button>
          {['push', 'pull', 'status'].map(cmd => (
            <button
              key={cmd}
              onClick={() => handleCommand(cmd)}
              disabled={gitLoading}
              style={{
                padding: '8px 12px', background: 'transparent',
                border: '1.5px solid #333', color: '#888', cursor: 'pointer',
                fontFamily: 'var(--font-number)', fontSize: '0.65rem', fontWeight: 900,
                letterSpacing: '0.1em', textTransform: 'uppercase',
                transition: 'all 0.12s ease', borderRadius: '2px',
                opacity: gitLoading ? 0.4 : 1,
                gridColumn: cmd === 'status' ? 'span 2' : 'auto'
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#c1ff72'; e.currentTarget.style.color = '#c1ff72'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#333'; e.currentTarget.style.color = '#888'; }}
            >
              {cmd === 'push' ? '↑ PUSH' : cmd === 'pull' ? '↓ PULL' : '⟳ REFRESH STATUS'}
            </button>
          ))}
        </div>
      </div>

      {!isSplit && <PowerLine />}

      {/* CENTER: Command Bar + Output */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '10px', overflow: 'hidden' }}>
        <HudLabel>Command Terminal</HudLabel>
        
        {/* Command input */}
        <div style={{ 
          display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px',
          background: '#0a0a0a', border: '1.5px solid #1a1a1a', marginBottom: '12px'
        }}>
          <span style={{ color: '#c1ff72', fontFamily: 'var(--font-number)', fontSize: '0.85rem', fontWeight: 700 }}>❯</span>
          <input
            type="text"
            value={commandInput}
            onChange={e => setCommandInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCommand()}
            placeholder="commit <msg> / push / pull / status / log"
            spellCheck={false}
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              color: '#fff', fontSize: '1rem', fontFamily: 'var(--font-header)',
              fontWeight: 700
            }}
          />
          {gitLoading && (
            <span style={{ 
              fontFamily: 'var(--font-number)', fontSize: '0.65rem', 
              color: '#c1ff72', animation: 'pulse-live 1s ease infinite' 
            }}>
              ⠿ RUNNING
            </span>
          )}
        </div>

        {/* Error display */}
        {gitError && (
          <div style={{ 
            padding: '10px 14px', background: 'rgba(255,62,62,0.06)',
            border: '1px solid rgba(255,62,62,0.25)', color: '#ff3e3e',
            fontFamily: 'var(--font-number)', fontSize: '0.7rem', fontWeight: 700,
            marginBottom: '12px'
          }}>
            ✕ {gitError}
          </div>
        )}

        {/* Command output */}
        {commandOutput && (
          <div style={{ flex: 1, overflow: 'auto' }}>
            <div style={{ 
              fontFamily: 'var(--font-number)', fontSize: '0.65rem', color: '#555',
              marginBottom: '8px', letterSpacing: '0.15em'
            }}>
              → git {commandOutput.command}
            </div>
            <pre style={{ 
              margin: 0, padding: '14px', background: '#0a0a0a', 
              border: '1px solid #1a1a1a', overflow: 'auto',
              color: '#ccc', fontFamily: 'var(--font-number)', fontSize: '0.75rem',
              lineHeight: 1.7, whiteSpace: 'pre-wrap'
            }}>
              {commandOutput.output}
            </pre>
          </div>
        )}

        {/* Default: show hint when no output */}
        {!commandOutput && !gitError && (
          <div style={{ 
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#333', fontFamily: 'var(--font-number)', fontSize: '0.65rem',
            letterSpacing: '0.2em', textTransform: 'uppercase'
          }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ width: '40px', height: '1px', background: '#222', margin: '0 auto 16px' }} />
              TYPE A COMMAND OR USE QUICK ACTIONS
              <div style={{ width: '40px', height: '1px', background: '#222', margin: '16px auto 0' }} />
            </div>
          </div>
        )}
      </div>

      {!isSplit && <PowerLine />}

      {/* RIGHT: Recent Commits Log */}
      <div style={{ flex: isSplit ? '0 0 auto' : '0 0 260px', display: 'flex', flexDirection: 'column', padding: '10px', overflow: 'auto' }}>
        <HudLabel>Commit History</HudLabel>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {logLines.length > 0 ? (
            logLines.map((line, i) => {
              const hash = line.substring(0, 7);
              const msg = line.substring(8);
              return (
                <div key={i} style={{ 
                  display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '8px 0',
                  borderBottom: '1px solid #111'
                }}>
                  <span style={{ 
                    fontFamily: 'var(--font-number)', fontSize: '0.7rem', color: '#c1ff72',
                    fontWeight: 900, flexShrink: 0, marginTop: '2px'
                  }}>
                    {hash}
                  </span>
                  <span style={{ 
                    fontFamily: 'var(--font-header)', fontSize: '0.85rem', color: '#aaa',
                    fontWeight: 700, lineHeight: 1.4
                  }}>
                    {msg}
                  </span>
                </div>
              );
            })
          ) : (
            <div style={{ 
              fontFamily: 'var(--font-number)', fontSize: '0.65rem', color: '#444',
              fontStyle: 'italic', padding: '20px 0'
            }}>
              No commit history available
            </div>
          )}
        </div>

        <button
          onClick={() => { refreshStatus(); refreshLog(); setCommandOutput(null); }}
          style={{
            marginTop: '12px', padding: '8px', background: 'transparent',
            border: '1.5px solid #222', color: '#555', cursor: 'pointer',
            fontFamily: 'var(--font-number)', fontSize: '0.6rem', fontWeight: 900,
            letterSpacing: '0.1em', borderRadius: '2px',
            transition: 'all 0.12s ease', width: '100%',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = '#555'; e.currentTarget.style.color = '#888'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = '#222'; e.currentTarget.style.color = '#555'; }}
        >
          ⟳ REFRESH
        </button>
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

export default GitAssistantPanel;
