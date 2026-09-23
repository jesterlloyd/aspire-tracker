// lib/server/signatures/sealing.js
//
// SIGNATURES-PHASE2: the sealing service. When the last signer finishes, the document is
//   1. flattened: every field value drawn onto its page (fields are page-percent boxes),
//      and any AcroForm in the source flattened, so nothing stays editable;
//   2. content-timestamped: the SHA-256 of those flattened pages is sent to the RFC 3161
//      authority in sig_settings, and the token's time and serial are PRINTED on
//   3. the certificate of completion and the event log, appended as the last pages;
//   4. sealed: a CMS signature from the settings' seal provider, itself timestamped by
//      the same authority (the time Adobe shows on the seal).
// A file cannot contain its own seal's timestamp, which is why step 2 exists: the
// certificate page carries a real trusted time over the signed content, and the seal
// carries one over the signature.
//
// SealingService is the interface the engine calls. A Cedars-Sinai-approved vendor could
// replace it (brief section 9) by implementing seal() with the same input and output.

import { createHash } from 'node:crypto'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { SignPdf } from '@signpdf/signpdf'
import { pdflibAddPlaceholder } from '@signpdf/placeholder-pdf-lib'
import { AspireCmsSigner } from './cmsSigner.js'
import { requestTimestamp } from './timestamp.js'
import { sealProviderFor } from './sealProvider.js'
import { formatInZone, documentTypeLabel } from '../../../src/lib/signatures/sigModel.js'

const sha256Hex = (b) => createHash('sha256').update(b).digest('hex')
const INK = rgb(0.10, 0.12, 0.25)
const MUTED = rgb(0.35, 0.37, 0.45)
const RULE = rgb(0.85, 0.86, 0.9)

// Standard fonts cannot draw every character; anything outside WinAnsi becomes '?'.
const winAnsi = (s) => String(s ?? '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
  .replace(/[–—]/g, '-').replace(/•/g, '*').replace(/[^\x20-\x7E\xA0-\xFF]/g, '?')

function wrap(text, font, size, width) {
  const words = winAnsi(text).split(/\s+/)
  const lines = []
  let line = ''
  for (const w of words) {
    const next = line ? `${line} ${w}` : w
    if (font.widthOfTextAtSize(next, size) > width && line) { lines.push(line); line = w } else line = next
  }
  if (line) lines.push(line)
  return lines
}

// ── 1. Flatten ──────────────────────────────────────────────────────────────────────

export async function flattenDocument({ documentBytes, fields, values, signersByRole }) {
  const doc = await PDFDocument.load(documentBytes, { updateMetadata: false })
  try { doc.getForm().flatten() } catch { /* no AcroForm */ }
  const pages = doc.getPages()
  const helv = await doc.embedFont(StandardFonts.Helvetica)
  const script = await doc.embedFont(StandardFonts.TimesRomanBoldItalic)

  for (const f of fields) {
    const page = pages[(f.page || 1) - 1]
    if (!page) continue
    const { width: W, height: H } = page.getSize()
    const x = (f.x / 100) * W, w = (f.w / 100) * W, h = (f.h / 100) * H
    const yTop = H - (f.y / 100) * H, y = yTop - h
    if (f.type === 'radio') {
      const selected = values[f.group] === f.id
      const r = Math.min(w, h) / 2
      page.drawCircle({ x: x + w / 2, y: y + h / 2, size: r, borderColor: INK, borderWidth: 0.8 })
      if (selected) page.drawCircle({ x: x + w / 2, y: y + h / 2, size: r * 0.55, color: INK })
      if (f.option) page.drawText(winAnsi(f.option), { x: x + w + 3, y: y + h / 2 - 3.5, size: 8, font: helv, color: INK })
      continue
    }
    const v = values[f.id]
    if (v == null || v === '') continue
    if (f.type === 'check') {
      page.drawRectangle({ x, y, width: w, height: h, borderColor: INK, borderWidth: 0.8 })
      if (v === true || v === 'true' || v === '✓' || v === 'on') {
        page.drawLine({ start: { x: x + w * 0.2, y: y + h * 0.5 }, end: { x: x + w * 0.42, y: y + h * 0.22 }, thickness: 1.4, color: INK })
        page.drawLine({ start: { x: x + w * 0.42, y: y + h * 0.22 }, end: { x: x + w * 0.82, y: y + h * 0.8 }, thickness: 1.4, color: INK })
      }
      continue
    }
    if (f.type === 'sig' || f.type === 'ini') {
      const signer = signersByRole[f.role]
      const adopted = signer?.adopted_signature
      if (adopted?.kind === 'draw' && adopted.path && f.type === 'sig') {
        // The stroke path is in a 0..100 x 0..30 box; scale it into the field.
        const sx = w / 100, sy = h / 30
        page.drawSvgPath(adopted.path, { x, y: yTop, scale: Math.min(sx, sy), borderColor: INK, borderWidth: 1.4 / Math.min(sx, sy) })
      } else {
        const text = winAnsi(String(v))
        let size = Math.min(h * 0.72, 22)
        while (size > 6 && script.widthOfTextAtSize(text, size) > w) size -= 0.5
        page.drawText(text, { x: x + 1, y: y + (h - size) / 2 + size * 0.2, size, font: script, color: INK })
      }
      continue
    }
    const text = winAnsi(String(v))
    let size = Math.min(h * 0.62, 11)
    while (size > 5 && helv.widthOfTextAtSize(text, size) > w - 2) size -= 0.25
    page.drawText(text, { x: x + 1, y: y + (h - size) / 2 + size * 0.15, size, font: helv, color: INK })
  }
  return doc
}

// ── 3. Certificate of completion and event log ─────────────────────────────────────

export async function appendCertificate(doc, { request, signers, events, timeZone, contentTimestamp, originalSha256, contentSha256, orgName, sealProviderLabel }) {
  const helv = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const script = await doc.embedFont(StandardFonts.TimesRomanBoldItalic)
  const mono = await doc.embedFont(StandardFonts.Courier)
  const M = 54, W = 612, H = 792, CW = W - 2 * M
  let page = doc.addPage([W, H])
  let y = H - M
  const ensure = (need) => { if (y - need < M) { page = doc.addPage([W, H]); y = H - M } }
  const line = (text, { font = helv, size = 9.5, color = INK, gap = 3, indent = 0 } = {}) => {
    for (const l of wrap(text, font, size, CW - indent)) { ensure(size + gap); page.drawText(l, { x: M + indent, y: y - size, size, font, color }); y -= size + gap }
  }
  const kv = (k, v, { monoValue = false } = {}) => {
    ensure(14)
    page.drawText(winAnsi(k), { x: M, y: y - 9, size: 8.5, font: helv, color: MUTED })
    const lines = wrap(v, monoValue ? mono : helv, monoValue ? 8 : 9.5, CW - 150)
    lines.forEach((l, i) => page.drawText(l, { x: M + 150, y: y - 9 - i * 12, size: monoValue ? 8 : 9.5, font: monoValue ? mono : helv, color: INK }))
    y -= Math.max(1, lines.length) * 12 + 3
  }
  const rule = () => { ensure(10); page.drawLine({ start: { x: M, y: y - 4 }, end: { x: W - M, y: y - 4 }, thickness: 0.6, color: RULE }); y -= 12 }
  const when = (iso) => iso ? formatInZone(iso, timeZone, true) : 'n/a'

  line('CERTIFICATE OF COMPLETION', { font: bold, size: 8.5, color: MUTED, gap: 6 })
  line(request.title, { font: bold, size: 17, gap: 8 })
  kv('Envelope', request.envelope_code)
  kv('Document type', documentTypeLabel(request.document_type))
  kv('Sent by', `${request.sender_name || ''}${request.sender_email ? ` <${request.sender_email}>` : ''}, ${when(request.sent_at)}`)
  kv('Completed', when(request.completed_at))
  kv('Organization', orgName || '')
  kv('Original upload (SHA-256)', originalSha256 || '', { monoValue: true })
  kv('Signed pages (SHA-256)', contentSha256 || '', { monoValue: true })
  if (contentTimestamp) {
    kv('Trusted timestamp', `${when(contentTimestamp.gen_time)} (RFC 3161, ${contentTimestamp.tsa_name || contentTimestamp.tsa_url}, serial ${contentTimestamp.serial}) over the signed pages above`)
  }
  kv('Seal', `Digitally sealed by ${sealProviderLabel || 'ASPIRE Intelligence'}. The seal carries its own RFC 3161 timestamp. Any change to this file after sealing makes the seal show as invalid in a PDF reader.`)
  rule()

  const signerPeople = signers.filter(s => s.recipient_type !== 'cc' && s.status !== 'replaced').sort((a, b) => a.order_index - b.order_index)
  for (const s of signerPeople) {
    const ev = (type) => events.find(e => e.signer_id === s.id && e.type === type)
    const signedEv = ev('signed')
    ensure(120)
    line(`${s.order_index}. ${s.name}`, { font: bold, size: 11.5, gap: 2 })
    line(`${s.email}${s.recipient_type === 'viewer' ? ' (needed to view)' : ''}`, { size: 9, color: MUTED, gap: 6 })
    kv('Identity check', s.verify_method === 'password' ? 'ASPIRE account, password re-entered' : `Unique emailed link + 6-digit one-time code sent to ${s.code_sent_to || 'email'}`)
    kv('Consent', s.consented_at ? `Accepted, disclosure v${s.consent_version}, ${when(s.consented_at)}; sample PDF opened ${when(s.sample_pdf_opened_at)}` : (s.verify_method === 'password' ? 'Staff signer in the app' : 'n/a'))
    if (s.recipient_type === 'viewer') kv('Viewed', when(s.opened_at))
    else kv('Signed', when(s.signed_at))
    kv('IP address and device', signedEv ? `${signedEv.ip || 'unknown'} · ${summarizeAgent(signedEv.user_agent)}` : 'n/a')
    if (s.recipient_type === 'signer' && s.adopted_signature) {
      ensure(40)
      page.drawText('Signature', { x: M, y: y - 9, size: 8.5, font: helv, color: MUTED })
      if (s.adopted_signature.kind === 'draw' && s.adopted_signature.path) {
        page.drawSvgPath(s.adopted_signature.path, { x: M + 150, y: y + 2, scale: 1.6, borderColor: INK, borderWidth: 0.9 })
      } else {
        page.drawText(winAnsi(s.adopted_signature.text || s.name), { x: M + 150, y: y - 22, size: 20, font: script, color: INK })
      }
      y -= 42
      kv('Adopted as', s.adopted_signature.kind === 'draw' ? 'Drawn signature' : 'Typed signature')
    }
    rule()
  }

  // Event log.
  page = doc.addPage([W, H]); y = H - M
  line('EVENT LOG', { font: bold, size: 8.5, color: MUTED, gap: 6 })
  line(`Every event, in order. Times in ${timeZone}. Each event's hash covers the one before it.`, { size: 9, color: MUTED, gap: 8 })
  for (const e of events) {
    ensure(28)
    line(`${when(e.at)}  ${describeEvent(e)}`, { size: 8.8, gap: 1 })
    line(`${e.actor || 'System'}${e.ip ? ` · ${e.ip}` : ''}${e.user_agent ? ` · ${summarizeAgent(e.user_agent)}` : ''}`, { size: 7.8, color: MUTED, gap: 5, indent: 10 })
  }
  const last = events[events.length - 1]
  if (last?.hash) { y -= 4; line(`Chain head: ${last.hash}`, { font: mono, size: 7.5, color: MUTED }) }
  return doc
}

export function summarizeAgent(ua) {
  const s = String(ua || '')
  if (!s) return 'unknown device'
  const browser = /Edg\//.test(s) ? 'Edge' : /Chrome\//.test(s) ? 'Chrome' : /Firefox\//.test(s) ? 'Firefox' : /Safari\//.test(s) ? 'Safari' : 'Browser'
  const os = /iPhone/.test(s) ? 'iPhone' : /iPad/.test(s) ? 'iPad' : /Android/.test(s) ? 'Android' : /Mac OS X/.test(s) ? 'macOS' : /Windows/.test(s) ? 'Windows' : /Linux/.test(s) ? 'Linux' : 'device'
  return `${browser} · ${os}`
}

const EVENT_WORDS = {
  created: 'Request created', sent: 'Sent for signature', delivered: 'Email delivered', link_opened: 'Signing link opened',
  code_sent: 'One-time code sent', code_failed: 'One-time code entered incorrectly', code_verified: 'One-time code verified',
  password_verified: 'Identity re-confirmed with account password', sample_pdf_opened: 'Sample PDF opened',
  consent_accepted: 'Consent to electronic records accepted', opened: 'Document opened', downloaded: 'Document downloaded',
  field_filled: 'Field filled', signature_adopted: 'Signature adopted', signed: 'Signed', viewed: 'Viewed',
  routed: 'Routed to the next signer', declined: 'Declined', voided: 'Voided', expired: 'Expired',
  reminder_sent: 'Reminder sent', delegation_requested: 'Asked to reassign to someone else',
  delegation_approved: 'Reassignment approved by the sender', delegation_rejected: 'Reassignment declined by the sender',
  paper_copy_requested: 'Paper copy requested', content_timestamped: 'Signed pages timestamped (RFC 3161)',
  sealed: 'Document sealed and certificate appended', seal_failed: 'Sealing failed, will retry',
  copies_sent: 'Completed copy emailed to every party', filed_to_record: 'Filed to the record',
}
export function describeEvent(e) {
  const base = EVENT_WORDS[e.type] || e.type
  const d = e.details || {}
  if (e.type === 'code_verified' && d.sent_to) return `${base} (sent to ${d.sent_to})`
  if (e.type === 'consent_accepted' && d.version) return `${base} (disclosure v${d.version})`
  if (e.type === 'signed' && d.fields != null) return `${base} ${d.fields} field${d.fields === 1 ? '' : 's'} (${d.kind || 'typed'} signature)`
  if ((e.type === 'declined' || e.type === 'voided') && d.reason) return `${base}: "${d.reason}"`
  if (e.type === 'routed' && d.to) return `${base}: ${d.to}`
  if (e.type === 'content_timestamped' && d.serial) return `${base}, serial ${d.serial}`
  if (e.type === 'sealed' && d.sha256) return `${base}, SHA-256 ${d.sha256.slice(0, 12)}...`
  return base
}

// ── The service ─────────────────────────────────────────────────────────────────────

export class SealingService {
  constructor({ settings, orgName = '', env = process.env, fetchImpl } = {}) {
    this.settings = settings || {}
    this.orgName = orgName
    this.env = env
    this.fetchImpl = fetchImpl
  }

  /**
   * @returns {{ sealedBytes, sealedSha256, contentSha256, contentTimestamp, sealResult }}
   */
  async seal({ documentBytes, request, signers, fields, values, events, originalSha256 }) {
    const provider = sealProviderFor(this.settings, this.env)
    const timeZone = this.settings.time_zone || 'America/Los_Angeles'
    const tsaUrl = this.settings.tsa_url
    const tsaName = this.settings.tsa_name || ''
    const signersByRole = Object.fromEntries(signers.map(s => [s.role_key, s]))

    // 1. Flatten, then hash exactly the flattened pages.
    const flat = await flattenDocument({ documentBytes, fields, values, signersByRole })
    const flatBytes = Buffer.from(await flat.save({ useObjectStreams: false }))
    const contentSha256 = sha256Hex(flatBytes)

    // 2. A trusted time over that hash, printed on the certificate.
    const ct = await requestTimestamp(tsaUrl, flatBytes.toString('binary'), { fetchImpl: this.fetchImpl })
    const contentTimestamp = { gen_time: ct.genTime, serial: ct.serial, policy: ct.policy, tsa_url: tsaUrl, tsa_name: tsaName, token_base64: Buffer.from(ct.tokenDer, 'binary').toString('base64') }

    // 3. Certificate and event log, on a reloaded copy of the flattened file.
    const doc = await PDFDocument.load(flatBytes, { updateMetadata: false })
    doc.setTitle(request.title)
    doc.setProducer('ASPIRE Intelligence')
    await appendCertificate(doc, {
      request, signers, events, timeZone, contentTimestamp, originalSha256, contentSha256,
      orgName: this.orgName, sealProviderLabel: provider.label,
    })

    // 4. Seal, with its own timestamp.
    pdflibAddPlaceholder({
      pdfDoc: doc, reason: `Sealed by ASPIRE Intelligence, envelope ${request.envelope_code}`,
      contactInfo: request.sender_email || '', name: provider.label, location: this.orgName || 'ASPIRE Intelligence',
      signatureLength: 24576,
    })
    const unsigned = Buffer.from(await doc.save({ useObjectStreams: false }))
    const signer = new AspireCmsSigner({ provider, tsaUrl, tsaName, fetchImpl: this.fetchImpl })
    const sealedBytes = await new SignPdf().sign(unsigned, signer)
    return { sealedBytes, sealedSha256: sha256Hex(sealedBytes), contentSha256, contentTimestamp, sealResult: signer.result }
  }
}

