/* -------------------------------------------------------
 * LinkServiceModal.jsx — Link an existing Render service
 *
 * Lets the user deploy to a backend that is ALREADY on Render.
 * We fetch the account's services, the user picks one, and the
 * link is stored per session so every deploy targets that service.
 * ------------------------------------------------------- */

import React, { useState, useEffect, useMemo } from 'react';

const RENDER_MINT = '#46E3B7';

const SERVICE_TYPE_LABELS = {
  web_service: 'WEB SERVICE',
  private_service: 'PRIVATE SERVICE',
  background_worker: 'BACKGROUND WORKER',
  static_site: 'STATIC SITE',
  cron_job: 'CRON JOB',
};

const LinkServiceModal = ({ sessionId, onClose, onLinked }) => {
  const [loading, setLoading] = useState(true);
  const [services, setServices] = useState([]);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [linkingId, setLinkingId] = useState(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        if (!window.electronAPI?.listRenderServices) {
          setError('Electron API not available. This feature requires the desktop app.');
          setLoading(false);
          return;
        }
        const res = await window.electronAPI.listRenderServices();
        if (res?.success) {
          setServices(res.services || []);
        } else {
          setError(res?.error || 'Failed to load Render services');
        }
      } catch (err) {
        setError(err.message || 'Failed to load Render services');
      }
      setLoading(false);
    };
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return services;
    return services.filter((s) => s.name.toLowerCase().includes(q));
  }, [services, query]);

  const handleLink = async (service) => {
    // Render links are stored per session, so a link needs an active session.
    // Catch it here with a clear instruction instead of leaking the internal
    // "sessionId is required" error from the main process.
    if (!sessionId) {
      setError('No active session. Start or join a session first (top-left → New Session), then link — Render links are saved per session.');
      return;
    }
    setLinkingId(service.id);
    setError(null);
    try {
      const res = await window.electronAPI.linkRenderService({
        sessionId,
        serviceId: service.id,
        serviceName: service.name,
        serviceUrl: service.url,
        serviceType: service.type,
      });
      if (res?.success) {
        onLinked?.(service.name, service.url);
      } else {
        setError(res?.error || 'Failed to link service');
        setLinkingId(null);
      }
    } catch (err) {
      setError(err.message || 'Failed to link service');
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
              LINK EXISTING SERVICE
            </h2>
            <div style={{
              fontFamily: 'var(--font-number)',
              fontSize: '0.58rem',
              color: 'var(--t3)',
              marginTop: '2px',
              letterSpacing: '0.06em',
            }}>
              DEPLOY UPDATES TO A BACKEND ALREADY ON RENDER
            </div>
          </div>
        </div>

        {/* Search */}
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your Render services..."
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
          onFocus={e => e.currentTarget.style.borderColor = RENDER_MINT}
          onBlur={e => e.currentTarget.style.borderColor = 'var(--line-strong)'}
        />

        {/* No-session notice — linking needs an active session to attach to. */}
        {!sessionId && (
          <div style={{
            fontFamily: "'Space Grotesk', sans-serif",
            fontSize: '0.6rem',
            lineHeight: 1.6,
            color: '#FFB224',
            letterSpacing: '0.01em',
            padding: '9px 12px',
            background: 'rgba(255, 178, 36, 0.05)',
            border: '1px solid rgba(255, 178, 36, 0.25)',
            borderRadius: '4px',
          }}>
            No active session — start or join one first (top-left → New Session).
            Render links are saved per session, so you can browse below but can't
            link until a session exists.
          </div>
        )}

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
                borderTop: `2px solid ${RENDER_MINT}`,
                borderRadius: '50%',
                animation: 'spin-slow 0.8s linear infinite',
              }} />
              <span style={{
                fontFamily: 'var(--font-number)', fontSize: '0.6rem',
                color: 'var(--t3)', letterSpacing: '0.1em',
              }}>LOADING SERVICES...</span>
            </div>
          ) : filtered.length === 0 ? (
            <div style={{
              height: '120px', display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: '0 20px', textAlign: 'center',
            }}>
              <span style={{
                fontFamily: 'var(--font-number)', fontSize: '0.6rem',
                color: 'var(--t4)', letterSpacing: '0.1em', lineHeight: 1.6,
              }}>
                {services.length === 0
                  ? 'NO SERVICES FOUND — CREATE ONE FROM YOUR GITHUB REPO INSTEAD'
                  : 'NO MATCHES'}
              </span>
            </div>
          ) : (
            filtered.map((s) => (
              <button
                key={s.id}
                onClick={() => handleLink(s)}
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
                    {s.name}
                    {s.suspended && (
                      <span style={{ color: '#FFB224', fontSize: '0.55rem', marginLeft: '8px' }}>
                        SUSPENDED
                      </span>
                    )}
                  </span>
                  <span style={{
                    fontFamily: 'var(--font-number)', fontSize: '0.52rem',
                    color: 'var(--t4)', letterSpacing: '0.04em', textTransform: 'uppercase',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {SERVICE_TYPE_LABELS[s.type] || s.type}
                    {s.runtime ? ` · ${s.runtime}` : ''}
                    {s.branch ? ` · ${s.branch}` : ''}
                  </span>
                </div>
                <span style={{
                  fontFamily: 'var(--font-number)', fontSize: '0.55rem',
                  color: linkingId === s.id ? RENDER_MINT : '#4ADE80',
                  letterSpacing: '0.08em', fontWeight: 700, flexShrink: 0,
                }}>
                  {linkingId === s.id ? 'LINKING...' : 'LINK →'}
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

export default LinkServiceModal;
