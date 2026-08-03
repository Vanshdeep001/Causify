#!/usr/bin/env node
/* -------------------------------------------------------
 * fetch-cloudflared.js — download the tunnel binary for bundling
 *
 * The app ships cloudflared so hosting a session over the internet needs no
 * setup from the user. The binary itself is not committed — it is ~30 MB of
 * third-party build output that would bloat the repository and go stale — so
 * this pulls the current release into resources/bin/<platform>/ before a
 * package build.
 *
 *   node scripts/fetch-cloudflared.js          # this machine's platform
 *   node scripts/fetch-cloudflared.js --all    # every platform we ship
 *
 * cloudflared is Apache-2.0. resources/bin/LICENSE-cloudflared.txt must ship
 * with the binary; see the note this script writes there.
 * ------------------------------------------------------- */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');
const os = require('os');

const BASE = 'https://github.com/cloudflare/cloudflared/releases/latest/download';

/* macOS releases are tarballs; the others are the bare executable. */
const TARGETS = {
  win: { asset: 'cloudflared-windows-amd64.exe', out: 'cloudflared.exe' },
  mac: { asset: 'cloudflared-darwin-amd64.tgz', out: 'cloudflared', archive: 'tgz' },
  linux: { asset: 'cloudflared-linux-amd64', out: 'cloudflared' },
};

const currentPlatform = () =>
  process.platform === 'win32' ? 'win'
    : process.platform === 'darwin' ? 'mac'
      : 'linux';

/** GitHub redirects release downloads to a CDN, so follow 3xx. */
function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));

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
          process.stdout.write(`\r  ${pct}%  (${(seen / 1e6).toFixed(1)} MB)   `);
        }
      });

      res.pipe(file);
      file.on('finish', () => file.close(() => {
        process.stdout.write('\n');
        resolve();
      }));
      file.on('error', reject);
    }).on('error', reject);
  });
}

async function fetchOne(key) {
  const target = TARGETS[key];
  if (!target) throw new Error(`Unknown platform "${key}"`);

  const dir = path.join(__dirname, '..', 'resources', 'bin', key);
  fs.mkdirSync(dir, { recursive: true });

  const finalPath = path.join(dir, target.out);
  console.log(`\n${key}: ${target.asset}`);

  if (target.archive === 'tgz') {
    const tmp = path.join(os.tmpdir(), `cloudflared-${key}-${Date.now()}.tgz`);
    await download(`${BASE}/${target.asset}`, tmp);
    // bsdtar ships with macOS and modern Windows; on Linux it is GNU tar.
    execFileSync('tar', ['-xzf', tmp, '-C', dir], { stdio: 'inherit' });
    fs.rmSync(tmp, { force: true });
  } else {
    await download(`${BASE}/${target.asset}`, finalPath);
  }

  if (!fs.existsSync(finalPath)) {
    throw new Error(`Expected ${finalPath} after extraction, but it is missing`);
  }
  if (key !== 'win') fs.chmodSync(finalPath, 0o755);

  const mb = (fs.statSync(finalPath).size / 1e6).toFixed(1);
  console.log(`  → ${path.relative(process.cwd(), finalPath)} (${mb} MB)`);
}

function writeLicenseNote() {
  const dir = path.join(__dirname, '..', 'resources', 'bin');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'LICENSE-cloudflared.txt'),
    [
      'cloudflared is bundled with this application under the Apache License 2.0.',
      '',
      'Source:  https://github.com/cloudflare/cloudflared',
      'License: https://github.com/cloudflare/cloudflared/blob/master/LICENSE',
      '',
      'It is used only to expose this machine\'s local backend so invited',
      'collaborators can reach a session hosted here. It is started on request',
      'and stopped when the session ends or the app quits.',
      '',
    ].join('\n'),
    'utf8'
  );
}

(async () => {
  const all = process.argv.includes('--all');
  const keys = all ? Object.keys(TARGETS) : [currentPlatform()];

  console.log(`Fetching cloudflared for: ${keys.join(', ')}`);
  try {
    for (const key of keys) await fetchOne(key);
    writeLicenseNote();
    console.log('\nDone.');
  } catch (err) {
    console.error(`\nFailed: ${err.message}`);
    process.exit(1);
  }
})();
