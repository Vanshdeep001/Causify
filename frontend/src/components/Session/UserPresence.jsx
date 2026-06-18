/* -------------------------------------------------------
 * UserPresence.jsx — Collaborative Presence (Monochrome & Squarish)
 * With Follow Mode + Voice indicators
 * ------------------------------------------------------- */

import React, { useState, useRef, useEffect } from 'react';
import useEditorStore from '../../store/useEditorStore';

const UserPresence = () => {
  const connectedUsers = useEditorStore((s) => s.connectedUsers);
  const currentUser = useEditorStore((s) => s.currentUser);
  const lastChange = useEditorStore((s) => s.lastChange);
  const voiceRoomUsers = useEditorStore((s) => s.voiceRoomUsers);
  const followingUserId = useEditorStore((s) => s.followingUserId);
  const followedByUsers = useEditorStore((s) => s.followedByUsers);
  const followToast = useEditorStore((s) => s.followToast);
  const startFollowing = useEditorStore((s) => s.startFollowing);
  const stopFollowing = useEditorStore((s) => s.stopFollowing);

  // Context menu for user actions
  const [contextMenu, setContextMenu] = useState(null); // { userId, x, y }
  const menuRef = useRef(null);

  // Close menu on outside click
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setContextMenu(null);
      }
    };
    if (contextMenu) {
      document.addEventListener('mousedown', handleOutsideClick);
    }
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [contextMenu]);

  const handleUserClick = (user, e) => {
    if (user.id === currentUser?.id) return; // Can't follow yourself
    const rect = e.currentTarget.getBoundingClientRect();
    setContextMenu({
      userId: user.id,
      username: user.username,
      x: rect.left + rect.width / 2,
      y: rect.bottom + 6,
    });
  };

  const handleFollow = (userId) => {
    if (followingUserId === userId) {
      stopFollowing();
    } else {
      startFollowing(userId);
    }
    setContextMenu(null);
  };

  // Find the user being followed
  const followedUser = followingUserId
    ? connectedUsers.find(u => u.id === followingUserId)
    : null;

  return (
    <div className="user-presence" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>

      {/* Follow mode banner */}
      {followedUser && (
        <div
          onClick={stopFollowing}
          title="Click to stop following"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '3px 10px',
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: '999px',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
            animation: 'fadeIn 0.2s ease-out',
          }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--t1)"
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          <span style={{
            fontFamily: 'var(--font-number)',
            fontSize: '0.52rem',
            fontWeight: 600,
            letterSpacing: '0.06em',
            color: 'var(--t1)',
            textTransform: 'uppercase',
          }}>
            Following {followedUser.username}
          </span>
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="var(--t3)"
            strokeWidth="3" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </div>
      )}

      {/* Follow toast notification */}
      {followToast && (
        <div style={{
          padding: '3px 10px',
          background: 'rgba(255,255,255,0.06)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '999px',
          fontFamily: 'var(--font-number)',
          fontSize: '0.5rem',
          color: 'var(--t2)',
          letterSpacing: '0.04em',
          animation: 'fadeIn 0.2s ease-out',
        }}>
          {followToast}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', paddingLeft: '10px' }}>
        {connectedUsers.map((user, idx) => {
          const isActive = lastChange && lastChange.userId === user.id && (Date.now() - lastChange.timestamp < 3000);
          const isInVoice = voiceRoomUsers.some(u => u.id === user.id);
          const isBeingFollowed = followingUserId === user.id;
          const isFollowingMe = followedByUsers.includes(user.id);
          const isMe = user.id === currentUser?.id;
          
          // Monochrome styling
          const isOwner = user.role === 'owner' || idx === 0;
          const borderStyle = isBeingFollowed
            ? '1.5px solid rgba(255,255,255,0.8)'
            : isActive
              ? '1px solid #FFFFFF'
              : '1px solid var(--line-strong)';

          return (
            <div
              key={user.id}
              title={`${user.username}${isMe ? ' (you)' : ''}${isInVoice ? ' 🎤' : ''}${isFollowingMe ? ' 👁 following you' : ''}`}
              onClick={(e) => handleUserClick(user, e)}
              style={{
                width: '24px',
                height: '24px',
                background: isActive ? '#1C1C1C' : isBeingFollowed ? 'rgba(255,255,255,0.06)' : 'var(--s2)',
                borderRadius: '3px',
                border: borderStyle,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginLeft: '-4px',
                position: 'relative',
                zIndex: isActive ? 100 : connectedUsers.length - idx,
                boxShadow: isBeingFollowed
                  ? '0 0 10px rgba(255,255,255,0.15)'
                  : isActive 
                    ? '0 0 8px rgba(255, 255, 255, 0.15)' 
                    : '0 2px 4px rgba(0,0,0,0.5)',
                transition: 'all 0.15s ease',
                transform: isActive ? 'translateY(-1px)' : 'translateY(0)',
                color: isOwner ? '#FFFFFF' : '#A0A0A0',
                cursor: isMe ? 'default' : 'pointer',
              }}
            >
              <svg 
                viewBox="0 0 24 24" 
                width="12" 
                height="12" 
                fill="none" 
                stroke="currentColor" 
                strokeWidth="2.2" 
                strokeLinecap="round" 
                strokeLinejoin="round"
                style={{ opacity: isActive ? 1 : 0.7 }}
              >
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
              {/* Active editing indicator */}
              {isActive && (
                <div style={{
                  position: 'absolute',
                  bottom: '-2px',
                  right: '-2px',
                  width: '5px',
                  height: '5px',
                  borderRadius: '50%',
                  background: '#FFFFFF',
                  boxShadow: '0 0 4px #FFFFFF',
                  border: '1px solid var(--s1)',
                }} />
              )}
              {/* Voice indicator */}
              {isInVoice && (
                <div style={{
                  position: 'absolute',
                  top: '-3px',
                  right: '-3px',
                  width: '8px',
                  height: '8px',
                  borderRadius: '2px',
                  background: 'var(--s1)',
                  border: '1px solid var(--line-strong)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <svg width="5" height="5" viewBox="0 0 24 24" fill="none" stroke="var(--t2)"
                    strokeWidth="3" strokeLinecap="round">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  </svg>
                </div>
              )}
              {/* Follow indicator (eye icon) */}
              {isBeingFollowed && (
                <div style={{
                  position: 'absolute',
                  bottom: '-4px',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: '10px',
                  height: '6px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF"
                    strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Context menu for user actions */}
      {contextMenu && (
        <div
          ref={menuRef}
          style={{
            position: 'fixed',
            left: contextMenu.x,
            top: contextMenu.y,
            transform: 'translateX(-50%)',
            background: '#1A1A1A',
            border: '1px solid var(--line-strong)',
            borderRadius: '6px',
            padding: '4px',
            zIndex: 9999,
            minWidth: '120px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
            animation: 'fadeIn 0.1s ease-out',
          }}
        >
          {/* Arrow pointing up */}
          <div style={{
            position: 'absolute',
            top: '-4px',
            left: '50%',
            transform: 'translateX(-50%) rotate(45deg)',
            width: '8px',
            height: '8px',
            background: '#1A1A1A',
            borderTop: '1px solid var(--line-strong)',
            borderLeft: '1px solid var(--line-strong)',
          }} />
          <div
            onClick={() => handleFollow(contextMenu.userId)}
            style={{
              padding: '6px 10px',
              cursor: 'pointer',
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontFamily: 'var(--font-number)',
              fontSize: '0.6rem',
              fontWeight: 500,
              color: followingUserId === contextMenu.userId ? 'var(--crimson)' : 'var(--t1)',
              letterSpacing: '0.04em',
              transition: 'background 0.1s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            {followingUserId === contextMenu.userId ? 'Stop Following' : `Follow ${contextMenu.username}`}
          </div>
        </div>
      )}

      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '4px 10px',
        background: 'var(--s3)',
        borderRadius: '999px',
        border: '1px solid var(--line)',
        marginLeft: '4px'
      }}>
        <div style={{
          width: '5px',
          height: '5px',
          borderRadius: '50%',
          background: 'var(--t2)',
        }} />
        <span style={{
          fontFamily: 'var(--font-number)',
          fontWeight: 500,
          fontSize: '0.56rem',
          letterSpacing: '0.06em',
          color: 'var(--t2)',
        }}>
          {connectedUsers.length} ONLINE
        </span>
      </div>
    </div>
  );
};

export default UserPresence;
