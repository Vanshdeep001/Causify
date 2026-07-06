/* -------------------------------------------------------
 * detectBackend.js — Backend detection for Render deploys
 *
 * The Vercel deploy detects the FRONTEND inside the Electron main
 * process because it writes files to a local workspace first. Render
 * deploys are Git-based — nothing is written to disk — so backend
 * detection runs here in the renderer, straight over the session's
 * in-memory files map ({ relPath: content }).
 *
 * Returns everything the Create Service flow needs prefilled:
 *   { framework, runtime, rootDir, buildCommand, startCommand,
 *     dockerfilePath, createSupported, note }
 *
 * `runtime` is Render's native runtime id (node | python | go | rust |
 * ruby | elixir | docker). Java/Spring has no native runtime on Render,
 * so it needs a Dockerfile.
 * ------------------------------------------------------- */

/** Normalize a path map into [{ rel, dir, name, content }]. */
function indexFiles(files) {
  const items = [];
  for (const [rel, content] of Object.entries(files || {})) {
    if (!rel || typeof rel !== 'string') continue;
    const clean = rel.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!clean || clean.includes('node_modules/') || clean.startsWith('.git/')) continue;
    const idx = clean.lastIndexOf('/');
    items.push({
      rel: clean,
      dir: idx === -1 ? '' : clean.slice(0, idx),
      name: idx === -1 ? clean : clean.slice(idx + 1),
      content: content == null ? '' : String(content),
    });
  }
  return items;
}

const BACKEND_PATH_HINT = /(^|\/)(backend|server|api|services?)($|\/)/i;
const FRONTEND_DEPS = [
  'next', 'vite', 'react-scripts', 'vue', 'svelte', '@sveltejs/kit',
  '@angular/core', 'nuxt', 'gatsby', 'astro',
];
const NODE_BACKEND_DEPS = [
  'express', 'fastify', 'koa', '@nestjs/core', '@hapi/hapi', 'hapi',
  'restify', 'apollo-server', 'socket.io',
];

/**
 * Detect the deployable backend in the session files.
 * Returns null when nothing backend-shaped is found.
 */
export function detectBackend(files) {
  const items = indexFiles(files);
  if (items.length === 0) return null;

  const byDir = new Map();
  for (const it of items) {
    if (!byDir.has(it.dir)) byDir.set(it.dir, new Map());
    byDir.get(it.dir).set(it.name, it);
  }

  const candidates = [];

  for (const [dir, names] of byDir) {
    const depth = dir === '' ? 0 : dir.split('/').length;
    const hasDockerfile = names.has('Dockerfile');
    const pathHint = BACKEND_PATH_HINT.test(dir) ? 0 : 1;
    const add = (c) => candidates.push({ dir, depth, pathHint, hasDockerfile, ...c });

    // Java / Spring — Render has no native Java runtime; Docker required.
    if (names.has('pom.xml') || names.has('build.gradle') || names.has('build.gradle.kts')) {
      const isSpring = items.some(
        (i) => i.dir.startsWith(dir) && /spring-boot|org\.springframework/.test(i.content || '')
      );
      add({
        framework: isSpring ? 'Spring Boot' : 'Java',
        runtime: 'docker',
        createSupported: hasDockerfile,
        note: hasDockerfile
          ? null
          : 'Java has no native runtime on Render — add a Dockerfile to this project to create a new service, or link a service you already set up.',
      });
      continue;
    }

    // Python
    if (names.has('requirements.txt') || names.has('pyproject.toml') || names.has('manage.py')) {
      const reqs = (names.get('requirements.txt')?.content || '') +
                   (names.get('pyproject.toml')?.content || '');
      let framework = 'Python';
      let startCommand = 'python main.py';
      if (/fastapi/i.test(reqs)) {
        framework = 'FastAPI';
        startCommand = 'uvicorn main:app --host 0.0.0.0 --port $PORT';
      } else if (/django/i.test(reqs) || names.has('manage.py')) {
        framework = 'Django';
        const wsgi = items.find((i) => i.name === 'wsgi.py' && i.dir.startsWith(dir));
        const proj = wsgi ? wsgi.dir.split('/').pop() : 'app';
        startCommand = `gunicorn ${proj}.wsgi:application`;
      } else if (/flask/i.test(reqs)) {
        framework = 'Flask';
        startCommand = 'gunicorn app:app';
      }
      add({
        framework,
        runtime: 'python',
        buildCommand: 'pip install -r requirements.txt',
        startCommand,
        createSupported: true,
      });
      continue;
    }

    // Go
    if (names.has('go.mod')) {
      add({
        framework: 'Go',
        runtime: 'go',
        buildCommand: 'go build -o app .',
        startCommand: './app',
        createSupported: true,
      });
      continue;
    }

    // Rust
    if (names.has('Cargo.toml')) {
      const nameMatch = (names.get('Cargo.toml')?.content || '').match(/name\s*=\s*"([^"]+)"/);
      add({
        framework: 'Rust',
        runtime: 'rust',
        buildCommand: 'cargo build --release',
        startCommand: `./target/release/${nameMatch ? nameMatch[1] : 'app'}`,
        createSupported: true,
      });
      continue;
    }

    // Ruby
    if (names.has('Gemfile')) {
      const gemfile = names.get('Gemfile')?.content || '';
      const isRails = /rails/i.test(gemfile);
      add({
        framework: isRails ? 'Ruby on Rails' : 'Ruby',
        runtime: 'ruby',
        buildCommand: 'bundle install',
        startCommand: isRails ? 'bundle exec rails server' : 'bundle exec ruby app.rb',
        createSupported: true,
      });
      continue;
    }

    // Elixir
    if (names.has('mix.exs')) {
      add({
        framework: 'Elixir',
        runtime: 'elixir',
        buildCommand: 'mix deps.get && mix compile',
        startCommand: 'mix run --no-halt',
        createSupported: true,
      });
      continue;
    }

    // Node backend — a package.json with server deps and no frontend framework.
    if (names.has('package.json')) {
      try {
        const pkg = JSON.parse(names.get('package.json').content || '{}');
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        const isFrontend = FRONTEND_DEPS.some((d) => deps[d]);
        const backendDep = NODE_BACKEND_DEPS.find((d) => deps[d]);
        if (!isFrontend && (backendDep || pkg.scripts?.start)) {
          const hasBuild = Boolean(pkg.scripts?.build);
          add({
            framework: backendDep === '@nestjs/core' ? 'NestJS'
              : backendDep ? `Node.js (${backendDep})`
              : 'Node.js',
            runtime: 'node',
            buildCommand: hasBuild ? 'npm install && npm run build' : 'npm install',
            startCommand: pkg.scripts?.start ? 'npm start' : `node ${pkg.main || 'index.js'}`,
            createSupported: true,
          });
        }
      } catch {
        // Unparseable package.json — not a candidate.
      }
      continue;
    }

    // Bare Dockerfile with no recognized language marker.
    if (hasDockerfile) {
      add({ framework: 'Docker', runtime: 'docker', createSupported: true });
    }
  }

  if (candidates.length === 0) return null;

  // Backend-looking paths first, then shallowest.
  candidates.sort((a, b) => (a.pathHint - b.pathHint) || (a.depth - b.depth));
  const best = candidates[0];

  // A Dockerfile beside the detected backend wins — it is the user's
  // explicit build recipe, and the only option for Java anyway.
  if (best.hasDockerfile) {
    return {
      framework: best.framework === 'Docker' ? 'Docker' : `${best.framework} (Docker)`,
      runtime: 'docker',
      rootDir: best.dir,
      dockerfilePath: './Dockerfile',
      buildCommand: '',
      startCommand: '',
      createSupported: true,
      note: null,
    };
  }

  return {
    framework: best.framework,
    runtime: best.runtime,
    rootDir: best.dir,
    dockerfilePath: null,
    buildCommand: best.buildCommand || '',
    startCommand: best.startCommand || '',
    createSupported: best.createSupported !== false,
    note: best.note || null,
  };
}

/**
 * Detect env vars from .env files in the session, preferring files that
 * live inside the detected backend root. Same output shape as the Vercel
 * flow: [{ key, value, source }].
 */
export function detectBackendEnvVars(files, rootDir) {
  const ENV_NAMES = new Set(['.env', '.env.local', '.env.production']);
  const items = indexFiles(files).filter((i) => ENV_NAMES.has(i.name));
  if (items.length === 0) return [];

  // Prefer env files inside the backend root when one is known.
  const prefix = rootDir ? `${rootDir}/` : null;
  const scoped = prefix
    ? items.filter((i) => i.rel.startsWith(prefix) || i.dir === rootDir)
    : [];
  const chosen = scoped.length > 0 ? scoped : items;

  const vars = [];
  for (const file of chosen) {
    for (const line of file.content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (key) vars.push({ key, value, source: file.rel });
    }
  }
  return vars;
}
