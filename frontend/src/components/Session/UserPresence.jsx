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
    <div className="user-presence" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', paddingLeft: '10px' }}>
        {connectedUsers.map((user, idx) => {
          const isActive = lastChange && lastChange.userId === user.id && (Date.now() - lastChange.timestamp < 3000);
          
          return (
            <div
              key={user.id}
              title={user.username}
              style={{
                width: '32px',
                height: '32px',
                background: user.color || '#ddd',
                borderRadius: '50%',
                border: `2px solid var(--bg-creme)`, // White-space separator
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: 'var(--font-number)',
                fontWeight: 900,
                fontSize: '0.6rem',
                color: '#fff',
                marginLeft: '-12px',
                position: 'relative',
                zIndex: (isActive ? 100 : connectedUsers.length - idx),
                boxShadow: isActive ? `0 0 0 2px #fff, 0 0 0 4px ${user.color}` : '0 2px 4px rgba(0,0,0,0.1)',
                transition: 'all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
                transform: isActive ? 'translateY(-2px)' : 'translateY(0)',
                textShadow: '0 1px 2px rgba(0,0,0,0.2)',
                cursor: 'default'
              }}
            >
              {user.username.substring(0, 1).toUpperCase()}
              {isActive && (
                <div style={{
                  position: 'absolute',
                  bottom: '-2px',
                  right: '-2px',
                  width: '10px',
                  height: '10px',
                  borderRadius: '50%',
                  background: 'var(--accent-toxic-green)',
                  border: '2px solid #fff',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
                }} />
              )}
            </div>
          );
        })}
      </div>
      
      <div style={{ 
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '4px 10px',
        background: 'rgba(0,0,0,0.03)',
        borderRadius: '20px',
        border: '1px solid rgba(0,0,0,0.05)',
        marginLeft: '4px'
      }}>
        <div style={{ 
          width: '6px', 
          height: '6px', 
          borderRadius: '50%', 
          background: 'var(--accent-toxic-green)',
          boxShadow: '0 0 8px var(--accent-toxic-green)' 
        }} />
        <span style={{ 
          fontFamily: 'var(--font-number)',
          fontWeight: 700,
          fontSize: '0.55rem',
          letterSpacing: '0.05em',
          color: 'var(--color-black)',
          opacity: 0.7
        }}>
          {connectedUsers.length} ONLINE
        </span>
      </div>
    </div>
  );
};

export default UserPresence;
