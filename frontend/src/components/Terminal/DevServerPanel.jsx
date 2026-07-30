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
  'express': '#FFFFFF',
  'fastify': '#000',
  'koa': '#333',
  'nestjs': '#e0234e',
  'node': '#FFFFFF',
  'hapi': '#fd7e14',
};

const STATE_COLORS = {
  IDLE: '#6E6E6E',
  PREPARING: '#FFB224',
  INSTALLING: '#FFB224',
  STARTING: '#FFB224',
  RUNNING: '#FFFFFF',
  STOPPED: '#6E6E6E',
  ERROR: '#E5484D',
};

const STATE_LABELS = {
  IDLE: 'READY',
  PREPARING: 'PREPARING',
  INSTALLING: 'SYNCING',
  STARTING: 'STARTING',
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
const ReactAtom = ({ size = 26, color = '#EDEDED', spinning = false }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" style={{
    animation: spinning ? 'spin-slow 8s linear infinite' : 'none',
    transition: 'all 0.3s ease'
  }}>
    <circle cx="50" cy="50" r="6" fill={color} />
    <ellipse cx="50" cy="50" rx="40" ry="14" stroke={color} strokeWidth="3" fill="none" opacity="0.3" />
    <ellipse cx="50" cy="50" rx="40" ry="14" stroke={color} strokeWidth="3" fill="none" transform="rotate(60 50 50)" />
    <ellipse cx="50" cy="50" rx="40" ry="14" stroke={color} strokeWidth="3" fill="none" transform="rotate(120 50 50)" />
  </svg>
);

/* ── Node.js Hexagon Icon ── */
const NodeHex = ({ size = 26, color = '#EDEDED', active = false }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" style={{
    transition: 'all 0.3s ease'
  }}>
    <polygon points="50,5 95,27.5 95,72.5 50,95 5,72.5 5,27.5" stroke={color} strokeWidth="4" fill="none" />
    <text x="50" y="62" textAnchor="middle" fontFamily="'Space Grotesk', sans-serif" fontWeight="900" fontSize="30" fill={color}>N</text>
  </svg>
);

/* ── Flat Telemetry Row ── */
const TelemetryLine = ({ label, value, color }) => (
  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px', padding: '3px 0', whiteSpace: 'nowrap' }}>
    <span style={{ fontFamily: 'var(--font-number)', fontSize: '8px', color: 'var(--t3)', letterSpacing: '0.08em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
      {label}
    </span>
    <span style={{ fontFamily: 'var(--font-number)', fontSize: '0.7rem', color: color || 'var(--t1)', fontWeight: 600, whiteSpace: 'nowrap' }}>
      {value}
    </span>
  </div>
);

/* ── Pulsing Status Dot ── */
const StatusLabel = ({ state }) => {
  const color = STATE_COLORS[state] || '#6E6E6E';
  const label = STATE_LABELS[state] || 'UNKNOWN';
  const isPulsing = ['RUNNING', 'INSTALLING', 'STARTING', 'PREPARING'].includes(state);

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
      <span style={{
        width: '4px', height: '4px', borderRadius: '50%', background: color,
        boxShadow: isPulsing ? `0 0 6px ${color}` : 'none',
        animation: isPulsing ? 'pulse-live 1s ease-in-out infinite' : 'none'
      }} />
      <span style={{
        fontFamily: "'Space Grotesk', sans-serif",
        fontSize: '8px', fontWeight: 800, color: color,
        letterSpacing: '0.04em'
      }}>{label}</span>
    </div>
  );
};

/* ══════════════════════════════════════════════════
 *  SERVER CARD COMPONENT
 * ══════════════════════════════════════════════════ */
const ServerCard = ({ project, serverState, scope, isLocal }) => {
  const logContainerRef = useRef(null);
  const [isLoading, setIsLoading] = useState(false);
  const updateDevServer = useEditorStore((s) => s.updateDevServer);

  const state = serverState?.state || 'IDLE';
  const rawLogs = serverState?.recentLogs || [];
  const logs = rawLogs.map(stripAnsi);

  const port = serverState?.port || project.defaultPort;
  const url = serverState?.url || `http://localhost:${port}`;
  const isRunning = state === 'RUNNING';
  const isBusy = ['INSTALLING', 'STARTING', 'PREPARING'].includes(state);

  // Live telemetry simulation
  const [uptime, setUptime] = useState(0);
  const [cpu, setCpu] = useState(0);
  const [memory, setMemory] = useState(0);

  useEffect(() => {
    let interval;
    if (isRunning) {
      setCpu(Math.floor(Math.random() * 8) + 2);
      setMemory(Math.floor(Math.random() * 20) + 140);
      interval = setInterval(() => {
        setUptime(u => u + 1);
        setCpu(Math.floor(Math.random() * 8) + 2);
        setMemory(Math.floor(Math.random() * 20) + 140);
      }, 1000);
    } else {
      setUptime(0);
      setCpu(0);
      setMemory(0);
    }
    return () => clearInterval(interval);
  }, [isRunning]);

  const formatUptime = (secs) => {
    const h = Math.floor(secs / 3600).toString().padStart(2, '0');
    const m = Math.floor((secs % 3600) / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
  };

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  const handleStart = async () => {
    setIsLoading(true);
    try {
      const status = await startDevServer(scope, project.directory, project.type, { local: isLocal });
      updateDevServer(project.type, status);
    } catch (err) {
      updateDevServer(project.type, { state: 'ERROR', errorMessage: err.message });
    }
    setIsLoading(false);
  };

  const handleStop = async () => {
    setIsLoading(true);
    try {
      const status = await stopDevServer(scope, project.type, { local: isLocal });
      updateDevServer(project.type, status);
    } catch (err) {
      console.error('Stop error:', err);
    }
    setIsLoading(false);
  };

  const isReactLike = project.framework?.toLowerCase().includes('react') || project.framework?.toLowerCase().includes('vite');
  const themeColor = isReactLike ? '#61dafb' : '#6DB33F';

  return (
    <div style={{
      padding: '0',
      background: 'transparent',
      position: 'relative',
      overflow: 'visible',
    }}>
      <div style={{ display: 'flex', flexDirection: 'row', gap: '24px', flexWrap: 'wrap' }}>
        
        {/* LEFT COLUMN: Controls & Uptime telemetry */}
        <div style={{ flex: '1 1 280px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          {/* Header Title Info */}
          <div style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
            <div style={{
              width: '36px', height: '36px',
              border: `1px solid ${isRunning || isBusy ? themeColor : '#2E2E2E'}`,
              borderRadius: '2px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'transparent',
              transition: 'all 0.3s ease'
            }}>
              {isReactLike
                ? <ReactAtom size={22} color={isRunning || isBusy ? '#61dafb' : '#6E6E6E'} spinning={isRunning || isBusy} />
                : <NodeHex size={22} color={isRunning || isBusy ? '#6DB33F' : '#6E6E6E'} active={isRunning || isBusy} />
              }
            </div>
            <div>
              <h2 style={{
                fontFamily: 'var(--font-header)', fontSize: '1.15rem',
                color: 'var(--t1)', margin: 0,
                lineHeight: 1.1, textTransform: 'uppercase', letterSpacing: '-0.02em'
              }}>{project.displayName}</h2>
              <div style={{
                fontFamily: 'var(--font-number)', fontSize: '0.62rem',
                color: 'var(--t3)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '6px'
              }}>
                <span>PATH</span>
                <span style={{
                  color: isRunning || isBusy ? themeColor : 'var(--t2)',
                  background: 'var(--s2)',
                  padding: '1px 5px',
                  border: `1px solid ${isRunning || isBusy ? themeColor + '40' : '#2E2E2E'}`,
                  borderRadius: '2px',
                  transition: 'all 0.3s ease'
                }}>
                  {project.directory || 'ROOT'}
                </span>
              </div>
            </div>
          </div>

          {/* Telemetry Matrix (Flat Dot Leaders) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <TelemetryLine label="PORT" value={isRunning ? `:${port}` : 'CLOSED'} color={isRunning ? 'var(--t1)' : 'var(--t4)'} />
            <TelemetryLine label="STATE" value={<StatusLabel state={state} />} />
            <TelemetryLine label="UPTIME" value={isRunning ? formatUptime(uptime) : 'OFFLINE'} color={isRunning ? 'var(--t1)' : 'var(--t4)'} />
            <TelemetryLine label="LOAD" value={isRunning ? `${cpu}% CPU / ${memory}MB` : 'STABLE'} color={isRunning ? 'var(--t1)' : 'var(--t4)'} />
          </div>

          {/* Action Sequencer switch controller */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', gap: '10px' }}>
              {/* ACTIVATE */}
              <button
                onClick={!isRunning && !isBusy ? handleStart : undefined}
                disabled={isLoading || isBusy || isRunning}
                style={{
                  flex: 1,
                  height: '32px',
                  borderRadius: '2px',
                  border: `1px solid ${isRunning ? '#FFFFFF' : '#333'}`,
                  background: isRunning ? '#FFFFFF' : 'transparent',
                  color: isRunning ? '#000000' : 'var(--t3)',
                  fontFamily: "'Space Grotesk', sans-serif",
                  fontWeight: 700,
                  fontSize: '0.66rem',
                  letterSpacing: '0.04em',
                  cursor: isRunning || isBusy ? 'default' : 'pointer',
                  transition: 'all 0.2s ease',
                  opacity: isBusy ? 0.5 : 1,
                }}
                onMouseEnter={e => { if (!isRunning && !isBusy) { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = '#FFFFFF'; e.currentTarget.style.borderColor = '#FFFFFF'; } }}
                onMouseLeave={e => { if (!isRunning && !isBusy) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--t3)'; e.currentTarget.style.borderColor = '#333'; } }}
              >
                {isBusy ? 'SYNCING...' : 'ACTIVATE'}
              </button>
              
              {/* DEACTIVATE */}
              <button
                onClick={isRunning ? handleStop : undefined}
                disabled={isLoading || isBusy || !isRunning}
                style={{
                  flex: 1,
                  height: '32px',
                  borderRadius: '2px',
                  border: `1px solid ${(!isRunning && !isBusy) ? 'rgba(229, 72, 77, 0.2)' : (isRunning ? 'var(--crimson)' : '#333')}`,
                  background: isRunning ? 'transparent' : 'rgba(229, 72, 77, 0.04)',
                  color: isRunning ? 'var(--crimson)' : 'var(--t4)',
                  fontFamily: "'Space Grotesk', sans-serif",
                  fontWeight: 700,
                  fontSize: '0.66rem',
                  letterSpacing: '0.04em',
                  cursor: !isRunning || isBusy ? 'default' : 'pointer',
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={e => { if (isRunning && !isBusy) { e.currentTarget.style.background = 'rgba(229, 72, 77, 0.1)'; e.currentTarget.style.color = 'var(--crimson)'; e.currentTarget.style.borderColor = 'var(--crimson)'; } }}
                onMouseLeave={e => { if (isRunning && !isBusy) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--crimson)'; e.currentTarget.style.borderColor = 'var(--crimson)'; } }}
              >
                DEACTIVATE
              </button>
            </div>

            {/* Launch browser link (Flat underlined link) */}
            {isRunning && (
              <a
                href={url} target="_blank" rel="noreferrer"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  color: themeColor,
                  textDecoration: 'none',
                  fontFamily: "'Space Grotesk', sans-serif",
                  fontWeight: 600,
                  fontSize: '0.68rem',
                  letterSpacing: '0.04em',
                  marginTop: '4px',
                  borderBottom: `1px solid ${themeColor}80`,
                  paddingBottom: '2px',
                  alignSelf: 'flex-start',
                  transition: 'all 0.2s ease'
                }}
                onMouseEnter={e => { e.currentTarget.style.color = '#FFFFFF'; e.currentTarget.style.borderBottomColor = '#FFFFFF'; }}
                onMouseLeave={e => { e.currentTarget.style.color = themeColor; e.currentTarget.style.borderBottomColor = themeColor + '80'; }}
              >
                LAUNCH BROWSER
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </a>
            )}
          </div>
        </div>

        {/* CENTER DIVIDER: Solid vertical guide */}
        <div style={{ flex: '0 0 1px', borderRight: '1px solid #2E2E2E', alignSelf: 'stretch', margin: '4px 0', minHeight: '140px' }} />

        {/* RIGHT COLUMN: Output Stream Monitor Console */}
        <div style={{ flex: '2 2 400px', display: 'flex', flexDirection: 'column', minWidth: '300px', overflow: 'hidden' }}>
          
          {/* Console Header */}
          <div style={{
            background: 'transparent',
            padding: '0 0 8px 0',
            borderBottom: '1px solid #2E2E2E',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <span style={{ fontFamily: 'var(--font-number)', fontSize: '8px', color: 'var(--t3)', letterSpacing: '0.12em', fontWeight: 600 }}>LOG STREAM</span>
            <span style={{
              fontFamily: 'var(--font-number)',
              fontSize: '7px',
              color: isRunning ? themeColor : 'var(--t4)',
              letterSpacing: '0.04em',
              textShadow: isRunning ? `0 0 6px ${themeColor}40` : 'none',
              transition: 'all 0.3s ease'
            }}>
              {isRunning ? 'RECEIVING_FEED' : 'OFFLINE'}
            </span>
          </div>

          {/* Console Body */}
          <div style={{
            position: 'relative',
            background: '#070707',
            border: '1px solid #232323',
            borderRadius: '2px',
            flex: 1,
            height: '180px',
            minHeight: '180px',
            marginTop: '8px',
            overflow: 'hidden'
          }}>
            {/* CRT Screen Scanline Filter Overlay */}
            <div style={{
              position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
              background: 'linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.25) 50%), linear-gradient(90deg, rgba(255, 0, 0, 0.04), rgba(0, 255, 0, 0.01), rgba(0, 255, 0, 0.03))',
              backgroundSize: '100% 2px, 3px 100%',
              opacity: 0.15,
              pointerEvents: 'none',
              zIndex: 10
            }} />
            
            <div
              ref={logContainerRef}
              style={{
                height: '100%', overflowY: 'auto',
                padding: '10px 12px',
                background: '#070707',
                position: 'relative',
                zIndex: 5
              }}
            >
              {logs.length === 0 ? (
                <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{
                    fontFamily: "var(--font-number)", fontSize: '0.5rem',
                    color: 'var(--t4)', letterSpacing: '0.2em', fontWeight: 600,
                  }}>AWAITING OUTPUT STREAM</span>
                </div>
              ) : (
                <div style={{ position: 'relative' }}>
                  {logs.map((line, i) => {
                    const isSeparator = line.includes('━') || line.includes('──');
                    const isPhase = line.includes('PHASE') || line.includes('CAUSIFY DEV SERVER');
                    const isSuccess = line.includes('✓');
                    const isError = line.includes('✗') || line.includes('ERROR');
                    const isCommand = line.trimStart().startsWith('$');
                    const isUrl = line.includes('Local:') || line.includes('→ Detected') || line.includes('SERVER IS RUNNING');
                    const isValidation = line.includes('package.json:') || line.includes('index.html:') || line.includes('entry point:') || line.includes('Total files') || line.includes('src/:');
                    const isEmpty = line.trim() === '';

                    if (isSeparator) return <div key={i} style={{ height: '1px', background: 'var(--line)', margin: '6px 0' }} />;
                    if (isEmpty) return <div key={i} style={{ height: '3px' }} />;

                    return (
                      <div key={i} style={{
                        fontFamily: isPhase
                          ? "'Space Grotesk', sans-serif"
                          : "var(--font-mono, 'JetBrains Mono', monospace)",
                        fontSize: isPhase ? '0.58rem' : '0.62rem',
                        lineHeight: isPhase ? 1 : 1.6,
                        letterSpacing: isPhase ? '0.12em' : '0.01em',
                        color: isPhase ? 'var(--t3)'
                          : isUrl ? 'var(--t1)'
                          : isSuccess ? 'var(--t2)'
                          : isError ? 'var(--t4)'
                          : isCommand ? 'var(--t2)'
                          : isValidation ? 'var(--t4)'
                          : 'var(--t3)',
                        fontWeight: isPhase ? 900 : isSuccess || isCommand || isUrl ? 600 : 400,
                        marginTop: isPhase ? '6px' : '0',
                        marginBottom: isPhase ? '2px' : '1px',
                        paddingLeft: isValidation ? '6px' : '0',
                        borderLeft: isValidation ? '1px solid var(--line)' : 'none',
                      }}>
                        {isPhase ? line.replace(/[🚀📦⚡📂🔍]/g, '').trim() : line}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};

const DevServerPanel = () => {
  const sessionId = useEditorStore((s) => s.sessionId);
  // A locally opened folder runs its dev server in place, with no session at all.
  // The folder path is the scope everything else keys off.
  const workspaceRoot = useEditorStore((s) => s.workspaceRoot);
  const isLocal = Boolean(workspaceRoot);
  const scope = workspaceRoot || sessionId;

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
    if (scope && !projectDetected) handleDetect();
  }, [scope]);

  useEffect(() => {
    const hasActiveServer = Object.values(devServers).some(
      s => s?.state && !['IDLE', 'STOPPED', 'ERROR'].includes(s.state)
    );

    if (hasActiveServer && scope) {
      pollingRef.current = setInterval(async () => {
        try {
          const status = await getDevServerStatus(scope);
          if (status?.servers) {
            Object.entries(status.servers).forEach(([type, serverStatus]) => {
              updateDevServer(type, serverStatus);
            });
          }
        } catch (err) { }
      }, 2000);
    }
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [devServers, scope]);

  const handleDetect = async () => {
    if (!scope) return;
    setIsDetecting(true);
    setDetectError('');
    try {
      const result = await detectProject(scope, { local: isLocal });
      setDetectedProjects(result.projects || []);
      if (result.projects?.length > 0) setActiveIdx(0); // Reset to first on scan
      if (!result.projects || result.projects.length === 0) {
        setDetectError(isLocal
          ? 'No React/Node projects detected in this folder.'
          : 'No React/Node projects detected in this session.');
      }
    } catch (err) {
      setDetectError(err.message || 'Detection failed');
    }
    setIsDetecting(false);
  };

  // Needs either an open folder or a session — otherwise there's no project to run.
  if (!scope) return null;

  const currentProject = detectedProjects[activeIdx];

  return (
    <div style={{ padding: '16px', height: '100%', overflowY: 'auto', background: 'var(--s0)' }}>
      {/* HUD Header Banner */}
      <div style={{
        margin: '0 0 24px', padding: '8px 0',
        background: 'transparent', borderBottom: '1px solid #2E2E2E',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center'
      }}>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <div style={{
            width: '32px', height: '32px', border: '1px solid #2E2E2E',
            borderRadius: '2px', display: 'flex', alignItems: 'center', justifyContent: 'center',
            overflow: 'hidden'
          }}>
            <img src={causifyLogo} alt="Mission Control Logo" style={{ width: '75%', height: '75%', objectFit: 'contain' }} />
          </div>
          <div>
            {/* VT323, the terminal face. A pixel font renders small for its em
                and has one weight, so the size goes up and 900 comes off;
                tracking opens out rather than tightening, which is what a pixel
                grid needs. */}
            <h1 className="logo-text" style={{
              fontFamily: "'VT323', 'Silkscreen', monospace",
              fontSize: '1.6rem', fontWeight: 400, letterSpacing: '0.06em', margin: 0,
              display: 'flex', alignItems: 'center', gap: '6px'
            }}>
              <span style={{ color: 'var(--t1)' }}>MISSION</span>
              <span style={{
                color: 'transparent',
                WebkitTextStroke: '1px var(--t1)',
                WebkitTextFillColor: 'transparent',
              }}>CONTROL</span>
            </h1>
          </div>
        </div>

        <button
          onClick={handleDetect}
          disabled={isDetecting}
          style={{
            cursor: 'pointer',
            background: 'transparent',
            color: 'var(--t1)',
            fontFamily: "'Space Grotesk', sans-serif",
            fontWeight: 600,
            border: '1px solid rgba(255, 255, 255, 0.75)',
            borderRadius: '3px',
            fontSize: '0.62rem',
            letterSpacing: '0.06em',
            padding: '6px 14px',
            transition: 'all 0.2s ease',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--t1)'; e.currentTarget.style.color = 'var(--s0)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--t1)'; }}
        >
          {isDetecting ? "SCANNING..." : "REFRESH"}
        </button>
      </div>

      {detectError && (
        <div style={{
          padding: '12px 16px', border: '1px solid var(--crimson)', background: 'rgba(229, 72, 77, 0.08)',
          color: 'var(--crimson)', borderRadius: '2px',
          fontFamily: 'var(--font-header)', fontWeight: 800, fontSize: '0.72rem', marginBottom: '16px'
        }}>
          SYSTEM_ERROR: {detectError.toUpperCase()}
        </div>
      )}

      {/* Project Switcher Bar */}
      {detectedProjects.length > 1 && (
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: '14px', 
          marginBottom: '24px',
          paddingBottom: '12px',
          borderBottom: '1px solid #141414'
        }}>
          <span style={{ 
            fontFamily: 'var(--font-number)', 
            fontSize: '8px', 
            color: 'var(--t3)', 
            letterSpacing: '0.12em', 
            fontWeight: 800,
            textTransform: 'uppercase',
            whiteSpace: 'nowrap'
          }}>
            SELECT SYSTEM
          </span>
          
          <div style={{ 
            display: 'flex', 
            background: '#090909', 
            border: '1px solid #202020', 
            borderRadius: '4px', 
            padding: '2px',
            gap: '2px',
            alignItems: 'center'
          }}>
            {detectedProjects.map((p, idx) => {
              const isActive = activeIdx === idx;
              const server = devServers[p.type];
              const isRunning = server?.state === 'RUNNING';
              
              // Determine tech stack color
              const typeLower = p.type?.toLowerCase() || '';
              const fwLower = p.framework?.toLowerCase() || '';
              const isReact = typeLower.includes('frontend') || fwLower.includes('react') || fwLower.includes('vite') || fwLower.includes('next') || fwLower.includes('vue') || fwLower.includes('svelte');
              const themeColor = isReact ? '#61dafb' : '#6DB33F';
              const bgTint = isActive ? (isReact ? 'rgba(97, 218, 251, 0.08)' : 'rgba(109, 179, 63, 0.08)') : 'transparent';

              return (
                <button
                  key={idx}
                  onClick={() => setActiveIdx(idx)}
                  style={{
                    padding: '6px 14px',
                    borderRadius: '2px',
                    border: 'none',
                    background: bgTint,
                    color: isActive ? themeColor : 'var(--t3)',
                    fontFamily: "'Space Grotesk', sans-serif",
                    fontSize: '0.62rem',
                    fontWeight: 700,
                    cursor: 'pointer', 
                    transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center', 
                    gap: '6px',
                    textTransform: 'uppercase', 
                    letterSpacing: '0.08em',
                    textShadow: isActive ? `0 0 6px ${themeColor}40` : 'none',
                  }}
                  onMouseEnter={e => {
                    if (!isActive) {
                      e.currentTarget.style.color = themeColor;
                      e.currentTarget.style.background = themeColor + '08';
                    }
                  }}
                  onMouseLeave={e => {
                    if (!isActive) {
                      e.currentTarget.style.color = 'var(--t3)';
                      e.currentTarget.style.background = 'transparent';
                    }
                  }}
                >
                  {isActive && (
                    <span style={{ 
                      color: themeColor, 
                      marginRight: '2px', 
                      fontFamily: 'var(--font-mono)', 
                      fontSize: '0.68rem',
                      lineHeight: 1
                    }}>&rsaquo;</span>
                  )}
                  <span>{p.type.toUpperCase().replace('_', ' ')}</span>
                  
                  {isRunning && (
                    <div style={{ 
                      width: '4px', 
                      height: '4px', 
                      borderRadius: '50%', 
                      background: themeColor,
                      boxShadow: `0 0 6px ${themeColor}`,
                      marginLeft: '2px'
                    }} />
                  )}
                </button>
              );
            })}
          </div>
          
          {/* Decorative Terminal Line Grid */}
          <div style={{ flex: 1, height: '1px', background: 'linear-gradient(90deg, #202020, transparent)', marginLeft: '4px' }} />
        </div>
      )}

      {/* Active Project View */}
      <div style={{ animation: 'fade-in 0.3s ease-out' }}>
        {currentProject && (
          <ServerCard 
            key={currentProject.type} 
            project={currentProject} 
            serverState={devServers[currentProject.type]}
            scope={scope}
            isLocal={isLocal}
          />
        )}
      </div>

      {!detectError && detectedProjects.length === 0 && (
        <div style={{ padding: '48px 0', textAlign: 'center', background: 'transparent' }}>
          <div style={{ fontSize: '2rem', marginBottom: '12px' }}>📡</div>
          <h3 style={{ fontFamily: 'var(--font-header)', fontSize: '1rem', color: 'var(--t2)', margin: '0 0 8px' }}>WAITING FOR PROJECT SIGNALS...</h3>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.74rem', color: 'var(--t3)', margin: 0 }}>Upload a folder containing a package.json to initialize development servers.</p>
        </div>
      )}
    </div>
  );
};

export default DevServerPanel;
