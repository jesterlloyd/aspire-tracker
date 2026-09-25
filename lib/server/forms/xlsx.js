// lib/server/forms/xlsx.js
//
// FORM-SHEET-1 (2026-09-24): an Excel workbook of the Sheet, exactly as the person filtered and
// sorted it. A real .xlsx (Office Open XML in a ZIP), one worksheet, a bold frozen header row
// and sensible column widths; every cell is an inline STRING, so nothing in an answer can run
// as a formula. Built on the ZIP writer the signed-copies download already uses, so no
// dependency is added.
//
// FORM-SHEET-2: the Sheet's formatting travels. A cell may be { v, f } where f is
// { b, i, u, wrap, align, fill, ink } with fill and ink as hex; widths come from the layout; a
// group row ({ group: 'CSULB', count: 8 }) is a bold shaded row with its members outlined one
// level under it, like Smartsheet's group rows, so Excel can collapse them.

import { Buffer } from 'node:buffer'
import { zipStored } from '../signatures/zip.js'

// XML 1.0 forbids most control characters; a stray one would make Excel refuse the file.
// eslint-disable-next-line no-control-regex -- intentional: strip characters XML cannot hold
const XML_BAD = /[\x00-\x08\x0B\x0C\x0E-\x1F￾￿]/g
const esc = (v) => String(v ?? '').replace(XML_BAD, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const colName = (i) => { let n = i + 1, s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26) } return s }
const argb = (hex) => `FF${String(hex || '').replace('#', '').toUpperCase()}`

// Styles are made on demand: one font, fill and cell format per distinct combination.
function styleBook() {
  const fonts = ['<font><sz val="11"/><name val="Calibri"/></font>', '<font><b/><sz val="11"/><name val="Calibri"/></font>']
  const fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>', `<fill><patternFill patternType="solid"><fgColor rgb="${argb('#EDF1FA')}"/><bgColor indexed="64"/></patternFill></fill>`, `<fill><patternFill patternType="solid"><fgColor rgb="${argb('#E6E8EE')}"/><bgColor indexed="64"/></patternFill></fill>`]
  const xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>', '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>', '<xf numFmtId="0" fontId="1" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/>']
  const seen = new Map()
  const numFmts = []   // FORM-SHEET-3: custom number formats, ids from 164 as Excel requires
  const index = (list, xml) => { let i = list.indexOf(xml); if (i < 0) { list.push(xml); i = list.length - 1 } return i }
  return {
    HEADER: 1, GROUP: 2,
    of(f) {
      if (!f) return 0
      const key = JSON.stringify(f)
      if (seen.has(key)) return seen.get(key)
      const font = `<font>${f.b ? '<b/>' : ''}${f.i ? '<i/>' : ''}${f.u ? '<u/>' : ''}<sz val="11"/>${f.ink ? `<color rgb="${argb(f.ink)}"/>` : ''}<name val="Calibri"/></font>`
      const fontId = index(fonts, font)
      const fillId = f.fill ? index(fills, `<fill><patternFill patternType="solid"><fgColor rgb="${argb(f.fill)}"/><bgColor indexed="64"/></patternFill></fill>`) : 0
      const align = f.align || f.wrap ? `<alignment${f.align ? ` horizontal="${f.align}"` : ''}${f.wrap ? ' wrapText="1"' : ''} vertical="top"/>` : ''
      const nf = f.nf ? 164 + index(numFmts, f.nf) : 0
      const xf = `<xf numFmtId="${nf}" fontId="${fontId}" fillId="${fillId}" borderId="0" xfId="0" applyFont="1"${nf ? ' applyNumberFormat="1"' : ''}${fillId ? ' applyFill="1"' : ''}${align ? ' applyAlignment="1"' : ''}>${align}</xf>`
      const id = index(xfs, xf)
      seen.set(key, id)
      return id
    },
    xml: () => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${numFmts.length ? `<numFmts count="${numFmts.length}">${numFmts.map((c, i) => `<numFmt numFmtId="${164 + i}" formatCode="${esc(c)}"/>`).join('')}</numFmts>` : ''}<fonts count="${fonts.length}">${fonts.join('')}</fonts><fills count="${fills.length}">${fills.join('')}</fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs></styleSheet>`,
  }
}

/**
 * header: string[]; rows: (string | { v, f })[][] or { group, count }; widths: number[] (pixels,
 * optional). Returns the .xlsx bytes.
 */
export const colLetter = (i) => colName(i)
export function xlsxFor({ sheetName = 'Responses', header, rows, widths: pxWidths = [] }) {
  const book = styleBook()
  const text = (c) => (c && typeof c === 'object' ? ('v' in c ? c.v : (typeof c.n === 'number' ? String(c.n) : '')) : c)
  const dataRows = rows.filter(r => Array.isArray(r))
  const widths = header.map((h, c) => pxWidths[c]
    ? Math.min(90, Math.max(8, Math.round(pxWidths[c] / 7)))
    : Math.min(60, Math.max(10, String(h).length + 2, ...dataRows.slice(0, 500).map(r => String(text(r[c]) ?? '').length + 2))))
  // A cell is text (inline string: nothing in an answer can run as a formula), a number we
  // wrote (FORM-SHEET-3: a formatted or summed column), a formula WE wrote (the summary row), or
  // empty, which Excel's COUNTA and SUM then skip.
  const cell = (r, c, v, style) => {
    const at = `r="${colName(c)}${r}"${style ? ` s="${style}"` : ''}`
    if (v && typeof v === 'object' && typeof v.formula === 'string') return `<c ${at}><f>${esc(v.formula)}</f>${typeof v.n === 'number' ? `<v>${v.n}</v>` : ''}</c>`
    if (v && typeof v === 'object' && typeof v.n === 'number' && Number.isFinite(v.n)) return `<c ${at}><v>${v.n}</v></c>`
    const t = text(v)
    if (t == null || t === '') return `<c ${at}/>`
    return `<c ${at} t="inlineStr"><is><t xml:space="preserve">${esc(t)}</t></is></c>`
  }
  const grouped = rows.some(r => !Array.isArray(r))
  const out = [`<row r="1">${header.map((h, c) => cell(1, c, h, book.HEADER)).join('')}</row>`]
  rows.forEach((row, i) => {
    const r = i + 2
    if (!Array.isArray(row)) { out.push(`<row r="${r}">${cell(r, 0, `${row.group} (${row.count})`, book.GROUP)}${header.slice(1).map((_, c) => cell(r, c + 1, '', book.GROUP)).join('')}</row>`); return }
    out.push(`<row r="${r}"${grouped && !row.summary ? ' outlineLevel="1"' : ''}>${row.map((v, c) => cell(r, c, v, book.of(v && typeof v === 'object' ? v.f : null))).join('')}</row>`)
  })
  const last = rows.length + 1 - (rows.at(-1)?.summary ? 1 : 0)   // the filter stops above a summary row
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${grouped ? '<sheetPr><outlinePr summaryBelow="0"/></sheetPr>' : ''}<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" xSplit="1" topLeftCell="B2" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>${grouped ? '<sheetFormatPr defaultRowHeight="15" outlineLevelRow="1"/>' : ''}<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${out.join('')}</sheetData>${rows.length && !grouped ? `<autoFilter ref="A1:${colName(header.length - 1)}${last}"/>` : ''}</worksheet>`
  const name = esc(String(sheetName).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Responses')
  const files = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets>${rows.length && !grouped ? `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${name.replace(/'/g, "''")}'!$A$1:$${colName(header.length - 1)}$${last}</definedName></definedNames>` : ''}</workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'xl/worksheets/sheet1.xml': sheet,
  }
  files['xl/styles.xml'] = book.xml()   // after the sheet, which registers every style it uses
  return zipStored(Object.entries(files).map(([n, x]) => ({ name: n, data: Buffer.from(x, 'utf8') })), new Date(), { keepPaths: true })
}
