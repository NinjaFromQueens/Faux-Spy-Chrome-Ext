/**
 * Builds the Chrome Web Store and Firefox (AMO) packages from faux-spy-extension/.
 *
 * Usage: node build-extension.js
 * Output: faux-spy-v<version>.zip and faux-spy-firefox-v<version>.zip in this folder.
 *
 * Both packages come straight from source, byte for byte. Firefox builds used
 * to be patched by hand, which needed commenting out lines and re-saving
 * files — and the re-save garbled every emoji in the live Firefox build
 * ("ðŸ•µï¸ Investigate this image"). Nothing here edits file contents.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SRC = path.join(__dirname, 'faux-spy-extension');
const OUT = __dirname;

// Never shipped as-is: docs, editor files, and both manifests (each target
// adds its own manifest as manifest.json below).
const COMMON_EXCLUDE = [/\.md$/, /\.code-workspace$/, /^manifest(\.firefox)?\.json$/];
const TARGETS = {
  chrome: {
    manifest: 'manifest.json',
    out: v => `faux-spy-v${v}.zip`,
    exclude: [/^background-ff-shim\.js$/, /^content-ff-keepalive\.js$/],
  },
  firefox: {
    manifest: 'manifest.firefox.json',
    out: v => `faux-spy-firefox-v${v}.zip`,
    // Firefox doesn't load the ONNX runtime (importScripts is a no-op there),
    // and shipping minified ort.min.js would require a source submission.
    exclude: [/^ort[.-]/],
  },
};

function listFiles(dir, base = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const rel = base ? `${base}/${e.name}` : e.name;
    return e.isDirectory() ? listFiles(path.join(dir, e.name), rel) : [rel];
  });
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Minimal deflate zip writer. Fixed timestamps keep builds reproducible.
function writeZip(outPath, entries) {
  const DOS_TIME = 0, DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01
  const locals = [], centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8); local.writeUInt16LE(DOS_TIME, 10); local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(deflated.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(8, 10); central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14); central.writeUInt32LE(crc, 16); central.writeUInt32LE(deflated.length, 20);
    central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, deflated);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + deflated.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12); end.writeUInt32LE(offset, 16);
  fs.writeFileSync(outPath, Buffer.concat([...locals, centralBuf, end]));
}

const allFiles = listFiles(SRC).sort();
for (const [name, t] of Object.entries(TARGETS)) {
  const manifest = JSON.parse(fs.readFileSync(path.join(SRC, t.manifest), 'utf8'));
  const files = allFiles.filter(f => ![...COMMON_EXCLUDE, ...t.exclude].some(re => re.test(f)));
  const entries = [
    { name: 'manifest.json', data: fs.readFileSync(path.join(SRC, t.manifest)) },
    ...files.map(f => ({ name: f, data: fs.readFileSync(path.join(SRC, f)) })),
  ];

  // Every file the manifest points at must be in the package.
  const referenced = [
    ...(manifest.background?.scripts || []), manifest.background?.service_worker,
    ...(manifest.content_scripts || []).flatMap(c => [...(c.js || []), ...(c.css || [])]),
    manifest.action?.default_popup, manifest.options_page, manifest.options_ui?.page,
    ...Object.values(manifest.icons || {}),
  ].filter(Boolean);
  const missing = referenced.filter(r => !entries.some(e => e.name === r));
  if (missing.length) throw new Error(`${name}: manifest references missing files: ${missing.join(', ')}`);
  const names = entries.map(e => e.name);
  const dupes = names.filter((n, i) => names.indexOf(n) !== i);
  if (dupes.length) throw new Error(`${name}: duplicate entries: ${dupes.join(', ')}`);

  const outFile = path.join(OUT, t.out(manifest.version));
  writeZip(outFile, entries);
  const kb = Math.round(fs.statSync(outFile).size / 1024);
  console.log(`✅ ${name.padEnd(7)} v${manifest.version}  ${entries.length} files  ${kb} KB  →  ${path.basename(outFile)}`);
}
