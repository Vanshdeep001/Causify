/* -------------------------------------------------------
 * DevServerPanel.jsx — Mission Control Dev Server Runner
 * High-Fidelity HUD for Project Life-Cycle Management.
 * ------------------------------------------------------- */

import React, { useState, useEffect, useRef } from 'react';
import useEditorStore from '../../store/useEditorStore';
import causifyLogo from '../../assets/causify-logo.png';
import {
  detectProject,
  startDevServer,
  stopDevServer,
  getDevServerStatus,
} from '../../services/devserver';

/* ── Asset Data ── */
const FRAMEWORK_COLORS = {
  'react-vite': '#61dafb',
  'react-cra': '#61dafb',
  'react': '#61dafb',
  'nextjs': '#fff',
  'vue': '#42b883',
  'angular': '#dd0031',
  'svelte': '#ff3e00',
  'express': '#c1ff72',
  'fastify': '#000',
  'koa': '#333',
  'nestjs': '#e0234e',
  'node': '#c1ff72',
  'hapi': '#fd7e14',
};

const STATE_COLORS = {
  IDLE: '#555',
  PREPARING: '#fbbf24',
  INSTALLING: '#f59e0b',
  STARTING: '#38bdf8',
  RUNNING: '#c1ff72',
  STOPPED: '#6b7280',
  ERROR: '#ef4444',
};

const STATE_LABELS = {
  IDLE: 'SYSTEM READY',
  PREPARING: 'PREPARING FILES',
  INSTALLING: 'SYNCING RESOURCES',
  STARTING: 'STARTING UP',
  RUNNING: 'RUNNING',
  STOPPED: 'STOPPED',
  ERROR: 'ERROR',
};

/* ── Utility: Strip ANSI color codes from strings ── */
const stripAnsi = (str) => {
  if (!str) return "";
  return str.replace(/\x1B\[[;\\d]*m/g, "");
};

/* ── Animated React Atom Icon ── */
const ReactAtom = ({ size = 40, color = '#61dafb', spinning = false }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" style={{
    animation: spinning ? 'spin-slow 4s linear infinite' : 'none',
    filter: spinning ? `drop-shadow(0 0 8px ${color}66)` : 'none'
  }}>
    <circle cx="50" cy="50" r="6" fill={color} />
    <ellipse cx="50" cy="50" rx="40" ry="14" stroke={color} strokeWidth="3" fill="none" opacity="0.4" />
    <ellipse cx="50" cy="50" rx="40" ry="14" stroke={color} strokeWidth="3" fill="none" transform="rotate(60 50 50)" />
    <ellipse cx="50" cy="50" rx="40" ry="14" stroke={color} strokeWidth="3" fill="none" transform="rotate(120 50 50)" />
  </svg>
);

/* ── Node.js Hexagon Icon ── */
const NodeHex = ({ size = 40, color = '#c1ff72', active = false }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" style={{
    filter: active ? `drop-shadow(0 0 8px ${color}66)` : 'none',
    animation: active ? 'hud-flicker 2s infinite' : 'none'
  }}>
    <polygon points="50,5 95,27.5 95,72.5 50,95 5,72.5 5,27.5" stroke={color} strokeWidth="4" fill={color} fillOpacity={active ? 0.3 : 0.1} />
    <text x="50" y="62" textAnchor="middle" fontFamily="'Unbounded', sans-serif" fontWeight="900" fontSize="28" fill={color}>N</text>
  </svg>
);

/* ── HUD Component: Corner Brackets ── */
const HudCornerBrackets = () => (
  <>
    <div className="hud-corner-l" />
    <div className="hud-corner-r" style={{ bottom: '10px', right: '10px', top: 'auto', left: 'auto' }} />
    <div className="hud-corner-r" style={{ top: '10px', right: '10px', bottom: 'auto', left: 'auto', borderBottom: 'none', borderTop: '4px solid var(--accent-toxic-green)' }} />
    <div className="hud-corner-l" style={{ bottom: '10px', left: '10px', top: 'auto', right: 'auto', borderTop: 'none', borderBottom: '4px solid var(--accent-toxic-green)' }} />
  </>
);

/* ── Pulsing Status Dot ── */
const StatusLabel = ({ state }) => {
  const color = STATE_COLORS[state] || '#555';
  const label = STATE_LABELS[state] || 'UNKNOWN';
  const isPulsing = ['RUNNING', 'INSTALLING', 'STARTING', 'PREPARING'].includes(state);

  return (
    <div style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '8px',
      padding: '4px 12px',
      background: '#0a0a0a',
      border: `2px solid ${color}`,
      boxShadow: isPulsing ? `0 0 10px ${color}44` : 'none',
      position: 'relative',
      overflow: 'hidden'
    }}>
      {isPulsing && (
        <div style={{
          position: 'absolute',
          top: 0, left: 0, width: '100%', height: '100%',
          background: `linear-gradient(90deg, transparent, ${color}22, transparent)`,
          animation: 'scanline 2s linear infinite'
        }} />
      )}
      <span style={{
        width: '6px', height: '6px', borderRadius: '50%', background: color,
        animation: isPulsing ? 'pulse-live 1s ease-in-out infinite' : 'none'
      }} />
      <span style={{
        fontFamily: "'Unbounded', sans-serif",
        fontSize: '10px', fontWeight: 900, color: color,
        letterSpacing: '0.05em'
      }}>{label}</span>
    </div>
  );
};

/* ══════════════════════════════════════════════════
 *  SERVER CARD COMPONENT
 * ══════════════════════════════════════════════════ */
const ServerCard = ({ project, serverState, sessionId }) => {
  const logContainerRef = useRef(null);
  const [isExpanded, setIsExpanded] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const updateDevServer = useEditorStore((s) => s.updateDevServer);

  const state = serverState?.state || 'IDLE';
  const rawLogs = serverState?.recentLogs || [];
  const logs = rawLogs.map(stripAnsi);

  const port = serverState?.port || project.defaultPort;
  const url = serverState?.url || `http://localhost:${port}`;
  const fwColor = FRAMEWORK_COLORS[project.framework] || '#c1ff72';
  const isRunning = state === 'RUNNING';
  const isBusy = ['INSTALLING', 'STARTING', 'PREPARING'].includes(state);

  useEffect(() => {
    if (logContainerRef.current && isExpanded) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, isExpanded]);

  const handleStart = async () => {
    setIsLoading(true);
    setIsExpanded(true);
    try {
      const status = await startDevServer(sessionId, project.directory, project.type);
      updateDevServer(project.type, status);
    } catch (err) {
      updateDevServer(project.type, { state: 'ERROR', errorMessage: err.message });
    }
    setIsLoading(false);
  };

  const handleStop = async () => {
    setIsLoading(true);
    try {
      const status = await stopDevServer(sessionId, project.type);
      updateDevServer(project.type, status);
    } catch (err) {
      console.error('Stop error:', err);
    }
    setIsLoading(false);
  };

  const isReactLike = project.framework?.toLowerCase().includes('react') || project.framework?.toLowerCase().includes('vite');

  return (
    <div className="hud-module" style={{
      border: `4px solid ${isRunning ? fwColor : 'var(--color-black)'}`,
      padding: '0', background: '#080808',
      transition: 'all 0.4s cubic-bezier(0.19, 1, 0.22, 1)',
      boxShadow: isRunning ? `10px 10px 0px ${fwColor}` : '6px 6px 0px var(--color-black)'
    }}>
      <HudCornerBrackets />

      {/* Grid Pattern Background */}
      <div style={{
        position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
        backgroundImage: 'radial-gradient(rgba(255,255,255,0.03) 1px, transparent 0)',
        backgroundSize: '20px 20px', pointerEvents: 'none'
      }} />

      {/* Card Header Section */}
      <div style={{
        padding: '24px 30px', position: 'relative', zIndex: 5,
        display: 'flex', flexDirection: 'column', gap: '20px'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', gap: '20px' }}>
            <div style={{ paddingTop: '5px' }}>
              {isReactLike
                ? <ReactAtom size={50} color={fwColor} spinning={isRunning || isBusy} />
                : <NodeHex size={50} color={fwColor} active={isRunning || isBusy} />
              }
            </div>
            <div>
              <h2 style={{
                fontFamily: 'var(--font-header)', fontSize: '1.8rem',
                color: isRunning ? fwColor : '#fff', margin: 0,
                lineHeight: 1, textTransform: 'uppercase', letterSpacing: '-0.03em'
              }}>{project.displayName}</h2>
              <div style={{ display: 'flex', gap: '15px', marginTop: '10px' }}>
                <div style={{
                  fontFamily: 'var(--font-number)', fontSize: '10px',
                  fontWeight: 900, color: '#555', display: 'flex', alignItems: 'center', gap: '6px'
                }}>
                  <span style={{ opacity: 0.5 }}>PATH:</span>
                  <span style={{ color: '#aaa', background: '#111', padding: '2px 6px', border: '1px solid #222' }}>
                    {project.directory || 'ROOT'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '10px' }}>
            {isRunning ? (
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontFamily: 'var(--font-number)', fontSize: '8px', color: fwColor, fontWeight: 900, letterSpacing: '0.1em' }}>PORT</div>
                <div style={{ fontFamily: 'var(--font-number)', fontSize: '1.4rem', color: '#fff', fontWeight: 900 }}>:{port}</div>
              </div>
            ) : (
              <div style={{ textAlign: 'right', opacity: 0.3 }}>
                <div style={{ fontFamily: 'var(--font-number)', fontSize: '8px', color: '#555', fontWeight: 900 }}>DEFAULT PORT</div>
                <div style={{ fontFamily: 'var(--font-number)', fontSize: '1.4rem', color: '#555', fontWeight: 900 }}>:{project.defaultPort}</div>
              </div>
            )}
          </div>
        </div>

        {/* Action Bar */}
        <div style={{
          display: 'flex', gap: '12px', borderTop: '2px solid #1a1a1a', paddingTop: '15px'
        }}>
          {isRunning || isBusy ? (
            <button
              onClick={handleStop}
              disabled={isLoading}
              style={{
                flex: 1, height: '44px', border: 'var(--border-thin)',
                background: 'var(--accent-crimson)', color: '#fff',
                fontFamily: 'var(--font-number)', fontWeight: 900, fontSize: '12px',
                cursor: 'pointer', transition: 'all 0.2s',
                boxShadow: '4px 4px 0px #000'
              }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translate(-2px, -2px)'; e.currentTarget.style.boxShadow = '6px 6px 0px #000'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '4px 4px 0px #000'; }}
            >
              STOP SERVER
            </button>
          ) : (
            <button
              onClick={handleStart}
              disabled={isLoading}
              style={{
                flex: 1, height: '44px', border: 'var(--border-thin)',
                background: fwColor, color: '#000',
                fontFamily: 'var(--font-number)', fontWeight: 900, fontSize: '12px',
                cursor: 'pointer', transition: 'all 0.2s',
                boxShadow: '4px 4px 0px #000'
              }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translate(-2px, -2px)'; e.currentTarget.style.boxShadow = '6px 6px 0px #000'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '4px 4px 0px #000'; }}
            >
              START SERVER
            </button>
          )}

          {isRunning && (
            <a
              href={url} target="_blank" rel="noreferrer"
              style={{
                width: '60px', height: '44px', border: 'var(--border-thin)',
                background: '#fff', color: '#000', display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                boxShadow: '4px 4px 0px #000', transition: 'all 0.2s'
              }}
              onMouseEnter={e => { e.currentTarget.style.background = fwColor; e.currentTarget.style.transform = 'translate(-2px, -2px)'; e.currentTarget.style.boxShadow = '6px 6px 0px #000'; }}
              onMouseLeave={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '4px 4px 0px #000'; }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </a>
          )}

          <button
            onClick={() => setIsExpanded(!isExpanded)}
            style={{
              padding: '0 15px', border: 'var(--border-thin)',
              background: '#111', color: '#555',
              fontFamily: 'var(--font-number)', fontWeight: 900, fontSize: '10px',
              cursor: 'pointer'
            }}
          >
            {isExpanded ? 'HIDE LOGS' : 'SHOW LOGS'}
          </button>
        </div>
      </div>

      {/* Log Console — CRT Style */}
      {isExpanded && (
        <div style={{
          position: 'relative',
          background: '#050505',
          borderTop: '4px solid var(--color-black)',
          padding: '2px'
        }}>
          <div style={{
            position: 'absolute', top: 0, left: 0, height: '2px', width: '2px',
            background: fwColor, boxShadow: `0 0 10px ${fwColor}`, zIndex: 10
          }} />

          <div
            ref={logContainerRef}
            className="hud-scanlines"
            style={{
              height: '320px', overflowY: 'auto',
              padding: '20px',
              fontFamily: 'var(--font-mono)',
              fontSize: '11px', lineHeight: '1.7',
              color: '#aaccff', background: '#0a0a0a',
              position: 'relative'
            }}
          >
            {logs.length === 0 ? (
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#333' }}>
                <span className="hud-glitch-text">WAITING FOR OUTPUT...</span>
              </div>
            ) : (
              <div style={{ position: 'relative', zIndex: 5 }}>
                {logs.map((line, i) => (
                  <div key={i} style={{
                    color: line.includes('✓') ? 'var(--accent-toxic-green)'
                      : line.includes('✗') ? 'var(--accent-crimson)'
                        : line.includes('PHASE') ? '#fbbf24'
                          : line.includes('$') ? 'var(--accent-electric-blue)'
                            : line.includes('Local:') || line.includes('Network:') ? fwColor
                              : '#aaccff',
                    opacity: line.includes('━') || line.includes('──') ? 0.3 : 0.9,
                    textShadow: line.includes('✓') ? `0 0 5px ${fwColor}` : 'none',
                    fontWeight: line.includes('PHASE') || line.includes('✓') ? 900 : 400,
                    marginBottom: '2px'
                  }}>
                    {line}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const DevServerPanel = () => {
  const sessionId = useEditorStore((s) => s.sessionId);
  const detectedProjects = useEditorStore((s) => s.detectedProjects);
  const devServers = useEditorStore((s) => s.devServers);
  const projectDetected = useEditorStore((s) => s.projectDetected);
  const setDetectedProjects = useEditorStore((s) => s.setDetectedProjects);
  const updateDevServer = useEditorStore((s) => s.updateDevServer);

  const [activeIdx, setActiveIdx] = useState(0);
  const [isDetecting, setIsDetecting] = useState(false);
  const [detectError, setDetectError] = useState('');
  const pollingRef = useRef(null);

  useEffect(() => {
    if (sessionId && !projectDetected) handleDetect();
  }, [sessionId]);

  useEffect(() => {
    const hasActiveServer = Object.values(devServers).some(
      s => s?.state && !['IDLE', 'STOPPED', 'ERROR'].includes(s.state)
    );

    if (hasActiveServer && sessionId) {
      pollingRef.current = setInterval(async () => {
        try {
          const status = await getDevServerStatus(sessionId);
          if (status?.servers) {
            Object.entries(status.servers).forEach(([type, serverStatus]) => {
              updateDevServer(type, serverStatus);
            });
          }
        } catch (err) { }
      }, 2000);
    }
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [devServers, sessionId]);

  const handleDetect = async () => {
    if (!sessionId) return;
    setIsDetecting(true);
    setDetectError('');
    try {
      const result = await detectProject(sessionId);
      setDetectedProjects(result.projects || []);
      if (result.projects?.length > 0) setActiveIdx(0); // Reset to first on scan
      if (!result.projects || result.projects.length === 0) {
        setDetectError('No React/Node projects detected in this session.');
      }
    } catch (err) {
      setDetectError(err.message || 'Detection failed');
    }
    setIsDetecting(false);
  };

  if (!sessionId) return null;

  const currentProject = detectedProjects[activeIdx];

  return (
    <div style={{ padding: '20px', height: '100%', overflowY: 'auto', background: 'var(--bg-paper)' }}>
      {/* HUD Header Banner */}
      <div style={{
        margin: '0 0 20px', padding: '16px 20px',
        background: 'var(--color-black)', border: 'var(--border-thick)',
        boxShadow: '4px 4px 0px var(--accent-electric-blue)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center'
      }}>
        <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
          <div style={{
            width: '38px', height: '38px', background: 'var(--accent-toxic-green)',
            border: 'var(--border-thin)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '3px 3px 0px #000', overflow: 'hidden'
          }}>
            <img src={causifyLogo} alt="Mission Control Logo" style={{ width: '80%', height: '80%', objectFit: 'contain' }} />
          </div>
          <div>
            <h1 className="logo-text" style={{ fontSize: '1.4rem', color: '#fff', margin: 0, letterSpacing: '0.05em' }}>MISSION CONTROL</h1>
            <div className="hud-ticker" style={{ fontSize: '8px', opacity: 0.6 }}>
              LIVE_ENVIRONMENT_ORCHESTRATOR
            </div>
          </div>
        </div>

        <button
          onClick={handleDetect}
          disabled={isDetecting}
          className="tech-label"
          style={{
            cursor: 'pointer', background: isDetecting ? '#111' : '#fff',
            color: '#000', fontSize: '9px', padding: '6px 14px',
            boxShadow: '3px 3px 0px #000', transition: 'all 0.1s'
          }}
        >
          {isDetecting ? "SCANNING..." : "REFRESH"}
        </button>
      </div>

      {detectError && (
        <div style={{
          padding: '15px', border: 'var(--border-thick)', background: '#fff',
          boxShadow: 'var(--shadow-brutal)', color: 'var(--accent-crimson)',
          fontFamily: 'var(--font-header)', fontWeight: 800, marginBottom: '20px'
        }}>
          SYSTEM_ERROR: {detectError.toUpperCase()}
        </div>
      )}

      {/* Project Switcher Bar */}
      {detectedProjects.length > 1 && (
        <div style={{ 
          display: 'flex', gap: '10px', marginBottom: '25px', 
          background: '#eee', padding: '4px', border: 'var(--border-thin)'
        }}>
          {detectedProjects.map((p, idx) => {
            const isActive = activeIdx === idx;
            const server = devServers[p.type];
            const isRunning = server?.state === 'RUNNING';
            
            return (
              <button
                key={idx}
                onClick={() => setActiveIdx(idx)}
                style={{
                  flex: 1, padding: '10px 15px', border: 'none',
                  background: isActive ? '#000' : 'transparent',
                  color: isActive ? '#fff' : '#555',
                  fontFamily: 'var(--font-header)', fontSize: '0.7rem', fontWeight: 900,
                  cursor: 'pointer', transition: 'all 0.2s',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                  textTransform: 'uppercase', letterSpacing: '0.1em'
                }}
              >
                {isRunning && (
                  <div style={{ 
                    width: '6px', height: '6px', borderRadius: '50%', background: 'var(--accent-toxic-green)',
                    boxShadow: '0 0 10px var(--accent-toxic-green)'
                  }} />
                )}
                {p.type.replace('_', ' ')}
              </button>
            );
          })}
        </div>
      )}

      {/* Active Project View */}
      <div style={{ animation: 'fade-in 0.3s ease-out' }}>
        {currentProject && (
          <ServerCard 
            key={currentProject.type} 
            project={currentProject} 
            serverState={devServers[currentProject.type]} 
            sessionId={sessionId} 
          />
        )}
      </div>



      {!detectError && detectedProjects.length === 0 && (
        <div style={{ padding: '60px', textAlign: 'center', border: '4px dashed #ddd', opacity: 0.5 }}>
          <div style={{ fontSize: '4rem' }}>📡</div>
          <h3 style={{ fontFamily: 'var(--font-header)', fontSize: '1.5rem', marginTop: '20px' }}>WAITING FOR PROJECT SIGNALS...</h3>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.9rem' }}>Upload a folder containing a package.json to initialize development servers.</p>
        </div>
      )}
    </div>
  );
};

export default DevServerPanel;
