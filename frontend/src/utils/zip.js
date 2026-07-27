/* -------------------------------------------------------
 * zip.js — Minimal ZIP writer
 *
 * Lets a collaborator download a whole shared project from the browser, where
 * there is no filesystem to write into. Written by hand rather than pulling in
 * an archiver: the "stored" (uncompressed) ZIP format is small and completely
 * specified, and this avoids adding a dependency for one feature.
 *
 * Entries are stored uncompressed. Projects here are source files and modest
 * assets, and every unzip tool reads stored entries — trading some size for a
 * format that cannot get subtly wrong.
 * ------------------------------------------------------- */

/* CRC-32 (IEEE 802.3), the checksum ZIP requires for every entry. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let bit = 0; bit < 8; bit++) {
      c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/** Convert stored content to bytes. Binary assets travel as base64 data URLs. */
function toBytes(content) {
  if (content == null) return new Uint8Array(0);

  if (typeof content === 'string' && content.startsWith('data:')) {
    const marker = content.indexOf(';base64,');
    if (marker >= 0) {
      const binary = atob(content.slice(marker + ';base64,'.length));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes;
    }
  }

  return new TextEncoder().encode(String(content));
}

/** MS-DOS packed date and time, which is what the ZIP header stores. */
function dosDateTime(date = new Date()) {
  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | (Math.floor(date.getSeconds() / 2));
  const day =
    ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time: time & 0xFFFF, date: day & 0xFFFF };
}

/* Little-endian writers — every multi-byte field in a ZIP is little-endian. */
const u16 = (v) => [v & 0xFF, (v >>> 8) & 0xFF];
const u32 = (v) => [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF];

/**
 * Build a ZIP archive.
 *
 * @param {Array<{path: string, content: any}>} files
 * @returns {Blob} an archive ready to hand to a download link
 */
export function createZip(files) {
  const encoder = new TextEncoder();
  const { time, date } = dosDateTime();

  const chunks = [];      // archive body, in order
  const central = [];     // central directory entries
  let offset = 0;         // running offset of the next local header

  for (const file of files || []) {
    if (!file || !file.path) continue;

    // ZIP paths always use forward slashes and never start with one.
    const name = String(file.path).replace(/\\/g, '/').replace(/^\/+/, '');
    if (!name) continue;

    const nameBytes = encoder.encode(name);
    const data = toBytes(file.content);
    const checksum = crc32(data);

    // Local file header. Flag 0x0800 marks the name as UTF-8, so paths with
    // non-ASCII characters survive.
    const localHeader = new Uint8Array([
      ...u32(0x04034B50),
      ...u16(20), ...u16(0x0800), ...u16(0),
      ...u16(time), ...u16(date),
      ...u32(checksum), ...u32(data.length), ...u32(data.length),
      ...u16(nameBytes.length), ...u16(0),
      ...nameBytes,
    ]);

    chunks.push(localHeader, data);

    central.push(new Uint8Array([
      ...u32(0x02014B50),
      ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0),
      ...u16(time), ...u16(date),
      ...u32(checksum), ...u32(data.length), ...u32(data.length),
      ...u16(nameBytes.length), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0), ...u32(0),
      ...u32(offset),
      ...nameBytes,
    ]));

    offset += localHeader.length + data.length;
  }

  const centralSize = central.reduce((sum, entry) => sum + entry.length, 0);

  const endOfDirectory = new Uint8Array([
    ...u32(0x06054B50),
    ...u16(0), ...u16(0),
    ...u16(central.length), ...u16(central.length),
    ...u32(centralSize), ...u32(offset),
    ...u16(0),
  ]);

  return new Blob([...chunks, ...central, endOfDirectory], { type: 'application/zip' });
}

/** Save a Blob under the given filename via the browser's download flow. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Revoke on the next tick so the download has certainly started.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
