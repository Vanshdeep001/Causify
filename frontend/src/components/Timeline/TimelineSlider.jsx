/* -------------------------------------------------------
 * TimelineSlider.jsx — Snapshot Replay Timeline
 * Shows all captured snapshots in a structured, cardless splitscreen layout.
 * Left: Replay Controller spec sheet.
 * Right: Mario playhead timeline & Git-style history log table.
 * Styled in classy Sky Blue & White theme with premium typography.
 * ------------------------------------------------------- */

import React from 'react';
import useEditorStore from '../../store/useEditorStore';

const TimelineSlider = () => {
  const snapshots = useEditorStore((s) => s.snapshots);
  const currentSnapshotIndex = useEditorStore((s) => s.currentSnapshotIndex);
  const isReplaying = useEditorStore((s) => s.isReplaying);
  const goToSnapshot = useEditorStore((s) => s.goToSnapshot);
  const goToLive = useEditorStore((s) => s.goToLive);
  const restoreSnapshot = useEditorStore((s) => s.restoreSnapshot);
  const deployHistory = useEditorStore((s) => s.deployHistory);
  const setPendingRedeploy = useEditorStore((s) => s.setPendingRedeploy);
  const setTerminalActiveTab = useEditorStore((s) => s.setTerminalActiveTab);


  const formatTime = (ts) => {
    try {
      return new Date(ts).toLocaleTimeString([], { hour12: false });
    } catch {
      return '--:--:--';
    }
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

  const sliderValue = isReplaying ? currentSnapshotIndex : snapshots.length;
  const activeSnap = isReplaying ? snapshots[currentSnapshotIndex] : null;

  const handleSliderChange = (e) => {
    const val = parseInt(e.target.value, 10);
    if (val === snapshots.length) {
      goToLive();
    } else {
      goToSnapshot(val);
    }
  };

  return (
    <div style={{
      display: 'flex',
      height: '100%',
      width: '100%',
      gap: '24px',
      fontFamily: 'var(--font-number)',
      '--thumb-shadow': isReplaying ? 'rgba(0, 162, 255, 0.45)' : 'rgba(255, 255, 255, 0.35)',
    }}>

      {/* LEFT COLUMN: REPLAY CONTROLLER & SPEC SHEET */}
      <div style={{
        width: '260px',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        borderRight: '1px solid var(--line-strong)',
        paddingRight: '20px',
        flexShrink: 0,
      }}>
        <div>
          <span style={{
            fontSize: '0.56rem',
            fontWeight: 800,
            fontFamily: 'var(--font-header)',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: isReplaying ? '#38BDF8' : '#FFFFFF',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            userSelect: 'none',
          }}>
            <span style={{
              width: '4.5px',
              height: '4.5px',
              borderRadius: '50%',
              background: isReplaying ? '#38BDF8' : '#FFFFFF',
              boxShadow: isReplaying ? '0 0 6px rgba(0, 162, 255, 0.6)' : '0 0 6px rgba(255, 255, 255, 0.5)',
            }} />
            {isReplaying ? 'REPLAY ACTIVE' : 'LIVE MONITORING'}
          </span>
        </div>

        {/* Spec Sheet Table */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            fontSize: '0.62rem',
            fontFamily: 'var(--font-number)',
            letterSpacing: '0.06em',
            paddingBottom: '6px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
          }}>
            <span style={{ color: 'var(--t3)' }}>
              INDEX
            </span>
            <span style={{
              color: '#FFFFFF',
              fontWeight: 700,
              fontSize: '0.76rem',
              fontFamily: 'var(--font-number)',
            }}>
              {isReplaying ? `#${String(currentSnapshotIndex + 1).padStart(2, '0')}` : '—'}
            </span>
          </div>

          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            fontSize: '0.62rem',
            fontFamily: 'var(--font-number)',
            letterSpacing: '0.06em',
            paddingBottom: '6px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
          }}>
            <span style={{ color: 'var(--t3)' }}>
              TIMESTAMP
            </span>
            <span style={{
              color: '#FFFFFF',
              fontWeight: 700,
              fontSize: '0.72rem',
              fontFamily: 'var(--font-number)',
            }}>
              {isReplaying ? formatTime(activeSnap?.timestamp) : 'LIVE'}
            </span>
          </div>

          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '0.62rem',
            fontFamily: 'var(--font-number)',
            letterSpacing: '0.06em',
          }}>
            <span style={{ color: 'var(--t3)' }}>
              STATUS
            </span>
            {isReplaying ? (
              activeSnap?.hasError ? (
                <span style={{
                  fontSize: '0.52rem',
                  fontWeight: 900,
                  fontFamily: 'var(--font-header)',
                  color: '#FFFFFF',
                  background: 'linear-gradient(135deg, #FF4D52 0%, #FF2E93 100%)',
                  padding: '3px 8px',
                  borderRadius: '3px',
                  letterSpacing: '0.06em',
                  boxShadow: '0 2px 8px rgba(255, 77, 82, 0.2)',
                  userSelect: 'none',
                }}>
                  EXCEPTION
                </span>
              ) : (
                <span style={{
                  fontSize: '0.52rem',
                  fontWeight: 900,
                  fontFamily: 'var(--font-header)',
                  color: '#FFFFFF',
                  background: 'linear-gradient(135deg, #00A2FF 0%, #0066FF 100%)',
                  padding: '3px 8px',
                  borderRadius: '3px',
                  letterSpacing: '0.06em',
                  boxShadow: '0 2px 8px rgba(0, 162, 255, 0.2)',
                  userSelect: 'none',
                }}>
                  STABLE
                </span>
              )
            ) : (
              <span style={{
                fontSize: '0.52rem',
                fontWeight: 900,
                fontFamily: 'var(--font-header)',
                color: '#0A0A0A',
                background: '#FFFFFF',
                padding: '3px 8px',
                borderRadius: '3px',
                letterSpacing: '0.06em',
                boxShadow: '0 2px 8px rgba(255, 255, 255, 0.15)',
                userSelect: 'none',
              }}>
                ACTIVE
              </span>
            )}
          </div>
        </div>

        {/* Action Controls */}
        {isReplaying && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            marginTop: 'auto',
            animation: 'fadeIn 0.15s ease-out',
          }}>
            <button
              onClick={() => restoreSnapshot(currentSnapshotIndex)}
              style={{
                height: '28px',
                background: 'linear-gradient(135deg, #00A2FF 0%, #0066FF 100%)',
                color: '#FFFFFF',
                border: 'none',
                borderRadius: '4px',
                fontSize: '0.56rem',
                fontFamily: 'var(--font-header)',
                fontWeight: 800,
                letterSpacing: '0.08em',
                cursor: 'pointer',
                transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                boxShadow: '0 3px 10px rgba(0, 162, 255, 0.25)',
              }}
              className="premium-action-btn"
            >
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
              RESTORE POINT
            </button>
            <button
              onClick={goToLive}
              style={{
                height: '28px',
                background: 'rgba(255, 255, 255, 0.03)',
                color: 'var(--t2)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '4px',
                fontSize: '0.56rem',
                fontFamily: 'var(--font-header)',
                fontWeight: 800,
                letterSpacing: '0.08em',
                cursor: 'pointer',
                transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
              }}
              className="premium-exit-btn"
            >
              EXIT REPLAY
            </button>
          </div>
        )}
      </div>

      {/* RIGHT COLUMN: SCRUBBER & HISTORY TABLE */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        minWidth: 0,
      }}>

        {/* Mario-themed Scrubber slider track (cardless/borderless) */}
        <div style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          padding: '8px 0',
          height: '32px',
          flexShrink: 0,
        }}>
          {/* Ground dashed track behind blocks */}
          <div style={{
            position: 'absolute',
            left: '12px',
            right: '12px',
            height: '1px',
            borderBottom: '1px dashed var(--line-strong)',
            top: '50%',
            transform: 'translateY(-50%)',
            pointerEvents: 'none',
            zIndex: 0,
          }} />

          {/* Background blocks path */}
          <div style={{
            position: 'absolute',
            left: '0',
            right: '0',
            height: '24px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            pointerEvents: 'none',
            padding: '0 2px',
            zIndex: 1,
          }}>
            {Array.from({ length: snapshots.length + 1 }).map((_, idx) => {
              const isLive = idx === snapshots.length;
              const isCurrent = sliderValue === idx;
              const snap = !isLive ? snapshots[idx] : null;
              const hasError = snap?.hasError;

              // Check if this snapshot is a Vercel deployment
              const snapDeploy = snap ? deployHistory.find((d) => d.snapshotId === snap.id) : null;

              // Determine block appearance
              let blockBorder = '1px solid var(--line-strong)';
              let blockBg = 'var(--s0)';
              let blockContent = '';
              let blockColor = 'var(--t4)';

              if (isLive) {
                blockBorder = isCurrent ? '1px solid #FFFFFF' : '1px solid var(--line-strong)';
                blockBg = isCurrent ? 'rgba(255, 255, 255, 0.08)' : 'var(--s0)';
                blockColor = isCurrent ? '#FFFFFF' : 'var(--t4)';
                blockContent = '⚑';
              } else if (snapDeploy) {
                // Rocket block with sky blue accents
                blockBorder = isCurrent ? '1px solid #38BDF8' : '1px solid rgba(56, 189, 248, 0.4)';
                blockBg = isCurrent ? 'rgba(56, 189, 248, 0.15)' : 'rgba(56, 189, 248, 0.04)';
                blockColor = '#38BDF8';
                blockContent = '🚀';
              } else if (hasError) {
                blockBorder = isCurrent ? '1px solid #FF4D52' : '1px solid rgba(229, 72, 77, 0.25)';
                blockBg = isCurrent ? 'rgba(229, 72, 77, 0.1)' : 'rgba(229, 72, 77, 0.02)';
                blockColor = '#FF4D52';
                blockContent = '⚠';
              } else {
                blockBorder = isCurrent ? '1px solid #00A2FF' : '1px solid var(--line-strong)';
                blockBg = isCurrent ? 'rgba(0, 162, 255, 0.06)' : 'var(--s0)';
                blockColor = isCurrent ? '#38BDF8' : 'var(--t4)';
                blockContent = '?';
              }

              return (
                <div
                  key={idx}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isLive) {
                      goToLive();
                    } else if (snapDeploy) {
                      const confirmRestore = window.confirm(`Restore code from deployment at snapshot #${idx + 1}?`);
                      if (confirmRestore) {
                        restoreSnapshot(idx);
                      }
                    } else {
                      goToSnapshot(idx);
                    }
                  }}
                  style={{
                    width: '20px',
                    height: '20px',
                    border: blockBorder,
                    background: blockBg,
                    color: blockColor,
                    borderRadius: '2px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: 'var(--font-number)',
                    fontSize: '9px',
                    fontWeight: 700,
                    position: 'relative',
                    transition: 'all 0.2s ease',
                    boxShadow: isCurrent ? `0 0 8px ${blockColor}22` : 'none',
                    cursor: 'pointer',
                    pointerEvents: 'auto',
                  }}
                  title={isLive ? 'Live State' : `Snapshot #${idx + 1}${snapDeploy ? ' (Deployed)' : ''}${hasError ? ' (has error)' : ''}`}
                >
                  <div style={{ position: 'absolute', top: 1, left: 1, width: 2, height: 2, background: 'currentColor', opacity: 0.15 }} />
                  <div style={{ position: 'absolute', bottom: 1, right: 1, width: 2, height: 2, background: 'currentColor', opacity: 0.15 }} />
                  {blockContent}
                </div>
              );
            })}

          </div>

          <input
            type="range"
            min="0"
            max={snapshots.length}
            value={sliderValue}
            onChange={handleSliderChange}
            style={{
              width: '100%',
              height: '32px',
              background: 'transparent',
              outline: 'none',
              cursor: 'pointer',
              WebkitAppearance: 'none',
              position: 'relative',
              zIndex: 3,
              margin: 0,
            }}
            className={`timeline-scrubber-slider ${isReplaying ? 'replaying' : 'live'}`}
          />
        </div>

        {/* Tabular History Log (cardless/borderless) */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
        }}>
          {/* Header Row */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            padding: '4px 10px',
            fontSize: '0.58rem',
            color: 'var(--t3)',
            fontWeight: 800,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            borderBottom: '1px solid var(--line-strong)',
            paddingBottom: '6px',
            flexShrink: 0,
            fontFamily: 'var(--font-number)',
          }}>
            <div style={{ width: '60px' }}>Index</div>
            <div style={{ flex: 1 }}>Timestamp / Deployments</div>
            <div style={{ width: '135px' }}>Exception State</div>
            <div style={{ width: '160px', textAlign: 'right' }}>Action</div>
          </div>

          {/* LIVE entry — always first */}
          <div
            onClick={goToLive}
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '8px 10px',
              cursor: 'pointer',
              background: !isReplaying ? 'rgba(255, 255, 255, 0.03)' : 'transparent',
              borderLeft: !isReplaying ? '3px solid #FFFFFF' : '3px solid transparent',
              borderBottom: '1px solid var(--line-faint)',
              transition: 'all 0.15s ease',
              fontSize: '0.68rem',
              fontFamily: 'var(--font-number)',
            }}
            className="timeline-snap-item"
          >
            <div style={{ width: '60px', color: !isReplaying ? '#FFFFFF' : 'var(--t3)', fontWeight: 700 }}>LIVE</div>
            <div style={{ flex: 1, color: !isReplaying ? '#FFFFFF' : 'var(--t2)', fontSize: '0.66rem' }}>System active, listening...</div>
            <div style={{ width: '135px' }}>
              <span style={{
                fontSize: '0.52rem',
                fontWeight: 900,
                fontFamily: 'var(--font-header)',
                color: !isReplaying ? '#0A0A0A' : 'var(--t3)',
                background: !isReplaying ? '#FFFFFF' : 'rgba(255, 255, 255, 0.03)',
                border: !isReplaying ? 'none' : '1px solid rgba(255, 255, 255, 0.08)',
                padding: '2px 6px',
                borderRadius: '3px',
                letterSpacing: '0.04em',
              }}>
                SYNCHRONIZED
              </span>
            </div>
            <div style={{ width: '160px', textAlign: 'right', color: !isReplaying ? '#FFFFFF' : 'var(--t3)', fontSize: '0.54rem', fontFamily: 'var(--font-header)', fontWeight: 800, letterSpacing: '0.06em' }}>
              {!isReplaying ? 'VIEWING' : 'GO LIVE'}
            </div>
          </div>

          {/* Snapshot list entries */}
          {[...snapshots].reverse().map((snap, revIdx) => {
            const originalIdx = snapshots.length - 1 - revIdx;
            const isActive = currentSnapshotIndex === originalIdx;
            const isLastBeforeError = !snap.hasError &&
              originalIdx + 1 < snapshots.length &&
              snapshots[originalIdx + 1]?.hasError;

            const snapDeploy = snap ? deployHistory.find((d) => d.snapshotId === snap.id) : null;

            const rowBg = isActive ? 'rgba(0, 162, 255, 0.05)' : 'transparent';
            const rowBorder = isActive ? '3px solid #00A2FF' : '3px solid transparent';

            return (
              <React.Fragment key={snap.id || originalIdx}>
                <div
                  onClick={() => goToSnapshot(originalIdx)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '8px 10px',
                    cursor: 'pointer',
                    background: rowBg,
                    borderLeft: rowBorder,
                    borderBottom: '1px solid var(--line-faint)',
                    transition: 'all 0.15s ease',
                    fontSize: '0.68rem',
                    fontFamily: 'var(--font-number)',
                  }}
                  className="timeline-snap-item"
                >
                  <div style={{ width: '60px', color: isActive ? '#38BDF8' : 'var(--t3)', fontWeight: 700 }}>
                    #{String(originalIdx + 1).padStart(2, '0')}
                  </div>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', color: isActive ? '#FFFFFF' : 'var(--t2)', fontSize: '0.66rem', gap: '3px' }}>
                    <span>Snapshot captured successfully</span>
                    {snapDeploy && (
                      <a
                        href={snapDeploy.deploymentUrl}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          color: '#38BDF8',
                          textDecoration: 'none',
                          fontFamily: "'Space Grotesk', sans-serif",
                          fontWeight: 600,
                          fontSize: '0.58rem',
                          letterSpacing: '0.02em',
                          borderBottom: '1px dashed rgba(56, 189, 248, 0.4)',
                          paddingBottom: '1px',
                          alignSelf: 'flex-start',
                          transition: 'all 0.2s ease',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.color = '#FFFFFF'; e.currentTarget.style.borderBottomColor = '#FFFFFF'; }}
                        onMouseLeave={e => { e.currentTarget.style.color = '#38BDF8'; e.currentTarget.style.borderBottomColor = 'rgba(56, 189, 248, 0.4)'; }}
                      >
                        Vercel: {snapDeploy.deploymentUrl}
                      </a>
                    )}
                  </div>
                  <div style={{ width: '135px', display: 'flex', gap: '4px', alignItems: 'center' }}>
                    {snapDeploy && (
                      <span style={{
                        fontSize: '0.52rem',
                        fontWeight: 900,
                        fontFamily: 'var(--font-header)',
                        color: '#FFFFFF',
                        background: 'linear-gradient(135deg, #38BDF8 0%, #0066FF 100%)',
                        padding: '2px 6px',
                        borderRadius: '3px',
                        letterSpacing: '0.04em',
                      }}>
                        🚀 DEPLOYED
                      </span>
                    )}
                    {snap.hasError ? (
                      <span style={{
                        fontSize: '0.52rem',
                        fontWeight: 900,
                        fontFamily: 'var(--font-header)',
                        color: '#FFFFFF',
                        background: 'linear-gradient(135deg, #FF4D52 0%, #FF2E93 100%)',
                        padding: '2px 6px',
                        borderRadius: '3px',
                        letterSpacing: '0.04em',
                      }}>
                        EXCEPTION
                      </span>
                    ) : (
                      !snapDeploy && (
                        <span style={{
                          fontSize: '0.52rem',
                          fontWeight: 900,
                          fontFamily: 'var(--font-header)',
                          color: isActive ? '#FFFFFF' : 'var(--t3)',
                          background: isActive ? 'linear-gradient(135deg, #00A2FF 0%, #0066FF 100%)' : 'rgba(255, 255, 255, 0.03)',
                          border: isActive ? 'none' : '1px solid rgba(255, 255, 255, 0.08)',
                          padding: '2px 6px',
                          borderRadius: '3px',
                          letterSpacing: '0.04em',
                        }}>
                          STABLE
                        </span>
                      )
                    )}
                  </div>
                  <div style={{
                    width: '160px',
                    textAlign: 'right',
                    display: 'flex',
                    justifyContent: 'flex-end',
                    gap: '6px',
                    alignItems: 'center',
                  }}>
                    {isActive ? (
                      <>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            restoreSnapshot(originalIdx);
                          }}
                          style={{
                            background: 'linear-gradient(135deg, #00A2FF 0%, #0066FF 100%)',
                            color: '#FFFFFF',
                            border: 'none',
                            borderRadius: '3px',
                            padding: '3px 8px',
                            cursor: 'pointer',
                            fontSize: '0.52rem',
                            fontFamily: 'var(--font-header)',
                            fontWeight: 800,
                            letterSpacing: '0.04em',
                          }}
                        >
                          RESTORE CODE
                        </button>
                        {snapDeploy && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setPendingRedeploy(true);
                              setTerminalActiveTab('deploy');
                            }}
                            style={{
                              background: 'transparent',
                              color: '#38BDF8',
                              border: '1px solid rgba(56, 189, 248, 0.4)',
                              borderRadius: '3px',
                              padding: '2px 8px',
                              cursor: 'pointer',
                              fontSize: '0.52rem',
                              fontFamily: 'var(--font-header)',
                              fontWeight: 800,
                              letterSpacing: '0.04em',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(56, 189, 248, 0.1)'; }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                          >
                            REDEPLOY
                          </button>
                        )}
                      </>
                    ) : (
                      <span style={{
                        color: 'var(--t3)',
                        fontSize: '0.54rem',
                        fontFamily: 'var(--font-header)',
                        fontWeight: 800,
                        letterSpacing: '0.06em',
                      }}>
                        LOAD
                      </span>
                    )}
                  </div>
                </div>


                {isLastBeforeError && (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '4px 10px',
                    background: 'rgba(255,255,255,0.01)',
                    borderBottom: '1px solid var(--line-faint)',
                  }}>
                    <span style={{
                      fontSize: '0.52rem',
                      fontWeight: 800,
                      color: 'var(--t3)',
                      letterSpacing: '0.08em',
                      fontFamily: 'var(--font-number)',
                    }}>
                      ▲ LAST STABLE POINT BEFORE RUNTIME ERROR
                    </span>
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Custom styles for playhead & buttons */}
      <style>{`
        .timeline-scrubber-slider::-webkit-slider-runnable-track {
          width: 100%;
          height: 4px;
          cursor: pointer;
          background: transparent;
          border-radius: 2px;
          border: none;
        }
        .timeline-scrubber-slider::-webkit-slider-thumb {
          height: 24px;
          width: 24px;
          background-position: center;
          background-repeat: no-repeat;
          background-size: contain;
          cursor: pointer;
          -webkit-appearance: none;
          margin-top: 0px; 
          filter: drop-shadow(0 0 6px var(--thumb-shadow));
          transition: transform 0.15s cubic-bezier(0.175, 0.885, 0.32, 1.275);
          background-color: transparent;
          border: none;
        }
        .timeline-scrubber-slider::-webkit-slider-thumb:hover {
          transform: scale(1.2) translateY(-2px);
          filter: drop-shadow(0 0 10px var(--thumb-shadow)) brightness(1.2);
        }
        .timeline-scrubber-slider.replaying::-webkit-slider-thumb {
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath fill='%2300A2FF' d='M5 1h6v1H5z M4 2h9v1H4z M4 3h3v1H4z M7 3h2v1H7z M9 3h1v1H9z M10 3h1v1H10z M3 4h1v1H3z M4 4h1v1H4z M5 4h1v1H5z M6 4h3v1H6z M9 4h1v1H9z M10 4h3v1H10z M3 5h1v1H3z M4 5h2v1H4z M6 5h4v1H6z M10 5h1v1H10z M5 6h5v1H5z M4 7h8v1H4z M3 8h10v1H3z M2 9h12v1H2z M2 10h12v1H2z M4 11h8v1H4z M3 12h3v1H3z M10 12h3v1H10z M2 13h3v1H2z M11 13h3v1H11z'/%3E%3C/svg%3E");
        }
        .timeline-scrubber-slider.live::-webkit-slider-thumb {
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath fill='%23FFFFFF' d='M5 1h6v1H5z M4 2h9v1H4z M4 3h3v1H4z M7 3h2v1H7z M9 3h1v1H9z M10 3h1v1H10z M3 4h1v1H3z M4 4h1v1H4z M5 4h1v1H5z M6 4h3v1H6z M9 4h1v1H9z M10 4h3v1H10z M3 5h1v1H3z M4 5h2v1H4z M6 5h4v1H6z M10 5h1v1H10z M5 6h5v1H5z M4 7h8v1H4z M3 8h10v1H3z M2 9h12v1H2z M2 10h12v1H2z M4 11h8v1H4z M3 12h3v1H3z M10 12h3v1H10z M2 13h3v1H2z M11 13h3v1H11z'/%3E%3C/svg%3E");
        }

        .timeline-scrubber-slider::-moz-range-track {
          width: 100%;
          height: 4px;
          cursor: pointer;
          background: transparent;
          border-radius: 2px;
          border: none;
        }
        .timeline-scrubber-slider::-moz-range-thumb {
          height: 24px;
          width: 24px;
          background-position: center;
          background-repeat: no-repeat;
          background-size: contain;
          cursor: pointer;
          border: none;
          background-color: transparent;
          filter: drop-shadow(0 0 6px var(--thumb-shadow));
          transition: transform 0.15s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        }
        .timeline-scrubber-slider::-moz-range-thumb:hover {
          transform: scale(1.2) translateY(-2px);
          filter: drop-shadow(0 0 10px var(--thumb-shadow)) brightness(1.2);
        }
        .timeline-scrubber-slider.replaying::-moz-range-thumb {
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath fill='%2300A2FF' d='M5 1h6v1H5z M4 2h9v1H4z M4 3h3v1H4z M7 3h2v1H7z M9 3h1v1H9z M10 3h1v1H10z M3 4h1v1H3z M4 4h1v1H4z M5 4h1v1H5z M6 4h3v1H6z M9 4h1v1H9z M10 4h3v1H10z M3 5h1v1H3z M4 5h2v1H4z M6 5h4v1H6z M10 5h1v1H10z M5 6h5v1H5z M4 7h8v1H4z M3 8h10v1H3z M2 9h12v1H2z M2 10h12v1H2z M4 11h8v1H4z M3 12h3v1H3z M10 12h3v1H10z M2 13h3v1H2z M11 13h3v1H11z'/%3E%3C/svg%3E");
        }
        .timeline-scrubber-slider.live::-moz-range-thumb {
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath fill='%23FFFFFF' d='M5 1h6v1H5z M4 2h9v1H4z M4 3h3v1H4z M7 3h2v1H7z M9 3h1v1H9z M10 3h1v1H10z M3 4h1v1H3z M4 4h1v1H4z M5 4h1v1H5z M6 4h3v1H6z M9 4h1v1H9z M10 4h3v1H10z M3 5h1v1H3z M4 5h2v1H4z M6 5h4v1H6z M10 5h1v1H10z M5 6h5v1H5z M4 7h8v1H4z M3 8h10v1H3z M2 9h12v1H2z M2 10h12v1H2z M4 11h8v1H4z M3 12h3v1H3z M10 12h3v1H10z M2 13h3v1H2z M11 13h3v1H11z'/%3E%3C/svg%3E");
        }

        .premium-action-btn:hover {
          background: linear-gradient(135deg, #33B7FF 0%, #1A75FF 100%) !important;
          box-shadow: 0 4px 15px rgba(0, 162, 255, 0.45) !important;
          transform: translateY(-1.5px);
        }
        .premium-action-btn:active {
          transform: translateY(0);
        }
        .premium-exit-btn:hover {
          background: rgba(229, 72, 77, 0.08) !important;
          color: #FF4D52 !important;
          border-color: rgba(229, 72, 77, 0.35) !important;
          box-shadow: 0 4px 12px rgba(229, 72, 77, 0.15) !important;
          transform: translateY(-1.5px);
        }
        .premium-exit-btn:active {
          transform: translateY(0);
        }
        .timeline-snap-item:hover {
          background: rgba(255, 255, 255, 0.015) !important;
        }
      `}</style>
    </div>
  );
};

export default TimelineSlider;
