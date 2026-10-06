// src/lib/ngrp/applicantPacketPdf.js
//
// APPLICANT-PACKET-1: draws the packet applicantPacketModel.js describes, in the browser, with
// the pdf-lib the Forms PDFs already use and the same text helpers (src/lib/pdf/pdfText.js).
// Built in the browser on purpose: the files never leave the private bucket except to the
// person who could already open each one, nothing is copied into storage, and a large
// transcript does not run into a serverless response limit.
//
// Order: the summary (with an "In This Packet" list giving each part's pages), the Transition
// Form when there is one, then each document's own pages in the checklist's order. A PDF is
// copied page for page; a JPEG or PNG gets a page of its own, scaled to fit. A file that cannot
// be read (damaged, password protected) is named in the list instead of failing the packet.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { safe, wrap } from '../pdf/pdfText.js'

const W = 612, H = 792, M = 54
const INK = rgb(0.11, 0.13, 0.19), MUTED = rgb(0.33, 0.36, 0.42), RULE = rgb(0.85, 0.86, 0.89), NAVY = rgb(0.11, 0.15, 0.4)
const LABEL_W = 150

/**
 * @param summary packetSummary(...)
 * @param files   Map versionId -> Uint8Array, for every document whose status is 'include'
 * @returns Uint8Array
 */
export async function buildApplicantPacket({ summary, files = new Map() }) {
  const doc = await PDFDocument.create()
  doc.setTitle(safe(`${summary.title}: ${summary.name}`))
  doc.setCreator('ASPIRE Intelligence')
  const regular = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const own = new Set() // pages this module drew, which carry its footer

  let page, y
  const newPage = () => { page = doc.addPage([W, H]); own.add(page); y = H - M }
  const need = (h) => { if (y - h < M + 24) newPage() }
  const text = (s, { font = regular, size = 11, color = INK, x = M, width = W - 2 * M, gap = 3 } = {}) => {
    for (const line of wrap(s, font, size, width)) {
      need(size + gap)
      page.drawText(line, { x, y: y - size, size, font, color })
      y -= size + gap
    }
  }
  const rule = () => { need(14); page.drawLine({ start: { x: M, y: y - 4 }, end: { x: W - M, y: y - 4 }, thickness: 0.8, color: RULE }); y -= 14 }
  const heading = (s) => { y -= 8; need(40); text(s, { font: bold, size: 12.5, color: NAVY }); y -= 2 }
  // A label beside a wrapped value, the value's lines decide the row's height.
  // A long label wraps in its own column rather than running into the value.
  const pair = (label, value) => {
    const labels = wrap(label, regular, 9.5, LABEL_W - 12)
    const lines = wrap(value, regular, 10.5, W - 2 * M - LABEL_W)
    const rows = Math.max(1, lines.length, labels.length)
    need(13.5 * rows + 3)
    labels.forEach((l, i) => page.drawText(l, { x: M, y: y - 10.5 - i * 13.5, size: 9.5, font: regular, color: MUTED }))
    lines.forEach((l, i) => page.drawText(l, { x: M + LABEL_W, y: y - 10.5 - i * 13.5, size: 10.5, font: regular, color: INK }))
    y -= 13.5 * rows + 3
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  newPage()
  text('ASPIRE Intelligence · Cedars-Sinai', { font: bold, size: 9, color: NAVY })
  y -= 4
  text(summary.title, { size: 11, color: MUTED })
  text(summary.name, { font: bold, size: 20, gap: 6 })
  text(summary.generated, { size: 9.5, color: MUTED })
  rule()
  for (const sec of summary.sections) {
    heading(sec.heading)
    if (!sec.rows.length) { text(sec.empty || 'Nothing recorded.', { size: 10, color: MUTED }); continue }
    for (const [l, v] of sec.rows) pair(l, v)
  }

  // "In This Packet": the page numbers are written in once every part is placed.
  heading('In This Packet')
  const entries = [{ name: 'Summary', note: '' }]
  if (summary.form) entries.push({ name: summary.form.heading, note: '' })
  summary.documents.forEach((d, j) => entries.push({ name: d.name, docIndex: j }))
  const slots = entries.map((e) => {
    need(16)
    page.drawText(safe(e.name), { x: M, y: y - 10.5, size: 10.5, font: regular, color: INK })
    const slot = { page, y: y - 10.5 }
    y -= 16
    return slot
  })
  const ranges = [[1, doc.getPageCount()]]

  // ── Transition Form ──────────────────────────────────────────────────────
  if (summary.form) {
    newPage()
    const first = doc.getPageCount()
    text(summary.name, { size: 9.5, color: MUTED })
    text(summary.form.heading, { font: bold, size: 16, gap: 5 })
    if (summary.form.sub) text(summary.form.sub, { size: 9.5, color: MUTED })
    rule()
    for (const [l, v] of summary.form.rows) pair(l, v)
    ranges.push([first, doc.getPageCount()])
  }

  // ── Documents ────────────────────────────────────────────────────────────
  const notes = []
  for (const d of summary.documents) {
    if (d.status !== 'include') {
      notes.push(d.status === 'word' ? 'Word file, not included: open it in Documents' : d.required ? 'Not on file' : 'Not on file (optional)')
      ranges.push(null)
      continue
    }
    const bytes = files.get(d.versionId)
    const first = doc.getPageCount() + 1
    try {
      if (!bytes) throw new Error('missing')
      if (d.kind === 'pdf') {
        const src = await PDFDocument.load(bytes, { ignoreEncryption: true })
        const pages = await doc.copyPages(src, src.getPageIndices())
        pages.forEach(p => doc.addPage(p))
      } else {
        const img = d.contentType === 'image/png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes)
        const p = doc.addPage([W, H])
        own.add(p)
        p.drawText(safe(d.name), { x: M, y: H - M - 11, size: 11, font: bold, color: INK })
        const scale = Math.min((W - 2 * M) / img.width, (H - 2 * M - 40) / img.height, 1)
        const w = img.width * scale, h = img.height * scale
        p.drawImage(img, { x: (W - w) / 2, y: H - M - 30 - h, width: w, height: h })
      }
      notes.push('')
      ranges.push([first, doc.getPageCount()])
    } catch {
      notes.push('Could not be added: open it in Documents')
      ranges.push(null)
    }
  }

  // Page numbers into the list, then a footer on the pages this module drew.
  const pageWord = (r) => (r[0] === r[1] ? `page ${r[0]}` : `pages ${r[0]}-${r[1]}`)
  entries.forEach((e, i) => {
    const r = ranges[i]
    const docNote = e.docIndex !== undefined ? notes[e.docIndex] : ''
    const right = r ? pageWord(r) : docNote
    const size = r ? 10.5 : 9.5
    const w = regular.widthOfTextAtSize(safe(right), size)
    slots[i].page.drawText(safe(right), { x: W - M - w, y: slots[i].y, size, font: regular, color: r ? INK : MUTED })
  })
  const total = doc.getPageCount()
  doc.getPages().forEach((p, i) => {
    if (!own.has(p)) return
    p.drawText(safe(`${summary.title} · ${summary.name} · page ${i + 1} of ${total}`), { x: M, y: 30, size: 8, font: regular, color: MUTED })
  })
  return doc.save()
}
