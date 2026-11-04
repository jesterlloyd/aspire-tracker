// lib/server/sheet/readSheet.js
//
// STUDENT-IMPORT-KEITH-1 (Owner, 2026-11-03): read the first sheet of an .xlsx workbook, or a CSV,
// into { headers, rows } where every row is an array of strings aligned to the headers. No
// dependency: an .xlsx is a zip of XML parts, so this reads the zip's central directory, inflates
// the parts it needs with node:zlib, and reads shared strings, inline strings, numbers, booleans
// and date cells (a number in a date style becomes an ISO date or date-time).
//
// Limits are part of the contract, because the bytes come from a person's upload: a part may
// inflate to at most MAX_PART_BYTES, the sheet keeps MAX_ROWS rows and MAX_COLS columns, and a file
// that is not a workbook or a CSV is refused with a plain reason rather than guessed at.

import { inflateRawSync } from 'node:zlib'

export const MAX_ROWS = 1000
export const MAX_COLS = 200
const MAX_PART_BYTES = 40 * 1024 * 1024

export class SheetReadError extends Error {
  constructor(reason, message) { super(message); this.reason = reason }
}

// ── zip ────────────────────────────────────────────────────────────────────────

function readZipEntries(buf) {
  // End of central directory: signature 0x06054b50, within the last 64 KiB + 22 bytes.
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new SheetReadError('not_workbook', 'That file is not an Excel workbook.')
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  const entries = new Map()
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) break
    const method = buf.readUInt16LE(p + 10)
    const compSize = buf.readUInt32LE(p + 20)
    const size = buf.readUInt32LE(p + 24)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const local = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    entries.set(name, { method, compSize, size, local })
    p += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

function readPart(buf, entries, name) {
  const e = entries.get(name)
  if (!e) return null
  if (e.local + 30 > buf.length || buf.readUInt32LE(e.local) !== 0x04034b50) throw new SheetReadError('not_workbook', 'That workbook could not be read.')
  const start = e.local + 30 + buf.readUInt16LE(e.local + 26) + buf.readUInt16LE(e.local + 28)
  const data = buf.subarray(start, start + e.compSize)
  if (e.method === 0) return data.toString('utf8')
  if (e.method !== 8) throw new SheetReadError('not_workbook', 'That workbook uses a compression this reader does not support.')
  try {
    return inflateRawSync(data, { maxOutputLength: MAX_PART_BYTES }).toString('utf8')
  } catch {
    throw new SheetReadError('too_large', 'That workbook is too large or damaged to read.')
  }
}

// ── xml helpers ───────────────────────────────────────────────────────────────

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
export function decodeXml(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : m
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })
}

const attr = (tag, name) => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag)
  return m ? decodeXml(m[1]) : null
}

/** The text of a string item: every <t> in order, phonetic runs left out. */
function textOf(xml) {
  const body = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '')
  let out = ''
  for (const m of body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g)) out += m[1] ? decodeXml(m[1]) : ''
  return out
}

function sharedStrings(xml) {
  if (!xml) return []
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g)].map(m => (m[1] ? textOf(m[1]) : ''))
}

// Built-in number formats that are dates or times (ECMA-376 18.8.30).
const DATE_BUILTINS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47])
function dateStyles(xml) {
  if (!xml) return []
  const custom = new Map()
  for (const m of xml.matchAll(/<numFmt\b[^>]*>/g)) {
    const id = Number(attr(m[0], 'numFmtId'))
    const code = String(attr(m[0], 'formatCode') || '').replace(/"[^"]*"|\[[^\]]*\]|\\./g, '')
    custom.set(id, /[dmyhs]/i.test(code))
  }
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml)
  if (!xfs) return []
  return [...xfs[1].matchAll(/<xf\b[^>]*\/?>/g)].map(m => {
    const id = Number(attr(m[0], 'numFmtId'))
    return DATE_BUILTINS.has(id) || custom.get(id) === true
  })
}

/** An Excel serial (1900 date system) as YYYY-MM-DD, or YYYY-MM-DDTHH:MM when it has a time. */
export function serialToIso(serial) {
  const n = Number(serial)
  if (!Number.isFinite(n) || n < 1) return String(serial)
  const ms = Math.round((n - 25569) * 86400000)
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return String(serial)
  const iso = d.toISOString()
  return Math.abs(n - Math.floor(n)) < 1e-9 ? iso.slice(0, 10) : iso.slice(0, 16)
}

function colIndex(ref) {
  const letters = /^([A-Z]+)/.exec(String(ref || ''))?.[1]
  if (!letters) return -1
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

function firstSheetPath(buf, entries) {
  const wb = readPart(buf, entries, 'xl/workbook.xml')
  const rels = readPart(buf, entries, 'xl/_rels/workbook.xml.rels')
  const sheetTag = wb && /<sheet\b[^>]*>/.exec(wb)?.[0]
  const rid = sheetTag && (attr(sheetTag, 'r:id') || attr(sheetTag, 'id'))
  if (rid && rels) {
    for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
      if (attr(m[0], 'Id') !== rid) continue
      const target = String(attr(m[0], 'Target') || '')
      const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`
      if (entries.has(path)) return path
    }
  }
  if (entries.has('xl/worksheets/sheet1.xml')) return 'xl/worksheets/sheet1.xml'
  const any = [...entries.keys()].find(k => /^xl\/worksheets\/[^/]+\.xml$/.test(k))
  if (any) return any
  throw new SheetReadError('no_sheet', 'That workbook has no sheet to read.')
}

/** Rows of the workbook's first sheet, as arrays of strings (ragged; normalized by the caller). */
export function readXlsxGrid(buf) {
  const entries = readZipEntries(buf)
  const strings = sharedStrings(readPart(buf, entries, 'xl/sharedStrings.xml'))
  const isDate = dateStyles(readPart(buf, entries, 'xl/styles.xml'))
  const xml = readPart(buf, entries, firstSheetPath(buf, entries))
  const data = /<sheetData\b[^>]*>([\s\S]*)<\/sheetData>/.exec(xml || '')?.[1] || ''
  const grid = []
  for (const rm of data.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g)) {
    if (grid.length > MAX_ROWS) break
    const rTag = `<row${rm[1] || rm[3] || ''}>`
    const rNum = Number(attr(rTag, 'r'))
    const rowIdx = Number.isFinite(rNum) && rNum > 0 ? rNum - 1 : grid.length
    if (rowIdx > MAX_ROWS) break
    const row = []
    let next = 0
    for (const cm of (rm[2] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const cTag = `<c${cm[1]}>`
      const ref = attr(cTag, 'r')
      const ci = ref ? colIndex(ref) : next
      next = ci + 1
      if (ci < 0 || ci >= MAX_COLS) continue
      const body = cm[2] || ''
      const t = attr(cTag, 't')
      const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1]
      let value = ''
      if (t === 's') value = strings[Number(v)] ?? ''
      else if (t === 'inlineStr') value = textOf(/<is\b[^>]*>([\s\S]*?)<\/is>/.exec(body)?.[1] || '')
      else if (t === 'b') value = v === '1' ? 'TRUE' : v === '0' ? 'FALSE' : ''
      else if (t === 'str' || t === 'e') value = v != null ? decodeXml(v) : ''
      else if (v != null) {
        const s = Number(attr(cTag, 's'))
        value = Number.isFinite(s) && isDate[s] ? serialToIso(decodeXml(v)) : decodeXml(v)
      }
      row[ci] = value
    }
    grid[rowIdx] = row
  }
  return grid
}

// ── csv ────────────────────────────────────────────────────────────────────────

/** RFC 4180 CSV, quoted fields and newlines inside quotes included. A BOM is dropped. */
export function readCsvGrid(text) {
  const s = String(text || '').replace(/^\uFEFF/, '')
  const grid = []
  let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++ } else quoted = false
      } else field += ch
      continue
    }
    if (ch === '"' && field === '') quoted = true
    else if (ch === ',') { row.push(field); field = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++
      row.push(field); grid.push(row); row = []; field = ''
      if (grid.length > MAX_ROWS + 1) break
    } else field += ch
  }
  if (field !== '' || row.length) { row.push(field); grid.push(row) }
  return grid.map(r => r.slice(0, MAX_COLS))
}

// ── one shape ─────────────────────────────────────────────────────────────────

const clean = v => String(v ?? '').replace(/\u00a0/g, ' ').trim()

/** The header row is the first row with any text; rows after it that are wholly blank are dropped. */
export function gridToSheet(grid) {
  const rows = (grid || []).map(r => Array.from({ length: Math.min(MAX_COLS, (r || []).length) }, (_, i) => clean(r?.[i])))
  const headAt = rows.findIndex(r => r.some(Boolean))
  if (headAt < 0) return { headers: [], rows: [], truncated: false }
  let headers = rows[headAt]
  while (headers.length && !headers[headers.length - 1]) headers = headers.slice(0, -1)
  // Blank or repeated headers get a name of their own, so every column can be addressed.
  const seen = new Map()
  headers = headers.map((h, i) => {
    const base = h || `Column ${i + 1}`
    const n = (seen.get(base) || 0) + 1
    seen.set(base, n)
    return n === 1 ? base : `${base} (${n})`
  })
  const body = rows.slice(headAt + 1).map(r => headers.map((_, i) => r[i] || '')).filter(r => r.some(Boolean))
  return { headers, rows: body.slice(0, MAX_ROWS), truncated: body.length > MAX_ROWS }
}

/** Read an upload. `name` decides the format; an .xlsx is also recognised by its zip signature. */
export function readSheet(buf, name = '') {
  const lower = String(name).toLowerCase()
  const zip = buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50
  if (zip || lower.endsWith('.xlsx')) return gridToSheet(readXlsxGrid(buf))
  if (lower.endsWith('.xls')) throw new SheetReadError('old_excel', 'That is an older .xls file. Save it as .xlsx or CSV and try again.')
  if (lower.endsWith('.csv') || lower.endsWith('.txt') || !lower.includes('.')) return gridToSheet(readCsvGrid(buf.toString('utf8')))
  throw new SheetReadError('unsupported', 'Choose an Excel workbook (.xlsx) or a CSV file.')
}
