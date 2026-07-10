/* -------------------------------------------------------
 * ipc/renderDeploy.js — Render Backend Deployment IPC Handlers
 *
 * Backend counterpart of ipc/deploy.js (Vercel). Render does not
 * accept direct file uploads — services build from a connected Git
 * repository. So the lifecycle here is:
 *   - Render API key storage (OS keychain via safeStorage)
 *   - Key validation against the Render API (GET /v1/owners)
 *   - Link a session to an existing Render service, or create a
 *     new service from the session's GitHub repository
 *   - Trigger a deploy (POST /v1/services/{id}/deploys) and poll
 *     its status, streaming progress to the renderer
 *   - Env var upsert per key (PUT /v1/services/{id}/env-vars/{key})
 *
 * Security:
 *   - API key is encrypted at rest (safeStorage / DPAPI / Keychain)
 *   - API key is NEVER sent to the renderer or Java backend
 *   - All streamed output is scrubbed of the key before forwarding
 * ------------------------------------------------------- */

const { ipcMain, app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RENDER_API = 'https://api.render.com/v1';

/* ── Config Paths ── */
const CONFIG_DIR = app.getPath('userData');
const KEY_FILE = path.join(CONFIG_DIR, 'render-api-key.enc');
const LINKS_FILE = path.join(CONFIG_DIR, 'render-links.json');

/* ── Active deploy sessions ── */
const renderDeploySessions = new Map(); // deployId -> { cancelled, serviceId, renderDeployId }

/* ══════════════════════════════════════════════════════════
 *  API KEY MANAGEMENT (safeStorage)
 * ══════════════════════════════════════════════════════════ */

function storeApiKey(key) {
  if (!safeStorage.isEncryptionAvailable()) {
    fs.writeFileSync(KEY_FILE, key, 'utf-8');
    return;
  }
  fs.writeFileSync(KEY_FILE, safeStorage.encryptString(key));
}

function retrieveApiKey() {
  if (!fs.existsSync(KEY_FILE)) return null;
  try {
    const data = fs.readFileSync(KEY_FILE);
    if (!safeStorage.isEncryptionAvailable()) return data.toString('utf-8');
    return safeStorage.decryptString(data);
  } catch (err) {
    console.error('[Causify Render] Failed to decrypt API key:', err.message);
    return null;
  }
}

function scrubKey(text, key) {
  if (!key || !text) return text;
  return String(text).split(key).join('[REDACTED]');
}

/* ══════════════════════════════════════════════════════════
 *  SESSION → SERVICE LINKS
 *
 *  Vercel links live in the deploy workspace (.vercel/project.json).
 *  Render deploys have no local workspace, so links are kept in a
 *  single JSON map in userData keyed by sessionId.
 * ══════════════════════════════════════════════════════════ */

function readLinks() {
  try {
    if (!fs.existsSync(LINKS_FILE)) return {};
    return JSON.parse(fs.readFileSync(LINKS_FILE, 'utf-8')) || {};
  } catch {
    return {};
  }
}

function writeLinks(links) {
  fs.writeFileSync(LINKS_FILE, JSON.stringify(links, null, 2), 'utf-8');
}

function getLink(sessionId) {
  if (!sessionId) return null;
  return readLinks()[sessionId] || null;
}

function setLink(sessionId, link) {
  if (!sessionId) throw new Error('sessionId is required to link a Render service');
  const links = readLinks();
  links[sessionId] = link;
  writeLinks(links);
}

function clearLink(sessionId) {
  const links = readLinks();
  if (links[sessionId]) {
    delete links[sessionId];
    writeLinks(links);
  }
}

/* ══════════════════════════════════════════════════════════
 *  RENDER API HELPERS
 * ══════════════════════════════════════════════════════════ */

async function renderFetch(key, endpoint, options = {}) {
  const res = await fetch(`${RENDER_API}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(options.timeoutMs || 15000),
  });
  const data = await res.json().catch(() => null);
  return { res, data };
}

/**
 * Validate an API key by listing owners.
 * Returns { valid, name, owners: [{ id, name, type }], error }.
 */
async function validateApiKey(key) {
  try {
    const { res, data } = await renderFetch(key, '/owners?limit=20');
    if (!res.ok) {
      return {
        valid: false,
        error: res.status === 401 ? 'Invalid API key' : `API returned ${res.status}`,
      };
    }
    const owners = (Array.isArray(data) ? data : [])
      .map((entry) => entry.owner)
      .filter(Boolean)
      .map((o) => ({ id: o.id, name: o.name || o.email || 'Unknown', type: o.type }));
    return { valid: true, name: owners[0]?.name || 'Connected', owners };
  } catch (err) {
    return { valid: false, error: err.message || 'Request failed' };
  }
}

/**
 * List the services visible to the API key (newest first).
 * Returns { success, services: [{ id, name, type, repo, branch, url, runtime, suspended }], error }.
 */
async function listServices(key) {
  try {
    const { res, data } = await renderFetch(key, '/services?limit=100');
    if (!res.ok) {
      return { success: false, error: `API returned ${res.status}` };
    }
    const services = (Array.isArray(data) ? data : [])
      .map((entry) => entry.service)
      .filter(Boolean)
      .map((s) => ({
        id: s.id,
        name: s.name,
        type: s.type,
        repo: s.repo || null,
        branch: s.branch || null,
        url: s.serviceDetails?.url || null,
        runtime: s.serviceDetails?.runtime || s.serviceDetails?.env || null,
        suspended: s.suspended === 'suspended',
        updatedAt: Date.parse(s.updatedAt || s.createdAt || 0) || 0,
      }));
    services.sort((a, b) => b.updatedAt - a.updatedAt);
    return { success: true, services };
  } catch (err) {
    return { success: false, error: err.message || 'Request failed' };
  }
}

/**
 * Create a new service from a Git repository.
 * Returns { success, service: { id, name, url }, error }.
 */
async function createService(key, opts) {
  const {
    name, ownerId, repo, branch, runtime, rootDir,
    buildCommand, startCommand, dockerfilePath, plan,
  } = opts;

  if (!name || !ownerId || !repo) {
    return { success: false, error: 'name, ownerId and repo are required' };
  }

  // Strip embedded credentials and a trailing .git — Render wants the plain
  // https URL of a repo its account already has access to.
  const cleanRepo = String(repo)
    .replace(/:\/\/[^@/]+@/, '://')
    .replace(/\.git$/, '');

  const isDocker = runtime === 'docker';
  const serviceDetails = {
    plan: plan || 'free',
    region: opts.region || 'oregon',
    // Render renamed serviceDetails.env → runtime; send both so either
    // API revision accepts the payload (unknown fields are ignored).
    env: runtime,
    runtime,
    ...(rootDir ? { rootDir } : {}),
    envSpecificDetails: isDocker
      ? { dockerfilePath: dockerfilePath || './Dockerfile' }
      : { buildCommand: buildCommand || '', startCommand: startCommand || '' },
  };

  try {
    const { res, data } = await renderFetch(key, '/services', {
      method: 'POST',
      body: JSON.stringify({
        type: 'web_service',
        name,
        ownerId,
        repo: cleanRepo,
        ...(branch ? { branch } : {}),
        autoDeploy: 'yes',
        serviceDetails,
      }),
      timeoutMs: 30000,
    });

    if (!res.ok) {
      const msg = data?.message || `Service creation failed (${res.status})`;
      // The most common failure: Render has no access to the repo.
      const hint = res.status === 400 || res.status === 404
        ? ' Make sure this repository is accessible to your Render account (connect GitHub/GitLab in the Render dashboard).'
        : '';
      return { success: false, error: msg + hint };
    }

    const svc = data?.service || data;
    return {
      success: true,
      service: {
        id: svc.id,
        name: svc.name,
        type: svc.type,
        url: svc.serviceDetails?.url || null,
      },
    };
  } catch (err) {
    return { success: false, error: err.message || 'Request failed' };
  }
}

/**
 * Upsert env vars one key at a time (PUT /env-vars/{key}) so existing
 * variables on the service that we don't know about are left untouched.
 */
async function pushEnvVars(key, serviceId, vars) {
  const results = [];
  for (const { key: envKey, value } of vars || []) {
    try {
      const { res } = await renderFetch(
        key,
        `/services/${encodeURIComponent(serviceId)}/env-vars/${encodeURIComponent(envKey)}`,
        { method: 'PUT', body: JSON.stringify({ value }) }
      );
      results.push({ key: envKey, success: res.ok, ...(res.ok ? {} : { error: `API returned ${res.status}` }) });
    } catch (err) {
      results.push({ key: envKey, success: false, error: err.message });
    }
  }
  return results;
}

/* ══════════════════════════════════════════════════════════
 *  LIVE LOG STREAMING (GET /v1/logs)
 *
 *  Render's deploy-status endpoint only reports coarse phases, so the
 *  real build output (npm install, pip install, compiler output, …) is
 *  pulled from the logs API and forwarded verbatim to the renderer.
 * ══════════════════════════════════════════════════════════ */

/** Fetch service metadata needed for log queries: ownerId + public URL. */
async function fetchServiceInfo(key, serviceId) {
  try {
    const { res, data } = await renderFetch(key, `/services/${encodeURIComponent(serviceId)}`);
    if (!res.ok) return null;
    return {
      ownerId: data?.ownerId || null,
      url: data?.serviceDetails?.url || null,
    };
  } catch {
    return null;
  }
}

/**
 * Incremental log tailer for one service. Each pump() emits every log
 * line Render produced since the last call, exactly as Render wrote it.
 * If the logs API is not available to this account/plan, it disables
 * itself after telling the user once — status lines still flow.
 */
function createLogStreamer(key, ownerId, serviceId, sinceIso, emit) {
  const seen = new Set();
  let startTime = sinceIso;
  let disabled = false;

  return async function pump() {
    if (disabled || !ownerId) return;

    // A pump may need several pages when the build is chatty.
    for (let page = 0; page < 5; page++) {
      let res, data;
      try {
        const params = new URLSearchParams();
        params.set('ownerId', ownerId);
        params.append('resource', serviceId);
        params.set('direction', 'forward');
        params.set('limit', '100');
        if (startTime) params.set('startTime', startTime);
        params.set('endTime', new Date().toISOString());

        ({ res, data } = await renderFetch(key, `/logs?${params.toString()}`));
      } catch {
        return; // transient network error — try again next pump
      }

      if (!res.ok) {
        if ([400, 401, 403, 404].includes(res.status)) {
          disabled = true;
          emit(`⚠ Live Render logs unavailable (API returned ${res.status}) — showing deploy status only.`);
        }
        return;
      }

      const logs = Array.isArray(data?.logs) ? data.logs : [];
      for (const entry of logs) {
        const id = entry.id || `${entry.timestamp}|${entry.message}`;
        if (seen.has(id)) continue;
        seen.add(id);
        const msg = entry.message ?? entry.text ?? '';
        // Forward Render's output verbatim, line by line.
        for (const line of String(msg).split('\n')) {
          if (line.trim()) emit(line);
        }
        if (entry.timestamp) startTime = entry.timestamp;
      }

      if (!data?.hasMore) return;
      if (data.nextStartTime) startTime = data.nextStartTime;
    }
  };
}

/* ══════════════════════════════════════════════════════════
 *  DEPLOY EXECUTION (trigger + status polling)
 * ══════════════════════════════════════════════════════════ */

/** Human-readable line for each Render deploy status. */
const STATUS_LINES = {
  created: 'Deploy created — waiting for a build slot...',
  queued: 'Queued on Render...',
  pre_deploy_in_progress: 'Running pre-deploy command...',
  build_in_progress: 'Building your backend on Render...',
  update_in_progress: 'Build complete — rolling out the new version...',
  live: '✓ Service is live!',
  build_failed: '✗ Build failed — check the service logs on the Render dashboard.',
  update_failed: '✗ Rollout failed — check the service logs on the Render dashboard.',
  pre_deploy_failed: '✗ Pre-deploy command failed.',
  canceled: '⚠ Deploy was cancelled.',
  deactivated: '✗ Deploy was deactivated.',
};

const TERMINAL_STATUSES = new Set([
  'live', 'build_failed', 'update_failed', 'pre_deploy_failed', 'canceled', 'deactivated',
]);

/**
 * Return the most recent deploy for a service, or null. Used as a fallback when
 * a manual trigger returns nothing usable — e.g. a brand-new service whose first
 * build Render already auto-started.
 */
async function findLatestDeploy(key, serviceId) {
  const result = await renderFetch(
    key,
    `/services/${encodeURIComponent(serviceId)}/deploys?limit=1`
  ).catch(() => null);
  if (!result || !result.res.ok || !Array.isArray(result.data)) return null;
  const first = result.data[0];
  return first?.deploy || first || null;
}

/**
 * Trigger a deploy for the linked service and poll it to completion,
 * streaming progress over `render-deploy:log-<id>` / `render-deploy:complete-<id>`
 * — the same contract the Vercel deploy uses, so the panel logic mirrors it.
 */
async function deployService(key, serviceId, opts, deployId, event) {
  const send = (channel, payload) => {
    try {
      if (!event.sender.isDestroyed()) event.sender.send(channel, payload);
    } catch {
      // renderer gone
    }
  };
  const log = (line) => send(`render-deploy:log-${deployId}`, `${scrubKey(line, key)}\r\n`);
  const finish = (data) => {
    send(`render-deploy:complete-${deployId}`, data);
    renderDeploySessions.delete(deployId);
  };
  const session = () => renderDeploySessions.get(deployId);
  const cancelled = () => !session() || session().cancelled;

  try {
    // 1. Trigger the deploy.
    log(`Triggering deploy for service ${opts.serviceName || serviceId}...`);
    const { res, data } = await renderFetch(
      key,
      `/services/${encodeURIComponent(serviceId)}/deploys`,
      {
        method: 'POST',
        body: JSON.stringify({ clearCache: opts.clearCache ? 'clear' : 'do_not_clear' }),
        timeoutMs: 30000,
      }
    );
    // A brand-new service is created with autoDeploy:'yes', so Render already
    // kicked off its first build. An immediate second trigger can therefore be
    // rejected, or return a body we can't parse (data === null) — which used to
    // crash on `data.id`. Fall back to the deploy Render already started so a
    // freshly-created service still streams to completion instead of failing.
    let deploy = res.ok ? data : null;
    if (!deploy || !deploy.id) {
      deploy = await findLatestDeploy(key, serviceId);
    }
    if (!deploy || !deploy.id) {
      throw new Error(
        data?.message ||
        'Render accepted the request but returned no deploy to track. The service’s first build may already be running — open it on the Render dashboard, or wait a moment and hit Redeploy.'
      );
    }

    const renderDeployId = deploy.id;
    const s = session();
    if (s) s.renderDeployId = renderDeployId;

    if (deploy.commit?.message) {
      log(`Commit: ${String(deploy.commit.message).split('\n')[0]}`);
    }

    // Set up the live log tail: ownerId is required by the logs API.
    // Start the window slightly before the trigger so Render's first
    // build lines ("==> Cloning from ...") are not missed.
    const info = await fetchServiceInfo(key, serviceId);
    const streamLogs = createLogStreamer(
      key,
      info?.ownerId,
      serviceId,
      new Date(Date.now() - 10000).toISOString(),
      log
    );

    // 2. Poll the deploy status and tail the real Render logs. Backend
    //    builds are slower than static frontends — allow up to 20 minutes.
    let status = deploy.status || 'created';
    let lastStatus = null;
    const startedAt = Date.now();

    while (!TERMINAL_STATUSES.has(status)) {
      if (cancelled()) {
        // Ask Render to cancel too, then report.
        await renderFetch(
          key,
          `/services/${encodeURIComponent(serviceId)}/deploys/${encodeURIComponent(renderDeployId)}/cancel`,
          { method: 'POST' }
        ).catch(() => {});
        status = 'canceled';
        break;
      }
      if (Date.now() - startedAt > 20 * 60 * 1000) {
        throw new Error('Deploy timed out after 20 minutes.');
      }

      if (status !== lastStatus) {
        log(STATUS_LINES[status] || `  status: ${status}`);
        lastStatus = status;
      }

      await new Promise((r) => setTimeout(r, 4000));

      // Forward whatever Render logged since the last tick, verbatim.
      await streamLogs();

      const poll = await renderFetch(
        key,
        `/services/${encodeURIComponent(serviceId)}/deploys/${encodeURIComponent(renderDeployId)}`
      ).catch(() => null);
      if (!poll || !poll.res.ok) continue; // transient; keep polling
      status = poll.data?.status || status;
    }

    // Flush any trailing build output that landed after the final status.
    await new Promise((r) => setTimeout(r, 2000));
    await streamLogs();

    if (status !== lastStatus) log(STATUS_LINES[status] || `  status: ${status}`);

    if (status === 'live') {
      // Resolve the public URL of the service.
      let url = opts.serviceUrl || info?.url || null;
      try {
        const fresh = await fetchServiceInfo(key, serviceId);
        if (fresh?.url) url = fresh.url;
      } catch {
        // URL is a nicety — the deploy still succeeded
      }
      if (url) log(`→ ${url}`);
      finish({ success: true, url, deployId: renderDeployId, error: null });
    } else if (status === 'canceled') {
      finish({ success: false, url: null, deployId: renderDeployId, error: 'Deploy cancelled.' });
    } else {
      finish({
        success: false,
        url: null,
        deployId: renderDeployId,
        error: STATUS_LINES[status] ? STATUS_LINES[status].replace(/^✗ /, '') : `Deploy ${status}.`,
      });
    }
  } catch (err) {
    const msg = scrubKey(err.message || 'Deploy failed.', key);
    log(`✗ ${msg}`);
    finish({ success: false, url: null, deployId: null, error: msg });
  }
}

/* ══════════════════════════════════════════════════════════
 *  IPC HANDLER REGISTRATION
 * ══════════════════════════════════════════════════════════ */

function registerRenderDeployHandlers() {
  /* ── API Key Management ── */

  ipcMain.handle('render-deploy:set-key', async (_event, key) => {
    try {
      storeApiKey(key);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('render-deploy:has-key', () => fs.existsSync(KEY_FILE));

  ipcMain.handle('render-deploy:clear-key', () => {
    try {
      if (fs.existsSync(KEY_FILE)) fs.unlinkSync(KEY_FILE);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('render-deploy:validate-key', async (_event, key) => validateApiKey(key));

  ipcMain.handle('render-deploy:list-owners', async () => {
    const key = retrieveApiKey();
    if (!key) return { valid: false, error: 'No Render API key stored' };
    return validateApiKey(key);
  });

  /* ── Service Listing / Linking / Creation ── */

  ipcMain.handle('render-deploy:list-services', async () => {
    const key = retrieveApiKey();
    if (!key) return { success: false, error: 'No Render API key stored' };
    return listServices(key);
  });

  ipcMain.handle('render-deploy:get-linked', async (_event, options = {}) => {
    return getLink(options.sessionId);
  });

  ipcMain.handle('render-deploy:link-service', async (_event, options = {}) => {
    try {
      const { sessionId, serviceId, serviceName, serviceUrl, serviceType } = options;
      if (!serviceId) throw new Error('serviceId is required');
      setLink(sessionId, { serviceId, serviceName, serviceUrl: serviceUrl || null, serviceType: serviceType || null });
      console.log(`[Causify Render] Linked session ${String(sessionId).substring(0, 8)} to service ${serviceName || serviceId}`);
      return { success: true, serviceName: serviceName || null };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('render-deploy:unlink-service', async (_event, options = {}) => {
    clearLink(options.sessionId);
    return { success: true };
  });

  ipcMain.handle('render-deploy:create-service', async (_event, options = {}) => {
    const key = retrieveApiKey();
    if (!key) return { success: false, error: 'No Render API key stored' };

    const result = await createService(key, options);
    if (result.success && options.sessionId) {
      setLink(options.sessionId, {
        serviceId: result.service.id,
        serviceName: result.service.name,
        serviceUrl: result.service.url,
        serviceType: result.service.type,
      });
    }
    if (result.error) result.error = scrubKey(result.error, key);
    return result;
  });

  /* ── Env Var Push ── */

  ipcMain.handle('render-deploy:push-env', async (_event, options = {}) => {
    const key = retrieveApiKey();
    if (!key) return { success: false, error: 'No Render API key stored' };

    const link = getLink(options.sessionId);
    if (!link?.serviceId) {
      return { success: false, error: 'No Render service linked yet. Link or create a service first.' };
    }

    const results = await pushEnvVars(key, link.serviceId, options.vars);
    const allSuccess = results.every((r) => r.success);
    return { success: allSuccess, results };
  });

  /* ── Deploy Execution ── */

  ipcMain.handle('render-deploy:run', async (event, options = {}) => {
    const key = retrieveApiKey();
    if (!key) {
      throw new Error('No Render API key configured. Please connect your Render account first.');
    }

    const link = getLink(options.sessionId);
    if (!link?.serviceId) {
      throw new Error('No Render service linked. Link an existing service or create one from your GitHub repository first.');
    }

    // Accept a pre-generated deployId from the renderer so it can subscribe
    // to events BEFORE the deploy fires (avoids missing early log lines).
    const deployId = options.deployId || crypto.randomUUID();
    renderDeploySessions.set(deployId, { cancelled: false, serviceId: link.serviceId, renderDeployId: null });
    console.log(`[Causify Render] Started deploy ${deployId.substring(0, 8)} for service ${link.serviceName || link.serviceId}`);

    // Fire asynchronously; progress streams over IPC channels.
    deployService(
      key,
      link.serviceId,
      { serviceName: link.serviceName, serviceUrl: link.serviceUrl, clearCache: options.clearCache },
      deployId,
      event
    ).catch((err) => {
      console.error('[Causify Render] Deploy crashed:', err.message);
    });

    return { deployId, serviceName: link.serviceName || link.serviceId };
  });

  /* ── Cancel Deploy ── */

  ipcMain.handle('render-deploy:cancel', (_event, deployId) => {
    const session = renderDeploySessions.get(deployId);
    if (session) {
      // The polling loop notices the flag, asks Render to cancel, and reports.
      session.cancelled = true;
      console.log(`[Causify Render] Cancelled deploy ${String(deployId).substring(0, 8)}`);
      return { success: true };
    }
    return { success: false, error: 'No active deploy with that ID' };
  });

  /* ── Delete Render Service ── */

  ipcMain.handle('render-deploy:delete-service', async (_event, options = {}) => {
    const key = retrieveApiKey();
    if (!key) {
      return { success: false, error: 'No Render API key configured' };
    }

    const link = getLink(options.sessionId);
    if (!link?.serviceId) {
      return { success: false, error: 'No Render service linked to this session' };
    }

    try {
      const { res } = await renderFetch(key, `/services/${link.serviceId}`, {
        method: 'DELETE',
        timeoutMs: 15000,
      });

      if (!res.ok && res.status !== 404) {
        return { success: false, error: `Delete failed (HTTP ${res.status})` };
      }

      // Clear the local session → service link
      clearLink(options.sessionId);

      console.log(`[Causify Render] Deleted service ${link.serviceName || link.serviceId}`);
      return { success: true, serviceName: link.serviceName || null };
    } catch (err) {
      return { success: false, error: err.message || 'Request failed' };
    }
  });

  /* ── Check for Existing Deployment (restore after app restart) ── */

  ipcMain.handle('render-deploy:check-existing', async (_event, options = {}) => {
    const key = retrieveApiKey();
    if (!key) return { exists: false };

    const link = getLink(options.sessionId);
    if (!link?.serviceId) return { exists: false };

    try {
      const { res, data } = await renderFetch(key, `/services/${encodeURIComponent(link.serviceId)}`, {
        timeoutMs: 10000,
      });

      if (!res.ok) return { exists: false };

      return {
        exists: true,
        serviceName: link.serviceName || data?.name || null,
        serviceUrl: data?.serviceDetails?.url || link.serviceUrl || null,
        serviceId: link.serviceId,
      };
    } catch {
      return { exists: false };
    }
  });
}

/**
 * Flag all active deploy polls as cancelled (called on app quit).
 */
function killAllRenderDeploySessions() {
  for (const [deployId, session] of renderDeploySessions) {
    session.cancelled = true;
    renderDeploySessions.delete(deployId);
  }
}

module.exports = {
  registerRenderDeployHandlers,
  killAllRenderDeploySessions,
};
