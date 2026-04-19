/* -------------------------------------------------------
 * scripts/afterPack.js — electron-builder afterPack hook
 *
 * Runs after packaging but BEFORE the NSIS installer is
 * created. Sets the Causify icon on the exe using rcedit.
 * 
 * Uses execSync as a fallback since the async version can
 * hit file lock issues with electron-builder's pipeline.
 * ------------------------------------------------------- */

const path = require('path');
const { execSync } = require('child_process');

exports.default = async function afterPack(context) {
  const exePath = path.join(context.appOutDir, 'Causify.exe');
  const icoPath = path.join(__dirname, '..', 'public', 'icon.ico');
  const rceditBin = path.join(__dirname, '..', 'node_modules', 'rcedit', 'bin', 'rcedit-x64.exe');

  console.log('[afterPack] Setting icon on', exePath);
  
  // Small delay to ensure file handle is released
  await new Promise(r => setTimeout(r, 1000));
  
  // Retry up to 3 times with increasing delay
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      execSync(`"${rceditBin}" "${exePath}" --set-icon "${icoPath}"`, {
        stdio: 'pipe',
        windowsHide: true,
      });
      console.log('[afterPack] ✓ Icon set successfully (attempt', attempt + ')');
      return;
    } catch (err) {
      console.log(`[afterPack] Attempt ${attempt} failed, retrying in ${attempt}s...`);
      await new Promise(r => setTimeout(r, attempt * 1000));
    }
  }
  console.error('[afterPack] ✗ Could not set icon after 3 attempts');
};
