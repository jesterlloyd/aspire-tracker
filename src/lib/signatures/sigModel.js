// src/lib/signatures/sigModel.js
//
// SIGNATURES-PHASE2 (ASPIRE Catalog Phase 2, 2026-09-23). The rules of ASPIRE's own
// e-signature engine, in one pure module that the editor, the signer's page and the
// server all import: statuses and their words, field types and their defaults, format
// rules and group rules, what a signer still owes, snapping and nudging on the editor
// page, radio groups, signing order, excluded document types and the tracker's counts.
// No React, no I/O. Brief: docs/mockups/signatures-brief.md.

// ── Statuses ────────────────────────────────────────────────────────────────────────

export const REQUEST_STATUS = Object.freeze({
  draft: 'Draft', sent: 'Sent', opened: 'Opened', progress: 'Partly signed', completed: 'Completed',
  declined: 'Declined', voided: 'Voided', expired: 'Expired',
})
export const SIGNER_STATUS = Object.freeze({
  pending: 'Not sent yet', sent: 'Sent', delivered: 'Delivered', verified: 'Code verified',
  consented: 'Consent accepted', opened: 'Opened', signed: 'Signed', declined: 'Declined',
  completed_copy_sent: 'Completed copy sent', replaced: 'Replaced',
})
const SIGNER_RANK = ['pending', 'sent', 'delivered', 'verified', 'consented', 'opened', 'signed', 'completed_copy_sent']
export const signerRank = (s) => SIGNER_RANK.indexOf(s)
export const isFinal = (status) => ['completed', 'declined', 'voided', 'expired'].includes(status)
export const isWaiting = (status) => status === 'sent' || status === 'opened'

// Tracker filters (brief section 3): All, Waiting (Sent or Opened), Partly signed,
// Completed, Declined, Expired, Drafts.
export const TRACKER_FILTERS = Object.freeze([
  { key: 'all', label: 'All', test: () => true },
  { key: 'waiting', label: 'Waiting', test: (s) => isWaiting(s) },
  { key: 'progress', label: 'Partly signed', test: (s) => s === 'progress' },
  { key: 'completed', label: 'Completed', test: (s) => s === 'completed' },
  { key: 'declined', label: 'Declined', test: (s) => s === 'declined' },
  { key: 'expired', label: 'Expired', test: (s) => s === 'expired' },
  { key: 'draft', label: 'Drafts', test: (s) => s === 'draft' },
])

// ── Recipients ──────────────────────────────────────────────────────────────────────

export const RECIPIENT_TYPES = Object.freeze([
  { key: 'signer', label: 'Signer' },
  { key: 'viewer', label: 'Needs to view' },
  { key: 'cc', label: 'Receives a copy' },
])
// Signer 1 plum, signer 2 teal, then navy, amber, green (brief section 4).
export const SIGNER_COLORS = Object.freeze(['plum', 'teal', 'navy', 'amber', 'green'])
export const colorForIndex = (i) => SIGNER_COLORS[i % SIGNER_COLORS.length]
export const SENDER_ROLE = 'sender'

// ── Document types and exclusions (UETA / ESIGN, brief section 1.7) ───────────────

export const DOCUMENT_TYPES = Object.freeze([
  { key: 'acknowledgment', label: 'Acknowledgment' },
  { key: 'attestation', label: 'Attestation' },
  { key: 'consent_release', label: 'Consent or release' },
  { key: 'request_form', label: 'Request form' },
  { key: 'contract_agreement', label: 'Contract or agreement' },
  // Excluded unless an admin confirms.
  { key: 'will_trust', label: 'Will, codicil or trust', excluded: true },
  { key: 'family_law', label: 'Family law document', excluded: true },
  { key: 'court', label: 'Court order or filing', excluded: true },
  { key: 'utility_housing_loan_notice', label: 'Utility shutoff, eviction, foreclosure or loan default notice', excluded: true },
  { key: 'insurance_cancellation', label: 'Notice cancelling health or life insurance', excluded: true },
  { key: 'product_recall', label: 'Product recall notice', excluded: true },
  { key: 'hazmat', label: 'Hazardous-materials document', excluded: true },
  { key: 'notarized', label: 'Document that requires notarization', excluded: true },
])
export const isExcludedType = (key) => !!DOCUMENT_TYPES.find(t => t.key === key)?.excluded
export const documentTypeLabel = (key) => DOCUMENT_TYPES.find(t => t.key === key)?.label || key

// ── Field types ─────────────────────────────────────────────────────────────────────
// Default size in page percent [w, h]; `prefill` names the ASPIRE record value that fills
// it by default (the signer can still edit it).

export const FIELD_TYPES = Object.freeze([
  { key: 'sig', label: 'Signature', w: 24, h: 6, required: true },
  { key: 'ini', label: 'Initials', w: 9, h: 5, required: true },
  { key: 'date', label: 'Date signed', w: 18, h: 4, required: true, auto: true },
  { key: 'name', label: 'Full name', w: 26, h: 4, required: true, prefill: 'name' },
  { key: 'email', label: 'Email', w: 26, h: 4, required: true, prefill: 'email', rule: 'email' },
  { key: 'phone', label: 'Phone', w: 20, h: 4, required: false, prefill: 'phone', rule: 'us_phone' },
  { key: 'title', label: 'Title', w: 24, h: 4, required: false, prefill: 'title' },
  { key: 'org', label: 'School or company', w: 26, h: 4, required: false, prefill: 'org' },
  { key: 'addr', label: 'Address', w: 34, h: 4, required: false, prefill: 'address' },
  { key: 'text', label: 'Text', w: 26, h: 4, required: false },
  { key: 'check', label: 'Checkbox', w: 4, h: 3.2, required: false },
  { key: 'drop', label: 'Dropdown', w: 20, h: 4, required: false },
  { key: 'radio', label: 'Radio group', w: 2.8, h: 2.8, required: false },
])
export const fieldType = (k) => FIELD_TYPES.find(t => t.key === k)
export const fieldLabel = (f) => (f?.label && f.label.trim()) || fieldType(f?.type)?.label || 'Field'

// Format rules the editor offers per type (brief section 4, step 3).
export const RULE_OPTIONS = Object.freeze({
  phone: [{ key: 'us_phone', label: 'US phone number' }, { key: 'any_phone', label: 'Any phone number' }, { key: 'none', label: 'None' }],
  email: [{ key: 'email', label: 'Valid email address' }],
  text: [{ key: 'none', label: 'None' }, { key: 'number', label: 'Number' }, { key: 'zip', label: 'ZIP code' }, { key: 'max100', label: 'Up to 100 characters' }],
})
export const GROUP_RULES = Object.freeze([
  { key: 'at_least_1', label: 'At least 1' },
  { key: 'exactly_1', label: 'Exactly 1' },
  { key: 'all', label: 'All of them' },
])

// Returns null when the value passes, else the sentence the signer sees.
export function checkRule(rule, value) {
  const v = String(value ?? '').trim()
  if (!v) return null
  switch (rule) {
    case 'us_phone': return /^\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}$/.test(v.replace(/^\+?1[\s.-]?/, '')) ? null : 'Enter a US phone number, like (310) 555-0142.'
    case 'any_phone': return /^\+?[\d\s().-]{7,20}$/.test(v) ? null : 'Enter a phone number.'
    case 'email': return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? null : 'Enter a valid email address.'
    case 'number': return /^-?\d+(\.\d+)?$/.test(v) ? null : 'Enter a number.'
    case 'zip': return /^\d{5}(-\d{4})?$/.test(v) ? null : 'Enter a 5-digit ZIP code.'
    case 'max100': return v.length <= 100 ? null : 'Keep this to 100 characters or fewer.'
    default: return null
  }
}

// ── What a signer still owes ────────────────────────────────────────────────────────
// A group (checkboxes or a radio group) counts as ONE requirement. Returns the unmet
// requirements in page order, each { field, group?, message }.

const byPosition = (a, b) => (a.page - b.page) || (a.y - b.y) || (a.x - b.x)
const isChecked = (v) => v === true || v === 'true' || v === '✓' || v === 'on'

export function groupsOf(fields) {
  const g = {}
  for (const f of fields) if (f.group && (f.type === 'check' || f.type === 'radio')) (g[f.group] ||= []).push(f)
  return g
}

export function groupProblem(members, values, rule) {
  const n = members.filter(f => f.type === 'radio' ? values[f.group] === f.id : isChecked(values[f.id])).length
  const radio = members[0]?.type === 'radio'
  const r = radio ? 'exactly_1' : (rule || 'at_least_1')
  if (r === 'exactly_1' && n !== 1) return radio ? 'pick one option.' : 'check exactly one.'
  if (r === 'all' && n !== members.length) return 'check all of them.'
  if (r === 'at_least_1' && n < 1) return 'check at least one.'
  return null
}

export function unmetRequirements(fields, values, roleKey) {
  const mine = fields.filter(f => f.role === roleKey).sort(byPosition)
  const out = []
  const groups = groupsOf(mine)
  const seen = new Set()
  for (const f of mine) {
    if (f.group && groups[f.group]) {
      if (seen.has(f.group)) continue
      seen.add(f.group)
      const problem = groupProblem(groups[f.group], values, f.groupRule)
      if (problem) out.push({ field: groups[f.group].slice().sort(byPosition)[0], group: f.group, message: `${f.group}: ${problem}` })
      continue
    }
    const v = values[f.id]
    if (f.required && (v == null || String(v).trim() === '' || (f.type === 'check' && !isChecked(v)))) {
      out.push({ field: f, message: `${fieldLabel(f)} is required.` })
      continue
    }
    const bad = f.rule && f.rule !== 'none' ? checkRule(f.rule, v) : null
    if (bad) out.push({ field: f, message: bad })
  }
  return out.sort((a, b) => byPosition(a.field, b.field))
}

// ── Editor geometry (page-relative percent) ─────────────────────────────────────────

export const SNAP_THRESHOLD = 0.9
export const clampField = (f) => ({
  ...f,
  w: Math.min(100, Math.max(2.5, f.w)), h: Math.min(100, Math.max(2.5, f.h)),
  x: Math.min(100 - Math.min(100, Math.max(2.5, f.w)), Math.max(0, f.x)),
  y: Math.min(100 - Math.min(100, Math.max(2.5, f.h)), Math.max(0, f.y)),
})

// Snap any edge or center of `f` to the edges and centers of the other fields on its
// page, and to the page's vertical center line (x = 50). Returns the offset to apply and
// the guide lines to draw.
export function snapField(f, others, threshold = SNAP_THRESHOLD) {
  const peers = others.filter(o => o.id !== f.id && o.page === f.page)
  const xs = [50], ys = []
  for (const o of peers) { xs.push(o.x, o.x + o.w / 2, o.x + o.w); ys.push(o.y, o.y + o.h / 2, o.y + o.h) }
  const mine = (a, s) => [a, a + s / 2, a + s]
  let bx = null, by = null
  for (const v of mine(f.x, f.w)) for (const t of xs) { const d = t - v; if (Math.abs(d) < threshold && (!bx || Math.abs(d) < Math.abs(bx.d))) bx = { d, t } }
  for (const v of mine(f.y, f.h)) for (const t of ys) { const d = t - v; if (Math.abs(d) < threshold && (!by || Math.abs(d) < Math.abs(by.d))) by = { d, t } }
  return { dx: bx ? bx.d : 0, dy: by ? by.d : 0, guidesX: bx ? [bx.t] : [], guidesY: by ? [by.t] : [] }
}

export function nudge(f, key, shift) {
  const s = shift ? 2 : 0.5
  const d = { ArrowLeft: [-s, 0], ArrowRight: [s, 0], ArrowUp: [0, -s], ArrowDown: [0, s] }[key]
  return d ? clampField({ ...f, x: f.x + d[0], y: f.y + d[1] }) : f
}

// One click places three round options stacked on one vertical line, evenly spaced.
export const RADIO_STEP = 4.2
export function placeRadioGroup({ x, y, page, role, groupName, nextId }) {
  const t = fieldType('radio')
  return [0, 1, 2].map(i => clampField({
    id: nextId(), type: 'radio', page, role, x, y: y + i * RADIO_STEP, w: t.w, h: t.h,
    required: false, group: groupName, groupRule: 'exactly_1', option: `Option ${i + 1}`,
  }))
}

// Line up: every option of the group centered on the first option's line, evenly spaced
// between the first and last.
export function lineUpGroup(fields, groupName) {
  const g = fields.filter(f => f.group === groupName).sort((a, b) => a.y - b.y)
  if (g.length < 2) return fields
  const cx = g[0].x + g[0].w / 2
  const step = (g[g.length - 1].y - g[0].y) / (g.length - 1) || RADIO_STEP
  const moved = new Map(g.map((f, i) => [f.id, clampField({ ...f, x: cx - f.w / 2, y: g[0].y + i * step })]))
  return fields.map(f => moved.get(f.id) || f)
}

export function addGroupOption(fields, groupName, nextId) {
  const g = fields.filter(f => f.group === groupName).sort((a, b) => a.y - b.y)
  const last = g[g.length - 1]
  if (!last) return fields
  return [...fields, clampField({ ...last, id: nextId(), y: last.y + RADIO_STEP, option: `Option ${g.length + 1}` })]
}

export function nextGroupName(fields, kind) {
  const base = kind === 'radio' ? 'Choice' : 'Group'
  let n = 1
  const names = new Set(fields.map(f => f.group).filter(Boolean))
  while (names.has(`${base} ${n}`)) n++
  return `${base} ${n}`
}

// ── Checks before sending (brief section 4, step 4) ────────────────────────────────

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function sendIssues({ recipients, fields, documentType, excludedConfirmed = false, senderValues = {} }) {
  const issues = []
  const signers = recipients.filter(r => r.type === 'signer')
  if (!signers.length) issues.push('Add at least one signer.')
  for (const s of signers) {
    if (!fields.some(f => f.role === s.roleKey && f.type === 'sig')) issues.push(`${s.name || 'A signer'} has no signature field.`)
  }
  for (const r of recipients) if (!EMAIL.test(String(r.email || '').trim())) issues.push(`${r.name || 'A recipient'} needs a valid email.`)
  if (!documentType) issues.push('Choose a document type.')
  else if (isExcludedType(documentType) && !excludedConfirmed) issues.push('This document type is excluded from e-signature by law. An admin must confirm before sending.')
  for (const f of fields.filter(x => x.role === SENDER_ROLE)) {
    const v = senderValues[f.id]
    if (f.required && (v == null || String(v).trim() === '')) issues.push(`Fill "${fieldLabel(f)}" before sending.`)
  }
  return issues
}

// The rules the Checks panel lists when everything passes, in words.
export function ruleSummaries(fields) {
  const out = []
  const groups = groupsOf(fields)
  for (const [name, members] of Object.entries(groups)) {
    const radio = members[0].type === 'radio'
    const rule = radio ? 'picks exactly 1' : { at_least_1: 'checks at least 1', exactly_1: 'checks exactly 1', all: 'checks all' }[members[0].groupRule || 'at_least_1']
    out.push(`${name}: signer ${rule}`)
  }
  for (const f of fields) {
    if (!f.rule || f.rule === 'none' || f.group) continue
    const label = { us_phone: 'US phone format', any_phone: 'phone format', email: 'valid email', number: 'number', zip: 'ZIP code', max100: 'up to 100 characters' }[f.rule]
    if (label) out.push(`${fieldLabel(f)}: ${label}`)
  }
  return out
}

// ── Signing order ───────────────────────────────────────────────────────────────────
// In order: the lowest order_index that has not signed is the one whose turn it is.
// Viewers must open the document before it moves on. Copy recipients never block.

export function currentTurn(signers, order = 'sequential') {
  const active = signers
    .filter(s => s.recipient_type !== 'cc' && s.status !== 'replaced')
    .sort((a, b) => a.order_index - b.order_index)
  const pending = active.filter(s => s.recipient_type === 'viewer' ? !s.opened_at : !s.signed_at)
  if (!pending.length) return []
  return order === 'parallel' ? pending : [pending[0]]
}

export const allDone = (signers) => signers
  .filter(s => s.recipient_type !== 'cc' && s.status !== 'replaced')
  .every(s => s.recipient_type === 'viewer' ? !!s.opened_at : !!s.signed_at)

// A request's own status, derived from its signers (drafts and final states are kept).
export function deriveRequestStatus(request, signers) {
  if (['draft', 'completed', 'declined', 'voided', 'expired'].includes(request.status)) return request.status
  const people = signers.filter(s => s.recipient_type === 'signer' && s.status !== 'replaced')
  if (people.some(s => s.signed_at)) return 'progress'
  if (people.some(s => s.opened_at)) return 'opened'
  return 'sent'
}

// ── Tracker counts ──────────────────────────────────────────────────────────────────

export function trackerCounts(rows) {
  const c = {}
  for (const f of TRACKER_FILTERS) c[f.key] = rows.filter(r => f.test(r.status)).length
  return c
}

// A bulk parent's numbers, computed from its children every time (never stored).
export function bulkCounts(children, now = Date.now()) {
  const c = { total: children.length, signed: 0, overdue: 0, opened: 0, notOpened: 0, declined: 0 }
  for (const k of children) {
    if (k.status === 'completed') c.signed++
    else if (k.status === 'declined' || k.status === 'voided' || k.status === 'expired') c.declined++
    else if (k.due_at && new Date(k.due_at).getTime() < now) c.overdue++
    else if (k.status === 'opened' || k.status === 'progress') c.opened++
    else c.notOpened++
  }
  return c
}

export const bulkProgressLabel = (c) => `${c.signed} signed, ${c.overdue} overdue, ${c.opened} opened, ${c.notOpened} not opened`

// ── Small formatting helpers ────────────────────────────────────────────────────────

export function maskEmail(email) {
  const [user, domain] = String(email || '').split('@')
  if (!user || !domain) return ''
  return `${user[0]}${'•'.repeat(Math.max(3, Math.min(6, user.length - 1)))}@${domain}`
}

export const initialsOf = (name) => String(name || '').trim().split(/\s+/).filter(Boolean).map(w => w[0].toUpperCase()).slice(0, 3).join('')

export function formatInZone(iso, timeZone = 'America/Los_Angeles', withSeconds = false) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-US', {
    timeZone, month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
    ...(withSeconds ? { second: '2-digit' } : {}), timeZoneName: 'short',
  }).format(d)
}

export function envelopeCode(date = new Date(), rand = Math.random) {
  const y = date.getUTCFullYear()
  const md = String(date.getUTCMonth() + 1).padStart(2, '0') + String(date.getUTCDate()).padStart(2, '0')
  const tail = Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(rand() * 32)]).join('')
  return `ENV-${y}-${md}-${tail}`
}

// ── Audit events, in words (the screen and the certificate page read the same) ─────

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

