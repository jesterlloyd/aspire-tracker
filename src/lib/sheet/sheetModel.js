// src/lib/sheet/sheetModel.js
//
// BUDGET-SHEET-0a (2026-09-27): the rules of the Editable sheet, moved out of the forms model
// unchanged so a second sheet (Program Budget's expense ledger) can read them without reading
// forms. Pure and tested without a browser. src/lib/forms/formModel.js re-exports every name
// here, so the Forms Sheet, its server and its tests import exactly what they did before.
//
// Table canon section 1: an Editable sheet is not a DataSheet. It keeps gridlines, row
// numbers and cell editing, and it never takes tractor holes or paired bands.

// FORM-OTHER-1 (2026-09-24, Owner): a choice, checkbox or dropdown question can offer "Other"
// with a text box. Its answer is stored as the text "Other: <what they typed>", so every
// reader (PDF, CSV, Sheet, viewer) shows it as written with no special case.
export const OTHER_PREFIX = 'Other: '
export const isOtherValue = (v) => typeof v === 'string' && /^Other:/.test(v)
export const otherText = (v) => String(v || '').replace(/^Other:\s*/, '')
export const otherValue = (text) => `${OTHER_PREFIX}${String(text || '')}`

/** Does a Sheet cell match a filter value? A choice matches its option; "Other" matches any Other answer. */
export function cellMatches(column, cell, value) {
  if (!value) return true
  const text = String(cell || '')
  if (column?.options) {
    const parts = column.type === 'checkboxes' ? text.split('; ') : [text]
    return value === 'Other' ? parts.some(isOtherValue) : parts.includes(value)
  }
  return text.toLowerCase().includes(String(value).toLowerCase())
}

// Fills and inks are fixed PAIRS (a literal ink beside a literal background), so a formatted
// cell reads the same in light and dark mode. Every ink passes 4.5:1 on every fill and on
// white; test/formSheet.test.mjs measures all of them.
export const SHEET_FILLS = Object.freeze([
  { key: 'yellow', label: 'Yellow', hex: '#FFF4C2' }, { key: 'orange', label: 'Orange', hex: '#FDE9D4' },
  { key: 'red', label: 'Red', hex: '#FBE2E2' }, { key: 'purple', label: 'Purple', hex: '#EDE3FB' },
  { key: 'blue', label: 'Blue', hex: '#DCEBFB' }, { key: 'green', label: 'Green', hex: '#DDF3E4' },
  { key: 'gray', label: 'Gray', hex: '#ECEDEF' },
])
export const SHEET_INKS = Object.freeze([
  { key: 'navy', label: 'Navy', hex: '#1D2567' }, { key: 'red', label: 'Red', hex: '#A32A32' },
  { key: 'green', label: 'Green', hex: '#0E6B43' }, { key: 'orange', label: 'Orange', hex: '#8A4B0F' },
  { key: 'purple', label: 'Purple', hex: '#5B3A8C' }, { key: 'gray', label: 'Gray', hex: '#4A5063' },
])
export const SHEET_DEFAULT_INK = '#1B2033'   // the ink on a filled cell with no ink chosen
export const SHEET_STAFF_TYPES = Object.freeze([
  { key: 'text', label: 'Text' }, { key: 'number', label: 'Number' }, { key: 'check', label: 'Checkbox' }, { key: 'choice', label: 'Dropdown' }, { key: 'date', label: 'Date' },
])

const inList = (list, key) => list.some(x => x.key === key)

/** One cell's format, cleaned: only known keys, only palette colours. Null when nothing is set. */
export function cleanFormat(f) {
  if (!f || typeof f !== 'object') return null
  const out = {}
  for (const k of ['b', 'i', 'u', 'wrap']) if (f[k] === true) out[k] = true
  if (inList(SHEET_FILLS, f.fill)) out.fill = f.fill
  if (inList(SHEET_INKS, f.ink)) out.ink = f.ink
  if (['left', 'center', 'right'].includes(f.align)) out.align = f.align
  // FORM-SHEET-3: number and date formats, like Smartsheet's $, %, .0 and date buttons.
  if (NUMBER_FORMATS.some(n => n.key === f.num)) out.num = f.num
  if (Number.isInteger(f.dec) && f.dec >= 0 && f.dec <= 4) out.dec = f.dec
  if (f.comma === true) out.comma = true
  if (DATE_FORMATS.some(d => d.key === f.date)) out.date = f.date
  return Object.keys(out).length ? out : null
}

// ── Number, date and summary formats (FORM-SHEET-3, Owner, 2026-09-24) ─────────────────
// A format changes how a value LOOKS in the Sheet and in Excel, never the stored answer.
export const NUMBER_FORMATS = Object.freeze([
  { key: 'number', label: 'Number' }, { key: 'currency', label: 'Currency ($)' }, { key: 'percent', label: 'Percent (%)' },
])
export const DATE_FORMATS = Object.freeze([
  { key: 'mdy', label: '09/24/2026', excel: 'mm/dd/yyyy' }, { key: 'iso', label: '2026-09-24', excel: 'yyyy-mm-dd' },
  { key: 'short', label: 'Sep 24, 2026', excel: 'mmm d, yyyy' }, { key: 'long', label: 'Thursday, September 24, 2026', excel: 'dddd, mmmm d, yyyy' },
])
export const SUMMARY_FNS = Object.freeze([
  { key: 'sum', label: 'Sum' }, { key: 'avg', label: 'Average' }, { key: 'min', label: 'Min' }, { key: 'max', label: 'Max' },
  { key: 'count', label: 'Count' }, { key: 'counta', label: 'Count filled' },
])

/** A number out of display text: "$1,250.50" -> 1250.5, "25%" -> 0.25, "" or text -> null. */
export function parseNumber(text) {
  const t = String(text ?? '').trim()
  if (!t) return null
  const pct = t.endsWith('%')
  const n = Number(t.replace(/[$,%\s]/g, ''))
  if (!Number.isFinite(n) || !/\d/.test(t) || /[a-z]/i.test(t.replace(/e[+-]?\d+$/i, ''))) return null
  return pct ? n / 100 : n
}
/** A date out of display text: "09/24/2026" or "2026-09-24" -> { y, m, d }, else null. */
export function parseDate(text) {
  const t = String(text ?? '').trim()
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t)
  if (m) return { y: +m[1], m: +m[2], d: +m[3] }
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t)
  return m ? { y: +m[3], m: +m[1], d: +m[2] } : null
}

export function formatNumber(n, f = {}) {
  const dec = Number.isInteger(f.dec) ? f.dec : (f.num === 'currency' ? 2 : f.num === 'percent' ? 0 : undefined)
  const opts = { useGrouping: f.comma === true || f.num === 'currency', ...(dec != null ? { minimumFractionDigits: dec, maximumFractionDigits: dec } : { maximumFractionDigits: 6 }) }
  if (f.num === 'currency') return new Intl.NumberFormat('en-US', { ...opts, style: 'currency', currency: 'USD' }).format(n)
  if (f.num === 'percent') return new Intl.NumberFormat('en-US', { ...opts, style: 'percent' }).format(n)
  return new Intl.NumberFormat('en-US', opts).format(n)
}

/** A cell's text as its format shows it. Text that is not a number or a date is left alone. */
export function displayValue(text, f) {
  if (!f || text == null || text === '') return text ?? ''
  if (f.date) {
    const d = parseDate(text)
    if (d) {
      const js = new Date(Date.UTC(d.y, d.m - 1, d.d, 12))
      if (f.date === 'iso') return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`
      if (f.date === 'short') return js.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' })
      if (f.date === 'long') return js.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
      return `${String(d.m).padStart(2, '0')}/${String(d.d).padStart(2, '0')}/${d.y}`
    }
  }
  if (f.num || Number.isInteger(f.dec) || f.comma) {
    const n = parseNumber(text)
    if (n != null) return formatNumber(n, f)
  }
  return text
}

/** A column summary over the shown rows, like Smartsheet's summary row. Null when nothing counts. */
export function summarize(values, fn) {
  if (fn === 'counta') return values.filter(v => String(v ?? '').trim() !== '').length
  const nums = values.map(parseNumber).filter(n => n != null)
  if (fn === 'count') return nums.length
  if (!nums.length) return null
  if (fn === 'sum') return nums.reduce((a, b) => a + b, 0)
  if (fn === 'avg') return nums.reduce((a, b) => a + b, 0) / nums.length
  if (fn === 'min') return Math.min(...nums)
  if (fn === 'max') return Math.max(...nums)
  return null
}

/** A column's format under a cell's own: the cell wins for every key it sets. */
export const mergeFormat = (col, cell) => (col || cell ? { ...(col || {}), ...(cell || {}) } : null)

/** Rows grouped by one column's text, in first-appearance order, like Smartsheet's group rows. */
export function groupSheetRows(rows, key, valueOf) {
  const groups = new Map()
  for (const r of rows) {
    const v = String(valueOf(r, key) || '').trim() || '(blank)'
    if (!groups.has(v)) groups.set(v, [])
    groups.get(v).push(r)
  }
  return [...groups].map(([label, list]) => ({ label, rows: list }))
}
