/* -------------------------------------------------------
 * VoiceRoom.jsx — WebRTC Voice Chat Component
 *
 * Manages peer-to-peer audio connections using WebRTC.
 * Uses the existing STOMP WebSocket for signaling (SDP/ICE).
 * Audio analysis via AudioContext for speaking indicators.
 * ------------------------------------------------------- */

import React, { useRef, useEffect, useCallback, useState } from 'react';
import useEditorStore from '../../store/useEditorStore';
import { sendVoiceJoin, sendVoiceLeave, sendVoiceSignal } from '../../services/socket';

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

const VoiceRoom = () => {
  const sessionId = useEditorStore((s) => s.sessionId);
  const currentUser = useEditorStore((s) => s.currentUser);
  const connectedUsers = useEditorStore((s) => s.connectedUsers);
  const isInVoiceRoom = useEditorStore((s) => s.isInVoiceRoom);
  const isMuted = useEditorStore((s) => s.isMuted);
  const isDeafened = useEditorStore((s) => s.isDeafened);
  const voiceRoomUsers = useEditorStore((s) => s.voiceRoomUsers);
  const speakingUsers = useEditorStore((s) => s.speakingUsers);
  const joinVoiceRoom = useEditorStore((s) => s.joinVoiceRoom);
  const leaveVoiceRoom = useEditorStore((s) => s.leaveVoiceRoom);
  const toggleMute = useEditorStore((s) => s.toggleMute);
  const toggleDeafen = useEditorStore((s) => s.toggleDeafen);
  const addVoiceUser = useEditorStore((s) => s.addVoiceUser);
  const removeVoiceUser = useEditorStore((s) => s.removeVoiceUser);
  const setSpeakingUser = useEditorStore((s) => s.setSpeakingUser);

  // Refs for WebRTC management
  const localStreamRef = useRef(null);
  const peerConnectionsRef = useRef({}); // { [userId]: RTCPeerConnection }
  const audioElementsRef = useRef({});   // { [userId]: HTMLAudioElement }
  const analyserRef = useRef(null);
  const analyserIntervalRef = useRef(null);
  const [joinHovered, setJoinHovered] = useState(false);
  const [muteHovered, setMuteHovered] = useState(false);
  const [deafenHovered, setDeafenHovered] = useState(false);
  const [leaveHovered, setLeaveHovered] = useState(false);

  // ── Handle incoming voice signaling messages ──
  const handleVoiceSignal = useCallback((data) => {
    if (!currentUser || data.userId === currentUser.id) return;

    if (data.type === 'voice-join') {
      addVoiceUser({ id: data.userId, username: data.username, color: data.color });
      // If we're already in the room, create an offer to the new peer
      if (useEditorStore.getState().isInVoiceRoom) {
        createPeerConnection(data.userId, true);
      }
    } else if (data.type === 'voice-leave') {
      removePeerConnection(data.userId);
      removeVoiceUser(data.userId);
    } else if (data.type === 'voice-signal') {
      handleSignalingData(data);
    }
  }, [currentUser]);

  // Register the voice signal handler globally
  useEffect(() => {
    window._onVoiceSignal = handleVoiceSignal;
    return () => { window._onVoiceSignal = null; };
  }, [handleVoiceSignal]);

  // ── Create a peer connection to a remote user ──
  const createPeerConnection = useCallback(async (remoteUserId, isInitiator) => {
    if (peerConnectionsRef.current[remoteUserId]) return;

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    peerConnectionsRef.current[remoteUserId] = pc;

    // Add local audio tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current);
      });
    }

    // Handle incoming remote audio
    pc.ontrack = (event) => {
      const [remoteStream] = event.streams;
      if (!audioElementsRef.current[remoteUserId]) {
        const audio = new Audio();
        audio.srcObject = remoteStream;
        audio.autoplay = true;
        audioElementsRef.current[remoteUserId] = audio;
      } else {
        audioElementsRef.current[remoteUserId].srcObject = remoteStream;
      }

      // Set up speaking detection for remote user
      try {
        const audioCtx = new AudioContext();
        const source = audioCtx.createMediaStreamSource(remoteStream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        const checkSpeaking = setInterval(() => {
          analyser.getByteFrequencyData(dataArray);
          const avg = dataArray.reduce((a, b) => a + b) / dataArray.length;
          setSpeakingUser(remoteUserId, avg > 15);
        }, 150);

        pc._speakingInterval = checkSpeaking;
        pc._audioCtx = audioCtx;
      } catch (e) {
        console.warn('[Voice] Could not set up speaking detection:', e);
      }
    };

    // Send ICE candidates to remote peer
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendVoiceSignal(sessionId, {
          userId: currentUser.id,
          targetUserId: remoteUserId,
          signalType: 'ice-candidate',
          candidate: event.candidate,
        });
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
        removePeerConnection(remoteUserId);
      }
    };

    // If initiator, create and send offer
    if (isInitiator) {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendVoiceSignal(sessionId, {
          userId: currentUser.id,
          targetUserId: remoteUserId,
          signalType: 'offer',
          sdp: offer,
        });
      } catch (e) {
        console.error('[Voice] Failed to create offer:', e);
      }
    }
  }, [sessionId, currentUser, setSpeakingUser]);

  // ── Handle incoming WebRTC signaling data ──
  const handleSignalingData = useCallback(async (data) => {
    if (!currentUser || data.targetUserId !== currentUser.id) return;

    const remoteUserId = data.userId;

    if (data.signalType === 'offer') {
      await createPeerConnection(remoteUserId, false);
      const pc = peerConnectionsRef.current[remoteUserId];
      if (!pc) return;

      try {
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sendVoiceSignal(sessionId, {
          userId: currentUser.id,
          targetUserId: remoteUserId,
          signalType: 'answer',
          sdp: answer,
        });
      } catch (e) {
        console.error('[Voice] Failed to handle offer:', e);
      }
    } else if (data.signalType === 'answer') {
      const pc = peerConnectionsRef.current[remoteUserId];
      if (pc) {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        } catch (e) {
          console.error('[Voice] Failed to set answer:', e);
        }
      }
    } else if (data.signalType === 'ice-candidate') {
      const pc = peerConnectionsRef.current[remoteUserId];
      if (pc) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (e) {
          console.error('[Voice] Failed to add ICE candidate:', e);
        }
      }
    }
  }, [sessionId, currentUser, createPeerConnection]);

  // ── Remove a peer connection ──
  const removePeerConnection = useCallback((userId) => {
    const pc = peerConnectionsRef.current[userId];
    if (pc) {
      if (pc._speakingInterval) clearInterval(pc._speakingInterval);
      if (pc._audioCtx) pc._audioCtx.close().catch(() => {});
      pc.close();
      delete peerConnectionsRef.current[userId];
    }
    if (audioElementsRef.current[userId]) {
      audioElementsRef.current[userId].srcObject = null;
      delete audioElementsRef.current[userId];
    }
    setSpeakingUser(userId, false);
  }, [setSpeakingUser]);

  // ── Join voice room ──
  const handleJoinVoice = useCallback(async () => {
    if (!sessionId || !currentUser) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;

      // Set up local speaking detection
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      analyserIntervalRef.current = setInterval(() => {
        analyser.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((a, b) => a + b) / dataArray.length;
        setSpeakingUser(currentUser.id, avg > 15);
      }, 150);

      joinVoiceRoom();
      addVoiceUser({ id: currentUser.id, username: currentUser.username, color: currentUser.color });
      sendVoiceJoin(sessionId, currentUser);
    } catch (e) {
      console.error('[Voice] Failed to get microphone:', e);
    }
  }, [sessionId, currentUser, joinVoiceRoom, addVoiceUser, setSpeakingUser]);

  // ── Leave voice room ──
  const handleLeaveVoice = useCallback(() => {
    if (!sessionId || !currentUser) return;

    // Clean up all peer connections
    Object.keys(peerConnectionsRef.current).forEach(userId => {
      removePeerConnection(userId);
    });

    // Stop local stream
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }

    // Clean up analyser
    if (analyserIntervalRef.current) {
      clearInterval(analyserIntervalRef.current);
      analyserIntervalRef.current = null;
    }
    analyserRef.current = null;

    leaveVoiceRoom();
    removeVoiceUser(currentUser.id);
    setSpeakingUser(currentUser.id, false);
    sendVoiceLeave(sessionId, currentUser);
  }, [sessionId, currentUser, leaveVoiceRoom, removeVoiceUser, removePeerConnection, setSpeakingUser]);

  // ── Mute/unmute local track ──
  useEffect(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach(track => {
        track.enabled = !isMuted;
      });
    }
  }, [isMuted]);

  // ── Deafen: mute all remote audio ──
  useEffect(() => {
    Object.values(audioElementsRef.current).forEach(audio => {
      if (audio) audio.muted = isDeafened;
    });
  }, [isDeafened]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (isInVoiceRoom) {
        handleLeaveVoice();
      }
    };
  }, []);

  // Leave voice room automatically if connectedUsers drops below 2
  useEffect(() => {
    if (connectedUsers.length < 2 && isInVoiceRoom) {
      handleLeaveVoice();
    }
  }, [connectedUsers.length, isInVoiceRoom, handleLeaveVoice]);

  if (!sessionId || connectedUsers.length < 2) return null;

  const btnBase = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 'none',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    fontFamily: 'var(--font-header)',
    fontSize: '0.5rem',
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
  };

  return (
    <div className="voice-room-panel" style={{
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
    }}>
      {/* Voice room users (speaking indicators) */}
      {isInVoiceRoom && voiceRoomUsers.length > 0 && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            {voiceRoomUsers.map(user => {
              const isSpeaking = speakingUsers[user.id];
              const isMe = user.id === currentUser?.id;
              return (
                <div
                  key={user.id}
                  title={`${user.username}${isMe ? ' (you)' : ''}${isSpeaking ? ' — speaking' : ''}`}
                  className={isSpeaking ? 'voice-avatar speaking' : 'voice-avatar'}
                  style={{
                    width: '24px',
                    height: '24px',
                    borderRadius: '3px',
                    background: isSpeaking ? 'rgba(255,255,255,0.08)' : 'var(--s2)',
                    border: isSpeaking
                      ? '1.5px solid #FFFFFF'
                      : '1px solid var(--line-strong)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    position: 'relative',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {/* Person avatar icon instead of mic */}
                  <svg 
                    viewBox="0 0 24 24" 
                    width="11" 
                    height="11" 
                    fill="none" 
                    stroke={isSpeaking ? '#FFFFFF' : 'var(--t3)'} 
                    strokeWidth="2.5" 
                    strokeLinecap="round" 
                    strokeLinejoin="round"
                    style={{ opacity: isMe && isMuted ? 0.3 : 0.8 }}
                  >
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                  {/* Mute slash overlay */}
                  {isMe && isMuted && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                      stroke="var(--crimson)" strokeWidth="2.5" strokeLinecap="round"
                      style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }}
                    >
                      <line x1="2" y1="2" x2="22" y2="22" />
                    </svg>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{ width: '1px', height: '14px', background: 'var(--line-strong)' }} />
        </>
      )}

      {/* Join / Leave button */}
      {!isInVoiceRoom ? (
        <button
          onClick={handleJoinVoice}
          onMouseEnter={() => setJoinHovered(true)}
          onMouseLeave={() => setJoinHovered(false)}
          title="Join Voice Room"
          className="voice-btn"
          style={{
            ...btnBase,
            height: '24px',
            padding: '0 8px',
            gap: '4px',
            background: joinHovered ? 'rgba(255,255,255,0.06)' : 'transparent',
            color: joinHovered ? 'var(--t1)' : 'var(--t3)',
            borderRadius: '3px',
            border: '1px solid var(--line)',
          }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
          VOICE
        </button>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
            {/* Mute toggle */}
            <button
              onClick={toggleMute}
              onMouseEnter={() => setMuteHovered(true)}
              onMouseLeave={() => setMuteHovered(false)}
              title={isMuted ? 'Unmute' : 'Mute'}
              className="voice-btn"
              style={{
                ...btnBase,
                width: '24px',
                height: '24px',
                borderRadius: '3px',
                background: isMuted
                  ? 'rgba(229, 72, 77, 0.12)'
                  : muteHovered ? 'rgba(255,255,255,0.06)' : 'transparent',
                color: isMuted ? 'var(--crimson)' : muteHovered ? 'var(--t1)' : 'var(--t2)',
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                {isMuted ? (
                  <>
                    <line x1="1.5" y1="1.5" x2="22.5" y2="22.5" />
                    <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
                    <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .51-.06 1-.16 1.47" />
                    <line x1="12" y1="19" x2="12" y2="23" />
                    <line x1="8" y1="23" x2="16" y2="23" />
                  </>
                ) : (
                  <>
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    <line x1="12" y1="19" x2="12" y2="23" />
                    <line x1="8" y1="23" x2="16" y2="23" />
                  </>
                )}
              </svg>
            </button>

            {/* Deafen toggle */}
            <button
              onClick={toggleDeafen}
              onMouseEnter={() => setDeafenHovered(true)}
              onMouseLeave={() => setDeafenHovered(false)}
              title={isDeafened ? 'Undeafen' : 'Deafen'}
              className="voice-btn"
              style={{
                ...btnBase,
                width: '24px',
                height: '24px',
                borderRadius: '3px',
                background: isDeafened
                  ? 'rgba(229, 72, 77, 0.12)'
                  : deafenHovered ? 'rgba(255,255,255,0.06)' : 'transparent',
                color: isDeafened ? 'var(--crimson)' : deafenHovered ? 'var(--t1)' : 'var(--t2)',
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                {isDeafened ? (
                  <>
                    <line x1="1.5" y1="1.5" x2="22.5" y2="22.5" />
                    <path d="M3 14h2a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H3V14z" />
                    <path d="M21 14h-2a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h2V14z" />
                    <path d="M3 14V8a9 9 0 0 1 18 0v6" />
                  </>
                ) : (
                  <>
                    <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
                    <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
                  </>
                )}
              </svg>
            </button>

            {/* Leave button */}
            <button
              onClick={handleLeaveVoice}
              onMouseEnter={() => setLeaveHovered(true)}
              onMouseLeave={() => setLeaveHovered(false)}
              title="Leave Voice"
              className="voice-btn"
              style={{
                ...btnBase,
                width: '24px',
                height: '24px',
                borderRadius: '3px',
                background: leaveHovered
                  ? 'rgba(229, 72, 77, 0.12)'
                  : 'transparent',
                color: leaveHovered ? 'var(--crimson)' : 'var(--t3)',
              }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16.5 9.4l-9-5.19M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                <line x1="3.27" y1="6.96" x2="12" y2="12.01" />
                <line x1="12" y1="22.08" x2="12" y2="12" />
              </svg>
            </button>
          </div>
          <div style={{ width: '1px', height: '14px', background: 'var(--line-strong)' }} />
        </>
      )}

      {/* Voice count badge */}
      {voiceRoomUsers.length > 0 && (
        <span style={{
          fontFamily: 'var(--font-number)',
          fontSize: '0.56rem',
          fontWeight: 600,
          color: 'var(--t3)',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}>
          {voiceRoomUsers.length} IN VOICE
        </span>
      )}
    </div>
  );
};

export default VoiceRoom;
