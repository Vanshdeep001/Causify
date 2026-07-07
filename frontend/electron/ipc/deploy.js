/* -------------------------------------------------------
 * ipc/deploy.js — Vercel Deployment IPC Handlers
 *
 * Manages the entire one-click deploy lifecycle:
 *   - Vercel access token storage (OS keychain via safeStorage)
 *   - Token validation against the Vercel API
 *   - Deploy execution via node-pty (npx vercel --prod --yes)
 *   - Live log streaming with token scrubbing
 *   - Env file detection + push to Vercel project
 *
 * Security:
 *   - Token is encrypted at rest (safeStorage / DPAPI / Keychain)
 *   - Token is NEVER sent to the renderer or Java backend
 *   - Env values are read from disk here and pushed directly
 *     to the Vercel API — they never reach the renderer
 *   - All log output is scrubbed of the token before forwarding
 * ------------------------------------------------------- */

const { ipcMain, app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

/**
 * Resolves the deploy workspace directory for a session.
 *
 * Every session deploys from a single, persistent directory under the OS temp
 * dir. The renderer's in-memory files are written here before each deploy (see
 * prepareWorkspace), and the `.vercel/` link folder is preserved across deploys
 * so updates are pushed to the same Vercel project instead of creating new ones.
 */
function resolveWorkspaceCwd(options) {
  if (!options) return process.cwd();
  if (typeof options === 'string') return options;

  const { cwd, sessionId } = options;
  if (cwd) return cwd;

  if (sessionId) {
    return path.join(os.tmpdir(), 'causify-deploy', sessionId);
  }

  return process.cwd();
}

/**
 * Materialize the renderer's in-memory files to the deploy workspace.
 *
 * Cleans any previously written files but preserves the `.vercel/` folder so the
 * project link survives between deploys. This is what makes plain static
 * (HTML/CSS/JS) projects deployable — their files only live in the renderer
 * until written here.
 *
 * Returns { cwd, fileCount, webRoot } — or { needsChoice, candidates } when
 * several distinct web apps are detected and no explicit `chosenWebRoot` was
 * passed ('.' means the project root).
 */
function prepareWorkspace(sessionId, files, chosenWebRoot = null) {
  if (!sessionId) throw new Error('sessionId is required to prepare a deploy workspace');

  const dir = path.join(os.tmpdir(), 'causify-deploy', sessionId);
  fs.mkdirSync(dir, { recursive: true });

  // Clear previous content but keep the Vercel project link.
  for (const entry of fs.readdirSync(dir)) {
    if (entry === '.vercel') continue;
    fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
  }

  // Build a normalized, filtered list of files to write.
  const items = [];
  for (const [rel, content] of Object.entries(files || {})) {
    if (!rel || typeof rel !== 'string') continue;
    // Never ship dependency / VCS dirs
    if (rel.includes('node_modules/') || rel.startsWith('.git/')) continue;

    // Normalize separators and strip any leading slashes
    const safeRel = rel.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!safeRel) continue;
    items.push({ rel: safeRel, content });
  }

  // The user shouldn't have to lay the project out for Vercel. Vercel serves the
  // deploy ROOT, so the platform must figure out which directory is the
  // deployable web app — whether it's nested under a single project folder
  // (e.g. "Late night reminder/") or sitting beside a backend (e.g. "frontend/"
  // next to "backend/"). listWebRootCandidates finds those directories; when
  // exactly one exists we use it, and when several distinct web apps exist we
  // stop and ask the user instead of guessing (the caller re-invokes with
  // options.webRoot set to the chosen directory, '.' meaning the project root).
  // The chosen prefix is then stripped so it becomes the deploy root, and
  // everything outside it (the backend, infra, etc.) is dropped.
  let webRoot;
  if (chosenWebRoot != null) {
    webRoot = chosenWebRoot === '.' ? '' : String(chosenWebRoot).replace(/\/+$/, '');
  } else {
    const candidates = listWebRootCandidates(items);
    if (candidates.length > 1) {
      return {
        needsChoice: true,
        candidates: candidates.map((c) => ({
          dir: c.dir === '' ? '.' : c.dir,
          framework: c.framework,
          label: c.label,
          fileCount: c.dir === ''
            ? items.length
            : items.filter((i) => i.rel.startsWith(c.dir + '/')).length,
        })),
      };
    }
    webRoot = candidates.length === 1 ? candidates[0].dir : null;
  }
  let kept = items;
  if (webRoot != null) {
    const prefix = webRoot === '' ? '' : webRoot + '/';
    kept = items
      .filter((i) => prefix === '' || i.rel.startsWith(prefix))
      .map((i) => ({ rel: prefix === '' ? i.rel : i.rel.slice(prefix.length), content: i.content }));
  } else {
    // No clear web root — fall back to stripping a single common wrapper folder.
    let prefix = commonRootDir(kept.map((i) => i.rel));
    while (prefix) {
      kept = kept.map((i) => ({ rel: i.rel.slice(prefix.length + 1), content: i.content }));
      prefix = commonRootDir(kept.map((i) => i.rel));
    }
  }

  let fileCount = 0;
  for (const { rel, content } of kept) {
    if (!rel) continue;
    const target = path.join(dir, rel);
    if (!target.startsWith(dir)) continue; // guard against path traversal

    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content == null ? '' : String(content), 'utf-8');
    fileCount++;
  }

  return { cwd: dir, fileCount, webRoot: webRoot == null ? null : (webRoot || '.') };
}

/* Directories that mark a backend / non-deployable project. */
const BACKEND_MARKERS = [
  'pom.xml', 'build.gradle', 'build.gradle.kts', 'requirements.txt',
  'manage.py', 'go.mod', 'Cargo.toml', 'Gemfile', 'composer.json',
];

/* Frontend framework dependencies that mark a deployable web app. */
const FRONTEND_DEPS = [
  'next', 'vite', 'react-scripts', 'vue', 'svelte', '@sveltejs/kit',
  '@angular/core', 'nuxt', 'gatsby', 'astro', 'react', 'preact', 'solid-js',
];

/* Display names for the framework dep that qualified a candidate. */
const FRAMEWORK_LABELS = {
  next: 'Next.js', vite: 'Vite', 'react-scripts': 'Create React App',
  vue: 'Vue', svelte: 'Svelte', '@sveltejs/kit': 'SvelteKit',
  '@angular/core': 'Angular', nuxt: 'Nuxt', gatsby: 'Gatsby', astro: 'Astro',
  react: 'React', preact: 'Preact', 'solid-js': 'Solid',
};

/**
 * List every directory in the project that could be the deployable web root,
 * best candidate first. Candidates are directories that either contain an
 * index.html (static) or a package.json with a frontend framework / build
 * script. Backend-looking directories are excluded, static candidates nested
 * inside a framework app (its public/ or build output) are collapsed into it,
 * and the remaining list is ranked: non-backend paths, then shallowest, then
 * framework apps over static HTML.
 */
function listWebRootCandidates(items) {
  // Map each directory to the set of files directly inside it.
  const dirFiles = new Map();
  for (const { rel } of items) {
    const idx = rel.lastIndexOf('/');
    const dir = idx === -1 ? '' : rel.slice(0, idx);
    const name = idx === -1 ? rel : rel.slice(idx + 1);
    if (!dirFiles.has(dir)) dirFiles.set(dir, new Set());
    dirFiles.get(dir).add(name);
  }

  const contentOf = (rel) => {
    const it = items.find((i) => i.rel === rel);
    return it ? it.content : null;
  };

  const candidates = [];
  for (const [dir, names] of dirFiles) {
    const isBackend = BACKEND_MARKERS.some((m) => names.has(m));
    const depth = dir === '' ? 0 : dir.split('/').length;

    // Static site: a directory with an index.html (and not a backend).
    if (names.has('index.html') && !isBackend) {
      candidates.push({ dir, depth, framework: false, label: 'Static HTML' });
    }

    // Framework app: a package.json with a frontend dep or a build script.
    if (names.has('package.json')) {
      try {
        const pkgRel = dir === '' ? 'package.json' : `${dir}/package.json`;
        const pkg = JSON.parse(contentOf(pkgRel) || '{}');
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        const frameworkDep = FRONTEND_DEPS.find((d) => deps[d]);
        const hasBuild = pkg.scripts && (pkg.scripts.build || pkg.scripts['vercel-build']);
        if (frameworkDep || (hasBuild && !isBackend)) {
          candidates.push({
            dir, depth, framework: true,
            label: frameworkDep ? FRAMEWORK_LABELS[frameworkDep] : 'Node build',
          });
        }
      } catch {
        // Unparseable package.json — ignore as a framework candidate.
      }
    }
  }

  // Dedup by directory — a dir can qualify as both static and framework
  // (e.g. a Vite app with index.html beside package.json). Framework wins.
  const byDir = new Map();
  for (const c of candidates) {
    const prev = byDir.get(c.dir);
    if (!prev || (c.framework && !prev.framework)) byDir.set(c.dir, c);
  }

  // A static candidate nested inside a framework app is that app's public/
  // or build output, not a separate site — collapse it into the app.
  let unique = [...byDir.values()];
  unique = unique.filter((c) =>
    c.framework ||
    !unique.some(
      (o) => o.framework && o.dir !== c.dir &&
        (o.dir === '' || c.dir.startsWith(o.dir + '/'))
    )
  );

  const looksLikeBackendPath = (d) =>
    /(^|\/)(backend|server|api|services?|src\/main)($|\/)/i.test(d);

  unique.sort((a, b) => {
    const ab = looksLikeBackendPath(a.dir) ? 1 : 0;
    const bb = looksLikeBackendPath(b.dir) ? 1 : 0;
    if (ab !== bb) return ab - bb;                 // non-backend paths first
    if (a.depth !== b.depth) return a.depth - b.depth; // shallowest first
    return (a.framework ? 0 : 1) - (b.framework ? 0 : 1); // framework over static
  });

  return unique;
}

/**
 * Decide which directory in the project is the deployable web root.
 *
 * Returns the directory prefix to deploy ('' for the project root), or null when
 * no obvious web app is found (caller falls back to a generic strip).
 */
function detectWebRoot(items) {
  const candidates = listWebRootCandidates(items);
  return candidates.length > 0 ? candidates[0].dir : null;
}

/**
 * If every path lives under one shared top-level directory (i.e. nothing sits
 * at the root), return that directory name; otherwise null.
 */
function commonRootDir(paths) {
  if (!paths || paths.length === 0) return null;
  const segments = paths.map((p) => p.split('/'));
  // Every file must be nested at least one level deep.
  if (segments.some((s) => s.length < 2 || !s[0])) return null;
  const first = segments[0][0];
  return segments.every((s) => s[0] === first) ? first : null;
}

let pty;
try {
  pty = require('node-pty');
} catch (err) {
  console.error('[Causify Deploy] Failed to load node-pty:', err.message);
  pty = null;
}

/* ── Config Paths ── */
const CONFIG_DIR = app.getPath('userData');
const TOKEN_FILE = path.join(CONFIG_DIR, 'vercel-token.enc');

/* ── Active deploy sessions ── */
const deploySessions = new Map(); // deployId -> { process, token }

/* ══════════════════════════════════════════════════════════
 *  TOKEN MANAGEMENT (safeStorage)
 * ══════════════════════════════════════════════════════════ */

/**
 * Encrypt and store the Vercel token.
 */
function storeToken(token) {
  if (!safeStorage.isEncryptionAvailable()) {
    // Fallback: store in plain text (rare edge case on some Linux distros)
    fs.writeFileSync(TOKEN_FILE, token, 'utf-8');
    return;
  }
  const encrypted = safeStorage.encryptString(token);
  fs.writeFileSync(TOKEN_FILE, encrypted);
}

/**
 * Retrieve and decrypt the Vercel token.
 */
function retrieveToken() {
  if (!fs.existsSync(TOKEN_FILE)) return null;

  try {
    const data = fs.readFileSync(TOKEN_FILE);

    if (!safeStorage.isEncryptionAvailable()) {
      return data.toString('utf-8');
    }

    return safeStorage.decryptString(data);
  } catch (err) {
    console.error('[Causify Deploy] Failed to decrypt token:', err.message);
    return null;
  }
}

/* ══════════════════════════════════════════════════════════
 *  VERCEL API HELPERS
 * ══════════════════════════════════════════════════════════ */

/**
 * Validate a Vercel token by hitting the projects API.
 * Returns { valid, username, error }.
 */
async function validateToken(token) {
  try {
    const response = await fetch('https://api.vercel.com/v2/user', {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return { valid: false, error: `API returned ${response.status}` };
    }

    const data = await response.json();
    const username = data?.user?.username || data?.user?.name || 'Unknown';
    return { valid: true, username };
  } catch (err) {
    return { valid: false, error: err.message || 'Request failed' };
  }
}

/**
 * Detect the Vercel project ID from `.vercel/project.json` in the cwd.
 * Returns projectId or null if not linked yet.
 */
function getVercelProjectId(cwd) {
  try {
    if (!cwd || !fs.existsSync(cwd)) return null;
    const projectFile = path.join(cwd, '.vercel', 'project.json');
    if (fs.existsSync(projectFile)) {
      const data = JSON.parse(fs.readFileSync(projectFile, 'utf-8'));
      return data.projectId || null;
    }
  } catch {
    // Not linked yet — that's fine, first deploy will create it
  }
  return null;
}

/**
 * Read the full project link (.vercel/project.json) for display.
 * Returns { projectId, orgId } or null.
 */
function getLinkedProjectInfo(cwd) {
  try {
    if (!cwd) return null;
    const projectFile = path.join(cwd, '.vercel', 'project.json');
    if (!fs.existsSync(projectFile)) return null;
    const data = JSON.parse(fs.readFileSync(projectFile, 'utf-8'));
    if (!data.projectId) return null;
    return { projectId: data.projectId, orgId: data.orgId || null, projectName: data.projectName || null };
  } catch {
    return null;
  }
}

/**
 * Verify that the project referenced by `.vercel/project.json` still exists and
 * is reachable with this token. If the project was deleted (or the token can no
 * longer access it), the stale link is removed so the next deploy creates a
 * fresh project instead of crashing inside the Vercel CLI with the cryptic
 * "Cannot read properties of undefined (reading 'value')" error.
 *
 * Returns { cleared: boolean }.
 */
async function validateProjectLink(cwd, token) {
  const info = getLinkedProjectInfo(cwd);
  if (!info || !info.projectId) return { cleared: false };

  try {
    let url = `https://api.vercel.com/v9/projects/${encodeURIComponent(info.projectId)}`;
    if (info.orgId) url += `?teamId=${encodeURIComponent(info.orgId)}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });

    // 404 = deleted, 403 = no access with this token. Either way the link is
    // unusable — clear it so we deploy fresh.
    if (res.status === 404 || res.status === 403) {
      fs.rmSync(path.join(cwd, '.vercel'), { recursive: true, force: true });
      console.log(`[Causify Deploy] Cleared stale project link (${res.status}) for ${info.projectId}`);
      return { cleared: true };
    }
  } catch (err) {
    // Network hiccup — leave the link alone rather than nuking a valid one.
    console.warn('[Causify Deploy] Could not validate project link:', err.message);
  }

  return { cleared: false };
}

/**
 * Link the deploy workspace to an existing Vercel project by writing
 * .vercel/project.json. This is how updates get pushed to a project that was
 * already deployed on Vercel (e.g. from the dashboard or a prior deploy).
 */
function linkProject(cwd, projectId, orgId, projectName) {
  if (!cwd) throw new Error('No deploy workspace to link');
  if (!projectId || !orgId) throw new Error('projectId and orgId are required to link a project');

  const vercelDir = path.join(cwd, '.vercel');
  fs.mkdirSync(vercelDir, { recursive: true });
  fs.writeFileSync(
    path.join(vercelDir, 'project.json'),
    JSON.stringify({ orgId, projectId, projectName: projectName || undefined }, null, 2),
    'utf-8'
  );
}

/**
 * List the Vercel projects available to the token (newest first).
 * Returns { success, projects: [{ id, name, accountId, framework }], error }.
 */
async function listProjects(token) {
  try {
    const response = await fetch('https://api.vercel.com/v9/projects?limit=100', {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return { success: false, error: `API returned ${response.status}` };
    }

    const data = await response.json();
    const projects = (data.projects || []).map((p) => ({
      id: p.id,
      name: p.name,
      accountId: p.accountId,
      framework: p.framework || null,
      updatedAt: p.updatedAt || p.createdAt || 0,
    }));
    projects.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return { success: true, projects };
  } catch (err) {
    return { success: false, error: err.message || 'Request failed' };
  }
}

/* ══════════════════════════════════════════════════════════
 *  DEPLOY VIA REST API
 *
 *  The Vercel CLI proved too fragile in an embedded context (version drift,
 *  global-config corruption, team-scope crashes, interactive prompts). We deploy
 *  straight against the Vercel REST API instead: upload the files, create a
 *  production deployment, poll until it's ready. Deterministic HTTP, no CLI.
 * ══════════════════════════════════════════════════════════ */

/**
 * Turn an arbitrary string into a valid Vercel project name:
 * lowercase, alphanumeric + hyphens, <= 100 chars.
 */
function sanitizeProjectName(name) {
  const slug = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 100);
  return slug || 'causify-app';
}

/** Collect every file under a directory as { rel, abs }, skipping junk. */
function collectFiles(baseDir) {
  const out = [];
  const skip = new Set(['.vercel', 'node_modules', '.git']);
  const walk = (absDir, relDir) => {
    let entries;
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (skip.has(entry.name)) continue;
      const abs = path.join(absDir, entry.name);
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(abs, rel);
      else out.push({ rel, abs });
    }
  };
  walk(baseDir, '');
  return out;
}

/**
 * Deploy the contents of `cwd` to Vercel via the REST API. Streams progress to
 * the renderer over the same `deploy:log-<id>` / `deploy:complete-<id>` channels
 * the CLI path used, so the UI is unchanged.
 */
async function deployViaApi(token, cwd, opts, deployId, event, getSession) {
  const send = (channel, payload) => {
    try {
      if (!event.sender.isDestroyed()) event.sender.send(channel, payload);
    } catch {
      // renderer gone
    }
  };
  const log = (line) => send(`deploy:log-${deployId}`, `${line}\r\n`);
  const finish = (data) => {
    send(`deploy:complete-${deployId}`, data);
    deploySessions.delete(deployId);
  };
  const cancelled = () => {
    const s = getSession();
    return !s || s.cancelled;
  };

  try {
    const files = collectFiles(cwd);
    if (files.length === 0) throw new Error('No files to deploy.');

    // 1. Upload each file (content-addressed by SHA1).
    log(`Uploading ${files.length} file(s) to Vercel...`);
    const manifest = [];
    for (const f of files) {
      if (cancelled()) throw new Error('Deployment cancelled.');
      const buf = fs.readFileSync(f.abs);
      const sha = crypto.createHash('sha1').update(buf).digest('hex');

      const res = await fetch('https://api.vercel.com/v2/files', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/octet-stream',
          'x-vercel-digest': sha,
        },
        body: buf,
        signal: AbortSignal.timeout(60000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Upload failed for ${f.rel} (${res.status}) ${text}`.trim());
      }
      manifest.push({ file: f.rel, sha, size: buf.length });
      log(`  ✓ ${f.rel}`);
    }

    if (cancelled()) throw new Error('Deployment cancelled.');

    // 2. Create the production deployment.
    log('Creating production deployment...');
    const hasPackageJson = files.some((f) => f.rel === 'package.json');
    const body = {
      name: opts.projectName,
      files: manifest,
      target: 'production',
      // Pure static projects have no build step; let Vercel build framework apps.
      ...(hasPackageJson ? {} : { projectSettings: { framework: null } }),
    };

    const createRes = await fetch('https://api.vercel.com/v13/deployments?forceNew=1', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
    const dep = await createRes.json().catch(() => ({}));
    if (!createRes.ok) {
      throw new Error(dep?.error?.message || `Deployment request failed (${createRes.status}).`);
    }

    const deploymentId = dep.id || dep.uid;
    const ownerId = dep.ownerId || dep.creator?.uid || null;
    const teamId = ownerId && String(ownerId).startsWith('team_') ? ownerId : null;
    const projectId = dep.projectId || dep.project?.id || null;
    let url = dep.url ? `https://${dep.url}` : null;

    // Persist the project link so future deploys update this same project.
    if (projectId && ownerId) {
      try {
        linkProject(cwd, projectId, ownerId, opts.projectName);
      } catch {
        // non-fatal
      }
    }

    log(`Deployment created${url ? `: ${url}` : ''}`);
    log('Building...');

    // 3. Poll until the deployment is ready.
    const statusUrl =
      `https://api.vercel.com/v13/deployments/${deploymentId}` +
      (teamId ? `?teamId=${encodeURIComponent(teamId)}` : '');

    let state = dep.readyState || dep.status || 'QUEUED';
    const terminal = new Set(['READY', 'ERROR', 'CANCELED']);
    const startedAt = Date.now();
    let lastState = null;

    while (!terminal.has(state)) {
      if (cancelled()) throw new Error('Deployment cancelled.');
      if (Date.now() - startedAt > 5 * 60 * 1000) {
        throw new Error('Deployment timed out after 5 minutes.');
      }
      await new Promise((r) => setTimeout(r, 2500));

      const pollRes = await fetch(statusUrl, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15000),
      });
      const pollData = await pollRes.json().catch(() => ({}));
      if (!pollRes.ok) continue; // transient; keep polling

      state = pollData.readyState || pollData.status || state;
      if (pollData.url) url = `https://${pollData.url}`;
      if (state !== lastState) {
        log(`  status: ${state}`);
        lastState = state;
      }
    }

    if (state === 'READY') {
      log(`✓ Deployment ready: ${url}`);
      finish({ success: true, url, exitCode: 0, error: null });
    } else {
      finish({ success: false, url, exitCode: 1, error: `Deployment ${state.toLowerCase()}.` });
    }
  } catch (err) {
    finish({ success: false, url: null, exitCode: 1, error: err.message || 'Deployment failed.' });
  }
}

/**
 * Detect the frontend framework from package.json in the cwd.
 */
function detectFramework(cwd) {
  try {
    if (!cwd || !fs.existsSync(cwd)) return 'unknown';
    const pkgPath = path.join(cwd, 'package.json');
    if (!fs.existsSync(pkgPath)) {
      // No package.json — treat a project with an index.html as a static site.
      if (fs.existsSync(path.join(cwd, 'index.html'))) return 'Static HTML';
      return 'unknown';
    }

    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };

    if (deps['next']) return 'Next.js';
    if (deps['vite']) return 'Vite';
    if (deps['react-scripts']) return 'Create React App';
    if (deps['vue']) return 'Vue';
    if (deps['svelte']) return 'Svelte';
    if (deps['@angular/core']) return 'Angular';
    if (deps['nuxt']) return 'Nuxt';
    if (deps['gatsby']) return 'Gatsby';
    if (deps['astro']) return 'Astro';
    if (deps['react']) return 'React';
    return 'Node.js';
  } catch {
    return 'unknown';
  }
}

/* ══════════════════════════════════════════════════════════
 *  ENV FILE DETECTION & PUSH
 * ══════════════════════════════════════════════════════════ */

/**
 * Detect and parse env files in the project root.
 * Returns array of { key, value, source }.
 */
function detectEnvFiles(cwd) {
  const envFileNames = ['.env', '.env.local', '.env.production'];
  const vars = [];

  if (!cwd || !fs.existsSync(cwd)) return vars;

  for (const filename of envFileNames) {
    const filePath = path.join(cwd, filename);
    if (!fs.existsSync(filePath)) continue;

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      for (const line of lines) {
        const trimmed = line.trim();
        // Skip empty lines and comments
        if (!trimmed || trimmed.startsWith('#')) continue;

        const eqIndex = trimmed.indexOf('=');
        if (eqIndex === -1) continue;

        const key = trimmed.substring(0, eqIndex).trim();
        let value = trimmed.substring(eqIndex + 1).trim();

        // Remove surrounding quotes if present
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }

        if (key) {
          vars.push({ key, value, source: filename });
        }
      }
    } catch (err) {
      console.error(`[Causify Deploy] Failed to parse ${filename}:`, err.message);
    }
  }

  return vars;
}

/**
 * Push environment variables to a Vercel project.
 * Handles 409 conflicts by removing and re-adding.
 */
async function pushEnvVars(token, projectId, vars) {
  const results = [];

  for (const { key, value } of vars) {
    try {
      const response = await fetch(
        `https://api.vercel.com/v10/projects/${projectId}/env`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            key,
            value,
            target: ['production'],
            type: 'encrypted',
          }),
          signal: AbortSignal.timeout(10000),
        }
      );

      if (response.status === 409) {
        // Variable already exists — find and update it
        const existingRes = await fetch(
          `https://api.vercel.com/v9/projects/${projectId}/env`,
          {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(10000),
          }
        );

        if (existingRes.ok) {
          const existingData = await existingRes.json();
          const existing = existingData.envs?.find(
            (e) => e.key === key && e.target?.includes('production')
          );

          if (existing) {
            // Delete the existing variable
            await fetch(
              `https://api.vercel.com/v9/projects/${projectId}/env/${existing.id}`,
              {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
                signal: AbortSignal.timeout(10000),
              }
            );

            // Re-create it with the new value
            const retryRes = await fetch(
              `https://api.vercel.com/v10/projects/${projectId}/env`,
              {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${token}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  key,
                  value,
                  target: ['production'],
                  type: 'encrypted',
                }),
                signal: AbortSignal.timeout(10000),
              }
            );

            results.push({
              key,
              success: retryRes.ok,
              updated: true,
            });
            continue;
          }
        }

        results.push({ key, success: false, error: 'Conflict — could not update' });
      } else {
        results.push({ key, success: response.ok });
      }
    } catch (err) {
      results.push({ key, success: false, error: err.message });
    }
  }

  return results;
}

/* ══════════════════════════════════════════════════════════
 *  DEPLOY EXECUTION (node-pty)
 * ══════════════════════════════════════════════════════════ */

/**
 * Scrub the Vercel token from log output.
 */
function scrubToken(text, token) {
  if (!token || !text) return text;
  // Replace any occurrence of the token with [REDACTED]
  return text.split(token).join('[REDACTED]');
}

/**
 * Get the shell to use for running npx.
 */
function getDeployShell() {
  if (process.platform === 'win32') {
    return process.env.COMSPEC || 'cmd.exe';
  }
  return process.env.SHELL || '/bin/bash';
}

/* ══════════════════════════════════════════════════════════
 *  IPC HANDLER REGISTRATION
 * ══════════════════════════════════════════════════════════ */

function registerDeployHandlers() {
  /* ── Token Management ── */

  ipcMain.handle('deploy:set-token', async (_event, token) => {
    try {
      storeToken(token);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('deploy:has-token', () => {
    return fs.existsSync(TOKEN_FILE);
  });

  ipcMain.handle('deploy:clear-token', () => {
    try {
      if (fs.existsSync(TOKEN_FILE)) fs.unlinkSync(TOKEN_FILE);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('deploy:validate-token', async (_event, token) => {
    return await validateToken(token);
  });

  /* ── Workspace Preparation ── */

  ipcMain.handle('deploy:prepare', async (_event, options = {}) => {
    try {
      const { sessionId, files, webRoot } = options;
      const result = prepareWorkspace(sessionId, files, webRoot ?? null);
      if (result.needsChoice) {
        console.log(
          `[Causify Deploy] Multiple web roots detected for ${String(sessionId).substring(0, 8)}: ` +
          result.candidates.map((c) => c.dir).join(', ') + ' — asking user'
        );
        return { success: true, ...result };
      }
      console.log(
        `[Causify Deploy] Prepared workspace for ${String(sessionId).substring(0, 8)} ` +
        `(${result.fileCount} files, web root: ${result.webRoot ?? 'auto'}) → ${result.cwd}`
      );
      return { success: true, ...result };
    } catch (err) {
      console.error('[Causify Deploy] Failed to prepare workspace:', err.message);
      return { success: false, error: err.message };
    }
  });

  /* ── Framework Detection ── */

  ipcMain.handle('deploy:detect-framework', async (_event, options) => {
    const resolvedCwd = resolveWorkspaceCwd(options);
    return detectFramework(resolvedCwd);
  });

  /* ── Existing Project Linking ── */

  ipcMain.handle('deploy:list-projects', async () => {
    const token = retrieveToken();
    if (!token) {
      return { success: false, error: 'No Vercel token stored' };
    }
    return await listProjects(token);
  });

  ipcMain.handle('deploy:get-linked', async (_event, options) => {
    const resolvedCwd = resolveWorkspaceCwd(options);
    return getLinkedProjectInfo(resolvedCwd);
  });

  ipcMain.handle('deploy:link-project', async (_event, options = {}) => {
    try {
      const { projectId, orgId, projectName } = options;
      const resolvedCwd = resolveWorkspaceCwd(options);
      // Ensure the workspace dir exists before writing the link.
      fs.mkdirSync(resolvedCwd, { recursive: true });
      linkProject(resolvedCwd, projectId, orgId, projectName);
      console.log(`[Causify Deploy] Linked workspace to project ${projectName || projectId}`);
      return { success: true, projectName: projectName || null };
    } catch (err) {
      console.error('[Causify Deploy] Failed to link project:', err.message);
      return { success: false, error: err.message };
    }
  });

  /* ── Env File Operations ── */

  ipcMain.handle('deploy:detect-env', async (_event, options) => {
    const resolvedCwd = resolveWorkspaceCwd(options);
    return detectEnvFiles(resolvedCwd);
  });

  ipcMain.handle('deploy:push-env', async (_event, options = {}) => {
    const token = retrieveToken();
    if (!token) {
      return { success: false, error: 'No Vercel token stored' };
    }

    const { vars } = options;
    const resolvedCwd = resolveWorkspaceCwd(options);
    const projectId = getVercelProjectId(resolvedCwd);
    if (!projectId) {
      return {
        success: false,
        error: 'No Vercel project linked yet. Deploy once first to create the project link.',
      };
    }

    const results = await pushEnvVars(token, projectId, vars);
    const allSuccess = results.every((r) => r.success);
    return { success: allSuccess, results };
  });

  /* ── Deploy Execution ── */

  ipcMain.handle('deploy:run', async (event, options = {}) => {
    const token = retrieveToken();
    if (!token) {
      throw new Error('No Vercel token configured. Please connect your Vercel account first.');
    }

    const deployId = crypto.randomUUID();
    const cwd = resolveWorkspaceCwd(options);

    try {
      fs.mkdirSync(cwd, { recursive: true });
    } catch (err) {
      throw new Error(`Deploy workspace is not accessible: ${err.message}`);
    }

    const entries = fs.readdirSync(cwd).filter((e) => e !== '.vercel');
    if (entries.length === 0) {
      throw new Error(
        'Deploy workspace is empty. Open or add files in this session before deploying.'
      );
    }

    // If a previous deploy linked this workspace to a project that has since
    // been deleted (or is no longer accessible), drop the stale link so a fresh
    // project is created instead of failing.
    await validateProjectLink(cwd, token);

    const framework = detectFramework(cwd);

    // Target project name: reuse the linked project (so updates are pushed to
    // the same deployment) or derive a stable name from the session.
    const linked = getLinkedProjectInfo(cwd);
    const projectName =
      linked?.projectName || sanitizeProjectName(options.sessionId || 'causify-app');

    const session = { api: true, cancelled: false, token };
    deploySessions.set(deployId, session);
    console.log(`[Causify Deploy] Started API deploy ${deployId.substring(0, 8)} (${projectName}) in ${cwd}`);

    // Fire the deployment asynchronously; progress streams over IPC channels.
    deployViaApi(token, cwd, { projectName }, deployId, event, () => deploySessions.get(deployId))
      .catch((err) => {
        console.error('[Causify Deploy] API deploy crashed:', err.message);
      });

    return { deployId, framework };
  });

  /* ── Cancel Deploy ── */

  ipcMain.handle('deploy:cancel', (_event, deployId) => {
    const session = deploySessions.get(deployId);
    if (session) {
      // API deploys can't be force-killed mid-request; flag them so the polling
      // loop stops and reports the cancellation. Legacy PTY sessions (if any)
      // still get killed.
      session.cancelled = true;
      if (session.process) {
        try {
          session.process.kill();
        } catch {
          // Already dead
        }
        deploySessions.delete(deployId);
      }
      console.log(`[Causify Deploy] Cancelled deploy ${deployId.substring(0, 8)}`);
      return { success: true };
    }
    return { success: false, error: 'No active deploy with that ID' };
  });
}

/**
 * Kill all active deploy sessions (called on app quit).
 */
function killAllDeploySessions() {
  for (const [deployId, session] of deploySessions) {
    session.cancelled = true;
    if (session.process) {
      try {
        session.process.kill();
      } catch {
        // Already dead
      }
    }
    deploySessions.delete(deployId);
  }
}

module.exports = {
  registerDeployHandlers,
  killAllDeploySessions,
};
