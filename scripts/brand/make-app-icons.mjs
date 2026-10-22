// Regenerates every ASPIRE app icon from reference/brand/aspire-icon-source-1024.png.
// Usage: node scripts/brand/make-app-icons.mjs [source.png]
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';
const src = process.argv[2] || 'reference/brand/aspire-icon-source-1024.png';
const out = 'public';
// The tab icons, favicon.ico and the manifest keep the source's rounded corners
// (transparent outside the square): the Owner wants the rounded version in the tab
// (APP-ICON-2). Only apple-touch-icon is flattened onto black, because iOS fills
// transparency with black and masks its own corners.
const rounded = sharp(src);
const flat = sharp(src).flatten({ background: '#000000' });
const sizes = { 'aspire-icon.png': 512, 'aspire-icon-192.png': 192, 'aspire-icon-96.png': 96, 'aspire-icon-48.png': 48, 'aspire-icon-32.png': 32, 'aspire-icon-16.png': 16 };
for (const [name, px] of Object.entries(sizes)) {
  await rounded.clone().resize(px, px, { kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toFile(`${out}/${name}`);
}
await flat.clone().resize(180, 180, { kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toFile(`${out}/apple-touch-icon.png`);
// Home-screen app icons (APP-ICON-4): OPAQUE and at plain paths with no query string, the way
// Cardfold's are (it installs with its icon on the Owner's iPhone; ASPIRE's transparent,
// query-stringed manifest icons installed as the letter A on a real device). A new path is
// the cache-bust: rename the folder, never add ?v=.
const { mkdirSync } = await import('node:fs');
mkdirSync(`${out}/app-icon`, { recursive: true });
for (const px of [180, 192, 512]) {
  await flat.clone().resize(px, px, { kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toFile(`${out}/app-icon/aspire-${px}.png`);
}
// Maskable: the mark inside the central 80% safe zone on a black square.
const inner = await sharp(src).flatten({ background: '#000000' }).resize(410, 410, { kernel: 'lanczos3' }).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 3, background: '#000000' } })
  .composite([{ input: inner, left: 51, top: 51 }]).removeAlpha().png({ compressionLevel: 9 }).toFile(`${out}/app-icon/aspire-maskable-512.png`);
// favicon.ico: PNG-compressed entries at 16, 32 and 48.
const entries = [];
for (const px of [16, 32, 48]) entries.push({ px, buf: await rounded.clone().resize(px, px, { kernel: 'lanczos3' }).png().toBuffer() });
const header = Buffer.alloc(6); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(entries.length, 4);
let offset = 6 + 16 * entries.length; const dirs = [];
for (const e of entries) { const d = Buffer.alloc(16); d.writeUInt8(e.px, 0); d.writeUInt8(e.px, 1); d.writeUInt8(0, 2); d.writeUInt8(0, 3); d.writeUInt16LE(1, 4); d.writeUInt16LE(32, 6); d.writeUInt32LE(e.buf.length, 8); d.writeUInt32LE(offset, 12); offset += e.buf.length; dirs.push(d); }
writeFileSync(`${out}/favicon.ico`, Buffer.concat([header, ...dirs, ...entries.map(e => e.buf)]));
console.log('done');
