/* -------------------------------------------------------
 * ScreenCapture.jsx — Screen Recording
 *
 * A single Record control in the toolbar. Instead of the
 * browser's "choose what to share" picker, clicking Record
 * opens a small in-app menu asking WHAT to record:
 *
 *   • Whole Editor      → the entire editor tile
 *   • Code Editor Only  → just the Monaco code area
 *
 * Recording captures the current tab via getDisplayMedia and
 * crops it to the chosen region using the Region Capture API
 * (CropTarget.fromElement + track.cropTo). When cropping isn't
 * available the full captured surface is recorded instead.
 *
 * Output is saved as a .webm (native dialog in Electron,
 * <a download> in a plain browser).
 * ------------------------------------------------------- */

import React, { useState, useRef, useCallback, useEffect } from 'react';

const fmtTime = (s) =>
  `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

const timestamp = () =>
  new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

// Regions the user can choose to record (see ids set in EditorPage.jsx)
const REGIONS = {
  editor: { id: 'causify-editor-region', label: 'Whole Editor', sub: 'Toolbar, panels & code' },
  code: { id: 'causify-code-region', label: 'Code Editor Only', sub: 'Just the code area' },
};

const ScreenCapture = () => {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [starting, setStarting] = useState(false);

  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const wrapRef = useRef(null);

  /* ── Cleanup on unmount ── */
  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
  }, []);

  /* ── Close the menu on outside click / Escape ── */
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setMenuOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  /* ── Save a Blob to disk (Electron dialog or browser download) ── */
  const saveBlob = useCallback(async (blob, defaultName, filters) => {
    if (window.electronAPI?.saveBinaryFile) {
      const buf = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      const CHUNK = 0x8000;
      for (let i = 0; i < buf.length; i += CHUNK) {
        binary += String.fromCharCode.apply(null, buf.subarray(i, i + CHUNK));
      }
      const base64 = btoa(binary);
      return window.electronAPI.saveBinaryFile(base64, defaultName, filters);
    }

    // Browser fallback
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = defaultName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { fileName: defaultName };
  }, []);

  /* ── Start recording a chosen region ── */
  const startRecording = useCallback(async (regionKey) => {
    if (recording || starting) return;
    setMenuOpen(false);
    setStarting(true);

    try {
      const region = REGIONS[regionKey];
      const target = document.getElementById(region.id);

      // Capture the current tab so Region Capture can crop it.
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: false,
        preferCurrentTab: true, // Chrome: pre-selects this tab (ignored elsewhere)
      });
      streamRef.current = stream;
      const [videoTrack] = stream.getVideoTracks();

      // Crop to the chosen element when the Region Capture API is available.
      try {
        if (target && window.CropTarget?.fromElement && videoTrack.cropTo) {
          const cropTarget = await window.CropTarget.fromElement(target);
          await videoTrack.cropTo(cropTarget);
        }
      } catch (cropErr) {
        console.warn('[Capture] Region crop unavailable, recording full surface:', cropErr);
      }

      const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
        .find((t) => MediaRecorder.isTypeSupported(t)) || 'video/webm';

      const rec = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];

      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };

      rec.onstop = async () => {
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        const blob = new Blob(chunksRef.current, { type: mime });
        chunksRef.current = [];
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
        }
        setRecording(false);
        setElapsed(0);

        if (blob.size > 0) {
          await saveBlob(blob, `causify-${regionKey}-${timestamp()}.webm`, [
            { name: 'WebM Video', extensions: ['webm'] },
          ]);
        }
      };

      // Stop if the user ends sharing from the OS/browser overlay
      videoTrack.addEventListener('ended', () => {
        if (rec.state !== 'inactive') rec.stop();
      });

      rec.start();
      recorderRef.current = rec;
      setRecording(true);
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    } catch (err) {
      console.error('[Capture] Start recording failed:', err);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      setRecording(false);
    } finally {
      setStarting(false);
    }
  }, [recording, starting, saveBlob]);

  /* ── Stop recording ── */
  const stopRecording = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
  }, []);

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
      {!recording ? (
        <button
          onClick={() => setMenuOpen((o) => !o)}
          disabled={starting}
          title="Record the screen"
          style={{
            width: '28px',
            height: '28px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: menuOpen ? 'rgba(255,255,255,0.05)' : 'transparent',
            border: 'none',
            borderRadius: '6px',
            cursor: starting ? 'wait' : 'pointer',
            padding: 0,
            color: menuOpen ? 'var(--crimson)' : 'var(--t3)',
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--crimson)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = menuOpen ? 'var(--crimson)' : 'var(--t3)'; }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="12" cy="12" r="9" />
            <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
          </svg>
        </button>
      ) : (
        <button
          onClick={stopRecording}
          title="Stop recording & save"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '7px',
            height: '26px',
            padding: '0 10px',
            background: 'rgba(229, 72, 77, 0.12)',
            border: '1px solid rgba(229, 72, 77, 0.4)',
            borderRadius: '6px',
            cursor: 'pointer',
            color: 'var(--crimson)',
            transition: 'all 0.15s ease',
          }}
        >
          <span
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: 'var(--crimson)',
              animation: 'capture-rec-pulse 1.2s ease-in-out infinite',
            }}
          />
          <span
            style={{
              fontFamily: 'var(--font-number)',
              fontSize: '0.68rem',
              fontWeight: 600,
              letterSpacing: '0.04em',
              color: 'var(--t1)',
              minWidth: '38px',
            }}
          >
            {fmtTime(elapsed)}
          </span>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
            <rect x="5" y="5" width="14" height="14" rx="2" />
          </svg>
        </button>
      )}

      {/* ── Region choice menu ── */}
      {menuOpen && !recording && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            /* Hangs from the button's LEFT edge. It used to hang from the right,
               which was correct while this control lived at the right end of the
               editor toolbar; in the app header it sits a couple of hundred
               pixels from the left edge, and a 240px menu opening leftwards from
               there runs straight off the window. */
            left: 0,
            width: '240px',
            background: 'var(--s1)',
            border: '1px solid var(--line-strong)',
            borderRadius: '10px',
            boxShadow: '0 12px 32px -8px rgba(0,0,0,0.6)',
            padding: '8px',
            zIndex: 1000,
            animation: 'capture-menu-in 0.15s ease-out',
          }}
        >
          <div
            style={{
              fontFamily: 'var(--font-number)',
              fontSize: '0.54rem',
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              color: 'var(--t3)',
              padding: '4px 8px 8px',
            }}
          >
            Record which area?
          </div>

          {Object.entries(REGIONS).map(([key, r]) => (
            <button
              key={key}
              onClick={() => startRecording(key)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                width: '100%',
                padding: '9px 10px',
                background: 'transparent',
                border: '1px solid transparent',
                borderRadius: '7px',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                e.currentTarget.style.borderColor = 'var(--line-strong)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.borderColor = 'transparent';
              }}
            >
              <span
                style={{
                  flexShrink: 0,
                  width: '30px',
                  height: '30px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--t2)',
                  border: '1px solid var(--line-strong)',
                  borderRadius: '7px',
                }}
              >
                {key === 'editor' ? (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="3" width="20" height="18" rx="2" />
                    <line x1="2" y1="8" x2="22" y2="8" />
                  </svg>
                ) : (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="16 18 22 12 16 6" />
                    <polyline points="8 6 2 12 8 18" />
                  </svg>
                )}
              </span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
                <span
                  style={{
                    fontFamily: "'Space Grotesk', sans-serif",
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    color: 'var(--t1)',
                  }}
                >
                  {r.label}
                </span>
                <span
                  style={{
                    fontFamily: 'var(--font-number)',
                    fontSize: '0.56rem',
                    letterSpacing: '0.04em',
                    color: 'var(--t3)',
                  }}
                >
                  {r.sub}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      <style>{`
        @keyframes capture-rec-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%      { opacity: 0.35; transform: scale(0.85); }
        }
        @keyframes capture-menu-in {
          from { opacity: 0; transform: translateY(-6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
};

export default ScreenCapture;
