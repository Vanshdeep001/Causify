/* -------------------------------------------------------
 * RenderDeployPanel.jsx — One-Click Render Backend Deployment
 *
 * Backend counterpart of DeployPanel.jsx (Vercel / frontend).
 * Same split-column layout and design language:
 *   Left:  Deploy controls, status, telemetry, explainer
 *   Right: Live deploy status stream (CRT console aesthetic)
 *
 * Key difference from the Vercel flow: Render builds from the
 * session's Git repository — nothing is uploaded from the editor.
 * The session is linked to a Render service (existing or newly
 * created), deploys are triggered via the Render API, and status
 * is polled and streamed into the console.
 * ------------------------------------------------------- */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import useEditorStore from '../../store/useEditorStore';
import ConnectRenderModal from './ConnectRenderModal';
import EnvConfirmModal from './EnvConfirmModal';
import LinkServiceModal from './LinkServiceModal';
import CreateServiceModal from './CreateServiceModal';
import { detectBackend, detectBackendEnvVars } from './detectBackend';

const RENDER_MINT = '#46E3B7';

/* ── Utility: Strip ANSI color codes ── */
const stripAnsi = (str) => {
  if (!str) return '';
  return str.replace(/\x1B\[[;\d]*m/g, '').replace(/\x1B\[\?[;\d]*[a-zA-Z]/g, '');
};

/* ── Status Configuration ── */
const STATUS_CONFIG = {
  idle:         { label: 'READY',       color: '#6E6E6E', pulse: false },
  connecting:   { label: 'CONNECTING',  color: '#FFB224', pulse: true },
  'env-confirm':{ label: 'CONFIRMING',  color: '#FFB224', pulse: false },
  'pushing-env':{ label: 'PUSHING ENV', color: '#FFB224', pulse: true },
  deploying:    { label: 'DEPLOYING',   color: RENDER_MINT, pulse: true },
  success:      { label: 'LIVE',        color: '#4ADE80', pulse: false },
  error:        { label: 'FAILED',      color: '#E5484D', pulse: false },
};

/* ── Server Stack Icon ── */
const ServerIcon = ({ size = 18, color = '#FFFFFF' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    style={{ transition: 'all 0.3s ease' }}>
    <rect x="2" y="2" width="20" height="8" rx="2" />
    <rect x="2" y="14" width="20" height="8" rx="2" />
    <line x1="6" y1="6" x2="6.01" y2="6" />
    <line x1="6" y1="18" x2="6.01" y2="18" />
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
      overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '160px',
    }}>
      {value}
    </span>
  </div>
);

/* ══════════════════════════════════════════════════════════
 *  RENDER DEPLOY PANEL COMPONENT
 * ══════════════════════════════════════════════════════════ */
const RenderDeployPanel = () => {
  const deployStatus = useEditorStore((s) => s.renderDeployStatus);
  const deployLogs = useEditorStore((s) => s.renderDeployLogs);
  const deployUrl = useEditorStore((s) => s.renderDeployUrl);
  const deployError = useEditorStore((s) => s.renderDeployError);
  const deployStartTime = useEditorStore((s) => s.renderDeployStartTime);
  const currentDeployId = useEditorStore((s) => s.currentRenderDeployId);
  const renderConnected = useEditorStore((s) => s.renderConnected);
  const renderOwnerName = useEditorStore((s) => s.renderOwnerName);
  const renderRuntime = useEditorStore((s) => s.renderRuntime);
  const sessionId = useEditorStore((s) => s.sessionId);
  const sessionName = useEditorStore((s) => s.sessionName);
  const gitRepoUrl = useEditorStore((s) => s.gitRepoUrl);
  const gitRepoConnected = useEditorStore((s) => s.gitRepoConnected);

  const setDeployStatus = useEditorStore((s) => s.setRenderDeployStatus);
  const addDeployLog = useEditorStore((s) => s.addRenderDeployLog);
  const clearDeployLogs = useEditorStore((s) => s.clearRenderDeployLogs);
  const setDeployUrl = useEditorStore((s) => s.setRenderDeployUrl);
  const setDeployError = useEditorStore((s) => s.setRenderDeployError);
  const setDeployStartTime = useEditorStore((s) => s.setRenderDeployStartTime);
  const setCurrentDeployId = useEditorStore((s) => s.setCurrentRenderDeployId);
  const setRenderConnected = useEditorStore((s) => s.setRenderConnected);
  const setRenderRuntime = useEditorStore((s) => s.setRenderRuntime);
  const resetDeploy = useEditorStore((s) => s.resetRenderDeploy);
  const addDeploymentRecord = useEditorStore((s) => s.addDeploymentRecord);
  const setLastRenderDeploySessionId = useEditorStore((s) => s.setLastRenderDeploySessionId);
  const lastRenderDeploySessionId = useEditorStore((s) => s.lastRenderDeploySessionId);

  const [showConnectModal, setShowConnectModal] = useState(false);
  const [showEnvModal, setShowEnvModal] = useState(false);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [linkedService, setLinkedService] = useState(null); // { name, url }
  const [detection, setDetection] = useState(null);
  const [detectedEnvVars, setDetectedEnvVars] = useState([]);
  const [elapsed, setElapsed] = useState(0);
  const logContainerRef = useRef(null);
  const cleanupRef = useRef({ log: null, complete: null });

  // Delete service state
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // States to chain Env Confirmation -> Create Service -> Deploy
  const [pendingEnvVars, setPendingEnvVars] = useState(null);
  const [shouldDeployAfterCreate, setShouldDeployAfterCreate] = useState(false);

  // Check API key on mount
  useEffect(() => {
    const checkKey = async () => {
      if (window.electronAPI?.hasRenderApiKey) {
        const hasKey = await window.electronAPI.hasRenderApiKey();
        if (hasKey && !renderConnected) {
          setRenderConnected(true, renderOwnerName || 'Connected');
        }
      }
    };
    checkKey();
  }, []);

  // Load any existing service link for this session
  useEffect(() => {
    const loadLink = async () => {
      if (!sessionId || !window.electronAPI?.getLinkedRenderService) return;
      try {
        const info = await window.electronAPI.getLinkedRenderService({ sessionId });
        if (info?.serviceName || info?.serviceId) {
          setLinkedService({ name: info.serviceName || info.serviceId, url: info.serviceUrl || null });
        }
      } catch {
        // No link yet — fine
      }
    };
    loadLink();
  }, [sessionId]);

  // Restore existing deployment state on mount (after app restart).
  // The success panel is already persisted (renderDeployStatus/renderDeployUrl in
  // the store), so this pass is purely additive: when the service can be confirmed
  // on Render we refresh the live URL / name and, if the persisted state was lost,
  // we re-show the success panel.
  //
  // We deliberately do NOT reset a persisted "success" when the check returns
  // exists:false. That check reports false for transient, non-deletion reasons —
  // API key not yet unlocked on startup, the session→service link missing, or an
  // API hiccup — and resetting on those made a live service revert to "Deploy
  // Backend" after every reopen. The state now persists until the user explicitly
  // cancels or deletes the service.
  useEffect(() => {
    const restoreDeployment = async () => {
      const targetSessionId = lastRenderDeploySessionId || sessionId;
      if (!targetSessionId || !window.electronAPI?.checkExistingRenderDeploy) return;

      try {
        const result = await window.electronAPI.checkExistingRenderDeploy({ sessionId: targetSessionId });
        if (result?.exists) {
          // Service confirmed on Render — ensure the panel shows success
          if (deployStatus === 'idle') {
            setDeployStatus('success');
          }
          if (result.serviceUrl) setDeployUrl(result.serviceUrl);
          if (result.serviceName) {
            setLinkedService({ name: result.serviceName, url: result.serviceUrl || null });
          }
          // Align lastRenderDeploySessionId if needed
          if (lastRenderDeploySessionId !== targetSessionId) {
            setLastRenderDeploySessionId(targetSessionId);
          }
        }
      } catch {
        // Non-fatal — just keep the current (persisted) state
      }
    };
    restoreDeployment();
  }, [sessionId, lastRenderDeploySessionId]);

  // Detect the backend from the session files so the RUNTIME telemetry
  // and the Create Service form are prefilled.
  useEffect(() => {
    const files = useEditorStore.getState().files;
    const result = detectBackend(files);
    setDetection(result);
    setRenderRuntime(result ? result.framework : null);
  }, [sessionId, setRenderRuntime]);

  // Elapsed timer
  useEffect(() => {
    let interval;
    if (deployStatus === 'deploying' && deployStartTime) {
      interval = setInterval(() => {
        setElapsed(Math.floor((Date.now() - deployStartTime) / 1000));
      }, 1000);
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

  /* ── Trigger the deploy on the linked service ── */
  const proceedWithDeployment = useCallback(async () => {
    setDeployStatus('deploying');
    setDeployStartTime(Date.now());
    setElapsed(0);

    // Pre-generate the deployId so we can subscribe to events BEFORE
    // the IPC fires the deploy — prevents missing early log lines.
    const deployId = (typeof window !== 'undefined' && window.crypto?.randomUUID)
      ? window.crypto.randomUUID()
      : Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    setCurrentDeployId(deployId);

    // Subscribe to live status stream BEFORE triggering the deploy
    const unsubLog = window.electronAPI.onRenderDeployLog(deployId, (data) => {
      const lines = stripAnsi(data).split('\n').filter(l => l.trim());
      lines.forEach(line => addDeployLog(line));
    });

    // Subscribe to completion
    const unsubComplete = window.electronAPI.onRenderDeployComplete(deployId, async (data) => {
      if (data.success) {
        setDeployStatus('success');
        setDeployUrl(data.url);
        setLastRenderDeploySessionId(sessionId);
        setLinkedService((prev) => prev ? { ...prev, url: data.url || prev.url } : prev);
        addDeployLog('✓ Backend deployed successfully!');
        if (data.url) addDeployLog(`→ ${data.url}`);

        // Record in deployment history (same store/API as the Vercel flow)
        const store = useEditorStore.getState();
        const statusText = store.gitStatus || '';
        const branchMatch = statusText.match(/On branch (\S+)/) || statusText.match(/^##\s+(\S+)/m);
        const gitBranch = branchMatch ? branchMatch[1] : 'main';
        const logText = store.gitLog || '';
        const commitMatch = logText.match(/^(\w+)/);
        const gitCommit = commitMatch ? commitMatch[1] : undefined;

        const record = {
          sessionId: store.sessionId,
          deploymentUrl: data.url,
          target: 'production',
          gitBranch,
          gitCommit,
          status: 'success',
          framework: `Render · ${store.renderRuntime || 'Backend'}`,
        };

        try {
          const { createDeployment } = await import('../../services/api');
          const savedRecord = await createDeployment(record);
          addDeploymentRecord(savedRecord);
        } catch (apiErr) {
          console.error('[RenderDeployPanel] Failed to save deployment record:', apiErr);
          addDeploymentRecord({
            id: data.deployId || deployId,
            url: data.url,
            timestamp: new Date().toISOString(),
            status: 'success',
            framework: record.framework,
          });
        }
      } else {
        setDeployStatus('error');
        setDeployError(data.error || 'Deploy failed');
        addDeployLog(`✗ Deploy failed: ${data.error || 'Unknown error'}`);
      }

      unsubLog?.();
      unsubComplete?.();
    });

    cleanupRef.current = { log: unsubLog, complete: unsubComplete };

    try {
      const store = useEditorStore.getState();
      await window.electronAPI.runRenderDeploy({
        sessionId: store.sessionId,
        deployId,
      });
    } catch (err) {
      // Cleanup subscriptions on failure
      unsubLog?.();
      unsubComplete?.();
      setDeployStatus('error');
      setDeployError(err.message || 'Failed to start deploy');
      addDeployLog(`✗ Error: ${err.message}`);
    }
  }, [
    setDeployStatus,
    setDeployStartTime,
    setCurrentDeployId,
    addDeployLog,
    setDeployUrl,
    addDeploymentRecord,
    setDeployError,
  ]);

  /* ── Deploy Action ── */
  const handleDeploy = useCallback(async () => {
    if (!window.electronAPI?.runRenderDeploy) {
      setDeployError('Electron API not available. This feature requires the desktop app.');
      setDeployStatus('error');
      return;
    }

    // 1. Account connected?
    const hasKey = await window.electronAPI.hasRenderApiKey();
    if (!hasKey) {
      setShowConnectModal(true);
      return;
    }

    // Reset state for a new deploy
    resetDeploy();
    clearDeployLogs();
    setDeployStatus('connecting');

    try {
      const store = useEditorStore.getState();

      // Render deploys the repo's latest commit — remind the user.
      addDeployLog('ℹ Render builds from your Git repository — unpushed local changes are not included.');

      // Detect backend + env files from the session files.
      const det = detectBackend(store.files);
      setDetection(det);
      if (det) setRenderRuntime(det.framework);

      const link = await window.electronAPI.getLinkedRenderService({ sessionId });
      const envVars = detectBackendEnvVars(store.files, det?.rootDir);

      if (!link?.serviceId) {
        // No service linked: we want to create a new service and then deploy.
        setShouldDeployAfterCreate(true);
        if (envVars.length > 0) {
          setDetectedEnvVars(envVars);
          setDeployStatus('env-confirm');
          setShowEnvModal(true);
        } else {
          setPendingEnvVars([]);
          setShowCreateModal(true);
        }
      } else {
        // Service is linked: standard direct deploy.
        setShouldDeployAfterCreate(false);
        if (envVars.length > 0) {
          setDetectedEnvVars(envVars);
          setDeployStatus('env-confirm');
          setShowEnvModal(true);
        } else {
          proceedWithDeployment();
        }
      }
    } catch (err) {
      setDeployStatus('error');
      setDeployError(err.message || 'Failed to start deploy');
      addDeployLog(`✗ Error: ${err.message}`);
    }
  }, [
    sessionId,
    resetDeploy,
    clearDeployLogs,
    setDeployStatus,
    setRenderRuntime,
    proceedWithDeployment,
    setDeployError,
    addDeployLog,
    setShouldDeployAfterCreate,
    setPendingEnvVars,
    setShowCreateModal,
  ]);

  /* ── Confirm Env Variables ── */
  const handleConfirmEnv = useCallback(async (selectedVars) => {
    setShowEnvModal(false);

    if (shouldDeployAfterCreate) {
      // Chain to service creation first
      setPendingEnvVars(selectedVars);
      setShowCreateModal(true);
    } else {
      // Standard flow: upload to existing service and deploy
      setDeployStatus('pushing-env');
      addDeployLog('⚙ Uploading environment variables to Render...');

      try {
        const res = await window.electronAPI.pushRenderEnvVars({ sessionId, vars: selectedVars });
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
    }
  }, [
    sessionId,
    proceedWithDeployment,
    setDeployStatus,
    addDeployLog,
    setDeployError,
    shouldDeployAfterCreate,
    setPendingEnvVars,
    setShowCreateModal,
  ]);

  /* ── Skip / Cancel Env Step ── */
  const handleSkipEnv = useCallback(() => {
    setShowEnvModal(false);
    addDeployLog('⚠ Skipped environment variable upload.');

    if (shouldDeployAfterCreate) {
      setPendingEnvVars([]);
      setShowCreateModal(true);
    } else {
      proceedWithDeployment();
    }
  }, [
    proceedWithDeployment,
    addDeployLog,
    shouldDeployAfterCreate,
    setPendingEnvVars,
    setShowCreateModal,
  ]);

  const handleCancelEnv = useCallback(() => {
    setShowEnvModal(false);
    setShouldDeployAfterCreate(false);
    setPendingEnvVars(null);
    resetDeploy();
  }, [resetDeploy, setShouldDeployAfterCreate, setPendingEnvVars]);

  /* ── Cancel Deploy ── */
  const handleCancel = useCallback(async () => {
    if (currentDeployId && window.electronAPI?.cancelRenderDeploy) {
      await window.electronAPI.cancelRenderDeploy(currentDeployId);
      addDeployLog('⚠ Deploy cancelled by user');
    }
    cleanupRef.current.log?.();
    cleanupRef.current.complete?.();
    setDeployStatus('idle');
  }, [currentDeployId]);

  /* ── Disconnect ── */
  const handleDisconnect = useCallback(async () => {
    if (window.electronAPI?.clearRenderApiKey) {
      await window.electronAPI.clearRenderApiKey();
    }
    setRenderConnected(false, null);
    resetDeploy();
  }, []);

  /* ── Delete Render Service ── */
  const handleDeleteService = useCallback(async () => {
    if (!deleteConfirm) {
      setDeleteConfirm(true);
      return;
    }

    if (!window.electronAPI?.deleteRenderService) {
      setDeployError('Delete not available — update the desktop app.');
      setDeleteConfirm(false);
      return;
    }

    setDeleting(true);
    setDeployError(null);
    addDeployLog('⚠ Deleting Render service...');

    try {
      const store = useEditorStore.getState();
      const res = await window.electronAPI.deleteRenderService({ sessionId: store.sessionId });
      if (res.success) {
        addDeployLog(`✓ Service${res.serviceName ? ` "${res.serviceName}"` : ''} deleted from Render.`);
        setLinkedService(null);
        resetDeploy();
      } else {
        setDeployError(res.error || 'Failed to delete service');
        addDeployLog(`✗ Delete failed: ${res.error || 'Unknown error'}`);
      }
    } catch (err) {
      setDeployError(err.message || 'Delete request failed');
      addDeployLog(`✗ Delete error: ${err.message}`);
    } finally {
      setDeleting(false);
      setDeleteConfirm(false);
    }
  }, [deleteConfirm, sessionId, addDeployLog, setDeployError, resetDeploy]);

  const isDeploying = deployStatus === 'deploying' || deployStatus === 'pushing-env';
  const isSuccess = deployStatus === 'success';
  const isError = deployStatus === 'error';
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
            border: `1px solid ${isDeploying ? RENDER_MINT : isSuccess ? '#4ADE80' : '#2E2E2E'}`,
            borderRadius: '2px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all 0.3s ease',
          }}>
            <ServerIcon
              size={16}
              color={isDeploying ? RENDER_MINT : isSuccess ? '#4ADE80' : isError ? '#E5484D' : '#6E6E6E'}
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
            <span style={{
              fontFamily: 'var(--font-number)', fontSize: '0.52rem',
              color: 'var(--t4)', letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}>
              One-click backend deployment · Powered by Render
            </span>
          </div>
        </div>

        {/* Connection status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {renderConnected && (
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
              {renderOwnerName || 'CONNECTED'}
            </span>
          )}
          {renderConnected ? (
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
              CONNECT RENDER
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
              label="RUNTIME"
              value={renderRuntime || 'NOT DETECTED'}
              color={renderRuntime ? 'var(--t1)' : 'var(--t4)'}
            />
            <TelemetryLine
              label="SERVICE"
              value={linkedService?.name || 'NOT LINKED'}
              color={linkedService ? 'var(--t1)' : 'var(--t4)'}
            />
            <TelemetryLine
              label="TARGET"
              value="PRODUCTION"
              color={isDeploying ? RENDER_MINT : 'var(--t2)'}
            />
            <TelemetryLine
              label="ELAPSED"
              value={isDeploying || isSuccess || isError ? formatElapsed(elapsed) : 'IDLE'}
              color={isDeploying ? RENDER_MINT : isSuccess ? '#4ADE80' : 'var(--t4)'}
            />
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {!isDeploying ? (
              <button
                onClick={handleDeploy}
                disabled={isDeploying}
                title="Triggers a build of your backend's Git repository on Render. Frontend files are not deployed here."
                style={{
                  height: '38px',
                  borderRadius: '3px',
                  border: 'none',
                  background: `linear-gradient(135deg, ${RENDER_MINT} 0%, #1BA57B 100%)`,
                  color: '#06251C',
                  fontFamily: "'Space Grotesk', sans-serif",
                  fontWeight: 700,
                  fontSize: '0.72rem',
                  letterSpacing: '0.06em',
                  cursor: 'pointer',
                  transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                  boxShadow: '0 4px 14px rgba(70, 227, 183, 0.3)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.boxShadow = '0 6px 20px rgba(70, 227, 183, 0.45)';
                  e.currentTarget.style.transform = 'translateY(-1px)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.boxShadow = '0 4px 14px rgba(70, 227, 183, 0.3)';
                  e.currentTarget.style.transform = 'translateY(0)';
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 2L11 13" /><path d="M22 2L15 22L11 13L2 9L22 2Z" />
                </svg>
                {isSuccess ? 'REDEPLOY BACKEND' : 'DEPLOY BACKEND'}
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

            {/* Link existing service / create new one */}
            {renderConnected && !isDeploying && (
              <>
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
                  {linkedService ? `LINKED: ${String(linkedService.name).toUpperCase()}` : 'LINK EXISTING SERVICE'}
                </button>

                <button
                  onClick={() => setShowCreateModal(true)}
                  title={gitRepoConnected
                    ? 'Create a new Render web service from this session’s GitHub repository.'
                    : 'Connect a GitHub repository in the Git tab first, or paste a repo URL in the form.'}
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
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="16" />
                    <line x1="8" y1="12" x2="16" y2="12" />
                  </svg>
                  CREATE NEW SERVICE
                </button>
              </>
            )}

            {/* Service URL */}
            {(deployUrl || linkedService?.url) && (
              <a
                href={deployUrl || linkedService.url}
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
                OPEN SERVICE
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </a>
            )}

            {/* Delete Service */}
            {linkedService && !isDeploying && (
              <button
                onClick={handleDeleteService}
                disabled={deleting}
                style={{
                  background: 'transparent',
                  color: deleteConfirm ? '#FFFFFF' : 'var(--t4)',
                  border: `1px solid ${deleteConfirm ? 'var(--crimson)' : 'var(--line)'}`,
                  borderRadius: '3px',
                  fontFamily: "'Space Grotesk', sans-serif",
                  fontWeight: 600,
                  fontSize: '0.56rem',
                  letterSpacing: '0.06em',
                  padding: '6px 12px',
                  cursor: deleting ? 'default' : 'pointer',
                  opacity: deleting ? 0.5 : 1,
                  transition: 'all 0.2s ease',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  ...(deleteConfirm ? { background: 'rgba(229, 72, 77, 0.12)', borderColor: 'var(--crimson)', color: 'var(--crimson)' } : {}),
                }}
                onMouseEnter={e => {
                  if (!deleting && !deleteConfirm) {
                    e.currentTarget.style.color = 'var(--crimson)';
                    e.currentTarget.style.borderColor = 'var(--crimson)';
                  }
                }}
                onMouseLeave={e => {
                  if (!deleteConfirm) {
                    e.currentTarget.style.color = 'var(--t4)';
                    e.currentTarget.style.borderColor = 'var(--line)';
                  }
                  if (deleteConfirm) setDeleteConfirm(false);
                }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
                {deleting ? 'DELETING...' : deleteConfirm ? 'CLICK AGAIN TO CONFIRM' : 'DELETE SERVICE'}
              </button>
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

            {/* Java-without-Dockerfile note from detection */}
            {detection?.note && (
              <div style={{
                fontFamily: "'Space Grotesk', sans-serif",
                fontSize: '0.58rem',
                lineHeight: 1.6,
                color: '#FFB224',
                letterSpacing: '0.01em',
                padding: '8px 12px',
                background: 'rgba(255, 178, 36, 0.05)',
                border: '1px solid rgba(255, 178, 36, 0.2)',
                borderRadius: '3px',
              }}>
                {detection.note}
              </div>
            )}
          </div>

          {/* What this does / How it works */}
          <div style={{
            borderTop: '1px solid #2E2E2E', paddingTop: '14px',
            display: 'flex', flexDirection: 'column', gap: '8px',
          }}>
            <span style={{
              fontFamily: 'var(--font-number)', fontSize: '8px',
              color: 'var(--t3)', letterSpacing: '0.12em', fontWeight: 600,
            }}>
              WHAT THIS DOES
            </span>
            <p style={{
              margin: 0,
              fontFamily: "'Space Grotesk', sans-serif",
              fontSize: '0.62rem', lineHeight: 1.65,
              color: 'var(--t3)', letterSpacing: '0.01em',
            }}>
              Deploys the{' '}
              <span style={{ color: 'var(--t1)', fontWeight: 600 }}>backend of this session</span>{' '}
              to Render as a live web service. Works with Node.js, Python, Go,
              Rust, Ruby, Elixir and Docker backends (Java/Spring via Docker).{' '}
              <span style={{ color: '#FFB224' }}>
                Render builds from your Git repository — commit and push your
                changes first
              </span>{' '}
              (the Git tab handles that). Your frontend is deployed separately
              via the Vercel tab.
            </p>

            <span style={{
              fontFamily: 'var(--font-number)', fontSize: '8px',
              color: 'var(--t3)', letterSpacing: '0.12em', fontWeight: 600,
              marginTop: '6px',
            }}>
              HOW IT WORKS
            </span>
            <ol style={{
              margin: 0, padding: 0, listStyle: 'none',
              display: 'flex', flexDirection: 'column', gap: '5px',
            }}>
              {[
                'Link an existing Render service, or create one from your GitHub repo.',
                'Your backend runtime is auto-detected (Node, Python, Go, Docker…).',
                'Detected .env variables can be reviewed and uploaded to the service.',
                'Render pulls the repo, builds it, and serves your API on a live URL.',
              ].map((step, i) => (
                <li key={i} style={{
                  display: 'flex', gap: '8px', alignItems: 'baseline',
                  fontFamily: "'Space Grotesk', sans-serif",
                  fontSize: '0.6rem', lineHeight: 1.5,
                  color: 'var(--t3)', letterSpacing: '0.01em',
                }}>
                  <span style={{
                    fontFamily: 'var(--font-number)', fontSize: '0.55rem',
                    color: 'var(--t4)', fontWeight: 600, flexShrink: 0,
                  }}>
                    0{i + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          </div>
        </div>

        {/* CENTER DIVIDER */}
        <div style={{
          flex: '0 0 1px', borderRight: '1px solid #2E2E2E',
          alignSelf: 'stretch', margin: '4px 0', minHeight: '140px',
        }} />

        {/* RIGHT COLUMN: Live Deploy Status Console */}
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
            }}>DEPLOY LOG</span>
            <span style={{
              fontFamily: 'var(--font-number)',
              fontSize: '7px',
              color: isDeploying ? RENDER_MINT : isSuccess ? '#4ADE80' : 'var(--t4)',
              letterSpacing: '0.04em',
              textShadow: isDeploying ? '0 0 6px rgba(70, 227, 183, 0.4)' : 'none',
              transition: 'all 0.3s ease',
            }}>
              {isDeploying ? 'RECEIVING_FEED' : isSuccess ? 'SERVICE_LIVE' : isError ? 'DEPLOY_FAILED' : 'OFFLINE'}
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
                    // Render prefixes its own build phases with "==>"
                    // (e.g. "==> Cloning from ...", "==> Build successful 🎉").
                    const lineSuccess = line.includes('✓') || /successful|🎉|is live/i.test(line);
                    const lineError = line.includes('✗') || /\berror\b|failed|ERR!/i.test(line);
                    const lineUrl = line.includes('https://') || line.includes('→');
                    const linePhase = line.startsWith('==>') || line.includes('Building') || line.includes('Triggering') || line.includes('rolling out') || line.includes('Queued');
                    const lineWarn = line.includes('⚠') || line.includes('ℹ') || /\bwarn(ing)?\b/i.test(line);

                    return (
                      <div key={i} style={{
                        fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
                        fontSize: '0.62rem',
                        lineHeight: 1.6,
                        letterSpacing: '0.01em',
                        color: lineSuccess ? '#4ADE80'
                          : lineError ? '#E5484D'
                          : lineUrl ? RENDER_MINT
                          : linePhase ? 'var(--t2)'
                          : lineWarn ? '#FFB224'
                          : 'var(--t3)',
                        fontWeight: lineSuccess || lineUrl || linePhase ? 600 : 400,
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

      {/* Connect Render Modal */}
      {showConnectModal && (
        <ConnectRenderModal
          onClose={() => setShowConnectModal(false)}
          onConnected={(name) => {
            setRenderConnected(true, name);
            setShowConnectModal(false);
          }}
        />
      )}

      {/* Env Variable Confirmation Modal */}
      {showEnvModal && (
        <EnvConfirmModal
          envVars={detectedEnvVars}
          provider="Render"
          providerColor={RENDER_MINT}
          onConfirm={handleConfirmEnv}
          onSkip={handleSkipEnv}
          onCancel={handleCancelEnv}
        />
      )}

      {/* Link Existing Service Modal */}
      {showLinkModal && (
        <LinkServiceModal
          sessionId={sessionId}
          onClose={() => setShowLinkModal(false)}
          onLinked={(name, url) => {
            setLinkedService({ name, url: url || null });
            setShowLinkModal(false);
          }}
        />
      )}

      {/* Create New Service Modal */}
      {showCreateModal && (
        <CreateServiceModal
          sessionId={sessionId}
          detection={detection}
          repoUrl={gitRepoUrl}
          defaultName={(sessionName || 'causify-backend')
            .toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'causify-backend'}
          onClose={() => setShowCreateModal(false)}
          onCreated={async (name, url) => {
            setLinkedService({ name, url: url || null });
            setShowCreateModal(false);

            if (shouldDeployAfterCreate) {
              setShouldDeployAfterCreate(false);
              
              if (pendingEnvVars && pendingEnvVars.length > 0) {
                setDeployStatus('pushing-env');
                addDeployLog('⚙ Uploading environment variables to the new Render service...');
                try {
                  const res = await window.electronAPI.pushRenderEnvVars({ sessionId, vars: pendingEnvVars });
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
              } else {
                proceedWithDeployment();
              }
              setPendingEnvVars(null);
            }
          }}
        />
      )}
    </div>
  );
};

export default RenderDeployPanel;
