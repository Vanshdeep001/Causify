/* -------------------------------------------------------
 * ipc/guardian.js — Repository Guardian IPC Handlers
 *
 * Bridges the renderer to the Repository Guardian daemon
 * (the `gitpilot` Python package) running on 127.0.0.1:8787.
 *
 * Provides:
 *   - guardian:detect     → { installed, running, tokenExists }
 *   - guardian:get-token  → local API token (renderer never reads disk)
 *   - guardian:setup      → one-click auth + init (keys go to OS keychain)
 *   - guardian:start      → launch the daemon for a repo
 *   - guardian:stop       → stop the daemon
 *
 * Read-only integration: the daemon's API cannot mutate the
 * repo; setup/start/stop only manage the local process.
 * ------------------------------------------------------- */

const { ipcMain } = require('electron');
const { execFile } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const GUARDIAN_PORT = 8787;
const GUARDIAN_HOME = path.join(os.homedir(), '.gitpilot');
const TOKEN_PATH = path.join(GUARDIAN_HOME, 'api.token');

/* ── helpers ── */

function execToResult(cmd, args, cwd) {
  return new Promise((resolve) => {
    execFile(cmd, args, {
      cwd: cwd || undefined,
      timeout: 120000,
      windowsHide: true,
    }, (err, stdout, stderr) => {
      resolve({
        code: err ? (err.code === 'ENOENT' ? 'ENOENT' : err.code ?? 1) : 0,
        stdout: String(stdout || ''),
        stderr: String(stderr || ''),
      });
    });
  });
}

// Run the guardian CLI; never throws — always resolves { code, stdout, stderr }.
// pip on Windows often installs console scripts outside PATH, so when the
// `gitpilot` command is missing we fall back to running it as a Python module.
let moduleFallback = null; // cached: 'python' | 'py' once one works
async function runGuardian(args, cwd) {
  if (!moduleFallback) {
    const direct = await execToResult('gitpilot', args, cwd);
    if (direct.code !== 'ENOENT') return direct;
  }
  for (const py of moduleFallback ? [moduleFallback] : ['python', 'py']) {
    const res = await execToResult(py, ['-m', 'gitpilot.cli.main', ...args], cwd);
    if (res.code === 'ENOENT') continue;
    if (/No module named/i.test(res.stderr)) break; // python exists, guardian isn't installed
    moduleFallback = py;
    return res;
  }
  return { code: 'ENOENT', stdout: '', stderr: 'Neither gitpilot nor python found on PATH' };
}

function checkHealth() {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port: GUARDIAN_PORT, path: '/health', timeout: 1500 },
      (res) => { res.resume(); resolve(res.statusCode === 200); }
    );
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

// The daemon serves a single repo at a time. Ask the running one which repo it
// is bound to, so we can detect a mismatch (user switched projects) and relaunch
// it for the connected repo instead of showing another repository's data.
function getRunningRepo() {
  return new Promise((resolve) => {
    let token = '';
    try { token = fs.readFileSync(TOKEN_PATH, 'utf-8').trim(); } catch { /* no token yet */ }
    const req = http.get(
      { host: '127.0.0.1', port: GUARDIAN_PORT, path: '/api/status', timeout: 2000, headers: { 'X-GitPilot-Token': token } },
      (res) => {
        let body = '';
        res.on('data', (d) => { body += d; });
        res.on('end', () => { try { resolve(JSON.parse(body).repo || null); } catch { resolve(null); } });
      }
    );
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

// A daemon that was killed or interrupted by a reboot leaves a stale pid file
// behind, which can stop `gitpilot start` from relaunching. Remove it, but only
// when the recorded process is confirmed dead — never touch a live daemon.
function clearStalePid() {
  try {
    const pidPath = path.join(GUARDIAN_HOME, 'gitpilot.pid');
    if (!fs.existsSync(pidPath)) return;
    const pid = parseInt(String(fs.readFileSync(pidPath, 'utf-8')).trim(), 10);
    if (!pid) { fs.unlinkSync(pidPath); return; }
    try { process.kill(pid, 0); } catch (e) { if (e.code === 'ESRCH') fs.unlinkSync(pidPath); }
  } catch { /* best effort */ }
}

async function isInstalled() {
  const res = await runGuardian(['--help']);
  return res.code !== 'ENOENT';
}

// Extract { ownerRepo, token } from a GitHub URL like
// https://user:TOKEN@github.com/owner/repo.git or https://TOKEN@github.com/...
function parseRepoUrl(url) {
  if (!url) return { ownerRepo: null, token: null };
  const repoMatch = url.match(/github\.com[:/]+([^/]+)\/(.+?)(?:\.git)?\/?$/);
  const ownerRepo = repoMatch ? `${repoMatch[1]}/${repoMatch[2]}` : null;
  const authMatch = url.match(/^https?:\/\/(?:[^:@/]+:)?([^@/]+)@/);
  return { ownerRepo, token: authMatch ? authMatch[1] : null };
}

// Each repo gets its own workspace dir holding .gitpilot.yml; the daemon
// must be started from the same dir since it loads config from cwd.
function workspaceDir(ownerRepo) {
  const dir = path.join(GUARDIAN_HOME, 'repos', ownerRepo.replace('/', '__'));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function registerGuardianHandlers() {

  /* ── Is the guardian installed / running? ── */
  ipcMain.handle('guardian:detect', async () => {
    const [installed, running] = await Promise.all([isInstalled(), checkHealth()]);
    return { installed, running, tokenExists: fs.existsSync(TOKEN_PATH) };
  });

  /* ── Local API token (generated by the daemon on first start) ── */
  ipcMain.handle('guardian:get-token', async () => {
    try {
      return fs.readFileSync(TOKEN_PATH, 'utf-8').trim();
    } catch {
      return null;
    }
  });

  /* ── One-click setup: auth (OS keychain) + init (repo config) ── */
  ipcMain.handle('guardian:setup', async (_event, options = {}) => {
    const { repoUrl, githubToken, openrouterKey } = options;
    const parsed = parseRepoUrl(repoUrl);
    if (!parsed.ownerRepo) {
      return { error: 'Could not detect owner/repo from the repository URL.' };
    }
    const token = githubToken || parsed.token;
    if (!token) {
      return { error: 'A GitHub Personal Access Token is required.', needsToken: true };
    }
    // Reuse the machine's OpenRouter key when available — same provider
    // DebugSync's own AI analysis uses. Keys are stored by the guardian
    // CLI in the OS keychain; DebugSync never persists them itself.
    const llmKey = openrouterKey || process.env.OPENROUTER_API_KEY || null;

    const authArgs = ['auth', '--github-token', token];
    if (llmKey) authArgs.push('--openrouter', llmKey);
    const authRes = await runGuardian(authArgs);
    if (authRes.code === 'ENOENT') return { error: 'Repository Guardian is not installed (gitpilot not found on PATH).' };
    if (authRes.code !== 0) {
      return { error: `Authentication failed: ${(authRes.stderr || authRes.stdout).trim().slice(0, 400)}` };
    }

    const dir = workspaceDir(parsed.ownerRepo);
    const initRes = await runGuardian(['init', '--repo', parsed.ownerRepo, '--yes'], dir);
    if (initRes.code !== 0) {
      return { error: `Configuration failed: ${(initRes.stderr || initRes.stdout).trim().slice(0, 400)}` };
    }

    return { success: true, repo: parsed.ownerRepo, llmConfigured: !!llmKey };
  });

  /* ── Daemon lifecycle ── */
  ipcMain.handle('guardian:start', async (_event, repoUrl) => {
    const { ownerRepo, token } = parseRepoUrl(repoUrl);
    if (!ownerRepo) return { error: 'Could not detect owner/repo from the repository URL.' };

    // A running daemon serves exactly one repo. If one is already up, reuse it
    // only when it's serving THIS repo; otherwise stop it and relaunch for the
    // connected repo so the panel never shows another repository's PRs.
    if (await checkHealth()) {
      const activeRepo = await getRunningRepo();
      if (activeRepo && activeRepo.toLowerCase() === ownerRepo.toLowerCase()) {
        return { running: true, repo: activeRepo };
      }
      await runGuardian(['stop']);
      await new Promise((r) => setTimeout(r, 800));
    }

    const dir = workspaceDir(ownerRepo);

    // Auto-configure on first run using the token embedded in the repo URL the
    // user connected in the Git panel — Guardian works on that same repo with
    // no separate setup step. Falls back to the machine's OpenRouter key so AI
    // PR summaries are enabled when available.
    if (!fs.existsSync(path.join(dir, '.gitpilot.yml'))) {
      if (!token) {
        return {
          error: 'Repository Guardian needs a GitHub token. Reconnect the repo in the Git panel using a URL that includes your token (https://TOKEN@github.com/owner/repo.git).',
          needsToken: true,
        };
      }
      let llmKey = process.env.OPENROUTER_API_KEY || null;
      if (!llmKey) { try { llmKey = require('./security').retrieveApiKey(); } catch { /* optional */ } }

      const authArgs = ['auth', '--github-token', token];
      if (llmKey) authArgs.push('--openrouter', llmKey);
      const authRes = await runGuardian(authArgs);
      if (authRes.code === 'ENOENT') return { error: 'Repository Guardian is not installed (gitpilot not found on PATH).' };
      if (authRes.code !== 0) {
        return { error: `Auto-config failed (auth): ${(authRes.stderr || authRes.stdout).trim().slice(0, 300)}` };
      }
      const initRes = await runGuardian(['init', '--repo', ownerRepo, '--yes'], dir);
      if (initRes.code !== 0) {
        return { error: `Auto-config failed (init): ${(initRes.stderr || initRes.stdout).trim().slice(0, 300)}` };
      }
    }

    clearStalePid();
    const res = await runGuardian(['start'], dir);
    if (res.code === 'ENOENT') return { error: 'Repository Guardian is not installed (gitpilot not found on PATH).' };
    if (res.code !== 0) {
      return { error: `Start failed: ${(res.stderr || res.stdout).trim().slice(0, 400)}` };
    }
    // The daemon detaches; poll /health until it answers (max ~5s).
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 500));
      if (await checkHealth()) return { running: true };
    }
    return { running: false, error: 'Daemon started but is not answering yet — try refreshing.' };
  });

  ipcMain.handle('guardian:stop', async () => {
    const res = await runGuardian(['stop']);
    return res.code === 0
      ? { stopped: true }
      : { error: (res.stderr || res.stdout).trim().slice(0, 400) };
  });
}

module.exports = { registerGuardianHandlers };
