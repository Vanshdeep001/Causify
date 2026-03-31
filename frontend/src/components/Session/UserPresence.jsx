/* -------------------------------------------------------
 * UserPresence.jsx — Collaborative Presence
 * ------------------------------------------------------- */

import React from 'react';
import useEditorStore from '../../store/useEditorStore';

const UserPresence = () => {
  const connectedUsers = useEditorStore((s) => s.connectedUsers);
  const currentUser = useEditorStore((s) => s.currentUser);
  const lastChange = useEditorStore((s) => s.lastChange);

  return (
    <div className="user-presence" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <div style={{ display: 'flex' }}>
        {connectedUsers.map((user) => {
          // Pulse if this user was the source of a recent change (within 3s)
          const isActive = lastChange && lastChange.userId === user.id && (Date.now() - lastChange.timestamp < 3000);
          
          return (
            <div
              key={user.id}
              title={user.username}
              style={{
                width: '36px',
                height: '36px',
                background: user.color || '#ddd',
                border: isActive ? `3px solid ${user.color}` : 'var(--border-thin)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: 'var(--font-number)',
                fontWeight: 900,
                fontSize: '0.8rem',
                color: '#000',
                marginLeft: '-10px',
                position: 'relative',
                zIndex: (isActive || user.id === currentUser?.id) ? 10 : 1,
                boxShadow: isActive ? `0 0 12px ${user.color}` : 'none',
                transition: 'all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
                transform: isActive ? 'scale(1.15)' : 'scale(1)',
                boxSizing: 'border-box'
              }}
            >
              {user.username.substring(0, 1).toUpperCase()}
              {isActive && (
                <span style={{
                   position: 'absolute', top: '-5px', right: '-5px',
                   fontSize: '0.6rem', background: '#080808', color: user.color,
                   borderRadius: '50%', width: '14px', height: '14px',
                   display: 'flex', alignItems: 'center', justifyContent: 'center',
                   border: `1px solid ${user.color}`
                }}>✎</span>
              )}
            </div>
          );
        })}
      </div>
      <div className="tech-label" style={{ 
        background: 'var(--accent-toxic-green)',
        fontSize: '0.7rem',
        marginLeft: '4px'
      }}>
        ONLINE: {connectedUsers.length}
      </div>
    </div>
  );
};

export default UserPresence;
