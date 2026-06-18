/* -------------------------------------------------------
 * CodeShotModal.jsx — CodeShot Preview & Actions Modal
 *
 * Displays a preview of the captured CodeShot card and
 * provides actions: Copy Image, Save as PNG, Copy Share Link.
 *
 * Reads `codeShotModal` from the Zustand store.
 * ------------------------------------------------------- */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import useEditorStore from '../../store/useEditorStore';
import CodeShotCard from './CodeShotCard';
import { renderCodeShot } from '../../utils/codeShotRenderer';
import { buildCodeShotLink } from '../../utils/codeShotDeepLink';

const CodeShotModal = () => {
  const codeShotModal = useEditorStore((s) => s.codeShotModal);
  const closeCodeShotModal = useEditorStore((s) => s.closeCodeShotModal);
  const sessionId = useEditorStore((s) => s.sessionId);

  const [copyImageStatus, setCopyImageStatus] = useState('idle'); // 'idle' | 'copying' | 'done'
  const [copyLinkStatus, setCopyLinkStatus] = useState('idle');
  const [saveStatus, setSaveStatus] = useState('idle');
  const backdropRef = useRef(null);

  // Close on Escape key
  useEffect(() => {
    if (!codeShotModal) return;

    const handleKey = (e) => {
      if (e.key === 'Escape') closeCodeShotModal();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [codeShotModal, closeCodeShotModal]);

  // Reset statuses when modal opens
  useEffect(() => {
    if (codeShotModal) {
      setCopyImageStatus('idle');
      setCopyLinkStatus('idle');
      setSaveStatus('idle');
    }
  }, [codeShotModal]);

  /* ── Copy Image to Clipboard ── */
  const handleCopyImage = useCallback(async () => {
    if (!codeShotModal || copyImageStatus === 'copying') return;
    setCopyImageStatus('copying');

    try {
      const { blob, dataUrl } = await renderCodeShot(codeShotModal);

      // Try Electron native clipboard first (most reliable)
      if (window.electronAPI?.writeImageToClipboard) {
        const result = await window.electronAPI.writeImageToClipboard(dataUrl);
        if (result?.success) {
          setCopyImageStatus('done');
          setTimeout(() => setCopyImageStatus('idle'), 2000);
          return;
        }
      }

      // Fallback: Web Clipboard API
      if (blob && navigator.clipboard?.write) {
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': blob }),
        ]);
        setCopyImageStatus('done');
        setTimeout(() => setCopyImageStatus('idle'), 2000);
        return;
      }

      console.warn('[CodeShot] No clipboard API available');
      setCopyImageStatus('idle');
    } catch (err) {
      console.error('[CodeShot] Copy Image failed:', err);
      setCopyImageStatus('idle');
    }
  }, [codeShotModal, copyImageStatus]);

  /* ── Save as PNG ── */
  const handleSavePng = useCallback(async () => {
    if (!codeShotModal || saveStatus === 'copying') return;
    setSaveStatus('copying');

    try {
      const { dataUrl } = await renderCodeShot(codeShotModal);

      // Try Electron save dialog first
      if (window.electronAPI?.saveFile) {
        const defaultName = `codeshot-${codeShotModal.filePath.split('/').pop()}-L${codeShotModal.startLine}.png`;
        // Convert data URL to base64 content for Electron
        const base64 = dataUrl.split(',')[1];
        const result = await window.electronAPI.saveFile(
          base64,
          defaultName,
          [{ name: 'PNG Images', extensions: ['png'] }]
        );
        if (result) {
          setSaveStatus('done');
          setTimeout(() => setSaveStatus('idle'), 2000);
          return;
        }
      }

      // Fallback: Browser download
      const link = document.createElement('a');
      link.download = `codeshot-${codeShotModal.filePath.split('/').pop()}-L${codeShotModal.startLine}.png`;
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setSaveStatus('done');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (err) {
      console.error('[CodeShot] Save PNG failed:', err);
      setSaveStatus('idle');
    }
  }, [codeShotModal, saveStatus]);

  /* ── Copy Share Link ── */
  const handleCopyLink = useCallback(async () => {
    if (!codeShotModal || copyLinkStatus === 'copying') return;
    setCopyLinkStatus('copying');

    try {
      const link = buildCodeShotLink({
        projectId: sessionId || 'local',
        filePath: codeShotModal.filePath,
        startLine: codeShotModal.startLine,
        endLine: codeShotModal.endLine,
        // nodeId is left optional for v1
      });

      await navigator.clipboard.writeText(link);
      setCopyLinkStatus('done');
      setTimeout(() => setCopyLinkStatus('idle'), 2000);
    } catch (err) {
      console.error('[CodeShot] Copy Link failed:', err);
      setCopyLinkStatus('idle');
    }
  }, [codeShotModal, sessionId, copyLinkStatus]);

  /* ── Click backdrop to close ── */
  const handleBackdropClick = useCallback((e) => {
    if (e.target === backdropRef.current) {
      closeCodeShotModal();
    }
  }, [closeCodeShotModal]);

  if (!codeShotModal) return null;

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        animation: 'fadeIn 0.2s ease-out',
        padding: '24px',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '20px',
          maxWidth: '780px',
          width: '100%',
          maxHeight: '90vh',
          overflow: 'auto',
          animation: 'slideUp 0.25s ease-out',
        }}
      >
        {/* ── Modal Header ── */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '28px',
              height: '28px',
              borderRadius: '6px',
              background: 'linear-gradient(135deg, rgba(199,255,94,0.15), rgba(199,255,94,0.05))',
              border: '1px solid rgba(199,255,94,0.25)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#C7FF5E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
            </div>
            <div>
              <div style={{
                fontFamily: "'Space Grotesk', sans-serif",
                fontWeight: 700,
                fontSize: '14px',
                color: '#EDEDED',
                letterSpacing: '0.02em',
              }}>
                CodeShot Preview
              </div>
              <div style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '10px',
                color: '#6E6E6E',
                letterSpacing: '0.04em',
                marginTop: '1px',
              }}>
                {codeShotModal.filePath} · L{codeShotModal.startLine}–L{codeShotModal.endLine}
              </div>
            </div>
          </div>

          {/* Close button */}
          <button
            onClick={closeCodeShotModal}
            style={{
              width: '28px',
              height: '28px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'transparent',
              border: '1px solid #2E2E2E',
              borderRadius: '6px',
              color: '#6E6E6E',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = '#EDEDED'; e.currentTarget.style.borderColor = '#4A4A4A'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = '#6E6E6E'; e.currentTarget.style.borderColor = '#2E2E2E'; }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* ── Card Preview ── */}
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          padding: '8px',
          background: 'rgba(255,255,255,0.02)',
          borderRadius: '16px',
          border: '1px solid #1E1E1E',
        }}>
          <CodeShotCard
            code={codeShotModal.code}
            language={codeShotModal.language}
            filePath={codeShotModal.filePath}
            startLine={codeShotModal.startLine}
            endLine={codeShotModal.endLine}
            branch={codeShotModal.branch}
            timestamp={codeShotModal.timestamp}
          />
        </div>

        {/* ── Action Buttons ── */}
        <div style={{
          display: 'flex',
          gap: '10px',
          justifyContent: 'center',
          flexWrap: 'wrap',
        }}>
          {/* Copy Image */}
          <ActionButton
            icon={
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            }
            label={copyImageStatus === 'done' ? 'Copied ✓' : copyImageStatus === 'copying' ? 'Copying…' : 'Copy Image'}
            onClick={handleCopyImage}
            variant={copyImageStatus === 'done' ? 'success' : 'default'}
          />

          {/* Save as PNG */}
          <ActionButton
            icon={
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            }
            label={saveStatus === 'done' ? 'Saved ✓' : saveStatus === 'copying' ? 'Saving…' : 'Save as PNG'}
            onClick={handleSavePng}
            variant={saveStatus === 'done' ? 'success' : 'default'}
          />

          {/* Copy Share Link */}
          <ActionButton
            icon={
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
            }
            label={copyLinkStatus === 'done' ? 'Copied ✓' : copyLinkStatus === 'copying' ? 'Copying…' : 'Copy Share Link'}
            onClick={handleCopyLink}
            variant={copyLinkStatus === 'done' ? 'success' : 'accent'}
          />
        </div>
      </div>

      {/* Inline animations */}
      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
};

/* ── Shared Action Button ── */
const ActionButton = ({ icon, label, onClick, variant = 'default' }) => {
  const getColors = () => {
    switch (variant) {
      case 'success':
        return {
          bg: 'rgba(61, 214, 140, 0.1)',
          border: 'rgba(61, 214, 140, 0.3)',
          color: '#3DD68C',
          hoverBorder: 'rgba(61, 214, 140, 0.5)',
        };
      case 'accent':
        return {
          bg: 'rgba(199, 255, 94, 0.08)',
          border: 'rgba(199, 255, 94, 0.25)',
          color: '#C7FF5E',
          hoverBorder: 'rgba(199, 255, 94, 0.45)',
        };
      default:
        return {
          bg: 'rgba(255, 255, 255, 0.04)',
          border: '#2E2E2E',
          color: '#A0A0A0',
          hoverBorder: '#4A4A4A',
        };
    }
  };

  const colors = getColors();

  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '0 16px',
        height: '34px',
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        borderRadius: '8px',
        color: colors.color,
        cursor: 'pointer',
        fontFamily: "'Space Grotesk', sans-serif",
        fontSize: '12px',
        fontWeight: 600,
        letterSpacing: '0.02em',
        transition: 'all 0.15s ease',
        whiteSpace: 'nowrap',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = colors.hoverBorder;
        e.currentTarget.style.color = '#EDEDED';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = colors.border;
        e.currentTarget.style.color = colors.color;
      }}
    >
      {icon}
      {label}
    </button>
  );
};

export default CodeShotModal;
