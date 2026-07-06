/* -------------------------------------------------------
 * ConnectRenderModal.jsx — Render API Key Setup Modal
 *
 * Backend counterpart of ConnectVercelModal. The user pastes a
 * Render API key, which is validated against the Render API and
 * securely stored in the OS keychain.
 * ------------------------------------------------------- */

import React, { useState } from 'react';
import useEditorStore from '../../store/useEditorStore';

const RENDER_MINT = '#46E3B7';

const ConnectRenderModal = ({ onClose, onConnected }) => {
  const [apiKey, setApiKey] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [error, setError] = useState(null);
  const [showKey, setShowKey] = useState(false);
  const [success, setSuccess] = useState(null);

  const setRenderConnected = useEditorStore((s) => s.setRenderConnected);

  const handleValidate = async () => {
    if (!apiKey.trim()) {
      setError('Please paste your Render API key.');
      return;
    }

    setIsValidating(true);
    setError(null);

    try {
      if (!window.electronAPI?.validateRenderApiKey) {
        setError('Electron API not available. This feature requires the desktop app.');
        setIsValidating(false);
        return;
      }

      const result = await window.electronAPI.validateRenderApiKey(apiKey.trim());

      if (result.valid) {
        await window.electronAPI.setRenderApiKey(apiKey.trim());
        setRenderConnected(true, result.name);
        setSuccess(result.name);

        setTimeout(() => {
          onConnected?.(result.name);
          onClose?.();
        }, 1500);
      } else {
        setError(result.error || 'Invalid API key — check that it has not been revoked.');
      }
    } catch (err) {
      setError(err.message || 'Validation failed');
    }

    setIsValidating(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !isValidating) handleValidate();
    if (e.key === 'Escape') onClose?.();
  };

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
        width: '460px',
        background: 'var(--s1)',
        border: '1px solid var(--line-strong)',
        borderRadius: '6px',
        padding: '32px',
        display: 'flex',
        flexDirection: 'column',
        gap: '24px',
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
            {/* Server stack icon */}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={RENDER_MINT} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="2" width="20" height="8" rx="2" />
              <rect x="2" y="14" width="20" height="8" rx="2" />
              <line x1="6" y1="6" x2="6.01" y2="6" />
              <line x1="6" y1="18" x2="6.01" y2="18" />
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
              CONNECT RENDER
            </h2>
            <div style={{
              fontFamily: 'var(--font-number)',
              fontSize: '0.58rem',
              color: 'var(--t3)',
              marginTop: '2px',
              letterSpacing: '0.06em',
            }}>
              LINK YOUR ACCOUNT FOR ONE-CLICK BACKEND DEPLOYS
            </div>
          </div>
        </div>

        {/* Instructions */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          padding: '14px 16px',
          background: 'rgba(255, 255, 255, 0.02)',
          borderRadius: '4px',
          border: '1px solid var(--line)',
        }}>
          <div style={{
            fontFamily: 'var(--font-number)',
            fontSize: '0.6rem',
            color: 'var(--t2)',
            lineHeight: 1.6,
            letterSpacing: '0.02em',
          }}>
            Create an <span style={{ color: '#FFFFFF', fontWeight: 700 }}>API Key</span> from your Render Dashboard (Account Settings → API Keys):
          </div>
          <a
            href="https://dashboard.render.com/u/settings#api-keys"
            target="_blank"
            rel="noreferrer"
            style={{
              fontFamily: 'var(--font-number)',
              fontSize: '0.6rem',
              color: RENDER_MINT,
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              borderBottom: '1px solid rgba(70, 227, 183, 0.3)',
              paddingBottom: '2px',
              alignSelf: 'flex-start',
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = '#FFFFFF'; e.currentTarget.style.borderBottomColor = '#FFFFFF'; }}
            onMouseLeave={e => { e.currentTarget.style.color = RENDER_MINT; e.currentTarget.style.borderBottomColor = 'rgba(70, 227, 183, 0.3)'; }}
          >
            dashboard.render.com/u/settings
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </a>
          <div style={{
            fontFamily: 'var(--font-number)',
            fontSize: '0.52rem',
            color: 'var(--t4)',
            letterSpacing: '0.04em',
            marginTop: '4px',
          }}>
            YOUR KEY IS ENCRYPTED AND STORED IN THE OS KEYCHAIN. IT NEVER LEAVES THIS DEVICE.
          </div>
        </div>

        {/* Key Input */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <label style={{
            fontFamily: 'var(--font-number)',
            fontSize: '0.56rem',
            color: 'var(--t3)',
            letterSpacing: '0.08em',
            fontWeight: 700,
          }}>
            API KEY
          </label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <div style={{ flex: 1, position: 'relative' }}>
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => { setApiKey(e.target.value); setError(null); }}
                onKeyDown={handleKeyDown}
                placeholder="Paste your Render API key (rnd_...)"
                autoFocus
                style={{
                  width: '100%',
                  height: '36px',
                  background: 'var(--s0)',
                  border: `1px solid ${error ? 'var(--crimson)' : 'var(--line-strong)'}`,
                  borderRadius: '4px',
                  color: 'var(--t1)',
                  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                  fontSize: '0.68rem',
                  padding: '0 36px 0 12px',
                  outline: 'none',
                  letterSpacing: '0.02em',
                  transition: 'border-color 0.2s ease',
                  boxSizing: 'border-box',
                }}
                onFocus={e => e.currentTarget.style.borderColor = RENDER_MINT}
                onBlur={e => e.currentTarget.style.borderColor = error ? 'var(--crimson)' : 'var(--line-strong)'}
              />
              {/* Eye toggle */}
              <button
                onClick={() => setShowKey(!showKey)}
                style={{
                  position: 'absolute',
                  right: '8px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--t4)',
                  padding: '2px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                title={showKey ? 'Hide key' : 'Show key'}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  {showKey ? (
                    <>
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </>
                  ) : (
                    <>
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </>
                  )}
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div style={{
            fontFamily: 'var(--font-number)',
            fontSize: '0.58rem',
            color: 'var(--crimson)',
            fontWeight: 600,
            letterSpacing: '0.02em',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
            {error}
          </div>
        )}

        {/* Success Message */}
        {success && (
          <div style={{
            fontFamily: 'var(--font-number)',
            fontSize: '0.62rem',
            color: '#4ADE80',
            fontWeight: 700,
            letterSpacing: '0.04em',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 14px',
            background: 'rgba(74, 222, 128, 0.06)',
            border: '1px solid rgba(74, 222, 128, 0.2)',
            borderRadius: '4px',
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Connected as <span style={{ color: '#FFFFFF' }}>{success}</span>
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
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
            CANCEL
          </button>
          <button
            onClick={handleValidate}
            disabled={isValidating || !apiKey.trim() || !!success}
            style={{
              height: '34px',
              padding: '0 24px',
              background: isValidating ? 'rgba(70, 227, 183, 0.15)' : `linear-gradient(135deg, ${RENDER_MINT} 0%, #1BA57B 100%)`,
              color: '#06251C',
              border: 'none',
              borderRadius: '4px',
              fontFamily: 'var(--font-header)',
              fontWeight: 800,
              fontSize: '0.58rem',
              letterSpacing: '0.06em',
              cursor: isValidating || !apiKey.trim() ? 'default' : 'pointer',
              transition: 'all 0.2s ease',
              opacity: !apiKey.trim() ? 0.4 : 1,
              boxShadow: apiKey.trim() && !isValidating ? '0 4px 12px rgba(70, 227, 183, 0.25)' : 'none',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            {isValidating ? (
              <>
                <span style={{
                  width: '10px', height: '10px',
                  border: '2px solid rgba(6,37,28,0.3)',
                  borderTop: '2px solid #06251C',
                  borderRadius: '50%',
                  animation: 'spin-slow 0.8s linear infinite',
                }} />
                VALIDATING...
              </>
            ) : (
              'CONNECT'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConnectRenderModal;
