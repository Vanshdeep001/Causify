/* -------------------------------------------------------
 * NotificationSystem.jsx — Collaborative Feedback Toasts
 * ------------------------------------------------------- */

import React, { useEffect, useState } from 'react';
import useEditorStore from '../../store/useEditorStore';

const NotificationSystem = () => {
  const lastChange = useEditorStore((s) => s.lastChange);
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    if (!lastChange) return;

    // Create a new toast
    const id = Math.random().toString(36).substr(2, 9);
    const newToast = {
      id,
      msg: `${lastChange.username} updated ${lastChange.path.split('/').pop()}`,
      color: lastChange.color || '#2d5bff',
      icon: '✎'
    };

    setToasts(prev => [...prev.slice(-2), newToast]); // Keep only last 3

    const timer = setTimeout(() => {
         setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);

    return () => clearTimeout(timer);
  }, [lastChange]);

  return (
    <div style={{
      position: 'fixed', bottom: '2rem', right: '2rem',
      display: 'flex', flexDirection: 'column', gap: '10px',
      zIndex: 1000, pointerEvents: 'none'
    }}>
      {toasts.map((t) => (
        <div
          key={t.id}
          style={{
            background: '#080808', color: '#fff',
            border: `2px solid ${t.color}`,
            padding: '12px 20px',
            fontFamily: 'var(--font-number)', fontWeight: 900, fontSize: '0.75rem',
            boxShadow: `4px 4px 0 ${t.color}`,
            display: 'flex', alignItems: 'center', gap: '12px',
            animation: 'toast-in 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
            minWidth: '200px'
          }}
        >
          <span style={{ fontSize: '1.2rem', color: t.color }}>{t.icon}</span>
          <span>{t.msg.toUpperCase()}</span>
        </div>
      ))}

      <style>{`
        @keyframes toast-in {
          from { transform: translateX(100%) scale(0.9); opacity: 0; }
          to { transform: translateX(0) scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
};

export default NotificationSystem;
