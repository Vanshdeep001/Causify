/* -------------------------------------------------------
 * NotificationSystem.jsx — Collaborative Feedback Toasts
 * Only ONE toast at a time. New changes replace the old one.
 * Auto-disappears after a few seconds.
 *
 * A collaborator-edit toast is expandable: click it to see
 * exactly which lines changed (old → new). Revert + dev-server
 * toasts are informational only.
 * ------------------------------------------------------- */

import React, { useEffect, useState, useRef } from 'react';
import useEditorStore from '../../store/useEditorStore';

const PencilIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
  </svg>
);

const RevertIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 14 4 9 9 4" />
    <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
  </svg>
);

const RocketIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
    <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
    <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
  </svg>
);

const ChevronIcon = ({ open }) => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
    style={{ transition: 'transform 0.2s', transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}>
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const NotificationSystem = () => {
  const activePath = useEditorStore((s) => s.activePath);
  const lastChange = useEditorStore((s) => s.lastChange);
  const revertNotification = useEditorStore((s) => s.revertNotification);
  const devServerNotification = useEditorStore((s) => s.devServerNotification);
  const remoteLineChanges = useEditorStore((s) => s.remoteLineChanges);

  const [toast, setToast] = useState(null);       // Single toast, not an array
  const [exiting, setExiting] = useState(false);   // For exit animation
  const [expanded, setExpanded] = useState(false); // Diff panel open?
  const timerRef = useRef(null);
  const exitTimerRef = useRef(null);



  // Show revert notification (higher priority, longer duration)
  useEffect(() => {
    if (!revertNotification) return;
    showToast({
      title: `Your change to ${revertNotification.path.split('/').pop()} was reverted by ${revertNotification.username}`,
      color: '#E5484D',
      kind: 'revert',
      duration: 5500,
    });
  }, [revertNotification]);

  // Show dev server detection notification
  useEffect(() => {
    if (!devServerNotification) return;
    showToast({
      title: devServerNotification.message,
      color: '#C7FF5E',
      kind: 'devserver',
      duration: 6000,
    });
  }, [devServerNotification]);

  const showToast = ({ title, color, kind, path = null, duration = 4000 }) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (exitTimerRef.current) clearTimeout(exitTimerRef.current);

    setExiting(false);
    setExpanded(false);
    setToast({ id: Date.now(), title, color, kind, path });

    timerRef.current = setTimeout(() => dismiss(), duration);
  };

  const dismiss = () => {
    setExiting(true);
    exitTimerRef.current = setTimeout(() => {
      setToast(null);
      setExiting(false);
      setExpanded(false);
    }, 380);
  };

  // Build the line-diff list for the toast's file
  const getDiffs = () => {
    if (!toast?.path) return [];
    const changes = remoteLineChanges[toast.path] || {};
    return Object.entries(changes)
      .map(([line, info]) => ({ line: parseInt(line, 10), ...info }))
      .sort((a, b) => a.line - b.line);
  };

  const diffs = toast?.kind === 'edit' ? getDiffs() : [];
  const expandable = diffs.length > 0;

  const toggleExpand = () => {
    if (!expandable) return;
    const next = !expanded;
    setExpanded(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    // Keep the toast open while reading the diff; re-arm dismiss once collapsed
    if (!next) timerRef.current = setTimeout(() => dismiss(), 3000);
  };

  if (!toast) return null;

  const accent = toast.color;
  const Icon = toast.kind === 'revert' ? RevertIcon : toast.kind === 'devserver' ? RocketIcon : PencilIcon;

  const isPlaceholder = (s) => !s || s.startsWith('(');

  const getInitials = (name = '') => {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return (name.trim().slice(0, 2) || '?').toUpperCase();
  };
  const initials = toast.kind === 'edit' ? getInitials(lastChange?.username) : null;

  const gutterSty = {
    width: '26px', flexShrink: 0, textAlign: 'right', paddingRight: '9px',
    fontFamily: 'var(--font-number)', fontSize: '0.56rem', color: 'var(--t4)',
    lineHeight: '1.7', userSelect: 'none',
  };
  const signSty = (c) => ({
    width: '14px', flexShrink: 0, textAlign: 'center', color: c,
    fontFamily: 'var(--font-code)', fontSize: '0.64rem', lineHeight: '1.7',
  });
  const codeSty = (color, dim) => ({
    flex: 1, minWidth: 0, fontFamily: 'var(--font-code)', fontSize: '0.64rem',
    lineHeight: '1.7', color, opacity: dim ? 0.85 : 1,
    wordBreak: 'break-all', whiteSpace: 'pre-wrap',
  });

  return (
    <div style={{ position: 'fixed', bottom: '1.75rem', right: '1.75rem', zIndex: 1000, pointerEvents: 'none' }}>
      <div
        key={toast.id}
        style={{
          position: 'relative',
          width: '330px',
          background: 'rgba(15,15,15,0.85)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          border: '1px dotted #484848',
          borderRadius: '3px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          overflow: 'hidden',
          pointerEvents: 'auto',
          animation: exiting
            ? 'toast-out 0.38s cubic-bezier(0.6, -0.28, 0.735, 0.045) forwards'
            : 'toast-in 0.42s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {/* header */}
        <div
          onClick={toggleExpand}
          style={{
            position: 'relative',
            display: 'flex', alignItems: 'center', gap: '10px',
            padding: '10px 12px',
            cursor: expandable ? 'pointer' : 'default',
          }}
        >
          {/* avatar */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <div style={{
              width: '28px', height: '28px', borderRadius: '2px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'transparent', border: '1px dotted #6E6E6E',
              color: '#EDEDED',
            }}>
              {initials
                ? <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: '0.62rem', letterSpacing: '0.02em' }}>{initials}</span>
                : <Icon />}
            </div>
            {toast.kind === 'edit' && (
              <div style={{
                position: 'absolute', bottom: '-2px', right: '-2px',
                width: '12px', height: '12px', borderRadius: '2px',
                background: 'var(--s1)', border: '1px dotted #6E6E6E',
                display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#EDEDED',
              }}>
                <svg width="6" height="6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                </svg>
              </div>
            )}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: '0.78rem',
              color: 'var(--t1)', lineHeight: 1.3,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {toast.title}
            </div>
            {expandable && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px',
                fontFamily: 'var(--font-number)', fontSize: '0.55rem', letterSpacing: '0.06em',
                color: 'var(--t3)', textTransform: 'uppercase',
              }}>
                <span>//</span>
                {diffs.length} {diffs.length === 1 ? 'line' : 'lines'} changed
              </div>
            )}
          </div>

          {expandable && (
            <div style={{ color: 'var(--t3)', flexShrink: 0 }}>
              <ChevronIcon open={expanded} />
            </div>
          )}
        </div>

        {/* expanded diff */}
        {expanded && expandable && (
          <div style={{
            position: 'relative',
            borderTop: '1px dotted #2E2E2E',
            maxHeight: '210px', overflowY: 'auto',
            padding: '10px 12px 12px',
          }}>
            {diffs.map((d) => (
              <div key={d.line} style={{
                marginBottom: '8px',
                borderRadius: '2px', overflow: 'hidden',
                border: '1px dotted #2E2E2E', background: 'rgba(0,0,0,0.15)',
              }}>
                <div style={{
                  fontFamily: 'var(--font-number)', fontSize: '0.5rem', letterSpacing: '0.1em',
                  color: 'var(--t4)', textTransform: 'uppercase',
                  padding: '4px 8px', borderBottom: '1px dotted #2E2E2E',
                  background: 'rgba(255,255,255,0.015)',
                }}>
                  Line {d.line} · {d.type}
                </div>
                {!isPlaceholder(d.oldLine) && (
                  <div style={{ display: 'flex', alignItems: 'flex-start', padding: '3px 0', borderLeft: '1px dotted #484848' }}>
                    <span style={gutterSty}>{d.line}</span>
                    <span style={signSty('var(--t3)')}>−</span>
                    <code style={codeSty('var(--t2)', true)}>{d.oldLine}</code>
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'flex-start', padding: '3px 0', borderLeft: '1px dotted #6E6E6E', background: 'rgba(255,255,255,0.015)' }}>
                  <span style={gutterSty}>{d.line}</span>
                  <span style={signSty('var(--t1)')}>+</span>
                  <code style={codeSty('var(--t1)', false)}>{isPlaceholder(d.newLine) ? '(removed)' : d.newLine}</code>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <style>{`
        @keyframes toast-in {
          from { transform: translateY(12px) scale(0.97); opacity: 0; }
          to { transform: translateY(0) scale(1); opacity: 1; }
        }
        @keyframes toast-out {
          from { transform: translateY(0) scale(1); opacity: 1; }
          to { transform: translateY(12px) scale(0.97); opacity: 0; }
        }
      `}</style>
    </div>
  );
};

export default NotificationSystem;
