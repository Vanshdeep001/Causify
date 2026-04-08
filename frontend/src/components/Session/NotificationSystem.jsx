/* -------------------------------------------------------
 * NotificationSystem.jsx — Collaborative Feedback Toasts
 * Only ONE toast at a time. New changes replace the old one.
 * Auto-disappears after 4 seconds.
 *
 * Also handles REVERT notifications (shown in red).
 * ------------------------------------------------------- */

import React, { useEffect, useState, useRef } from 'react';
import useEditorStore from '../../store/useEditorStore';

const NotificationSystem = () => {
  const lastChange = useEditorStore((s) => s.lastChange);
  const revertNotification = useEditorStore((s) => s.revertNotification);
  const devServerNotification = useEditorStore((s) => s.devServerNotification);
  const [toast, setToast] = useState(null);       // Single toast, not an array
  const [exiting, setExiting] = useState(false);   // For exit animation
  const timerRef = useRef(null);
  const exitTimerRef = useRef(null);

  // Show change notification
  useEffect(() => {
    if (!lastChange) return;
    showToast({
      msg: `${lastChange.username} updated ${lastChange.path.split('/').pop()}`,
      color: lastChange.color || '#2d5bff',
      icon: '✎',
      duration: 3500,
    });
  }, [lastChange]);

  // Show revert notification (higher priority, longer duration)
  useEffect(() => {
    if (!revertNotification) return;
    showToast({
      msg: `Your change to ${revertNotification.path.split('/').pop()} was reverted by ${revertNotification.username}`,
      color: '#ff3e3e',
      icon: '↩',
      duration: 5500,
      isRevert: true,
    });
  }, [revertNotification]);

  // Show dev server detection notification
  useEffect(() => {
    if (!devServerNotification) return;
    showToast({
      msg: devServerNotification.message,
      color: '#c1ff72',
      icon: '🚀',
      duration: 6000,
    });
  }, [devServerNotification]);

  const showToast = ({ msg, color, icon, duration = 3500, isRevert = false }) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (exitTimerRef.current) clearTimeout(exitTimerRef.current);

    setExiting(false);
    setToast({ id: Date.now(), msg, color, icon, isRevert });

    timerRef.current = setTimeout(() => {
      setExiting(true);
      exitTimerRef.current = setTimeout(() => {
        setToast(null);
        setExiting(false);
      }, 400);
    }, duration);
  };

  if (!toast) return null;

  return (
    <div style={{
      position: 'fixed', bottom: '2rem', right: '2rem',
      zIndex: 1000, pointerEvents: 'none'
    }}>
      <div
        key={toast.id}
        style={{
          background: '#080808', color: '#fff',
          border: `2px solid ${toast.color}`,
          padding: '12px 20px',
          fontFamily: 'var(--font-number)', fontWeight: 900, fontSize: '0.75rem',
          boxShadow: `4px 4px 0 ${toast.color}`,
          display: 'flex', alignItems: 'center', gap: '12px',
          animation: exiting
            ? 'toast-out 0.4s cubic-bezier(0.6, -0.28, 0.735, 0.045) forwards'
            : 'toast-in 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
          minWidth: '200px',
          maxWidth: '420px',
        }}
      >
        <span style={{ fontSize: '1.2rem', color: toast.color }}>{toast.icon}</span>
        <span>{toast.msg.toUpperCase()}</span>
      </div>

      <style>{`
        @keyframes toast-in {
          from { transform: translateX(100%) scale(0.9); opacity: 0; }
          to { transform: translateX(0) scale(1); opacity: 1; }
        }
        @keyframes toast-out {
          from { transform: translateX(0) scale(1); opacity: 1; }
          to { transform: translateX(100%) scale(0.9); opacity: 0; }
        }
      `}</style>
    </div>
  );
};

export default NotificationSystem;
