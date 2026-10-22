// Regenerates every ASPIRE app icon from reference/brand/aspire-icon-source-1024.png.
// Usage: node scripts/brand/make-app-icons.mjs [source.png]
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';
const src = process.argv[2] || 'reference/brand/aspire-icon-source-1024.png';
const out = 'public';
// Flatten the transparent rounded corners onto black so every icon is a full-bleed square;
// browsers and home screens apply their own corner mask.
const base = sharp(src).flatten({ background: '#000000' });
const sizes = { 'aspire-icon.png': 512, 'aspire-icon-192.png': 192, 'apple-touch-icon.png': 180, 'aspire-icon-96.png': 96, 'aspire-icon-48.png': 48, 'aspire-icon-32.png': 32, 'aspire-icon-16.png': 16 };
for (const [name, px] of Object.entries(sizes)) {
  await base.clone().resize(px, px, { kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toFile(`${out}/${name}`);
}
// favicon.ico: PNG-compressed entries at 16, 32 and 48.
const entries = [];
for (const px of [16, 32, 48]) entries.push({ px, buf: await base.clone().resize(px, px, { kernel: 'lanczos3' }).png().toBuffer() });
const header = Buffer.alloc(6); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(entries.length, 4);
let offset = 6 + 16 * entries.length; const dirs = [];
for (const e of entries) { const d = Buffer.alloc(16); d.writeUInt8(e.px, 0); d.writeUInt8(e.px, 1); d.writeUInt8(0, 2); d.writeUInt8(0, 3); d.writeUInt16LE(1, 4); d.writeUInt16LE(32, 6); d.writeUInt32LE(e.buf.length, 8); d.writeUInt32LE(offset, 12); offset += e.buf.length; dirs.push(d); }
writeFileSync(`${out}/favicon.ico`, Buffer.concat([header, ...dirs, ...entries.map(e => e.buf)]));
console.log('done');
