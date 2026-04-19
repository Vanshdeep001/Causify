/* -------------------------------------------------------
 * TimelineSlider.jsx — Snapshot Replay Timeline
 * Shows all captured snapshots in a numbered list.
 * Click any snapshot to load it into the editor.
 * ------------------------------------------------------- */

import React from 'react';
import useEditorStore from '../../store/useEditorStore';

const TimelineSlider = () => {
  const snapshots = useEditorStore((s) => s.snapshots);
  const currentSnapshotIndex = useEditorStore((s) => s.currentSnapshotIndex);
  const isReplaying = useEditorStore((s) => s.isReplaying);
  const goToSnapshot = useEditorStore((s) => s.goToSnapshot);
  const goToLive = useEditorStore((s) => s.goToLive);

  const formatTime = (ts) => {
    try { return new Date(ts).toLocaleTimeString([], { hour12: false }); }
    catch { return '--:--:--'; }
  };

  if (snapshots.length === 0) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', height: '100%', gap: '12px', opacity: 0.5
      }}>
        <div style={{ fontSize: '2rem' }}>⏱</div>
        <div className="tech-label" style={{ border: 'none' }}>NO SNAPSHOTS YET</div>
        <div style={{ fontSize: '0.75rem', fontFamily: 'monospace', textAlign: 'center', color: '#888' }}>
          Click RUN to capture your first snapshot
        </div>
      </div>
    );
  }

  const hasAnyError = snapshots.some((s) => s.hasError);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '0' }}>

      {/* Header Row */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        paddingBottom: '12px', borderBottom: '2px solid #333', marginBottom: '12px', flexShrink: 0
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span className="tech-label" style={{ background: 'transparent', border: 'none', color: '#aaa', padding: 0 }}>
            {snapshots.length} SNAPSHOT{snapshots.length !== 1 ? 'S' : ''}
          </span>
          {hasAnyError && (
            <span style={{
              fontSize: '0.65rem', fontFamily: 'var(--font-number)', fontWeight: 900,
              color: '#ff3e3e', background: 'rgba(255,62,62,0.15)',
              padding: '2px 8px', borderRadius: '2px', border: '1px solid rgba(255,62,62,0.4)'
            }}>
              ⚠ ERRORS DETECTED
            </span>
          )}
        </div>
        {isReplaying && (
          <button
            onClick={goToLive}
            style={{
              fontFamily: 'var(--font-number)', fontWeight: 900, fontSize: '0.65rem',
              background: '#c1ff72', color: '#080808', border: '2px solid #c1ff72',
              padding: '4px 12px', cursor: 'pointer', textTransform: 'uppercase'
            }}
          >
            EXIT REPLAY
          </button>
        )}
      </div>

      {/* Snapshot List */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>

        {/* LIVE entry — always first/top */}
        <div
          onClick={goToLive}
          style={{
            display: 'flex', alignItems: 'center', gap: '12px',
            padding: '10px 14px', cursor: 'pointer',
            background: !isReplaying ? 'rgba(193,255,114,0.15)' : 'rgba(255,255,255,0.04)',
            border: !isReplaying ? '2px solid #c1ff72' : '2px solid #333',
            transition: 'all 0.15s ease', borderRadius: '2px'
          }}
        >
          {/* Status dot */}
          <div style={{
            width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0,
            background: !isReplaying ? '#c1ff72' : '#444',
            boxShadow: !isReplaying ? '0 0 8px #c1ff72' : 'none',
            animation: !isReplaying ? 'pulse-live 1.5s infinite' : 'none',
          }} />

          <div style={{ flex: 1 }}>
            <div style={{
              fontFamily: 'var(--font-number)', fontWeight: 900, fontSize: '0.75rem',
              color: !isReplaying ? '#c1ff72' : '#aaa', textTransform: 'uppercase'
            }}>
              LIVE
            </div>
          </div>

          <div style={{
            fontSize: '0.65rem', fontFamily: 'monospace',
            color: !isReplaying ? '#c1ff72' : '#555',
            background: !isReplaying ? 'rgba(193,255,114,0.2)' : 'rgba(255,255,255,0.05)',
            padding: '2px 8px', borderRadius: '2px'
          }}>
            {!isReplaying ? 'VIEWING' : 'CLICK TO GO LIVE'}
          </div>
        </div>

        {/* Snapshot entries — newest first */}
        {[...snapshots].reverse().map((snap, revIdx) => {
          const originalIdx = snapshots.length - 1 - revIdx;
          const isActive = currentSnapshotIndex === originalIdx;
          const isLastBeforeError = !snap.hasError &&
            originalIdx + 1 < snapshots.length &&
            snapshots[originalIdx + 1]?.hasError;

          return (
            <div key={snap.id || originalIdx}>
              {/* "Last working state" separator */}
              {isLastBeforeError && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '4px 0', margin: '4px 0', opacity: 0.6
                }}>
                  <div style={{ flex: 1, height: '1px', background: '#2d5bff' }} />
                  <span style={{
                    fontSize: '0.6rem', fontFamily: 'var(--font-number)',
                    color: '#2d5bff', whiteSpace: 'nowrap'
                  }}>
                    LAST WORKING STATE ↑
                  </span>
                  <div style={{ flex: 1, height: '1px', background: '#2d5bff' }} />
                </div>
              )}

              <div
                onClick={() => goToSnapshot(originalIdx)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '12px',
                  padding: '10px 14px', cursor: 'pointer', position: 'relative',
                  background: isActive
                    ? '#ffffff'
                    : snap.hasError
                    ? 'rgba(255,62,62,0.07)'
                    : 'rgba(255,255,255,0.04)',
                  border: isActive
                    ? '2px solid #ffffff'
                    : snap.hasError
                    ? '2px solid rgba(255,62,62,0.4)'
                    : '2px solid #333',
                  transition: 'all 0.15s ease', borderRadius: '2px',
                  color: isActive ? '#080808' : '#ccc',
                }}
              >
                {/* Snapshot number badge */}
                <div style={{
                  fontFamily: 'var(--font-number)', fontWeight: 900, fontSize: '0.65rem',
                  color: isActive ? '#080808' : '#555', minWidth: '28px', textAlign: 'center'
                }}>
                  #{originalIdx + 1}
                </div>

                {/* Info */}
                <div style={{ flex: 1 }}>
                  <div style={{
                    fontFamily: 'var(--font-number)', fontWeight: 700, fontSize: '0.72rem',
                    textTransform: 'uppercase', marginBottom: '2px',
                    color: isActive ? '#080808' : (snap.hasError ? '#ff6b6b' : '#ccc')
                  }}>
                    Snapshot {originalIdx + 1}
                    {snap.hasError && (
                      <span style={{
                        marginLeft: '8px', fontSize: '0.6rem', fontWeight: 900,
                        color: '#ff3e3e', background: 'rgba(255,62,62,0.2)',
                        padding: '1px 6px', borderRadius: '2px'
                      }}>
                        ERROR
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '0.68rem', fontFamily: 'monospace', opacity: 0.6 }}>
                    {formatTime(snap.timestamp)}
                  </div>
                </div>

                {/* Active badge */}
                {isActive && (
                  <div style={{
                    fontSize: '0.6rem', fontFamily: 'var(--font-number)', fontWeight: 900,
                    background: '#080808', color: '#fff',
                    padding: '2px 8px', borderRadius: '2px', textTransform: 'uppercase'
                  }}>
                    VIEWING
                  </div>
                )}
              </div>
            </div>
          );
        })}

      </div>

      {/* Footer hint when replaying */}
      {isReplaying && (
        <div style={{
          paddingTop: '12px', borderTop: '2px solid #333', marginTop: '8px', flexShrink: 0,
          fontSize: '0.68rem', fontFamily: 'monospace', color: '#666', textAlign: 'center'
        }}>
          SNAPSHOT MODE — CLICK LIVE TO EDIT.
        </div>
      )}
    </div>
  );
};

export default TimelineSlider;
