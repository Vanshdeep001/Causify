/* -------------------------------------------------------
 * scripts/build-installer.js
 *
 * Full build pipeline:
 *   1. Vite build (frontend)
 *   2. electron-builder (package + NSIS installer)
 *   3. rcedit to set the correct icon on the .exe
 * ------------------------------------------------------- */

const { execSync } = require('child_process');
const path = require('path');
const { rcedit } = require('rcedit');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');

async function build() {
  // Step 1: Vite build
  console.log('\n[1/3] Building frontend with Vite...');
  execSync('npx vite build', { cwd: ROOT, stdio: 'inherit' });

  // Step 2: electron-builder
  console.log('\n[2/3] Packaging with electron-builder...');
  execSync('npx electron-builder --win', {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
  });

  // Step 3: Set icon with rcedit
  const exePath = path.join(ROOT, 'release', 'win-unpacked', 'Causify.exe');
  const icoPath = path.join(ROOT, 'public', 'icon.ico');

  if (fs.existsSync(exePath) && fs.existsSync(icoPath)) {
    console.log('\n[3/3] Setting application icon with rcedit...');
    await rcedit(exePath, { icon: icoPath });
    console.log('  ✓ Icon set successfully on Causify.exe');
  } else {
    console.log('\n[3/3] Skipped rcedit — exe or icon not found');
    if (!fs.existsSync(exePath)) console.log('  Missing:', exePath);
    if (!fs.existsSync(icoPath)) console.log('  Missing:', icoPath);
  }

  console.log('\n✓ Build complete! Installer is in release/');
}

build().catch((err) => {
  console.error('\n✗ Build failed:', err.message);
  process.exit(1);
});
