// src/lib/connect/outreachAttachments.js
//
// OUTREACH-ATTACHMENTS-1 - the client half of Outreach attachments.
//
// The browser only ever holds ASPIRE Catalog SLUGS and display metadata. It
// never reads file bytes, never sees a storage path, and never receives a
// signed URL for an attachment. Everything shown here is either chosen from
// the ASPIRE Catalog picker (via /api/outreach-attachment-options) or echoed
// back by the server's own resolver, so what the composer displays is what the
// server will actually send.
//
// These limits MIRROR api/lib/outreachAttachments.js. They exist to give fast,
// friendly feedback while composing. They are NOT the enforcement point: the
// server re-checks count, extension, magic bytes and total size on every
// preview and every send, and refuses before the Resend client is created.

export const MAX_ATTACHMENTS = 5;
export const MAX_TOTAL_BYTES = 10 * 1024 * 1024;

/** Shown wherever attachments are added. Deliberately blunt. */
export const SENSITIVE_DATA_WARNING =
  'Do not attach patient information, PHI, or anything else confidential. ' +
  'Attachments are emailed outside Cedars-Sinai and cannot be recalled.'

export function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Short label for the chip. Comes from the server (type_label before a preview,
 * then the resolved filename's own type). The client never derives it from a
 * storage path, because it never has one.
 */
export function typeLabel(item) {
  if (item?.type_label) return item.type_label
  const m = /\.([a-z0-9]+)$/i.exec(String(item?.filename || '').trim())
  return m ? m[1].toUpperCase() : 'FILE'
}

export function totalBytes(items) {
  return (items || []).reduce((sum, a) => sum + (Number(a?.size_bytes) || 0), 0)
}

/**
 * Why the composer would refuse to add one more file, or null when it is fine.
 * Size is only known for items the server has already described, so an unknown
 * size never blocks - the server still enforces the real limit.
 */
export function addBlockedReason(current, next) {
  const items = current || []
  if (items.length >= MAX_ATTACHMENTS) return `You can attach up to ${MAX_ATTACHMENTS} files.`
  if (next && items.some(a => a.slug === next.slug)) return 'That file is already attached.'
  const projected = totalBytes(items) + (Number(next?.size_bytes) || 0)
  if (projected > MAX_TOTAL_BYTES) {
    return `Attachments would total more than ${formatBytes(MAX_TOTAL_BYTES)}.`
  }
  return null
}

/** The only thing sent to the server: an ordered list of slugs. */
export function toSlugs(items) {
  return (items || []).map(a => a?.slug).filter(Boolean)
}

/** Summary line under the paperclip control. */
export function attachmentSummary(items) {
  const n = (items || []).length
  if (n === 0) return ''
  return `${n} file${n === 1 ? '' : 's'} · ${formatBytes(totalBytes(items))} of ${formatBytes(MAX_TOTAL_BYTES)}`
}

// ── Draft persistence ───────────────────────────────────────────────────────
//
// Attachments are part of the message draft, so they are saved and restored
// with it and cleared whenever the draft's scope changes. Only identity and
// display text are stored: sizes are deliberately dropped, because a size is a
// server-resolved fact that can go stale while a draft sits in localStorage.

/** Reduce to the fields safe and useful to persist. Never sizes or paths. */
export function toDraftAttachments(items) {
  return (items || [])
    .filter(a => a && typeof a.slug === 'string' && a.slug)
    .map(a => ({ slug: a.slug, title: String(a.title || a.slug), type_label: a.type_label || '' }))
    .slice(0, MAX_ATTACHMENTS)
}

/**
 * Restore from a stored draft. A legacy draft saved before this feature has no
 * attachments key and MUST restore as an empty list rather than inheriting
 * whatever the composer happened to be holding.
 */
export function fromDraftAttachments(draft) {
  const raw = draft && Array.isArray(draft.attachments) ? draft.attachments : []
  return toDraftAttachments(raw)
}

// ── Review gating ───────────────────────────────────────────────────────────

/**
 * True when the server's preview has resolved EXACTLY the current selection,
 * in the same order. Anything else - a pending preview, a stale list from a
 * previous selection, a failed preview - is not a basis for sending.
 */
export function attachmentsResolved(selected, resolved) {
  const want = (selected || []).map(a => a?.slug)
  const got = (resolved || []).map(a => a?.slug)
  if (want.length !== got.length) return false
  return want.every((s, i) => s === got[i])
}

/**
 * Why sending is blocked on attachment grounds, or null when it is fine.
 * With no attachments selected this is always null, so ordinary Outreach is
 * never gated by this feature.
 */
export function sendBlockedReason(selected, resolved, { previewError = null, previewLoading = false } = {}) {
  if (!selected || selected.length === 0) return null
  if (previewError) return 'Attachments could not be verified. Remove them or try again.'
  if (previewLoading) return 'Checking attachments…'
  if (!attachmentsResolved(selected, resolved)) return 'Checking attachments…'
  const total = (resolved || []).reduce((n, a) => n + (Number(a.size_bytes) || 0), 0)
  if (total > MAX_TOTAL_BYTES) return `Attachments total more than ${formatBytes(MAX_TOTAL_BYTES)}.`
  return null
}
