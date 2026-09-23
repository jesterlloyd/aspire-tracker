// lib/server/signatures/zip.js
//
// SIGNATURES-PHASE2: a minimal ZIP writer for "Signed copies (ZIP)". Entries are STORED
// (no compression): the sealed PDFs inside are already compressed, and a stored entry
// keeps each file byte-for-byte identical, so every seal still verifies after unzipping.
// Uses Node's own CRC-32 (zlib.crc32, Node 22+), so no dependency is added.

import zlib from 'node:zlib'

const dosTime = (d) => ((d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2)) & 0xffff
const dosDate = (d) => (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff

/** @param {{ name: string, data: Buffer }[]} files @returns {Buffer} */
export function zipStored(files, when = new Date()) {
  const locals = [], centrals = []
  let offset = 0
  const seen = new Set()
  for (const f of files) {
    let name = f.name.replace(/[\\/:*?"<>|]+/g, '_')
    for (let i = 2; seen.has(name); i++) name = f.name.replace(/(\.pdf)?$/i, ` (${i})$1`)
    seen.add(name)
    const nameBuf = Buffer.from(name, 'utf8')
    const crc = zlib.crc32(f.data) >>> 0
    const size = f.data.length
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(0, 8); local.writeUInt16LE(dosTime(when), 10); local.writeUInt16LE(dosDate(when), 12)
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(size, 18); local.writeUInt32LE(size, 22)
    local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28)
    locals.push(local, nameBuf, f.data)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(0, 10); central.writeUInt16LE(dosTime(when), 12); central.writeUInt16LE(dosDate(when), 14)
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(size, 20); central.writeUInt32LE(size, 24)
    central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(offset, 42)
    centrals.push(central, nameBuf)
    offset += 30 + nameBuf.length + size
  }
  const cd = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, end])
}
