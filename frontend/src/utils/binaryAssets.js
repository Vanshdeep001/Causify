/*
 * binaryAssets.js — Helpers for handling binary project assets (images, fonts).
 *
 * Projects frequently `import logo from './assets/logo.png'`. Those files are not
 * text, so they are imported as base64 data URLs (data:<mime>;base64,<data>),
 * stored as ordinary string content, and decoded back to real bytes when the
 * dev-server workspace is written to disk. This keeps the collaborative editor
 * (which is text/CRDT based) unchanged while still letting Vite/webpack resolve
 * asset imports at build time.
 */

// Binary asset extensions we DO want to carry into the session (read as base64).
// Kept deliberately narrow: images + web fonts that code commonly imports.
export const BINARY_ASSET_EXTENSIONS = new Set([
  // images
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'webp', 'avif',
  // fonts
  'woff', 'woff2', 'ttf', 'otf', 'eot',
]);

// Heavy / irrelevant binaries that a dev server almost never needs to build.
// These stay excluded from import to keep sessions small.
export const SKIP_ASSET_EXTENSIONS = new Set([
  'mp4', 'mp3', 'wav', 'ogg', 'webm', 'avi', 'mov',
  'zip', 'rar', '7z', 'tar', 'gz', 'bz2',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'exe', 'dll', 'so', 'dylib', 'class', 'jar',
  'lock',
]);

const extensionOf = (path) => (path.includes('.') ? path.split('.').pop().toLowerCase() : '');

/** True for files that should be imported as base64 (images/fonts). */
export const isBinaryAssetPath = (path) => BINARY_ASSET_EXTENSIONS.has(extensionOf(path));

/** True for heavy binaries we deliberately skip on import. */
export const isSkippedAssetPath = (path) => SKIP_ASSET_EXTENSIONS.has(extensionOf(path));

/** True when stored content is a base64 data URL rather than editable text. */
export const isDataUrl = (content) =>
  typeof content === 'string' && content.startsWith('data:') && content.includes(';base64,');

/** True when the asset is a previewable raster/vector image. */
export const isImagePath = (path) =>
  ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'webp', 'avif', 'svg'].includes(extensionOf(path));
