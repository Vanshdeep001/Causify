/* -------------------------------------------------------
 * EnvConfirmModal.jsx — Environment Variable Confirmation
 *
 * Shows detected env variables before pushing to Vercel.
 * Each variable can be individually toggled on/off.
 * Values are masked by default with reveal toggle.
 * ------------------------------------------------------- */

import React, { useState, useMemo } from 'react';

/* ── Env Prefix Tags ── */
const CLIENT_PREFIXES = {
  'VITE_':        { label: 'VITE',      color: '#BD34FE' },
  'NEXT_PUBLIC_': { label: 'NEXT',      color: '#FFFFFF' },
  'REACT_APP_':   { label: 'CRA',       color: '#61DAFB' },
};

function getClientTag(key) {
  for (const [prefix, tag] of Object.entries(CLIENT_PREFIXES)) {
    if (key.startsWith(prefix)) return tag;
  }
  return null;
}

const EnvConfirmModal = ({ envVars = [], onConfirm, onSkip, onCancel }) => {
  // State: which vars are checked (all checked by default)
  const [checked, setChecked] = useState(() => {
    const map = {};
    envVars.forEach((v, i) => { map[i] = true; });
    return map;
  });

  // State: which vars have revealed values
  const [revealed, setRevealed] = useState({});

  const toggleCheck = (idx) => {
    setChecked(prev => ({ ...prev, [idx]: !prev[idx] }));
  };

  const toggleReveal = (idx) => {
    setRevealed(prev => ({ ...prev, [idx]: !prev[idx] }));
  };

  const toggleAll = () => {
    const allChecked = Object.values(checked).every(v => v);
    const map = {};
    envVars.forEach((_, i) => { map[i] = !allChecked; });
    setChecked(map);
  };

  const selectedVars = envVars.filter((_, i) => checked[i]);
  const selectedCount = selectedVars.length;

  // Group by source file
  const grouped = useMemo(() => {
    const groups = {};
    envVars.forEach((v, i) => {
      if (!groups[v.source]) groups[v.source] = [];
      groups[v.source].push({ ...v, idx: i });
    });
    return groups;
  }, [envVars]);

  return (
    <div style={{
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
    }}>
      <div style={{
        width: '560px',
        maxHeight: '80vh',
        background: 'var(--s1)',
        border: '1px solid var(--line-strong)',
        borderRadius: '6px',
        display: 'flex',
        flexDirection: 'column',
        animation: 'slide-up 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
      }}>

        {/* Header */}
        <div style={{
          padding: '24px 28px 16px',
          borderBottom: '1px solid var(--line)',
        }}>
          <h2 style={{
            fontFamily: 'var(--font-header)',
            fontSize: '0.95rem',
            fontWeight: 900,
            letterSpacing: '0.04em',
            margin: 0,
            color: 'var(--t1)',
          }}>
            ENVIRONMENT VARIABLES
          </h2>
          <div style={{
            fontFamily: 'var(--font-number)',
            fontSize: '0.56rem',
            color: 'var(--t3)',
            marginTop: '6px',
            letterSpacing: '0.04em',
            lineHeight: 1.5,
          }}>
            These {envVars.length} variables will be uploaded to your Vercel project's <span style={{ color: '#38BDF8', fontWeight: 700 }}>production</span> environment before the build starts.
            Uncheck any variable you don't want uploaded.
          </div>
        </div>

        {/* Variable List */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '12px 28px',
        }}>
          {Object.entries(grouped).map(([source, vars]) => (
            <div key={source} style={{ marginBottom: '16px' }}>
              {/* Source file label */}
              <div style={{
                fontFamily: 'var(--font-number)',
                fontSize: '0.5rem',
                color: 'var(--t4)',
                letterSpacing: '0.1em',
                fontWeight: 700,
                marginBottom: '8px',
                textTransform: 'uppercase',
              }}>
                {source}
              </div>

              {/* Variables */}
              {vars.map(({ key, value, idx }) => {
                const clientTag = getClientTag(key);
                const isChecked = checked[idx];
                const isRevealed = revealed[idx];

                return (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '6px 0',
                      borderBottom: '1px solid rgba(255, 255, 255, 0.03)',
                      opacity: isChecked ? 1 : 0.4,
                      transition: 'opacity 0.15s ease',
                    }}
                  >
                    {/* Checkbox */}
                    <button
                      onClick={() => toggleCheck(idx)}
                      style={{
                        width: '16px', height: '16px',
                        borderRadius: '3px',
                        border: `1px solid ${isChecked ? '#38BDF8' : 'var(--line-strong)'}`,
                        background: isChecked ? 'rgba(56, 189, 248, 0.15)' : 'transparent',
                        color: isChecked ? '#38BDF8' : 'transparent',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        transition: 'all 0.15s ease',
                        padding: 0,
                      }}
                    >
                      {isChecked && (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </button>

                    {/* Key name */}
                    <span style={{
                      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                      fontSize: '0.64rem',
                      color: isChecked ? '#FFFFFF' : 'var(--t3)',
                      fontWeight: 600,
                      minWidth: '140px',
                      letterSpacing: '0.02em',
                    }}>
                      {key}
                    </span>

                    {/* Client-exposed tag */}
                    {clientTag && (
                      <span style={{
                        fontFamily: 'var(--font-header)',
                        fontSize: '0.44rem',
                        fontWeight: 900,
                        color: clientTag.color,
                        background: `${clientTag.color}15`,
                        border: `1px solid ${clientTag.color}30`,
                        padding: '1px 5px',
                        borderRadius: '2px',
                        letterSpacing: '0.06em',
                        flexShrink: 0,
                      }}>
                        {clientTag.label}
                      </span>
                    )}

                    {/* Value (masked) */}
                    <span style={{
                      flex: 1,
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: '0.58rem',
                      color: 'var(--t4)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {isRevealed ? value : '••••••••••'}
                    </span>

                    {/* Reveal toggle */}
                    <button
                      onClick={() => toggleReveal(idx)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'var(--t4)',
                        padding: '2px',
                        flexShrink: 0,
                        display: 'flex',
                        alignItems: 'center',
                      }}
                      title={isRevealed ? 'Hide value' : 'Reveal value'}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        {isRevealed ? (
                          <>
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                            <circle cx="12" cy="12" r="3" />
                          </>
                        ) : (
                          <>
                            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8" />
                            <line x1="1" y1="1" x2="23" y2="23" />
                          </>
                        )}
                      </svg>
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{
          padding: '16px 28px',
          borderTop: '1px solid var(--line)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button
              onClick={toggleAll}
              style={{
                fontFamily: 'var(--font-number)',
                fontSize: '0.52rem',
                color: 'var(--t3)',
                background: 'transparent',
                border: '1px solid var(--line)',
                borderRadius: '3px',
                padding: '3px 8px',
                cursor: 'pointer',
                letterSpacing: '0.04em',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--t1)'; e.currentTarget.style.borderColor = 'var(--line-strong)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--t3)'; e.currentTarget.style.borderColor = 'var(--line)'; }}
            >
              {Object.values(checked).every(v => v) ? 'UNCHECK ALL' : 'CHECK ALL'}
            </button>
            <span style={{
              fontFamily: 'var(--font-number)',
              fontSize: '0.52rem',
              color: 'var(--t4)',
              letterSpacing: '0.04em',
            }}>
              {selectedCount} of {envVars.length} selected
            </span>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={onCancel}
              style={{
                height: '32px', padding: '0 16px',
                background: 'transparent',
                color: 'var(--t3)',
                border: '1px solid var(--line-strong)',
                borderRadius: '4px',
                fontFamily: 'var(--font-header)',
                fontWeight: 800,
                fontSize: '0.54rem',
                letterSpacing: '0.06em',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--t1)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--t3)'; }}
            >
              CANCEL
            </button>
            <button
              onClick={() => onSkip?.()}
              style={{
                height: '32px', padding: '0 16px',
                background: 'transparent',
                color: 'var(--t2)',
                border: '1px solid var(--line-strong)',
                borderRadius: '4px',
                fontFamily: 'var(--font-header)',
                fontWeight: 800,
                fontSize: '0.54rem',
                letterSpacing: '0.06em',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--t1)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--t2)'; }}
            >
              SKIP & DEPLOY
            </button>
            <button
              onClick={() => onConfirm?.(selectedVars)}
              disabled={selectedCount === 0}
              style={{
                height: '32px', padding: '0 20px',
                background: selectedCount > 0
                  ? 'linear-gradient(135deg, #00A2FF 0%, #0066FF 100%)'
                  : 'rgba(0, 162, 255, 0.15)',
                color: '#FFFFFF',
                border: 'none',
                borderRadius: '4px',
                fontFamily: 'var(--font-header)',
                fontWeight: 800,
                fontSize: '0.54rem',
                letterSpacing: '0.06em',
                cursor: selectedCount > 0 ? 'pointer' : 'default',
                transition: 'all 0.2s ease',
                boxShadow: selectedCount > 0 ? '0 3px 10px rgba(0, 162, 255, 0.25)' : 'none',
              }}
            >
              UPLOAD & DEPLOY
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EnvConfirmModal;
