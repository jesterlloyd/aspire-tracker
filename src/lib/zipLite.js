// KEITH-SKILL-INSTALL-1: dependency-free ZIP read/write for skill packages.
//
// READER: supports STORE and DEFLATE entries (DEFLATE via the platform's
// native DecompressionStream, available in every supported browser and in
// Node 18+). Anything else - encryption, zip64, spanned archives - is
// reported per entry as unsupported, never silently skipped.
//
// WRITER: STORE only. Skill packages are small Markdown files; a compressor
// is complexity with no payoff, and STORE archives open everywhere.
//
// This module handles BYTES only. What is allowed into a skill package (and
// what gets quarantined) is the caller's policy, not zip logic.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(bytes) {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const td = new TextDecoder()
const te = new TextEncoder()

async function inflateRaw(bytes) {
  const ds = new DecompressionStream('deflate-raw')
  const stream = new Blob([bytes]).stream().pipeThrough(ds)
  const buf = await new Response(stream).arrayBuffer()
  return new Uint8Array(buf)
}

/**
 * Read a zip archive. Returns { entries: [{ name, bytes|null, error|null }] }.
 * Walks the central directory (the authoritative index); a corrupt or absent
 * central directory is a hard error.
 */
export async function readZip(arrayBuffer) {
  const b = new Uint8Array(arrayBuffer)
  const dv = new DataView(arrayBuffer)
  // Find End Of Central Directory (scan backwards past an optional comment).
  let eocd = -1
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('not_a_zip')
  const count = dv.getUint16(eocd + 10, true)
  let off = dv.getUint32(eocd + 16, true)

  const entries = []
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(off, true) !== 0x02014b50) throw new Error('bad_central_directory')
    const method = dv.getUint16(off + 10, true)
    const compSize = dv.getUint32(off + 20, true)
    const nameLen = dv.getUint16(off + 28, true)
    const extraLen = dv.getUint16(off + 30, true)
    const commentLen = dv.getUint16(off + 32, true)
    const localOff = dv.getUint32(off + 42, true)
    const name = td.decode(b.subarray(off + 46, off + 46 + nameLen))
    off += 46 + nameLen + extraLen + commentLen

    if (name.endsWith('/')) continue // directory marker
    try {
      // Local header: re-read name/extra lengths (extra field can differ).
      if (dv.getUint32(localOff, true) !== 0x04034b50) throw new Error('bad_local_header')
      const lNameLen = dv.getUint16(localOff + 26, true)
      const lExtraLen = dv.getUint16(localOff + 28, true)
      const dataStart = localOff + 30 + lNameLen + lExtraLen
      const raw = b.subarray(dataStart, dataStart + compSize)
      if (method === 0) entries.push({ name, bytes: new Uint8Array(raw), error: null })
      else if (method === 8) entries.push({ name, bytes: await inflateRaw(raw), error: null })
      else entries.push({ name, bytes: null, error: `unsupported_compression_${method}` })
    } catch (e) {
      entries.push({ name, bytes: null, error: e?.message || 'entry_unreadable' })
    }
  }
  return { entries }
}

/**
 * Write a STORE-only zip from [{ name, text }]. Returns a Uint8Array.
 */
export function writeZip(files) {
  const chunks = []
  const central = []
  let offset = 0
  for (const f of files) {
    const nameB = te.encode(f.name)
    const data = te.encode(String(f.text ?? ''))
    const crc = crc32(data)
    const local = new Uint8Array(30 + nameB.length)
    const ldv = new DataView(local.buffer)
    ldv.setUint32(0, 0x04034b50, true)
    ldv.setUint16(4, 20, true)          // version needed
    ldv.setUint16(8, 0, true)           // method: STORE
    ldv.setUint32(14, crc, true)
    ldv.setUint32(18, data.length, true)
    ldv.setUint32(22, data.length, true)
    ldv.setUint16(26, nameB.length, true)
    local.set(nameB, 30)
    chunks.push(local, data)

    const cen = new Uint8Array(46 + nameB.length)
    const cdv = new DataView(cen.buffer)
    cdv.setUint32(0, 0x02014b50, true)
    cdv.setUint16(4, 20, true)
    cdv.setUint16(6, 20, true)
    cdv.setUint16(10, 0, true)
    cdv.setUint32(16, crc, true)
    cdv.setUint32(20, data.length, true)
    cdv.setUint32(24, data.length, true)
    cdv.setUint16(28, nameB.length, true)
    cdv.setUint32(42, offset, true)
    cen.set(nameB, 46)
    central.push(cen)
    offset += local.length + data.length
  }
  const cenSize = central.reduce((s, c) => s + c.length, 0)
  const eocd = new Uint8Array(22)
  const edv = new DataView(eocd.buffer)
  edv.setUint32(0, 0x06054b50, true)
  edv.setUint16(8, files.length, true)
  edv.setUint16(10, files.length, true)
  edv.setUint32(12, cenSize, true)
  edv.setUint32(16, offset, true)

  const total = offset + cenSize + 22
  const out = new Uint8Array(total)
  let p = 0
  for (const c of [...chunks, ...central, eocd]) { out.set(c, p); p += c.length }
  return out
}
