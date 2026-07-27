/* -------------------------------------------------------
 * UserPresence.jsx — Collaborative Presence (Monochrome & Squarish)
 * With Follow Mode + Voice indicators
 * ------------------------------------------------------- */

import React, { useState, useRef, useEffect } from 'react';
import useEditorStore from '../../store/useEditorStore';
import { sendKickUser, sendSetPermission } from '../../services/socket';

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
  const userRole = useEditorStore((s) => s.userRole);
  const sessionId = useEditorStore((s) => s.sessionId);

  // How many avatars to render inline before collapsing into a "+N" chip.
  const MAX_VISIBLE = 3;

  // Context menu for user actions
  const [contextMenu, setContextMenu] = useState(null); // { userId, x, y }
  const menuRef = useRef(null);

  // Roster popover (opened from the "+N" overflow chip)
  const [rosterOpen, setRosterOpen] = useState(false);
  const rosterRef = useRef(null);
  const rosterBtnRef = useRef(null);

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

  // Close roster on outside click
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (
        rosterRef.current && !rosterRef.current.contains(e.target) &&
        rosterBtnRef.current && !rosterBtnRef.current.contains(e.target)
      ) {
        setRosterOpen(false);
      }
    };
    if (rosterOpen) document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [rosterOpen]);

  // Owner-only permission + removal helpers (shared by menu and roster)
  const isOwnerView = userRole === 'owner';
  const togglePermission = (user) => {
    const next = user.permission === 'viewer' ? 'editor' : 'viewer';
    sendSetPermission(sessionId, user.id, next);
  };
  const kickUser = (user) => {
    if (window.confirm(`Remove ${user.username} from the session?`)) {
      sendKickUser(sessionId, user.id);
      setRosterOpen(false);
    }
  };
  const rosterIconBtn = (color) => ({
    width: '24px',
    height: '24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    border: '1px solid var(--line)',
    borderRadius: '4px',
    color,
    cursor: 'pointer',
    padding: 0,
    transition: 'all 0.1s',
  });

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

  return (
    <div className="user-presence" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>

      {/* NOTE: the "Following <user>" label lives in the editor banner
          (MonacoEditor) so it isn't shown twice. Here, the followed user's
          avatar itself turns into a cyan eye to indicate the follow target. */}

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

      <div style={{ display: 'flex', alignItems: 'center', paddingLeft: '10px', overflow: 'visible' }}>
        {connectedUsers.slice(0, MAX_VISIBLE).map((user, idx) => {
          const isActive = lastChange && lastChange.userId === user.id && (Date.now() - lastChange.timestamp < 3000);
          const isInVoice = voiceRoomUsers.some(u => u.id === user.id);
          const isBeingFollowed = followingUserId === user.id;
          const isFollowingMe = followedByUsers.includes(user.id);
          const isMe = user.id === currentUser?.id;
          const isViewer = user.permission === 'viewer';
          
          // Monochrome styling
          const isOwner = user.role === 'owner' || idx === 0;
          const borderStyle = isBeingFollowed
            ? '1.5px solid #38BDF8'
            : isActive
              ? '1px solid #FFFFFF'
              : '1px solid var(--line-strong)';

          return (
            <div
              key={user.id}
              title={`${user.username}${isMe ? ' (you)' : ''}${isViewer ? ' • view only' : ''}${isInVoice ? ' 🎤' : ''}${isFollowingMe ? ' 👁 following you' : ''}`}
              onClick={(e) => handleUserClick(user, e)}
              style={{
                width: '24px',
                height: '24px',
                background: isBeingFollowed ? 'rgba(56,189,248,0.14)' : isActive ? '#1C1C1C' : 'var(--s2)',
                borderRadius: '3px',
                border: borderStyle,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginLeft: '-4px',
                position: 'relative',
                zIndex: isBeingFollowed ? 101 : isActive ? 100 : connectedUsers.length - idx,
                boxShadow: isBeingFollowed
                  ? '0 0 12px rgba(56,189,248,0.55)'
                  : isActive
                    ? '0 0 8px rgba(255, 255, 255, 0.15)'
                    : '0 2px 4px rgba(0,0,0,0.5)',
                transition: 'all 0.15s ease',
                transform: isBeingFollowed ? 'translateY(-1px)' : isActive ? 'translateY(-1px)' : 'translateY(0)',
                color: isBeingFollowed ? '#38BDF8' : isOwner ? '#FFFFFF' : '#A0A0A0',
                cursor: isMe ? 'default' : 'pointer',
              }}
            >
              {isBeingFollowed ? (
                // "Seeing through" this user — an eye instead of the person glyph.
                <svg
                  viewBox="0 0 24 24"
                  width="13"
                  height="13"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ animation: 'speaking-pulse 2s ease-in-out infinite' }}
                >
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              ) : (
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
              )}
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
              {/* View-only indicator */}
              {isViewer && (
                <div style={{
                  position: 'absolute',
                  top: '-3px',
                  left: '-3px',
                  width: '9px',
                  height: '9px',
                  borderRadius: '2px',
                  background: '#FFB224',
                  border: '1px solid var(--s1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <svg width="6" height="6" viewBox="0 0 24 24" fill="none" stroke="#0A0A0A"
                    strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                </div>
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
              {/* (Being-followed state is shown by the cyan eye + ring above —
                  no separate corner badge needed.) */}
            </div>
          );
        })}

        {/* Overflow chip — opens the full roster when there are more users */}
        {connectedUsers.length > MAX_VISIBLE && (
          <div
            ref={rosterBtnRef}
            onClick={(e) => {
              if (rosterOpen) { setRosterOpen(false); return; }
              const rect = e.currentTarget.getBoundingClientRect();
              setRosterOpen({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
            }}
            title={`${connectedUsers.length - MAX_VISIBLE} more — view everyone`}
            style={{
              width: '24px',
              height: '24px',
              background: rosterOpen ? '#242424' : 'var(--s2)',
              borderRadius: '3px',
              border: '1px solid var(--line-strong)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginLeft: '-4px',
              position: 'relative',
              zIndex: 90,
              cursor: 'pointer',
              boxShadow: '0 2px 4px rgba(0,0,0,0.5)',
              transition: 'all 0.15s ease',
              fontFamily: 'var(--font-number)',
              fontSize: '0.55rem',
              fontWeight: 700,
              letterSpacing: '0.02em',
              color: 'var(--t1)',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = '#242424'; }}
            onMouseLeave={(e) => { if (!rosterOpen) e.currentTarget.style.background = 'var(--s2)'; }}
          >
            +{connectedUsers.length - MAX_VISIBLE}
          </div>
        )}
      </div>

      {/* ── Roster popover: full participant list + actions ── */}
      {rosterOpen && (
        <div
          ref={rosterRef}
          style={{
            position: 'fixed',
            top: rosterOpen.top,
            right: rosterOpen.right,
            width: '248px',
            maxHeight: '340px',
            overflowY: 'auto',
            background: '#141414',
            border: '1px solid var(--line-strong)',
            borderRadius: '8px',
            padding: '6px',
            zIndex: 9999,
            boxShadow: '0 12px 32px rgba(0,0,0,0.65)',
            animation: 'fadeIn 0.12s ease-out',
          }}
        >
          <div style={{
            padding: '4px 8px 8px',
            fontFamily: 'var(--font-number)',
            fontSize: '0.5rem',
            fontWeight: 700,
            letterSpacing: '0.1em',
            color: 'var(--t3)',
            textTransform: 'uppercase',
          }}>
            In this session · {connectedUsers.length}
          </div>

          {connectedUsers.map((user, idx) => {
            const isMe = user.id === currentUser?.id;
            const isOwnerRow = user.role === 'owner' || idx === 0;
            const isViewer = user.permission === 'viewer';
            const isInVoice = voiceRoomUsers.some((u) => u.id === user.id);
            const isBeingFollowed = followingUserId === user.id;
            const isFollowingMe = followedByUsers.includes(user.id);

            return (
              <div key={user.id} style={{
                display: 'flex',
                alignItems: 'center',
                gap: '9px',
                padding: '6px 8px',
                borderRadius: '5px',
                transition: 'background 0.1s',
              }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                {/* Avatar swatch */}
                <div style={{
                  width: '22px', height: '22px', flexShrink: 0,
                  borderRadius: '3px',
                  background: user.color || '#6366f1',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'var(--font-number)', fontSize: '0.6rem', fontWeight: 800,
                  color: '#0A0A0A',
                  boxShadow: isBeingFollowed ? '0 0 8px rgba(56,189,248,0.6)' : 'none',
                  border: isBeingFollowed ? '1.5px solid #38BDF8' : '1px solid rgba(0,0,0,0.3)',
                }}>
                  {(user.username || '?').charAt(0).toUpperCase()}
                </div>

                {/* Name + status badges */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontFamily: 'var(--font-body)', fontSize: '0.72rem', fontWeight: 600,
                    color: 'var(--t1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {user.username}{isMe && <span style={{ color: 'var(--t3)', fontWeight: 500 }}> (you)</span>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '2px' }}>
                    <span style={{
                      fontFamily: 'var(--font-number)', fontSize: '0.46rem', fontWeight: 700,
                      letterSpacing: '0.06em', textTransform: 'uppercase',
                      color: isOwnerRow ? '#FFFFFF' : isViewer ? '#FFB224' : 'var(--t3)',
                    }}>
                      {isOwnerRow ? 'Owner' : isViewer ? 'View only' : 'Editor'}
                    </span>
                    {isInVoice && <span title="In voice" style={{ fontSize: '0.5rem' }}>🎤</span>}
                    {isFollowingMe && <span title="Following you" style={{ fontSize: '0.5rem' }}>👁</span>}
                  </div>
                </div>

                {/* Actions */}
                {!isMe && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '2px', flexShrink: 0 }}>
                    <button
                      title={isBeingFollowed ? 'Stop following' : `Follow ${user.username}`}
                      onClick={() => { handleFollow(user.id); }}
                      style={rosterIconBtn(isBeingFollowed ? '#38BDF8' : 'var(--t2)')}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    </button>

                    {isOwnerView && !isOwnerRow && (
                      <button
                        title={isViewer ? 'Allow editing' : 'Set to view only'}
                        onClick={() => togglePermission(user)}
                        style={rosterIconBtn(isViewer ? '#FFB224' : 'var(--t2)')}
                      >
                        {isViewer ? (
                          // Currently view-only → click allows editing (pencil)
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 20h9" />
                            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                          </svg>
                        ) : (
                          // Currently editor → click restricts to view-only (padlock)
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                          </svg>
                        )}
                      </button>
                    )}

                    {isOwnerView && (
                      <button
                        title={`Remove ${user.username}`}
                        onClick={() => kickUser(user)}
                        style={rosterIconBtn('var(--crimson)')}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

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

          {/* Access toggle: owner grants / revokes edit rights */}
          {userRole === 'owner' && (() => {
            const target = connectedUsers.find(u => u.id === contextMenu.userId);
            const isViewer = target?.permission === 'viewer';
            return (
              <div
                onClick={() => {
                  sendSetPermission(sessionId, contextMenu.userId, isViewer ? 'editor' : 'viewer');
                  setContextMenu(null);
                }}
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
                  color: 'var(--t1)',
                  letterSpacing: '0.04em',
                  transition: 'background 0.1s',
                  marginTop: '2px',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
              >
                {isViewer ? (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                  </svg>
                ) : (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
                {isViewer ? 'Allow Editing' : 'Set to View Only'}
              </div>
            );
          })()}

          {/* Remove / Kick action (Only shown to owner, and only for other users) */}
          {userRole === 'owner' && (
            <div
              onClick={() => {
                if (window.confirm(`Are you sure you want to remove ${contextMenu.username} from the session?`)) {
                  sendKickUser(sessionId, contextMenu.userId);
                  setContextMenu(null);
                }
              }}
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
                color: 'var(--crimson)',
                letterSpacing: '0.04em',
                transition: 'background 0.1s',
                marginTop: '2px',
                borderTop: '1px solid rgba(255,255,255,0.05)',
                paddingTop: '8px',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(232,17,35,0.15)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="8.5" cy="7" r="4" />
                <line x1="18" y1="8" x2="23" y2="13" />
                <line x1="23" y1="8" x2="18" y2="13" />
              </svg>
              Remove User
            </div>
          )}
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
