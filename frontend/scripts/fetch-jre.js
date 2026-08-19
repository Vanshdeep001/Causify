#!/usr/bin/env node
/* -------------------------------------------------------
 * fetch-jre.js — build the Java runtime the app ships with
 *
 * The backend is a Spring Boot jar, so until now installing Causify was really
 * installing two things: the app, and a JDK the user had to find, install and
 * sometimes put on PATH themselves. Everyone who skipped that step got an app
 * that launched into a dead backend — the failure landed at the point where
 * nothing they could see was wrong.
 *
 * So the runtime ships with us. This downloads a Temurin JDK and runs jlink
 * over it to produce a trimmed image containing only the modules the backend
 * actually uses. Trimmed matters: the full JDK is ~330 MB unpacked, and most of
 * it is tooling nobody here will ever run.
 *
 * javac is deliberately included. Running a user's Java file is a feature of
 * the app, and it shells out to javac — bundling a runtime that starts the
 * backend but cannot compile a Hello World would just move the "install Java"
 * message somewhere less obvious.
 *
 *   node scripts/fetch-jre.js           # this machine's platform
 *   node scripts/fetch-jre.js --force   # rebuild even if one is already there
 *
 * jlink emits an image for the platform of the JDK it came from, so a Windows
 * installer must be built on Windows, a mac one on mac. That is already true of
 * this project's packaging.
 *
 * Temurin is GPLv2+CE. resources/jre/LICENSE-temurin.txt ships beside it.
 * ------------------------------------------------------- */

const fs = require('fs');
const path = require('path');
const https = require('https');
const os = require('os');
const { execFileSync } = require('child_process');

/* Java 21, not the newest.
 *
 * The backend is Spring Boot 3.2.5, whose bytecode-manipulation stack
 * (ByteBuddy, CGLIB) is only tested up to a couple of releases past 21. Newer
 * JDKs mostly work and warn a lot; 21 is the LTS this generation of Spring was
 * built against, and shipping a runtime is exactly the wrong place to be
 * adventurous — a JVM incompatibility here breaks the app for everyone at once
 * with no way for the user to swap it out. */
const FEATURE_VERSION = 21;

/* Modules the backend needs, and nothing else.
 *
 * Worth knowing why the non-obvious ones are here, because "it started fine on
 * my machine" is not evidence — a missing module usually surfaces as a
 * ClassNotFoundException deep in a library, on a code path nobody hit during a
 * smoke test:
 *
 *   java.desktop      java.beans lives here. Spring's whole property/binding
 *                     layer is built on it, so this is not optional despite the
 *                     name suggesting windows and mice.
 *   java.instrument   Spring's agent hooks and ByteBuddy attach through it.
 *   java.naming       Tomcat and JPA both reach for JNDI.
 *   java.sql*         H2 and Hibernate.
 *   java.transaction.xa  Hibernate's transaction plumbing.
 *   jdk.unsupported   sun.misc.Unsafe — H2, Netty and ByteBuddy all use it.
 *   jdk.crypto.ec     ECDHE cipher suites. Without it, HTTPS to the AI
 *                     providers fails during the handshake.
 *   jdk.zipfs         reading nested jars out of the Spring Boot fat jar.
 *   jdk.charsets      anything the user opens that is not UTF-8.
 *   jdk.compiler      javac, for running the user's Java code.
 */
const MODULES = [
  'java.base',
  'java.compiler',
  'java.datatransfer',
  'java.desktop',
  'java.instrument',
  'java.logging',
  'java.management',
  'java.naming',
  'java.net.http',
  'java.prefs',
  'java.rmi',
  'java.scripting',
  'java.security.jgss',
  'java.security.sasl',
  'java.sql',
  'java.sql.rowset',
  'java.transaction.xa',
  'java.xml',
  'java.xml.crypto',
  'jdk.charsets',
  'jdk.compiler',
  'jdk.crypto.cryptoki',
  'jdk.crypto.ec',
  'jdk.httpserver',
  'jdk.jfr',
  'jdk.management',
  'jdk.naming.dns',
  'jdk.unsupported',
  'jdk.zipfs',
];

const currentPlatform = () =>
  process.platform === 'win32' ? 'win'
    : process.platform === 'darwin' ? 'mac'
      : 'linux';

/* Adoptium's own naming, which differs from ours. */
const ADOPTIUM_OS = { win: 'windows', mac: 'mac', linux: 'linux' };
const ADOPTIUM_ARCH = { x64: 'x64', arm64: 'aarch64' };

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'resources', 'jre');
/* Cached outside resources/ so a rebuild does not re-download 180 MB, and so
   the cache never ends up inside the packaged app. */
const CACHE_DIR = path.join(os.tmpdir(), 'causify-jdk-cache');

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 6) return reject(new Error('Too many redirects'));

    https.get(url, { headers: { 'User-Agent': 'causify-build' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(download(res.headers.location, dest, redirects + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }

      const total = Number(res.headers['content-length'] || 0);
      let seen = 0;
      const file = fs.createWriteStream(dest);

      res.on('data', (c) => {
        seen += c.length;
        if (total) {
          const pct = ((seen / total) * 100).toFixed(0);
          process.stdout.write(`\r  ${pct}%  (${(seen / 1e6).toFixed(0)} MB)   `);
        }
      });

      res.pipe(file);
      file.on('finish', () => file.close(() => { process.stdout.write('\n'); resolve(); }));
      file.on('error', reject);
    }).on('error', reject);
  });
}

/** Where the JDK unpacked to. Temurin archives hold one top-level directory. */
function findJdkHome(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory());

  for (const entry of entries) {
    const candidate = path.join(dir, entry.name);
    // macOS archives nest the real home under Contents/Home.
    const macHome = path.join(candidate, 'Contents', 'Home');
    const home = fs.existsSync(path.join(macHome, 'bin')) ? macHome : candidate;
    if (fs.existsSync(path.join(home, 'bin')) && fs.existsSync(path.join(home, 'jmods'))) {
      return home;
    }
  }
  throw new Error(`No JDK (with jmods) found under ${dir}`);
}

async function ensureJdk(platform) {
  const osName = ADOPTIUM_OS[platform];
  const arch = ADOPTIUM_ARCH[process.arch] || 'x64';
  const marker = path.join(CACHE_DIR, `${osName}-${arch}-${FEATURE_VERSION}`);

  if (fs.existsSync(marker)) {
    try { return findJdkHome(marker); } catch { /* incomplete — redownload */ }
  }

  fs.mkdirSync(marker, { recursive: true });

  /* The redirect endpoint always points at the current build of this feature
     release, so there is no hard-coded patch version to go stale. jdk, not jre:
     jlink needs jmods, and the JRE package does not carry them. */
  const url = `https://api.adoptium.net/v3/binary/latest/${FEATURE_VERSION}/ga/${osName}/${arch}/jdk/hotspot/normal/eclipse`;
  const ext = platform === 'win' ? 'zip' : 'tar.gz';
  const archive = path.join(CACHE_DIR, `jdk-${osName}-${arch}.${ext}`);

  // A download that succeeded but failed to unpack should not cost another
  // 200 MB on the retry.
  if (!fs.existsSync(archive)) {
    console.log(`[jre] Downloading Temurin ${FEATURE_VERSION} for ${osName}/${arch}…`);
    await download(url, archive);
  } else {
    console.log('[jre] Using the archive already in the cache');
  }

  console.log('[jre] Extracting…');
  extract(archive, marker);
  fs.rmSync(archive, { force: true });

  return findJdkHome(marker);
}

/**
 * Unpack the JDK archive.
 *
 * Windows ships bsdtar in System32, which reads zip and tar.gz alike — but it
 * has to be named by full path. Resolving "tar" through PATH finds GNU tar
 * whenever the build runs under Git Bash or MSYS, and GNU tar reads "C:\…" as
 * a remote host and tries to open an SSH connection to a machine called C.
 */
function extract(archive, dest) {
  if (process.platform !== 'win32') {
    execFileSync('tar', ['-xf', archive, '-C', dest], { stdio: 'inherit' });
    return;
  }

  const bsdtar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  if (fs.existsSync(bsdtar)) {
    execFileSync(bsdtar, ['-xf', archive, '-C', dest], { stdio: 'inherit' });
    return;
  }

  // Pre-1803 Windows has no tar at all. Slower, but it is a one-off.
  execFileSync('powershell', [
    '-NoProfile', '-NonInteractive', '-Command',
    `Expand-Archive -LiteralPath '${archive}' -DestinationPath '${dest}' -Force`,
  ], { stdio: 'inherit' });
}

function buildRuntime(jdkHome, outDir) {
  const exe = process.platform === 'win32' ? '.exe' : '';
  const jlink = path.join(jdkHome, 'bin', `jlink${exe}`);

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(outDir), { recursive: true });

  const args = [
    '--add-modules', MODULES.join(','),
    '--output', outDir,
    '--strip-debug',
    '--no-header-files',
    '--no-man-pages',
    '--compress', 'zip-6',
    '--vm', 'server',
  ];

  console.log(`[jre] Linking ${MODULES.length} modules…`);
  try {
    execFileSync(jlink, args, { stdio: 'inherit' });
  } catch (err) {
    // --compress spelling changed across JDK generations; the image is worth
    // more than the compression.
    console.warn('[jre] jlink failed with compression — retrying without it');
    fs.rmSync(outDir, { recursive: true, force: true });
    execFileSync(jlink, args.filter((a, i) =>
      a !== '--compress' && args[i - 1] !== '--compress'), { stdio: 'inherit' });
  }
}

function dirSizeMb(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    total += entry.isDirectory() ? dirSizeMb(p) * 1e6 : fs.statSync(p).size;
  }
  return total / 1e6;
}

async function main() {
  const force = process.argv.includes('--force');
  const platform = currentPlatform();
  const exe = platform === 'win' ? '.exe' : '';
  const javaBin = path.join(OUT_DIR, 'bin', `java${exe}`);

  if (fs.existsSync(javaBin) && !force) {
    console.log(`[jre] Runtime already present at ${OUT_DIR} (--force to rebuild)`);
    return;
  }

  const jdkHome = await ensureJdk(platform);
  buildRuntime(jdkHome, OUT_DIR);

  // Prove the thing we are about to ship actually runs.
  const version = execFileSync(javaBin, ['-version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const javacBin = path.join(OUT_DIR, 'bin', `javac${exe}`);
  if (!fs.existsSync(javacBin)) {
    throw new Error('jlink produced an image without javac — running Java files would still need a system JDK');
  }

  fs.writeFileSync(
    path.join(OUT_DIR, 'LICENSE-temurin.txt'),
    [
      'This directory contains a trimmed Java runtime built with jlink from',
      `Eclipse Temurin ${FEATURE_VERSION} (https://adoptium.net).`,
      '',
      'Eclipse Temurin is licensed under GPLv2 with the Classpath Exception.',
      'https://openjdk.org/legal/gplv2+ce.html',
      '',
      'Source for OpenJDK is available at https://github.com/openjdk/jdk.',
      '',
    ].join('\n'),
  );

  console.log(`[jre] ✓ ${OUT_DIR}  (${dirSizeMb(OUT_DIR).toFixed(0)} MB)`);
  console.log(`[jre]   ${(version.split('\n')[0] || '').trim()}`);
}

main().catch((err) => {
  console.error(`[jre] ✗ ${err.message}`);
  process.exit(1);
});
