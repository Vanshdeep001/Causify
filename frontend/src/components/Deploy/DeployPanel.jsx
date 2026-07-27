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
import WebRootConfirmModal from './WebRootConfirmModal';

/* ── Utility: Strip ANSI color codes ── */
const stripAnsi = (str) => {
  if (!str) return '';
  return str.replace(/\x1B\[[;\d]*m/g, '').replace(/\x1B\[\?[;\d]*[a-zA-Z]/g, '');
};

/* ── Status Configuration ── */
const STATUS_CONFIG = {
  idle:        { label: 'READY',       color: '#6E6E6E', pulse: false },
  connecting:  { label: 'CONNECTING',  color: '#FFB224', pulse: true },
  'root-confirm':{ label: 'SELECT FOLDER', color: '#FFB224', pulse: false },
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
  const storeSessionId = useEditorStore((s) => s.sessionId);
  const workspaceRoot = useEditorStore((s) => s.workspaceRoot);
  // A locally opened folder deploys without any session; the folder path is the
  // scope the desktop layer keys its deploy workspace and Vercel link off.
  const sessionId = workspaceRoot || storeSessionId;

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
  const setLastDeploySessionId = useEditorStore((s) => s.setLastDeploySessionId);
  const lastDeploySessionId = useEditorStore((s) => s.lastDeploySessionId);

  const [showConnectModal, setShowConnectModal] = useState(false);
  const [showEnvModal, setShowEnvModal] = useState(false);
  const [showWebRootModal, setShowWebRootModal] = useState(false);
  const [webRootCandidates, setWebRootCandidates] = useState([]);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [linkedProject, setLinkedProject] = useState(null); // name of linked Vercel project
  const [detectedEnvVars, setDetectedEnvVars] = useState([]);
  const [elapsed, setElapsed] = useState(0);
  const logContainerRef = useRef(null);
  const cleanupRef = useRef({ log: null, complete: null });

  // Delete deployment state
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Deploy scope (personal account vs team) — avoids the SAML/scope 403.
  const [scopes, setScopes] = useState([]);
  const [scope, setScope] = useState(null); // { teamId, slug, name, type }
  const [copiedTokenUrl, setCopiedTokenUrl] = useState(false);
  const [copiedWorkspace, setCopiedWorkspace] = useState(false);

  // Monorepo deploy indicator (from prepareWorkspace)
  const [isMonorepo, setIsMonorepo] = useState(false);
  const [monorepoApp, setMonorepoApp] = useState(null); // app subfolder being built

  // Env vars deferred until after the first deploy creates the project link.
  const pendingEnvVarsRef = useRef(null);

  // User-chosen project name → clean "<name>.vercel.app" URL (new projects only).
  const [projectName, setProjectName] = useState('');
  const projectNameRef = useRef('');
  const sanitizeName = (s) => String(s || '').toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 100);

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

  // Restore existing deployment state on mount (after app restart).
  // The success panel is already persisted (deployStatus/deployUrl in the store),
  // so this pass is purely additive: when the deployment can be confirmed on
  // Vercel we refresh the live URL / project name and, if the persisted state
  // was lost (e.g. localStorage cleared), we re-show the success panel.
  //
  // We deliberately do NOT reset a persisted "success" when the check returns
  // exists:false. That check reports false for many transient, non-deletion
  // reasons — token not yet unlocked on startup, the .vercel link missing from a
  // regenerated deploy workspace, an API rate-limit, or the latest deploy simply
  // not being in the READY state — and resetting on those made a live deployment
  // revert to "Deploy to Production" after every reopen. The state now persists
  // until the user explicitly cancels or deletes the deployment.
  useEffect(() => {
    const restoreDeployment = async () => {
      const targetSessionId = lastDeploySessionId || sessionId;
      if (!targetSessionId || !window.electronAPI?.checkExistingVercelDeploy) return;

      try {
        const result = await window.electronAPI.checkExistingVercelDeploy({ sessionId: targetSessionId });
        if (result?.exists) {
          // Deployment confirmed on Vercel — ensure the panel shows success
          if (deployStatus === 'idle') {
            setDeployStatus('success');
          }
          if (result.deployUrl) setDeployUrl(result.deployUrl);
          if (result.projectName) setLinkedProject(result.projectName);
          // If we restored using targetSessionId, make sure we align lastDeploySessionId to it
          if (lastDeploySessionId !== targetSessionId) {
            setLastDeploySessionId(targetSessionId);
          }
        }
      } catch {
        // Non-fatal — just keep the current (persisted) state
      }
    };
    restoreDeployment();
  }, [sessionId, lastDeploySessionId]);

  // Load deployable scopes (personal account + teams) once connected, and
  // restore / default the selected scope.
  useEffect(() => {
    const loadScopes = async () => {
      if (!vercelConnected || !window.electronAPI?.listVercelScopes) return;
      try {
        const res = await window.electronAPI.listVercelScopes();
        if (!res?.success || !(res.scopes || []).length) return;
        setScopes(res.scopes);
        const current = await window.electronAPI.getVercelScope?.();
        const match = current && res.scopes.find((s) => (s.teamId || null) === (current.teamId || null));
        if (match) {
          setScope(match);
        } else {
          // Default to the first scope (personal) and persist it.
          setScope(res.scopes[0]);
          await window.electronAPI.setVercelScope?.(res.scopes[0]);
        }
      } catch {
        // non-fatal — scope selector just won't show
      }
    };
    loadScopes();
  }, [vercelConnected]);

  const handleScopeChange = async (key) => {
    const next = scopes.find((s) => (s.teamId || 'personal') === key);
    if (!next) return;
    setScope(next);
    try {
      await window.electronAPI.setVercelScope?.(next);
      // Project links are per-scope; clear the displayed link so it's re-detected.
      setLinkedProject(null);
    } catch {
      // ignore
    }
  };

  // Load any existing project link for this session (so redeploys show the target)
  useEffect(() => {
    const loadLink = async () => {
      if (!sessionId || !window.electronAPI?.getLinkedVercelProject) return;
      try {
        const info = await window.electronAPI.getLinkedVercelProject(
          useEditorStore.getState().getDeployScope()
        );
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

  /* ── Proceed With Deployment ── */
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

    // Subscribe to live logs BEFORE triggering the deploy
    const unsubLog = window.electronAPI.onDeployLog(deployId, (data) => {
      const lines = stripAnsi(data).split('\n').filter(l => l.trim());
      lines.forEach(line => addDeployLog(line));
    });

    // Subscribe to completion
    const unsubComplete = window.electronAPI.onDeployComplete(deployId, async (data) => {
      if (data.success) {
        setDeployStatus('success');
        setDeployUrl(data.url);
        setLastDeploySessionId(sessionId);
        addDeployLog(`✓ Deployment successful!`);
        addDeployLog(`→ ${data.url}`);

        // Env vars deferred from the first deploy: the project now exists, so
        // push them and prompt a redeploy to apply them at build time.
        if (pendingEnvVarsRef.current && pendingEnvVarsRef.current.length) {
          const vars = pendingEnvVarsRef.current;
          pendingEnvVarsRef.current = null;
          try {
            const store2 = useEditorStore.getState();
            const envRes = await window.electronAPI.pushEnvVars({ sessionId: store2.sessionId, vars });
            if (envRes.success) {
              addDeployLog(`✓ Added ${vars.length} environment variable(s) to the project.`);
              addDeployLog('↻ Redeploy to apply them at build time.');
            } else {
              addDeployLog(`⚠ Could not add environment variables: ${envRes.error || 'Unknown error'}`);
            }
          } catch (envErr) {
            addDeployLog(`⚠ Could not add environment variables: ${envErr.message}`);
          }
        }

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
          // Deployment history is keyed by scope: the folder path in local mode,
          // the session id otherwise.
          sessionId: store.workspaceRoot || store.sessionId,
          deploymentUrl: data.url,
          vercelDeploymentId: deployId,
          target: 'production',
          gitBranch,
          gitCommit,
          snapshotId,
          status: 'success',
          framework: store.deployFramework,
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
            framework: store.deployFramework,
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

    try {
      const store = useEditorStore.getState();
      const deployOptions = {
        ...store.getDeployScope(),
        deployId,
        ...(projectNameRef.current ? { projectName: projectNameRef.current } : {}),
      };

      const result = await window.electronAPI.runDeploy(deployOptions);
      setDeployFramework(result.framework);
    } catch (err) {
      // Cleanup subscriptions on failure
      unsubLog?.();
      unsubComplete?.();
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
  // chosenWebRoot is null on a fresh deploy; when several frontends are
  // detected the flow pauses on a folder picker and re-enters here with
  // the user's choice ('.' = project root).
  const startDeploy = useCallback(async (chosenWebRoot = null) => {
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
    setIsMonorepo(false);
    setMonorepoApp(null);

    try {
      const store = useEditorStore.getState();
      // Local mode has no session — the folder path identifies the project, and
      // the main process reads its contents from disk.
      const scopeOptions = store.workspaceRoot
        ? { workspaceRoot: store.workspaceRoot }
        : { sessionId: store.sessionId };
      const deployOptions = { ...scopeOptions };

      // Write the current in-memory files to the deploy workspace. This is what
      // makes plain static (HTML/CSS/JS) projects deployable and ensures the
      // very latest edits are what gets pushed.
      if (window.electronAPI.prepareDeployWorkspace) {
        const prep = await window.electronAPI.prepareDeployWorkspace({
          ...scopeOptions,
          files: store.files,
          ...(chosenWebRoot != null ? { webRoot: chosenWebRoot } : {}),
        });
        if (!prep?.success) {
          throw new Error(prep?.error || 'Failed to prepare deploy workspace');
        }
        if (prep.needsChoice) {
          // Several distinct frontends found — ask instead of guessing.
          setWebRootCandidates(prep.candidates || []);
          setDeployStatus('root-confirm');
          setShowWebRootModal(true);
          addDeployLog(`⚠ ${prep.candidates.length} deployable folders detected — waiting for selection.`);
          return;
        }
        if (!prep.fileCount) {
          throw new Error('No files to deploy — add or open files in this session first.');
        }
        setIsMonorepo(!!prep.monorepo);
        setMonorepoApp(prep.rootDirectory || null);
        if (prep.monorepo) {
          addDeployLog(`🧩 Monorepo — deploying the workspace, building "${prep.rootDirectory || '.'}/".`);
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

  const handleDeploy = useCallback(() => startDeploy(null), [startDeploy]);

  /* ── Confirm Deploy Folder ── */
  const handleConfirmWebRoot = useCallback((dir) => {
    setShowWebRootModal(false);
    addDeployLog(`📁 Deploy folder: ${dir === '.' ? 'project root' : dir + '/'}`);
    startDeploy(dir);
  }, [startDeploy, addDeployLog]);

  /* ── Cancel Deploy Folder Step ── */
  const handleCancelWebRoot = useCallback(() => {
    setShowWebRootModal(false);
    resetDeploy();
  }, [resetDeploy]);

  /* ── Confirm Env Variables ── */
  const handleConfirmEnv = useCallback(async (selectedVars) => {
    setShowEnvModal(false);
    setDeployStatus('pushing-env');
    addDeployLog('⚙ Uploading environment variables to Vercel...');

    try {
      const store = useEditorStore.getState();
      const deployOptions = store.getDeployScope();

      const res = await window.electronAPI.pushEnvVars({ ...deployOptions, vars: selectedVars });
      if (res.success) {
        addDeployLog('✓ Environment variables successfully uploaded.');
        proceedWithDeployment();
      } else if (/no vercel project linked/i.test(res.error || '')) {
        // First deploy: the project doesn't exist yet, so env vars can't be
        // attached now. Deploy to create it, then push them afterward.
        pendingEnvVarsRef.current = selectedVars;
        addDeployLog('ℹ New project — deploying first to create it, then env vars will be added.');
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

  /* ── Delete Deployment (Vercel Project) ── */
  const handleDeleteDeployment = useCallback(async () => {
    if (!deleteConfirm) {
      setDeleteConfirm(true);
      return;
    }

    if (!window.electronAPI?.deleteVercelProject) {
      setDeployError('Delete not available — update the desktop app.');
      setDeleteConfirm(false);
      return;
    }

    setDeleting(true);
    setDeployError(null);
    addDeployLog('⚠ Deleting Vercel project...');

    try {
      const store = useEditorStore.getState();
      // Target the session that actually deployed. The project link lives in a
      // temp dir keyed by session id, and the deploy was recorded under
      // lastDeploySessionId — using the current sessionId here would miss the
      // link whenever the app reopened into a new session. Pass the known
      // project name too so the main process can fall back to resolving the
      // project by name if the local .vercel link file is gone.
      const res = await window.electronAPI.deleteVercelProject({
        sessionId: store.lastDeploySessionId || store.sessionId,
        projectName: linkedProject || undefined,
      });
      if (res.success) {
        addDeployLog(`✓ Project${res.projectName ? ` "${res.projectName}"` : ''} deleted from Vercel.`);
        setLinkedProject(null);
        resetDeploy();
      } else {
        setDeployError(res.error || 'Failed to delete project');
        addDeployLog(`✗ Delete failed: ${res.error || 'Unknown error'}`);
      }
    } catch (err) {
      setDeployError(err.message || 'Delete request failed');
      addDeployLog(`✗ Delete error: ${err.message}`);
    } finally {
      setDeleting(false);
      setDeleteConfirm(false);
    }
  }, [deleteConfirm, addDeployLog, setDeployError, resetDeploy]);

  const isDeploying = deployStatus === 'deploying';
  const isSuccess = deployStatus === 'success';
  const isError = deployStatus === 'error';
  const statusColor = STATUS_CONFIG[deployStatus]?.color || '#6E6E6E';
  const logs = deployLogs.map(stripAnsi);

  // Detect the "token can't access this scope" / SAML 403 class of failure so we
  // can show an actionable recovery guide instead of just the raw error.
  const isScopeAuthError = isError && !!deployError &&
    /(\b403\b|forbidden|re-authenticate to this scope|Not authorized: Trying to access resource under scope|"?saml"?\s*:\s*true)/i.test(deployError);
  const blockedScope = (deployError && (deployError.match(/scope[\\"':\s]+([a-z0-9._-]+)/i)?.[1])) || null;

  const copyTokenUrl = async () => {
    try {
      await navigator.clipboard?.writeText('https://vercel.com/account/tokens');
      setCopiedTokenUrl(true);
      setTimeout(() => setCopiedTokenUrl(false), 1800);
    } catch { /* clipboard unavailable */ }
  };

  // Detect a missing package / workspace-dependency failure — e.g. a monorepo
  // repo deployed as a single folder, so a sibling package can't resolve.
  const missingModule = isError
    ? (`${deployError || ''}\n${logs.join('\n')}`
        .match(/Cannot find module ['"]([^'"]+)['"]|Module not found[^'"]*['"]([^'"]+)['"]/i) || [])
        .slice(1).find(Boolean) || null
    : null;
  const isMissingModuleError = isError && !!missingModule;
  const looksLikeWorkspacePkg = !!missingModule && missingModule.startsWith('@') && !missingModule.startsWith('@types/');

  const workspaceSnippet = `{
  "name": "workspace",
  "private": true,
  "workspaces": ["client", "shared"]
}`;
  const copyWorkspaceSnippet = async () => {
    try {
      await navigator.clipboard?.writeText(workspaceSnippet);
      setCopiedWorkspace(true);
      setTimeout(() => setCopiedWorkspace(false), 1800);
    } catch { /* clipboard unavailable */ }
  };

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
            <span style={{
              fontFamily: 'var(--font-number)', fontSize: '0.52rem',
              color: 'var(--t4)', letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}>
              One-click frontend deployment · Powered by Vercel
            </span>
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
              value={
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '7px' }}>
                  {deployFramework || 'DETECTING...'}
                  {isMonorepo && (
                    <span
                      title={monorepoApp ? `Monorepo — building "${monorepoApp}/" from the workspace` : 'Monorepo workspace deploy'}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: '4px',
                        padding: '1px 6px', borderRadius: '3px',
                        background: 'rgba(56, 189, 248, 0.12)',
                        border: '1px solid rgba(56, 189, 248, 0.4)',
                        color: '#7DD3FC',
                        fontFamily: 'var(--font-number)', fontSize: '0.46rem', fontWeight: 700,
                        letterSpacing: '0.08em',
                      }}
                    >
                      <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
                        <rect x="14" y="14" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" />
                      </svg>
                      MONOREPO{monorepoApp ? ` · ${monorepoApp}` : ''}
                    </span>
                  )}
                </span>
              }
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

          {/* Project name — becomes the Vercel project & URL. Only for new
              projects; once linked, redeploys keep the existing project. */}
          {vercelConnected && !linkedProject && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{
                fontFamily: 'var(--font-number)', fontSize: '0.5rem',
                letterSpacing: '0.1em', color: 'var(--t3)', textTransform: 'uppercase',
              }}>
                Project Name
              </label>
              <input
                type="text"
                value={projectName}
                placeholder="my-app"
                disabled={isDeploying}
                onChange={(e) => {
                  const v = e.target.value;
                  setProjectName(v);
                  projectNameRef.current = sanitizeName(v);
                }}
                style={{
                  background: 'var(--s0)', color: 'var(--t1)',
                  border: '1px solid var(--line-strong)', borderRadius: '4px',
                  padding: '7px 9px', fontFamily: 'var(--font-body)',
                  fontSize: '0.72rem', outline: 'none',
                }}
              />
              <span style={{
                fontFamily: 'var(--font-number)', fontSize: '0.5rem',
                color: 'var(--t4)', letterSpacing: '0.02em',
              }}>
                URL:{' '}
                <span style={{ color: '#38BDF8' }}>
                  {(sanitizeName(projectName) || 'your-project')}.vercel.app
                </span>
              </span>
            </div>
          )}

          {/* Deploy scope selector — pick the personal account or a team so the
              upload runs under a scope the token can actually access. */}
          {vercelConnected && scopes.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{
                fontFamily: 'var(--font-number)', fontSize: '0.5rem',
                letterSpacing: '0.1em', color: 'var(--t3)', textTransform: 'uppercase',
              }}>
                Deploy Scope
              </label>
              <select
                value={scope ? (scope.teamId || 'personal') : ''}
                onChange={(e) => handleScopeChange(e.target.value)}
                disabled={isDeploying}
                style={{
                  background: 'var(--s0)', color: 'var(--t1)',
                  border: '1px solid var(--line-strong)', borderRadius: '4px',
                  padding: '7px 9px', fontFamily: 'var(--font-body)',
                  fontSize: '0.7rem', outline: 'none',
                  cursor: isDeploying ? 'not-allowed' : 'pointer',
                }}
              >
                {scopes.map((s) => (
                  <option key={s.teamId || 'personal'} value={s.teamId || 'personal'}>
                    {s.name}{s.type === 'team' ? '  ·  team' : ''}
                  </option>
                ))}
              </select>
              <span style={{
                fontFamily: 'var(--font-number)', fontSize: '0.46rem',
                color: 'var(--t4)', letterSpacing: '0.02em', lineHeight: 1.4,
              }}>
                Where this deploys. If a team blocks with an SSO/403 error, pick your personal account.
              </span>
            </div>
          )}

          {/* Action Buttons */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {!isDeploying ? (
              <button
                onClick={handleDeploy}
                disabled={isDeploying}
                title="Deploys the frontend files of this session to Vercel as a production build. Backend code is not deployed."
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
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
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
              </div>
            )}

            {/* Delete Deployment */}
            {(isSuccess || deployUrl) && !isDeploying && (
              <button
                onClick={handleDeleteDeployment}
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
                  // Reset confirm state if user mouses away
                  if (deleteConfirm) setDeleteConfirm(false);
                }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
                {deleting ? 'DELETING...' : deleteConfirm ? 'CLICK AGAIN TO CONFIRM DELETE' : 'DELETE DEPLOYMENT'}
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

            {/* Actionable recovery guide for scope / SAML-403 failures */}
            {isScopeAuthError && (
              <div style={{
                marginTop: '10px',
                padding: '12px 14px',
                background: 'rgba(56, 189, 248, 0.05)',
                border: '1px solid rgba(56, 189, 248, 0.25)',
                borderRadius: '5px',
              }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '4px',
                }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#38BDF8"
                    strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
                  </svg>
                  <span style={{
                    fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700,
                    fontSize: '0.72rem', color: 'var(--t1)', letterSpacing: '0.02em',
                  }}>
                    How to fix this
                  </span>
                </div>

                <p style={{
                  fontFamily: 'var(--font-body)', fontSize: '0.68rem', lineHeight: 1.5,
                  color: 'var(--t3)', margin: '0 0 10px',
                }}>
                  Your Vercel token can only access{' '}
                  <strong style={{ color: 'var(--t2)' }}>{blockedScope || 'a team'}</strong>, which
                  is protected by SSO. Deploy with a token scoped to your <strong style={{ color: 'var(--t2)' }}>personal account</strong> instead:
                </p>

                <ol style={{
                  margin: 0, paddingLeft: '18px',
                  fontFamily: 'var(--font-body)', fontSize: '0.68rem', lineHeight: 1.7,
                  color: 'var(--t2)',
                }}>
                  <li>
                    Open{' '}
                    <span style={{ color: '#38BDF8', fontFamily: 'var(--font-number)', fontSize: '0.64rem' }}>
                      vercel.com/account/tokens
                    </span>{' '}
                    <button
                      onClick={copyTokenUrl}
                      style={{
                        marginLeft: '4px', verticalAlign: 'middle',
                        background: 'transparent', border: '1px solid var(--line-strong)',
                        borderRadius: '3px', color: copiedTokenUrl ? '#4ADE80' : 'var(--t3)',
                        fontFamily: 'var(--font-number)', fontSize: '0.5rem', fontWeight: 600,
                        letterSpacing: '0.04em', padding: '2px 6px', cursor: 'pointer',
                        textTransform: 'uppercase',
                      }}
                    >
                      {copiedTokenUrl ? 'Copied' : 'Copy link'}
                    </button>
                  </li>
                  <li><strong>Create Token</strong> → set <strong>Scope</strong> to your personal account (not the team).</li>
                  <li>Come back and click <strong>Reconnect</strong> below, then paste the new token.</li>
                  <li>In <strong>Deploy Scope</strong>, choose your personal account.</li>
                  <li>Hit <strong>Deploy to Production</strong> again.</li>
                </ol>

                <button
                  onClick={async () => { await handleDisconnect(); setShowConnectModal(true); }}
                  style={{
                    marginTop: '11px', width: '100%', height: '30px',
                    background: 'rgba(56, 189, 248, 0.12)',
                    border: '1px solid rgba(56, 189, 248, 0.45)',
                    borderRadius: '4px', color: '#7DD3FC',
                    fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700,
                    fontSize: '0.62rem', letterSpacing: '0.06em', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '7px',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(56, 189, 248, 0.2)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(56, 189, 248, 0.12)'; }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                  </svg>
                  Disconnect &amp; Reconnect
                </button>
              </div>
            )}

            {/* Recovery guide for a missing package / workspace dependency */}
            {isMissingModuleError && (
              <div style={{
                marginTop: '10px',
                padding: '12px 14px',
                background: 'rgba(255, 176, 36, 0.05)',
                border: '1px solid rgba(255, 176, 36, 0.28)',
                borderRadius: '5px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '4px' }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#FFB224"
                    strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                    <polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" />
                  </svg>
                  <span style={{
                    fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700,
                    fontSize: '0.72rem', color: 'var(--t1)', letterSpacing: '0.02em',
                  }}>
                    Missing package
                  </span>
                </div>

                <p style={{
                  fontFamily: 'var(--font-body)', fontSize: '0.68rem', lineHeight: 1.5,
                  color: 'var(--t3)', margin: '0 0 10px',
                }}>
                  The build can't find{' '}
                  <strong style={{ color: 'var(--t2)' }}>{missingModule}</strong>.{' '}
                  {looksLikeWorkspacePkg
                    ? 'That looks like a package from another folder in your repo (a workspace package). You deployed one folder, so its sibling was left behind — deploy the whole workspace instead:'
                    : "Add it to your app's dependencies (or inline it) so the build can resolve it:"}
                </p>

                {looksLikeWorkspacePkg ? (
                  <>
                    <ol style={{
                      margin: 0, paddingLeft: '18px',
                      fontFamily: 'var(--font-body)', fontSize: '0.68rem', lineHeight: 1.7,
                      color: 'var(--t2)',
                    }}>
                      <li style={{ marginBottom: '2px' }}>
                        Add a <strong>root <code style={{ fontFamily: 'var(--font-number)' }}>package.json</code></strong> next to your folders (adjust names):
                      </li>
                    </ol>
                    <div style={{ position: 'relative', margin: '6px 0 8px' }}>
                      <pre style={{
                        margin: 0, padding: '8px 10px',
                        background: 'var(--s0)', border: '1px solid var(--line-strong)',
                        borderRadius: '4px', color: 'var(--t2)',
                        fontFamily: 'var(--font-number)', fontSize: '0.6rem', lineHeight: 1.5,
                        overflowX: 'auto', whiteSpace: 'pre',
                      }}>{workspaceSnippet}</pre>
                      <button
                        onClick={copyWorkspaceSnippet}
                        style={{
                          position: 'absolute', top: '6px', right: '6px',
                          background: 'var(--s2)', border: '1px solid var(--line-strong)',
                          borderRadius: '3px', color: copiedWorkspace ? '#4ADE80' : 'var(--t3)',
                          fontFamily: 'var(--font-number)', fontSize: '0.5rem', fontWeight: 600,
                          letterSpacing: '0.04em', padding: '2px 6px', cursor: 'pointer',
                          textTransform: 'uppercase',
                        }}
                      >
                        {copiedWorkspace ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                    <ol start={2} style={{
                      margin: 0, paddingLeft: '18px',
                      fontFamily: 'var(--font-body)', fontSize: '0.68rem', lineHeight: 1.7,
                      color: 'var(--t2)',
                    }}>
                      <li>Make sure your app's <code style={{ fontFamily: 'var(--font-number)' }}>package.json</code> lists <code style={{ fontFamily: 'var(--font-number)', color: 'var(--t1)' }}>"{missingModule}": "*"</code>.</li>
                      <li><strong>Fully restart the app</strong>, then Deploy again — you'll skip the folder picker and see a <strong>MONOREPO</strong> badge.</li>
                    </ol>
                    <p style={{
                      fontFamily: 'var(--font-body)', fontSize: '0.62rem', lineHeight: 1.5,
                      color: 'var(--t4)', margin: '8px 0 0',
                    }}>
                      Type-only import? You can instead inline those types in the app and drop the dependency — then just deploy that folder.
                    </p>
                  </>
                ) : (
                  <ol style={{
                    margin: 0, paddingLeft: '18px',
                    fontFamily: 'var(--font-body)', fontSize: '0.68rem', lineHeight: 1.7,
                    color: 'var(--t2)',
                  }}>
                    <li>If it's an npm package: add <code style={{ fontFamily: 'var(--font-number)', color: 'var(--t1)' }}>"{missingModule}"</code> to your <code style={{ fontFamily: 'var(--font-number)' }}>package.json</code> dependencies.</li>
                    <li>If it's your own code in another folder: import it with a relative path, or set up a workspace.</li>
                    <li>Deploy again.</li>
                  </ol>
                )}
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
              Publishes the{' '}
              <span style={{ color: 'var(--t1)', fontWeight: 600 }}>frontend of this session</span>{' '}
              to Vercel and gives you a live production URL. Works with static
              sites (HTML/CSS/JS) and frontend frameworks like React, Vite and
              Next.js.{' '}
              <span style={{ color: '#FFB224' }}>
                Backend servers, databases and APIs are not deployed
              </span>{' '}
              — host those separately.
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
                'Your latest session files are packaged for deployment.',
                'The framework is auto-detected (React, Vite, Next.js, static…).',
                'Detected .env variables can be reviewed and uploaded first.',
                'Vercel builds the frontend and returns a live production URL.',
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

      {/* Deploy Folder Selection Modal */}
      {showWebRootModal && (
        <WebRootConfirmModal
          candidates={webRootCandidates}
          onConfirm={handleConfirmWebRoot}
          onCancel={handleCancelWebRoot}
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
