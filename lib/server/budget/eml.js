// lib/server/budget/eml.js
//
// PROGRAM-BUDGET Phase B (BUDGET-B2, 2026-09-27): a saved order email (.eml) as something Keith
// can read (prompt B1: "images, PDFs and saved order emails"). No dependency: MIME is headers,
// boundaries and two transfer encodings, and an order confirmation needs nothing more.
//
//   parseEml(buffer) -> { subject, from, date, text, attachments: [{ contentType, filename, bytes }] }
//
// `text` is the readable body (plain text if the email has it, else its HTML with the markup
// removed), capped so a newsletter-sized email cannot become a costly reading. A PDF or image
// attachment (the invoice many vendors attach) is returned as bytes, so the reader can hand
// Keith the attachment itself.

import { Buffer } from 'node:buffer'

export const EML_TEXT_MAX = 20000
const MAX_DEPTH = 6

function splitHead(raw) {
  const i = raw.search(/\r?\n\r?\n/)
  if (i < 0) return { head: raw, body: '' }
  const sep = raw.slice(i).match(/^\r?\n\r?\n/)[0]
  return { head: raw.slice(0, i), body: raw.slice(i + sep.length) }
}

function headers(head) {
  const out = {}
  for (const line of head.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const m = /^([\w-]+):\s*(.*)$/.exec(line)
    if (m) out[m[1].toLowerCase()] = m[2]
  }
  return out
}

const param = (value, name) => {
  const m = new RegExp(`${name}\\*?=\\s*(?:"([^"]*)"|([^;\\s]*))`, 'i').exec(value || '')
  return m ? (m[1] ?? m[2]) : ''
}

/** RFC 2047 encoded words in a header (=?utf-8?B?...?= and =?utf-8?Q?...?=). */
function decodeWords(s) {
  return String(s || '').replace(/=\?([^?]+)\?([bqBQ])\?([^?]*)\?=/g, (m, cs, enc, data) => {
    try {
      const bytes = enc.toUpperCase() === 'B' ? Buffer.from(data, 'base64') : qpBytes(data.replace(/_/g, ' '))
      return toText(bytes, cs)
    } catch { return m }
  })
}

function qpBytes(s) {
  const clean = String(s).replace(/=\r?\n/g, '')
  const out = []
  for (let i = 0; i < clean.length; i++) {
    if (clean[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(clean.slice(i + 1, i + 3))) { out.push(parseInt(clean.slice(i + 1, i + 3), 16)); i += 2 }
    else out.push(clean.charCodeAt(i) & 0xff)
  }
  return Buffer.from(out)
}

function toText(bytes, charset = 'utf-8') {
  const cs = String(charset || 'utf-8').toLowerCase()
  try { return new TextDecoder(cs === 'us-ascii' ? 'utf-8' : cs).decode(bytes) } catch { return new TextDecoder('utf-8').decode(bytes) }
}

function decodeBody(body, encoding) {
  const enc = String(encoding || '').toLowerCase()
  if (enc === 'base64') return Buffer.from(body.replace(/[^A-Za-z0-9+/=]/g, ''), 'base64')
  if (enc === 'quoted-printable') return qpBytes(body)
  return Buffer.from(body, 'latin1')
}

/** HTML to readable text: block ends become line breaks, tags go, the common entities decode. */
export function htmlToText(html) {
  return String(html || '')
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, '\t')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n)))
    .replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

function walk(raw, acc, depth) {
  if (depth > MAX_DEPTH) return
  const { head, body } = splitHead(raw)
  const h = headers(head)
  const type = String(h['content-type'] || 'text/plain').split(';')[0].trim().toLowerCase()
  if (type.startsWith('multipart/')) {
    const boundary = param(h['content-type'], 'boundary')
    if (!boundary) return
    const parts = body.split(new RegExp(`\\r?\\n?--${boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:--)?\\s*\\r?\\n?`))
    for (const part of parts) if (part.trim()) walk(part, acc, depth + 1)
    return
  }
  const bytes = decodeBody(body, h['content-transfer-encoding'])
  const disposition = String(h['content-disposition'] || '')
  const filename = decodeWords(param(disposition, 'filename') || param(h['content-type'], 'name'))
  if (type === 'text/plain' && !/attachment/i.test(disposition)) acc.plain.push(toText(bytes, param(h['content-type'], 'charset')))
  else if (type === 'text/html' && !/attachment/i.test(disposition)) acc.html.push(toText(bytes, param(h['content-type'], 'charset')))
  else if (/^(application\/pdf|image\/(jpeg|png|webp|gif))$/.test(type)) acc.attachments.push({ contentType: type, filename: filename || 'attachment', bytes })
  else if (type === 'message/rfc822') walk(toText(bytes), acc, depth + 1)
}

export function parseEml(buffer) {
  const raw = Buffer.isBuffer(buffer) ? buffer.toString('latin1') : String(buffer || '')
  const { head } = splitHead(raw)
  const h = headers(head)
  const acc = { plain: [], html: [], attachments: [] }
  walk(raw, acc, 0)
  // The plain part is written by the sender for reading; the HTML is the fallback.
  const plain = acc.plain.join('\n\n').trim()
  const text = (plain.length > 40 ? plain : htmlToText(acc.html.join('\n\n')) || plain).slice(0, EML_TEXT_MAX)
  return { subject: decodeWords(h.subject || ''), from: decodeWords(h.from || ''), date: h.date || '', text, attachments: acc.attachments }
}
