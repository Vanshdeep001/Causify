/* -------------------------------------------------------
 * LinkProjectModal.jsx — Link an existing Vercel project
 *
 * Lets the user push updates to an app that is ALREADY deployed on
 * Vercel. We fetch the account's projects, the user picks one, and we
 * write `.vercel/project.json` into the deploy workspace so the next
 * deploy targets that project instead of creating a new one.
 * ------------------------------------------------------- */

import React, { useState, useEffect, useMemo } from 'react';

const LinkProjectModal = ({ sessionId, onClose, onLinked }) => {
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState([]);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [linkingId, setLinkingId] = useState(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        if (!window.electronAPI?.listVercelProjects) {
          setError('Electron API not available. This feature requires the desktop app.');
          setLoading(false);
          return;
        }
        const res = await window.electronAPI.listVercelProjects();
        if (res?.success) {
          setProjects(res.projects || []);
        } else {
          setError(res?.error || 'Failed to load Vercel projects');
        }
      } catch (err) {
        setError(err.message || 'Failed to load Vercel projects');
      }
      setLoading(false);
    };
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => p.name.toLowerCase().includes(q));
  }, [projects, query]);

  const handleLink = async (project) => {
    setLinkingId(project.id);
    setError(null);
    try {
      const res = await window.electronAPI.linkVercelProject({
        sessionId,
        projectId: project.id,
        orgId: project.accountId,
        projectName: project.name,
      });
      if (res?.success) {
        onLinked?.(project.name);
      } else {
        setError(res?.error || 'Failed to link project');
        setLinkingId(null);
      }
    } catch (err) {
      setError(err.message || 'Failed to link project');
      setLinkingId(null);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') onClose?.();
  };

  return (
    <div
      onKeyDown={handleKeyDown}
      style={{
        position: 'fixed',
        top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        animation: 'fadeIn 0.2s ease-out',
      }}
    >
      <div style={{
        width: '480px',
        maxHeight: '80vh',
        background: 'var(--s1)',
        border: '1px solid var(--line-strong)',
        borderRadius: '6px',
        padding: '28px',
        display: 'flex',
        flexDirection: 'column',
        gap: '18px',
        animation: 'slide-up 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
      }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{
            width: '36px', height: '36px',
            border: '1px solid var(--line-strong)',
            borderRadius: '4px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
          </div>
          <div>
            <h2 style={{
              fontFamily: 'var(--font-header)',
              fontSize: '1.05rem',
              fontWeight: 900,
              letterSpacing: '0.04em',
              margin: 0,
              color: 'var(--t1)',
            }}>
              LINK EXISTING PROJECT
            </h2>
            <div style={{
              fontFamily: 'var(--font-number)',
              fontSize: '0.58rem',
              color: 'var(--t3)',
              marginTop: '2px',
              letterSpacing: '0.06em',
            }}>
              PUSH UPDATES TO AN APP ALREADY ON VERCEL
            </div>
          </div>
        </div>

        {/* Search */}
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your Vercel projects..."
          autoFocus
          style={{
            width: '100%',
            height: '36px',
            background: 'var(--s0)',
            border: '1px solid var(--line-strong)',
            borderRadius: '4px',
            color: 'var(--t1)',
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            fontSize: '0.68rem',
            padding: '0 12px',
            outline: 'none',
            boxSizing: 'border-box',
          }}
          onFocus={e => e.currentTarget.style.borderColor = '#38BDF8'}
          onBlur={e => e.currentTarget.style.borderColor = 'var(--line-strong)'}
        />

        {/* Body */}
        <div style={{
          flex: 1,
          minHeight: '120px',
          maxHeight: '320px',
          overflowY: 'auto',
          border: '1px solid var(--line)',
          borderRadius: '4px',
          background: 'var(--s0)',
        }}>
          {loading ? (
            <div style={{
              height: '120px', display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: '8px',
            }}>
              <span style={{
                width: '12px', height: '12px',
                border: '2px solid rgba(255,255,255,0.2)',
                borderTop: '2px solid #38BDF8',
                borderRadius: '50%',
                animation: 'spin-slow 0.8s linear infinite',
              }} />
              <span style={{
                fontFamily: 'var(--font-number)', fontSize: '0.6rem',
                color: 'var(--t3)', letterSpacing: '0.1em',
              }}>LOADING PROJECTS...</span>
            </div>
          ) : filtered.length === 0 ? (
            <div style={{
              height: '120px', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{
                fontFamily: 'var(--font-number)', fontSize: '0.6rem',
                color: 'var(--t4)', letterSpacing: '0.1em',
              }}>
                {projects.length === 0 ? 'NO PROJECTS FOUND IN THIS ACCOUNT' : 'NO MATCHES'}
              </span>
            </div>
          ) : (
            filtered.map((p) => (
              <button
                key={p.id}
                onClick={() => handleLink(p)}
                disabled={!!linkingId}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '10px',
                  padding: '10px 12px',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: '1px solid var(--line)',
                  cursor: linkingId ? 'default' : 'pointer',
                  textAlign: 'left',
                  transition: 'background 0.15s ease',
                }}
                onMouseEnter={e => { if (!linkingId) e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', overflow: 'hidden' }}>
                  <span style={{
                    fontFamily: "'Space Grotesk', sans-serif",
                    fontSize: '0.74rem', fontWeight: 600, color: 'var(--t1)',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {p.name}
                  </span>
                  {p.framework && (
                    <span style={{
                      fontFamily: 'var(--font-number)', fontSize: '0.52rem',
                      color: 'var(--t4)', letterSpacing: '0.04em', textTransform: 'uppercase',
                    }}>
                      {p.framework}
                    </span>
                  )}
                </div>
                <span style={{
                  fontFamily: 'var(--font-number)', fontSize: '0.55rem',
                  color: linkingId === p.id ? '#38BDF8' : '#4ADE80',
                  letterSpacing: '0.08em', fontWeight: 700, flexShrink: 0,
                }}>
                  {linkingId === p.id ? 'LINKING...' : 'LINK →'}
                </span>
              </button>
            ))
          )}
        </div>

        {/* Error */}
        {error && (
          <div style={{
            fontFamily: 'var(--font-number)',
            fontSize: '0.58rem',
            color: 'var(--crimson)',
            fontWeight: 600,
            letterSpacing: '0.02em',
            wordBreak: 'break-word',
          }}>
            {error}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              height: '34px',
              padding: '0 20px',
              background: 'transparent',
              color: 'var(--t3)',
              border: '1px solid var(--line-strong)',
              borderRadius: '4px',
              fontFamily: 'var(--font-header)',
              fontWeight: 800,
              fontSize: '0.58rem',
              letterSpacing: '0.06em',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--t1)'; e.currentTarget.style.borderColor = 'var(--t2)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--t3)'; e.currentTarget.style.borderColor = 'var(--line-strong)'; }}
          >
            CLOSE
          </button>
        </div>
      </div>
    </div>
  );
};

export default LinkProjectModal;
