/* -------------------------------------------------------
 * DeployPanel.jsx — One-Click Vercel Deployment Panel
 *
 * Full deployment panel with split-column layout:
 *   Left:  Deploy controls, status, telemetry
 *   Right: Live build log stream (CRT console aesthetic)
 *
 * Follows the same design language as DevServerPanel.jsx —
 * flat, cardless, premium typography.
 * ------------------------------------------------------- */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import useEditorStore from '../../store/useEditorStore';
import ConnectVercelModal from './ConnectVercelModal';
import EnvConfirmModal from './EnvConfirmModal';
import LinkProjectModal from './LinkProjectModal';

/* ── Utility: Strip ANSI color codes ── */
const stripAnsi = (str) => {
  if (!str) return '';
  return str.replace(/\x1B\[[;\d]*m/g, '').replace(/\x1B\[\?[;\d]*[a-zA-Z]/g, '');
};

/* ── Status Configuration ── */
const STATUS_CONFIG = {
  idle:        { label: 'READY',       color: '#6E6E6E', pulse: false },
  connecting:  { label: 'CONNECTING',  color: '#FFB224', pulse: true },
  'env-confirm':{ label: 'CONFIRMING', color: '#FFB224', pulse: false },
  'pushing-env':{ label: 'PUSHING ENV',color: '#FFB224', pulse: true },
  deploying:   { label: 'DEPLOYING',   color: '#38BDF8', pulse: true },
  success:     { label: 'READY',       color: '#4ADE80', pulse: false },
  error:       { label: 'FAILED',      color: '#E5484D', pulse: false },
};

/* ── Vercel Triangle Icon ── */
const VercelIcon = ({ size = 22, color = '#FFFFFF' }) => (
  <svg width={size} height={size} viewBox="0 0 76 65" fill={color}
    style={{ transition: 'all 0.3s ease' }}>
    <path d="M37.5274 0L75.0548 65H0L37.5274 0Z" />
  </svg>
);

/* ── Pulsing Status Dot ── */
const StatusLabel = ({ status }) => {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.idle;
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
      <span style={{
        width: '4px', height: '4px', borderRadius: '50%', background: config.color,
        boxShadow: config.pulse ? `0 0 6px ${config.color}` : 'none',
        animation: config.pulse ? 'pulse-live 1s ease-in-out infinite' : 'none',
      }} />
      <span style={{
        fontFamily: "'Space Grotesk', sans-serif",
        fontSize: '8px', fontWeight: 800, color: config.color,
        letterSpacing: '0.04em',
      }}>{config.label}</span>
    </div>
  );
};

/* ── Telemetry Row ── */
const TelemetryLine = ({ label, value, color }) => (
  <div style={{
    display: 'flex', alignItems: 'baseline',
    justifyContent: 'space-between', gap: '8px',
    padding: '3px 0', whiteSpace: 'nowrap',
  }}>
    <span style={{
      fontFamily: 'var(--font-number)', fontSize: '8px',
      color: 'var(--t3)', letterSpacing: '0.08em',
      textTransform: 'uppercase', whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
    <span style={{
      fontFamily: 'var(--font-number)', fontSize: '0.7rem',
      color: color || 'var(--t1)', fontWeight: 600, whiteSpace: 'nowrap',
    }}>
      {value}
    </span>
  </div>
);

/* ══════════════════════════════════════════════════════════
 *  DEPLOY PANEL COMPONENT
 * ══════════════════════════════════════════════════════════ */
const DeployPanel = () => {
  const deployStatus = useEditorStore((s) => s.deployStatus);
  const deployLogs = useEditorStore((s) => s.deployLogs);
  const deployUrl = useEditorStore((s) => s.deployUrl);
  const deployError = useEditorStore((s) => s.deployError);
  const deployStartTime = useEditorStore((s) => s.deployStartTime);
  const currentDeployId = useEditorStore((s) => s.currentDeployId);
  const vercelConnected = useEditorStore((s) => s.vercelConnected);
  const vercelUsername = useEditorStore((s) => s.vercelUsername);
  const deployFramework = useEditorStore((s) => s.deployFramework);
  const sessionId = useEditorStore((s) => s.sessionId);

  const setDeployStatus = useEditorStore((s) => s.setDeployStatus);
  const addDeployLog = useEditorStore((s) => s.addDeployLog);
  const clearDeployLogs = useEditorStore((s) => s.clearDeployLogs);
  const setDeployUrl = useEditorStore((s) => s.setDeployUrl);
  const setDeployError = useEditorStore((s) => s.setDeployError);
  const setDeployStartTime = useEditorStore((s) => s.setDeployStartTime);
  const setCurrentDeployId = useEditorStore((s) => s.setCurrentDeployId);
  const setVercelConnected = useEditorStore((s) => s.setVercelConnected);
  const setDeployFramework = useEditorStore((s) => s.setDeployFramework);
  const resetDeploy = useEditorStore((s) => s.resetDeploy);
  const addDeploymentRecord = useEditorStore((s) => s.addDeploymentRecord);
  const pendingRedeploy = useEditorStore((s) => s.pendingRedeploy);
  const setPendingRedeploy = useEditorStore((s) => s.setPendingRedeploy);

  const [showConnectModal, setShowConnectModal] = useState(false);
  const [showEnvModal, setShowEnvModal] = useState(false);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [linkedProject, setLinkedProject] = useState(null); // name of linked Vercel project
  const [detectedEnvVars, setDetectedEnvVars] = useState([]);
  const [elapsed, setElapsed] = useState(0);
  const logContainerRef = useRef(null);
  const cleanupRef = useRef({ log: null, complete: null });

  // Check token on mount
  useEffect(() => {
    const checkToken = async () => {
      if (window.electronAPI?.hasVercelToken) {
        const hasToken = await window.electronAPI.hasVercelToken();
        if (hasToken && !vercelConnected) {
          // Validate the stored token
          // We can't retrieve it from renderer, but we know it exists
          setVercelConnected(true, vercelUsername || 'Connected');
        }
      }
    };
    checkToken();
  }, []);

  // Load any existing project link for this session (so redeploys show the target)
  useEffect(() => {
    const loadLink = async () => {
      if (!sessionId || !window.electronAPI?.getLinkedVercelProject) return;
      try {
        const info = await window.electronAPI.getLinkedVercelProject({ sessionId });
        if (info?.projectName) setLinkedProject(info.projectName);
      } catch {
        // No link yet — fine
      }
    };
    loadLink();
  }, [sessionId]);

  // Elapsed timer
  useEffect(() => {
    let interval;
    if (deployStatus === 'deploying' && deployStartTime) {
      interval = setInterval(() => {
        setElapsed(Math.floor((Date.now() - deployStartTime) / 1000));
      }, 1000);
    } else if (deployStatus !== 'deploying') {
      // Keep the final elapsed time
    }
    return () => clearInterval(interval);
  }, [deployStatus, deployStartTime]);

  // Auto-scroll logs
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [deployLogs]);

  const formatElapsed = (secs) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  /* ── Proceed with PTY deployment ── */
  const proceedWithDeployment = useCallback(async () => {
    setDeployStatus('deploying');
    setDeployStartTime(Date.now());
    setElapsed(0);

    try {
      const store = useEditorStore.getState();
      const deployOptions = { sessionId: store.sessionId };

      const result = await window.electronAPI.runDeploy(deployOptions);
      const deployId = result.deployId;
      setCurrentDeployId(deployId);
      setDeployFramework(result.framework);

      // Subscribe to live logs
      const unsubLog = window.electronAPI.onDeployLog(deployId, (data) => {
        const lines = stripAnsi(data).split('\n').filter(l => l.trim());
        lines.forEach(line => addDeployLog(line));
      });

      // Subscribe to completion
      const unsubComplete = window.electronAPI.onDeployComplete(deployId, async (data) => {
        if (data.success) {
          setDeployStatus('success');
          setDeployUrl(data.url);
          addDeployLog(`✓ Deployment successful!`);
          addDeployLog(`→ ${data.url}`);

          // Fetch Git and Snapshot details
          const store = useEditorStore.getState();
          const statusText = store.gitStatus || '';
          const branchMatch = statusText.match(/On branch (\S+)/) || statusText.match(/^##\s+(\S+)/m);
          const gitBranch = branchMatch ? branchMatch[1] : 'main';
          
          const logText = store.gitLog || '';
          const commitMatch = logText.match(/^(\w+)/);
          const gitCommit = commitMatch ? commitMatch[1] : undefined;
          
          const latestSnapshot = store.snapshots[store.snapshots.length - 1];
          const snapshotId = latestSnapshot?.id || null;

          const deploymentData = {
            sessionId: store.sessionId,
            deploymentUrl: data.url,
            vercelDeploymentId: deployId,
            target: 'production',
            gitBranch,
            gitCommit,
            snapshotId,
            status: 'success',
            framework: result.framework,
          };

          try {
            const { createDeployment } = await import('../../services/api');
            const savedRecord = await createDeployment(deploymentData);
            
            // Record in history
            addDeploymentRecord(savedRecord);
          } catch (apiErr) {
            console.error('[DeployPanel] Failed to save deployment record:', apiErr);
            // Fallback: local only
            addDeploymentRecord({
              id: deployId,
              url: data.url,
              timestamp: new Date().toISOString(),
              status: 'success',
              framework: result.framework,
            });
          }
        } else {
          setDeployStatus('error');
          setDeployError(data.error || 'Deployment failed');
          addDeployLog(`✗ Deployment failed: ${data.error || 'Unknown error'}`);
        }

        // Cleanup subscriptions
        unsubLog?.();
        unsubComplete?.();
      });

      cleanupRef.current = { log: unsubLog, complete: unsubComplete };
    } catch (err) {
      setDeployStatus('error');
      setDeployError(err.message || 'Failed to start deployment');
      addDeployLog(`✗ Error: ${err.message}`);
    }
  }, [
    setDeployStatus,
    setDeployStartTime,
    setElapsed,
    setCurrentDeployId,
    setDeployFramework,
    addDeployLog,
    setDeployUrl,
    addDeploymentRecord,
    setDeployError,
  ]);

  /* ── Deploy Action ── */
  const handleDeploy = useCallback(async () => {
    if (!window.electronAPI?.runDeploy) {
      setDeployError('Electron API not available. This feature requires the desktop app.');
      setDeployStatus('error');
      return;
    }

    // Check if token exists
    const hasToken = await window.electronAPI.hasVercelToken();
    if (!hasToken) {
      setShowConnectModal(true);
      return;
    }

    // Reset state for new deploy
    resetDeploy();
    clearDeployLogs();
    setDeployStatus('connecting');

    try {
      const store = useEditorStore.getState();
      const deployOptions = { sessionId: store.sessionId };

      // Write the current in-memory files to the deploy workspace. This is what
      // makes plain static (HTML/CSS/JS) projects deployable and ensures the
      // very latest edits are what gets pushed.
      if (window.electronAPI.prepareDeployWorkspace) {
        const prep = await window.electronAPI.prepareDeployWorkspace({
          sessionId: store.sessionId,
          files: store.files,
        });
        if (!prep?.success) {
          throw new Error(prep?.error || 'Failed to prepare deploy workspace');
        }
        if (!prep.fileCount) {
          throw new Error('No files to deploy — add or open files in this session first.');
        }
        addDeployLog(`📦 Prepared ${prep.fileCount} file(s) for deployment.`);
      }

      // Detect framework
      const framework = await window.electronAPI.detectFramework(deployOptions);
      setDeployFramework(framework);

      // Detect env files
      let envVars = [];
      if (window.electronAPI.detectEnvFiles) {
        envVars = await window.electronAPI.detectEnvFiles(deployOptions);
      }

      if (envVars && envVars.length > 0) {
        setDetectedEnvVars(envVars);
        setDeployStatus('env-confirm');
        setShowEnvModal(true);
      } else {
        proceedWithDeployment();
      }
    } catch (err) {
      setDeployStatus('error');
      setDeployError(err.message || 'Failed to start deployment');
      addDeployLog(`✗ Error: ${err.message}`);
    }
  }, [
    resetDeploy,
    clearDeployLogs,
    setDeployStatus,
    setDeployFramework,
    setShowEnvModal,
    setDetectedEnvVars,
    proceedWithDeployment,
    setDeployError,
    addDeployLog,
  ]);

  /* ── Confirm Env Variables ── */
  const handleConfirmEnv = useCallback(async (selectedVars) => {
    setShowEnvModal(false);
    setDeployStatus('pushing-env');
    addDeployLog('⚙ Uploading environment variables to Vercel...');

    try {
      const store = useEditorStore.getState();
      const deployOptions = { sessionId: store.sessionId };

      const res = await window.electronAPI.pushEnvVars({ ...deployOptions, vars: selectedVars });
      if (res.success) {
        addDeployLog('✓ Environment variables successfully uploaded.');
        proceedWithDeployment();
      } else {
        addDeployLog(`✗ Failed to upload environment variables: ${res.error || 'Unknown error'}`);
        setDeployError(res.error || 'Failed to upload environment variables');
        setDeployStatus('error');
      }
    } catch (err) {
      addDeployLog(`✗ Error uploading environment variables: ${err.message}`);
      setDeployError(err.message || 'Failed to upload environment variables');
      setDeployStatus('error');
    }
  }, [proceedWithDeployment, setDeployStatus, addDeployLog, setDeployError]);

  /* ── Skip Env Variables ── */
  const handleSkipEnv = useCallback(() => {
    setShowEnvModal(false);
    addDeployLog('⚠ Skipped environment variable upload.');
    proceedWithDeployment();
  }, [proceedWithDeployment, addDeployLog]);

  /* ── Cancel Env Variable Step ── */
  const handleCancelEnv = useCallback(() => {
    setShowEnvModal(false);
    resetDeploy();
  }, [resetDeploy]);

  // Handle pending redeploy trigger from Timeline
  useEffect(() => {
    if (pendingRedeploy) {
      setPendingRedeploy(false);
      handleDeploy();
    }
  }, [pendingRedeploy, setPendingRedeploy, handleDeploy]);


  /* ── Cancel Deploy ── */
  const handleCancel = useCallback(async () => {
    if (currentDeployId && window.electronAPI?.cancelDeploy) {
      await window.electronAPI.cancelDeploy(currentDeployId);
      addDeployLog('⚠ Deployment cancelled by user');
    }
    // Cleanup subscriptions
    cleanupRef.current.log?.();
    cleanupRef.current.complete?.();
    setDeployStatus('idle');
  }, [currentDeployId]);

  /* ── Disconnect ── */
  const handleDisconnect = useCallback(async () => {
    if (window.electronAPI?.clearVercelToken) {
      await window.electronAPI.clearVercelToken();
    }
    setVercelConnected(false, null);
    resetDeploy();
  }, []);

  const isDeploying = deployStatus === 'deploying';
  const isSuccess = deployStatus === 'success';
  const isError = deployStatus === 'error';
  const statusColor = STATUS_CONFIG[deployStatus]?.color || '#6E6E6E';
  const logs = deployLogs.map(stripAnsi);

  return (
    <div style={{ padding: '16px', height: '100%', overflowY: 'auto', background: 'var(--s0)' }}>

      {/* HUD Header Banner */}
      <div style={{
        margin: '0 0 24px', padding: '8px 0',
        background: 'transparent', borderBottom: '1px solid #2E2E2E',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <div style={{
            width: '32px', height: '32px',
            border: `1px solid ${isDeploying ? '#38BDF8' : isSuccess ? '#4ADE80' : '#2E2E2E'}`,
            borderRadius: '2px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all 0.3s ease',
          }}>
            <VercelIcon
              size={18}
              color={isDeploying ? '#38BDF8' : isSuccess ? '#4ADE80' : isError ? '#E5484D' : '#6E6E6E'}
            />
          </div>
          <div>
            <h1 className="logo-text" style={{
              fontFamily: 'var(--font-header)', fontSize: '1.05rem', fontWeight: 900,
              letterSpacing: '0.04em', margin: 0,
              display: 'flex', alignItems: 'center', gap: '4px',
            }}>
              <span style={{ color: 'var(--t1)' }}>DEPLOY</span>
              <span style={{
                color: 'transparent',
                WebkitTextStroke: '1px var(--t1)',
                WebkitTextFillColor: 'transparent',
              }}>HQ</span>
            </h1>
          </div>
        </div>

        {/* Connection status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {vercelConnected && (
            <span style={{
              fontFamily: 'var(--font-number)',
              fontSize: '0.52rem',
              color: 'var(--t3)',
              letterSpacing: '0.04em',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}>
              <span style={{
                width: '4px', height: '4px', borderRadius: '50%',
                background: '#4ADE80',
                boxShadow: '0 0 4px rgba(74, 222, 128, 0.4)',
              }} />
              {vercelUsername || 'CONNECTED'}
            </span>
          )}
          {vercelConnected ? (
            <button
              onClick={handleDisconnect}
              style={{
                background: 'transparent', color: 'var(--t4)',
                border: '1px solid var(--line)', borderRadius: '3px',
                fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600,
                fontSize: '0.56rem', letterSpacing: '0.06em',
                padding: '4px 10px', cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--crimson)'; e.currentTarget.style.borderColor = 'var(--crimson)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--t4)'; e.currentTarget.style.borderColor = 'var(--line)'; }}
            >
              DISCONNECT
            </button>
          ) : (
            <button
              onClick={() => setShowConnectModal(true)}
              style={{
                background: 'transparent', color: 'var(--t1)',
                border: '1px solid rgba(255, 255, 255, 0.75)', borderRadius: '3px',
                fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600,
                fontSize: '0.62rem', letterSpacing: '0.06em',
                padding: '6px 14px', cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--t1)'; e.currentTarget.style.color = 'var(--s0)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--t1)'; }}
            >
              CONNECT VERCEL
            </button>
          )}
        </div>
      </div>

      {/* Main split layout */}
      <div style={{ display: 'flex', flexDirection: 'row', gap: '24px', flexWrap: 'wrap' }}>

        {/* LEFT COLUMN: Controls & Telemetry */}
        <div style={{ flex: '1 1 240px', display: 'flex', flexDirection: 'column', gap: '20px' }}>

          {/* Telemetry Matrix */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <TelemetryLine label="STATUS" value={<StatusLabel status={deployStatus} />} />
            <TelemetryLine
              label="FRAMEWORK"
              value={deployFramework || 'DETECTING...'}
              color={deployFramework ? 'var(--t1)' : 'var(--t4)'}
            />
            <TelemetryLine
              label="PROJECT"
              value={linkedProject || 'NEW PROJECT'}
              color={linkedProject ? 'var(--t1)' : 'var(--t4)'}
            />
            <TelemetryLine
              label="TARGET"
              value="PRODUCTION"
              color={isDeploying ? '#38BDF8' : 'var(--t2)'}
            />
            <TelemetryLine
              label="ELAPSED"
              value={isDeploying || isSuccess || isError ? formatElapsed(elapsed) : 'IDLE'}
              color={isDeploying ? '#38BDF8' : isSuccess ? '#4ADE80' : 'var(--t4)'}
            />
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {!isDeploying ? (
              <button
                onClick={handleDeploy}
                disabled={isDeploying}
                style={{
                  height: '38px',
                  borderRadius: '3px',
                  border: 'none',
                  background: 'linear-gradient(135deg, #00A2FF 0%, #0066FF 100%)',
                  color: '#FFFFFF',
                  fontFamily: "'Space Grotesk', sans-serif",
                  fontWeight: 700,
                  fontSize: '0.72rem',
                  letterSpacing: '0.06em',
                  cursor: 'pointer',
                  transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                  boxShadow: '0 4px 14px rgba(0, 162, 255, 0.3)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.boxShadow = '0 6px 20px rgba(0, 162, 255, 0.45)';
                  e.currentTarget.style.transform = 'translateY(-1px)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.boxShadow = '0 4px 14px rgba(0, 162, 255, 0.3)';
                  e.currentTarget.style.transform = 'translateY(0)';
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 2L11 13" /><path d="M22 2L15 22L11 13L2 9L22 2Z" />
                </svg>
                {isSuccess ? 'REDEPLOY' : 'DEPLOY TO PRODUCTION'}
              </button>
            ) : (
              <button
                onClick={handleCancel}
                style={{
                  height: '38px',
                  borderRadius: '3px',
                  border: '1px solid var(--crimson)',
                  background: 'transparent',
                  color: 'var(--crimson)',
                  fontFamily: "'Space Grotesk', sans-serif",
                  fontWeight: 700,
                  fontSize: '0.66rem',
                  letterSpacing: '0.06em',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(229, 72, 77, 0.1)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
              >
                CANCEL DEPLOYMENT
              </button>
            )}

            {/* Link existing Vercel project (push updates to an app already on Vercel) */}
            {vercelConnected && !isDeploying && (
              <button
                onClick={() => setShowLinkModal(true)}
                style={{
                  background: 'transparent',
                  color: 'var(--t3)',
                  border: '1px solid var(--line)',
                  borderRadius: '3px',
                  fontFamily: "'Space Grotesk', sans-serif",
                  fontWeight: 600,
                  fontSize: '0.58rem',
                  letterSpacing: '0.06em',
                  padding: '7px 10px',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                }}
                onMouseEnter={e => { e.currentTarget.style.color = 'var(--t1)'; e.currentTarget.style.borderColor = 'var(--t3)'; }}
                onMouseLeave={e => { e.currentTarget.style.color = 'var(--t3)'; e.currentTarget.style.borderColor = 'var(--line)'; }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
                {linkedProject ? `LINKED: ${linkedProject.toUpperCase()}` : 'LINK EXISTING PROJECT'}
              </button>
            )}

            {/* Deployment URL */}
            {deployUrl && (
              <a
                href={deployUrl}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  color: '#4ADE80',
                  textDecoration: 'none',
                  fontFamily: "'Space Grotesk', sans-serif",
                  fontWeight: 600,
                  fontSize: '0.68rem',
                  letterSpacing: '0.04em',
                  borderBottom: '1px solid rgba(74, 222, 128, 0.4)',
                  paddingBottom: '2px',
                  alignSelf: 'flex-start',
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={e => { e.currentTarget.style.color = '#FFFFFF'; e.currentTarget.style.borderBottomColor = '#FFFFFF'; }}
                onMouseLeave={e => { e.currentTarget.style.color = '#4ADE80'; e.currentTarget.style.borderBottomColor = 'rgba(74, 222, 128, 0.4)'; }}
              >
                OPEN DEPLOYMENT
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </a>
            )}

            {/* Error display */}
            {isError && deployError && (
              <div style={{
                fontFamily: 'var(--font-number)',
                fontSize: '0.58rem',
                color: 'var(--crimson)',
                fontWeight: 600,
                letterSpacing: '0.02em',
                padding: '8px 12px',
                background: 'rgba(229, 72, 77, 0.06)',
                border: '1px solid rgba(229, 72, 77, 0.2)',
                borderRadius: '3px',
                wordBreak: 'break-word',
              }}>
                {deployError}
              </div>
            )}
          </div>
        </div>

        {/* CENTER DIVIDER */}
        <div style={{
          flex: '0 0 1px', borderRight: '1px solid #2E2E2E',
          alignSelf: 'stretch', margin: '4px 0', minHeight: '140px',
        }} />

        {/* RIGHT COLUMN: Live Build Log Console */}
        <div style={{ flex: '2 2 400px', display: 'flex', flexDirection: 'column', minWidth: '300px', overflow: 'hidden' }}>

          {/* Console Header */}
          <div style={{
            background: 'transparent',
            padding: '0 0 8px 0',
            borderBottom: '1px solid #2E2E2E',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <span style={{
              fontFamily: 'var(--font-number)', fontSize: '8px',
              color: 'var(--t3)', letterSpacing: '0.12em', fontWeight: 600,
            }}>BUILD LOG</span>
            <span style={{
              fontFamily: 'var(--font-number)',
              fontSize: '7px',
              color: isDeploying ? '#38BDF8' : isSuccess ? '#4ADE80' : 'var(--t4)',
              letterSpacing: '0.04em',
              textShadow: isDeploying ? '0 0 6px rgba(56, 189, 248, 0.4)' : 'none',
              transition: 'all 0.3s ease',
            }}>
              {isDeploying ? 'RECEIVING_FEED' : isSuccess ? 'DEPLOY_COMPLETE' : isError ? 'DEPLOY_FAILED' : 'OFFLINE'}
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
            overflow: 'hidden',
          }}>
            {/* CRT Scanline Overlay */}
            <div style={{
              position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
              background: 'linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.25) 50%), linear-gradient(90deg, rgba(255, 0, 0, 0.04), rgba(0, 255, 0, 0.01), rgba(0, 255, 0, 0.03))',
              backgroundSize: '100% 2px, 3px 100%',
              opacity: 0.15,
              pointerEvents: 'none',
              zIndex: 10,
            }} />

            <div
              ref={logContainerRef}
              style={{
                height: '100%', overflowY: 'auto',
                padding: '10px 12px',
                background: '#070707',
                position: 'relative',
                zIndex: 5,
              }}
            >
              {logs.length === 0 ? (
                <div style={{
                  height: '100%', display: 'flex', alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <span style={{
                    fontFamily: 'var(--font-number)', fontSize: '0.5rem',
                    color: 'var(--t4)', letterSpacing: '0.2em', fontWeight: 600,
                  }}>AWAITING DEPLOYMENT STREAM</span>
                </div>
              ) : (
                <div>
                  {logs.map((line, i) => {
                    const isSuccess = line.includes('✓') || line.includes('Ready') || line.includes('Production');
                    const isError = line.includes('✗') || line.includes('Error') || line.includes('ERR!');
                    const isUrl = line.includes('https://') || line.includes('→');
                    const isPhase = line.includes('Uploading') || line.includes('Building') || line.includes('Deploying') || line.includes('Linking');
                    const isWarn = line.includes('⚠') || line.includes('Warning');

                    return (
                      <div key={i} style={{
                        fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
                        fontSize: '0.62rem',
                        lineHeight: 1.6,
                        letterSpacing: '0.01em',
                        color: isSuccess ? '#4ADE80'
                          : isError ? '#E5484D'
                          : isUrl ? '#38BDF8'
                          : isPhase ? 'var(--t2)'
                          : isWarn ? '#FFB224'
                          : 'var(--t3)',
                        fontWeight: isSuccess || isUrl || isPhase ? 600 : 400,
                        marginBottom: '1px',
                        wordBreak: 'break-all',
                      }}>
                        {line}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Connect Vercel Modal */}
      {showConnectModal && (
        <ConnectVercelModal
          onClose={() => setShowConnectModal(false)}
          onConnected={(username) => {
            setVercelConnected(true, username);
            setShowConnectModal(false);
          }}
        />
      )}

      {/* Env Variable Confirmation Modal */}
      {showEnvModal && (
        <EnvConfirmModal
          envVars={detectedEnvVars}
          onConfirm={handleConfirmEnv}
          onSkip={handleSkipEnv}
          onCancel={handleCancelEnv}
        />
      )}

      {/* Link Existing Project Modal */}
      {showLinkModal && (
        <LinkProjectModal
          sessionId={sessionId}
          onClose={() => setShowLinkModal(false)}
          onLinked={(name) => {
            setLinkedProject(name);
            setShowLinkModal(false);
          }}
        />
      )}
    </div>
  );
};

export default DeployPanel;
