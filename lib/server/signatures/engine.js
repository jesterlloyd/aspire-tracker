// lib/server/signatures/engine.js
//
// SIGNATURES-PHASE2: the signing engine. Every state change a request or a signer goes
// through happens here, on the service-role client, and every one of them appends an
// event to sig_events (the database chains and freezes them). The staff endpoint, the
// signer endpoint and the maintenance cron are thin: they authenticate, then call this.
//
// Rules this file keeps, from the brief:
//   - Consent is its own step and is recorded with its disclosure version and both
//     checkbox actions (sample PDF opened, agreed), each with a time (1.1).
//   - Nothing signs except finish(): opening, filling or scrolling never does (1.2).
//   - External signers: link + 6-digit emailed code, 10 minutes, 5 attempts. Staff
//     signers: their ASPIRE password, re-entered. IP and device on every event (1.3).
//   - A signer can always download the document, before and after signing (1.4).
//   - The last signer triggers the seal; copies go to every party (1.5).
//   - Excluded document types need an admin's confirmation to send (1.7).
//   - Links stop working when the request is completed, voided, declined or expired.

import { createHash, randomUUID } from 'node:crypto'
import {
  unmetRequirements, currentTurn, allDone, deriveRequestStatus, isFinal, isExcludedType,
  maskEmail, initialsOf, colorForIndex, envelopeCode, SENDER_ROLE,
} from '../../../src/lib/signatures/sigModel.js'
import { linkTokenFor, sha256, newCode, codeHash, codeMatches, newSession } from './tokens.js'
import { invitationEmail, staffTurnEmail, codeEmail, completedEmail, voidedEmail, senderNoticeEmail, fromLine } from './mail.js'
import { SealingService } from './sealing.js'
import { Buffer } from 'node:buffer'
import process from 'node:process'

export const ORG_ID = 'a5f1e000-0000-4000-8000-000000000001'
export const DOC_BUCKET = 'signature-documents'
const RECORD_BUCKET = 'record-documents'
const DAY = 24 * 3600 * 1000
const notEnabled = (e) => e && (e.code === '42P01' || e.code === '42703' || e.code === 'PGRST205')

export class EngineError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status }
}

// ── Settings and the flag ───────────────────────────────────────────────────────────

const DEFAULT_SETTINGS = {
  org_id: ORG_ID, seal_provider: 'env_p12', seal_provider_config: {}, tsa_url: 'http://timestamp.digicert.com',
  tsa_name: 'DigiCert Timestamp Authority', time_zone: 'America/Los_Angeles', current_disclosure_version: '1.0',
  code_ttl_minutes: 10, code_max_attempts: 5,
}

export async function loadSettings(db) {
  const { data } = await db.from('sig_settings').select('*').eq('org_id', ORG_ID).maybeSingle()
  const { data: org } = await db.from('organizations').select('name, time_zone').eq('id', ORG_ID).maybeSingle()
  return { ...DEFAULT_SETTINGS, ...(data || {}), org_name: org?.name || 'ASPIRE Intelligence' }
}

/** 'off' | 'owner' | 'on'. Anything unreadable (no table yet) is 'off': fail closed. */
export async function flagState(db) {
  const { data, error } = await db.from('feature_flags').select('state').eq('org_id', ORG_ID).eq('key', 'catalog.signatures').maybeSingle()
  if (error || !data) return 'off'
  return ['off', 'owner', 'on'].includes(data.state) ? data.state : 'off'
}

/** Staff may use signatures: 'on' admits Owner and Admin; 'owner' admits the Owner only. */
export function flagAllows(state, profile) {
  if (!profile || profile.is_active === false) return false
  const owner = profile.is_owner === true || profile.role === 'owner'
  if (state === 'on') return owner || profile.role === 'admin'
  if (state === 'owner') return owner
  return false
}

// ── Events ──────────────────────────────────────────────────────────────────────────

export async function appendEvent(db, { requestId, signerId = null, type, actor = null, ctx = {}, details = {} }) {
  const { error } = await db.from('sig_events').insert({
    org_id: ORG_ID, request_id: requestId, signer_id: signerId, type, actor,
    ip: ctx.ip || null, user_agent: ctx.userAgent || null, details,
  })
  if (error) throw new EngineError('event_failed', `Could not record the audit event: ${error.message}`, 500)
}

// ── Loading ─────────────────────────────────────────────────────────────────────────

const SIGNER_PUBLIC = 'id, request_id, role_key, order_index, recipient_type, name, email, student_id, contact_id, school_name, user_profile_id, color, status, link_version, code_sent_to, code_attempts, verified_at, verify_method, sample_pdf_opened_at, consent_version, consented_at, opened_at, signed_at, declined_at, decline_reason, adopted_signature, completed_copy_sent_at, notified_at, last_reminded_at, reminder_count, delegation, paper_copy_requested_at, created_at'

export async function loadBundle(db, requestId) {
  const { data: request, error } = await db.from('sig_requests').select('*').eq('id', requestId).maybeSingle()
  if (notEnabled(error)) throw new EngineError('not_enabled', 'Signatures are not enabled yet.', 409)
  if (error || !request) throw new EngineError('not_found', 'Request not found.', 404)
  const [{ data: signers }, { data: vals }, { data: events }] = await Promise.all([
    db.from('sig_request_signers').select(SIGNER_PUBLIC).eq('request_id', requestId).order('order_index'),
    db.from('sig_field_values').select('field_id, value, signer_id, filled_at').eq('request_id', requestId),
    db.from('sig_events').select('*').eq('request_id', requestId).order('id'),
  ])
  const values = Object.fromEntries((vals || []).map(v => [v.field_id, v.value]))
  return { request, signers: signers || [], values, valueRows: vals || [], events: events || [] }
}

export function signerLink(appUrl, signer) {
  return `${appUrl}/sign#t=${linkTokenFor(signer.id, signer.link_version || 1)}`
}

// ── Prefill from the ASPIRE record ─────────────────────────────────────────────────

export async function prefillFor(db, signer) {
  const out = { name: signer.name, email: signer.email }
  if (signer.student_id) {
    const { data: s } = await db.from('students').select('*').eq('id', signer.student_id).maybeSingle()
    if (s) Object.assign(out, { phone: s.phone || '', org: s.school || '' })
  } else if (signer.contact_id) {
    const { data: c } = await db.from('contacts').select('*').eq('id', signer.contact_id).maybeSingle()
    if (c) Object.assign(out, { phone: c.phone || '', title: c.title || c.role || '', org: c.school_name || c.organization || '' })
  } else if (signer.user_profile_id) {
    const { data: p } = await db.from('user_profiles').select('full_name, email, connect_signature').eq('id', signer.user_profile_id).maybeSingle()
    const cs = p?.connect_signature || {}
    Object.assign(out, { title: cs.title || '', org: cs.department || 'Cedars-Sinai', phone: cs.phone || '' })
  }
  return out
}

// ── Creating and sending ───────────────────────────────────────────────────────────

/**
 * Create one request ('one': every recipient on one copy) or one per person ('each':
 * each picked person fills the first signer role on their own copy, with any other
 * roles repeated on every copy) and send them.
 */
export async function createAndSend(db, input, { appUrl, mailer, sender, ctx = {}, isDemo = false }) {
  const {
    templateId = null, templateVersion = null, catalogResourceId = null, title, documentType, excludedConfirmed = false,
    documentPath, originalSha256, pageSizes, fields, roles, people = [], fixed = [], mode = 'one',
    signingOrder = 'sequential', senderValues = {}, subject, message, reminderRule = 'every_3_days',
    expiresDays = 30, dueAt = null, audienceLabel = '',
  } = input
  if (!title || !documentType || !documentPath) throw new EngineError('invalid', 'Title, document type and document are required.')
  if (isExcludedType(documentType) && !excludedConfirmed) throw new EngineError('excluded_type', 'This document type is excluded from e-signature. An admin must confirm before sending.', 403)
  if (!Array.isArray(fields) || !Array.isArray(roles) || !roles.length) throw new EngineError('invalid', 'The document has no signer roles.')

  const firstSignerRole = roles.find(r => r.type === 'signer')?.key
  const copies = mode === 'each'
    ? people.map(p => [{ ...p, roleKey: firstSignerRole }, ...fixed])
    : [[...people.map(p => ({ ...p, roleKey: p.roleKey || firstSignerRole })), ...fixed]]
  if (!copies.length || copies.some(c => !c.length)) throw new EngineError('invalid', 'Add at least one recipient.')

  // Staff signers sign in the app with their password: match their email to an account.
  const emails = [...new Set(copies.flat().map(r => String(r.email || '').trim().toLowerCase()).filter(Boolean))]
  const { data: staff } = emails.length
    ? await db.from('user_profiles').select('id, email, role, is_active').in('email', emails)
    : { data: [] }
  const staffByEmail = new Map((staff || []).filter(p => p.is_active !== false && ['owner', 'admin', 'interviewer'].includes(p.role)).map(p => [p.email.toLowerCase(), p.id]))

  let bulkId = null
  if (mode === 'each' && copies.length > 1) {
    const { data: bulk, error } = await db.from('sig_bulk_sends').insert({
      org_id: ORG_ID, template_id: templateId, title, audience_label: audienceLabel || `${copies.length} people`,
      sender_id: sender.id, expires_at: new Date(Date.now() + expiresDays * DAY).toISOString(), is_demo: isDemo,
    }).select('id').single()
    if (error) throw new EngineError('insert_failed', error.message, 500)
    bulkId = bulk.id
  }

  const created = []
  for (const copy of copies) {
    const { data: req, error } = await db.from('sig_requests').insert({
      org_id: ORG_ID, template_id: templateId, template_version: templateVersion, catalog_resource_id: catalogResourceId,
      parent_bulk_id: bulkId, envelope_code: envelopeCode(), title, document_type: documentType, mode,
      signing_order: signingOrder, status: 'draft', sender_id: sender.id, sender_name: sender.full_name, sender_email: sender.email,
      subject: subject || `Please sign: ${title}`, message, reminder_rule: reminderRule,
      expires_at: new Date(Date.now() + expiresDays * DAY).toISOString(), due_at: dueAt,
      fields, page_sizes: pageSizes || [], document_path: documentPath, original_sha256: originalSha256, is_demo: isDemo,
    }).select('*').single()
    if (error) throw new EngineError('insert_failed', error.message, 500)

    const roleOrder = new Map(roles.map((r, i) => [r.key, i]))
    const rows = copy.map((r, i) => {
      const role = roles.find(x => x.key === r.roleKey)
      const type = r.type || role?.type || 'signer'
      return {
        org_id: ORG_ID, request_id: req.id, role_key: r.roleKey || `cc${i}`,
        order_index: (roleOrder.get(r.roleKey) ?? (roles.length + i)) + 1,
        recipient_type: type, name: String(r.name || '').trim(), email: String(r.email || '').trim(),
        student_id: r.studentId || null, contact_id: r.contactId || null, school_name: r.schoolName || null,
        user_profile_id: staffByEmail.get(String(r.email || '').trim().toLowerCase()) || null,
        color: type === 'cc' ? 'slate' : colorForIndex(roleOrder.get(r.roleKey) ?? i),
        status: 'pending',
      }
    })
    const { data: signers, error: sErr } = await db.from('sig_request_signers').insert(rows).select(SIGNER_PUBLIC)
    if (sErr) throw new EngineError('insert_failed', sErr.message, 500)
    // Hash the derived link tokens now that ids exist.
    for (const s of signers) {
      await db.from('sig_request_signers').update({ access_token_hash: sha256(linkTokenFor(s.id, 1)) }).eq('id', s.id)
    }
    const senderFieldRows = fields.filter(f => f.role === SENDER_ROLE && senderValues[f.id] != null && String(senderValues[f.id]).trim() !== '')
      .map(f => ({ org_id: ORG_ID, request_id: req.id, field_id: f.id, signer_id: null, value: String(senderValues[f.id]) }))
    if (senderFieldRows.length) await db.from('sig_field_values').insert(senderFieldRows)

    await appendEvent(db, { requestId: req.id, type: 'created', actor: sender.full_name, ctx,
      details: { mode, bulk: !!bulkId, recipients: signers.length, document_type: documentType, original_sha256: originalSha256, excluded_confirmed: !!excludedConfirmed } })
    await db.from('sig_requests').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', req.id)
    await appendEvent(db, { requestId: req.id, type: 'sent', actor: sender.full_name, ctx, details: { signing_order: signingOrder } })
    await notifyTurn(db, req.id, { appUrl, mailer, ctx })
    created.push(req.id)
  }
  return { requestIds: created, bulkId }
}

/** Email whoever's turn it is and has not been told yet. */
export async function notifyTurn(db, requestId, { appUrl, mailer, ctx = {} }) {
  const b = await loadBundle(db, requestId)
  if (isFinal(b.request.status)) return
  for (const s of currentTurn(b.signers, b.request.signing_order)) {
    if (s.notified_at) continue
    const staff = !!s.user_profile_id && s.recipient_type === 'signer'
    const mail = staff
      ? staffTurnEmail({ request: b.request, signer: s, url: `${appUrl}/catalog/signatures?request=${b.request.id}` })
      : invitationEmail({ request: b.request, signer: s, url: signerLink(appUrl, s) })
    const sent = await sendMail(mailer, { from: fromLine(b.request.sender_name), to: s.email, ...mail, replyTo: b.request.sender_email })
    await db.from('sig_request_signers').update({ status: sent ? 'delivered' : 'sent', notified_at: new Date().toISOString() }).eq('id', s.id)
    await appendEvent(db, { requestId, signerId: s.id, type: 'delivered', actor: 'System', ctx,
      details: { to: s.email, accepted: !!sent, provider_id: sent?.id || null, staff } })
    if (s.order_index > 1 || b.signers.some(x => x.signed_at)) {
      await appendEvent(db, { requestId, signerId: s.id, type: 'routed', actor: 'System', details: { to: s.name } })
    }
  }
}

async function sendMail(mailer, { from, to, subject, html, replyTo, attachments }) {
  try {
    const { data, error } = await mailer.emails.send({ from, to: [to], subject, html, ...(replyTo ? { reply_to: replyTo } : {}), ...(attachments ? { attachments } : {}) })
    return error ? null : (data || { id: null })
  } catch { return null }
}

// ── The signer's side (token + code) ───────────────────────────────────────────────

/** Resolve a link token to its signer and request, refusing a dead link. */
export async function resolveLink(db, token) {
  const { data: s, error } = await db.from('sig_request_signers').select(`${SIGNER_PUBLIC}, code_hash, code_expires_at, code_sends, session_hash, session_expires_at, access_token_hash`)
    .eq('access_token_hash', sha256(token)).maybeSingle()
  if (notEnabled(error)) throw new EngineError('not_enabled', 'Signatures are not enabled yet.', 404)
  if (!s || s.status === 'replaced') throw new EngineError('bad_link', 'This link is not valid. Use the most recent email you received.', 404)
  const { data: request } = await db.from('sig_requests').select('*').eq('id', s.request_id).maybeSingle()
  if (!request) throw new EngineError('bad_link', 'This link is not valid.', 404)
  if (s.user_profile_id && s.recipient_type === 'signer') throw new EngineError('staff_signer', 'Sign this one inside ASPIRE Intelligence. Open the email that says "Sign in ASPIRE".', 403)
  return { signer: s, request }
}

export function linkIsLive(request) {
  if (request.status === 'completed') return { live: false, reason: 'This document is complete. The sealed copy was emailed to every party.' }
  if (request.status === 'voided') return { live: false, reason: `This request was cancelled by the sender${request.void_reason ? `: ${request.void_reason}` : '.'}` }
  if (request.status === 'declined') return { live: false, reason: 'This request was declined and is closed.' }
  if (request.status === 'expired' || (request.expires_at && new Date(request.expires_at).getTime() < Date.now())) return { live: false, reason: 'This request has expired. Ask the sender to send it again.' }
  return { live: true }
}

export async function sendCode(db, { signer, request, settings, mailer, ctx }) {
  if (signer.code_sends >= 10) throw new EngineError('too_many_codes', 'Too many codes were sent for this request. Contact the sender.', 429)
  const code = newCode()
  await db.from('sig_request_signers').update({
    code_hash: codeHash(signer.id, code), code_expires_at: new Date(Date.now() + settings.code_ttl_minutes * 60000).toISOString(),
    code_attempts: 0, code_sends: signer.code_sends + 1, code_sent_to: maskEmail(signer.email),
  }).eq('id', signer.id)
  const mail = codeEmail({ request, code, ttlMinutes: settings.code_ttl_minutes })
  const sent = await sendMail(mailer, { from: fromLine(request.sender_name), to: signer.email, ...mail })
  await appendEvent(db, { requestId: request.id, signerId: signer.id, type: 'code_sent', actor: signer.name, ctx, details: { sent_to: maskEmail(signer.email), accepted: !!sent } })
  if (!sent) throw new EngineError('mail_failed', 'The code could not be emailed. Try again in a moment.', 502)
  return { sentTo: maskEmail(signer.email), ttlMinutes: settings.code_ttl_minutes }
}

export async function verifyCode(db, { signer, request, code, settings, ctx }) {
  if (!signer.code_hash || !signer.code_expires_at) throw new EngineError('no_code', 'Send a code first.')
  if (new Date(signer.code_expires_at).getTime() < Date.now()) throw new EngineError('code_expired', 'That code has expired. Send a new code.')
  if (signer.code_attempts >= settings.code_max_attempts) throw new EngineError('code_locked', 'Too many tries. Send a new code.', 429)
  if (!codeMatches(signer.id, code, signer.code_hash)) {
    const attempts = signer.code_attempts + 1
    await db.from('sig_request_signers').update({ code_attempts: attempts }).eq('id', signer.id)
    await appendEvent(db, { requestId: request.id, signerId: signer.id, type: 'code_failed', actor: signer.name, ctx, details: { attempt: attempts } })
    const left = settings.code_max_attempts - attempts
    throw new EngineError('code_wrong', left > 0 ? `That code is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Too many tries. Send a new code.', 400)
  }
  const session = newSession()
  const now = new Date().toISOString()
  await db.from('sig_request_signers').update({
    code_hash: null, code_expires_at: null, verified_at: signer.verified_at || now, verify_method: 'email_code',
    status: signer.consented_at ? signer.status : 'verified', session_hash: session.hash, session_expires_at: session.expiresAt,
  }).eq('id', signer.id)
  await appendEvent(db, { requestId: request.id, signerId: signer.id, type: 'code_verified', actor: signer.name, ctx, details: { sent_to: signer.code_sent_to, failed_attempts: signer.code_attempts } })
  return { session: session.raw, expiresAt: session.expiresAt }
}

export function requireSession(signer, raw) {
  if (!raw || !signer.session_hash || sha256(raw) !== signer.session_hash) throw new EngineError('no_session', 'Confirm it is you with a one-time code first.', 401)
  if (new Date(signer.session_expires_at).getTime() < Date.now()) throw new EngineError('session_expired', 'Your session ended. Confirm it is you again.', 401)
}

export async function recordSampleOpened(db, { signer, request, ctx }) {
  if (!signer.sample_pdf_opened_at) await db.from('sig_request_signers').update({ sample_pdf_opened_at: new Date().toISOString() }).eq('id', signer.id)
  await appendEvent(db, { requestId: request.id, signerId: signer.id, type: 'sample_pdf_opened', actor: signer.name, ctx })
}

export async function recordConsent(db, { signer, request, settings, openedSample, agreed, ctx }) {
  if (!openedSample || !agreed) throw new EngineError('consent_incomplete', 'Check both boxes to continue.')
  if (!signer.sample_pdf_opened_at) throw new EngineError('sample_not_opened', 'Open the sample PDF first, so you know your device can read the format.')
  const now = new Date().toISOString()
  await db.from('sig_request_signers').update({ consent_version: settings.current_disclosure_version, consented_at: now, status: 'consented' }).eq('id', signer.id)
  await appendEvent(db, { requestId: request.id, signerId: signer.id, type: 'consent_accepted', actor: signer.name, ctx,
    details: { version: settings.current_disclosure_version, checked_sample_readable: true, checked_agree: true } })
}

export async function recordOpened(db, { signer, request, ctx }) {
  if (!signer.consented_at && !signer.user_profile_id) throw new EngineError('consent_required', 'Accept the consent to electronic records first.', 403)
  if (!signer.opened_at) {
    await db.from('sig_request_signers').update({ opened_at: new Date().toISOString(), status: signer.recipient_type === 'viewer' ? 'signed' : 'opened' }).eq('id', signer.id)
    await appendEvent(db, { requestId: request.id, signerId: signer.id, type: signer.recipient_type === 'viewer' ? 'viewed' : 'opened', actor: signer.name, ctx })
    await refreshStatus(db, request.id)
  }
}

/**
 * Apply the signer's values and adopted signature, and sign. The ONLY path that signs.
 * `values` holds only this signer's fields (and radio groups); anything else is ignored.
 */
export async function finishSigning(db, { signer, request, values, adopted, ctx, appUrl, mailer, settings, method = 'email_code', sealOptions = {} }) {
  const live = linkIsLive(request)
  if (!live.live) throw new EngineError('closed', live.reason, 409)
  if (signer.signed_at) throw new EngineError('already_signed', 'You already signed this document.', 409)
  const turn = currentTurn(await signersOf(db, request.id), request.signing_order)
  if (!turn.some(t => t.id === signer.id)) throw new EngineError('not_your_turn', 'It is not your turn to sign yet.', 409)
  if (method !== 'password' && !signer.consented_at) throw new EngineError('consent_required', 'Accept the consent to electronic records first.', 403)

  const fields = request.fields || []
  const mine = fields.filter(f => f.role === signer.role_key)
  const merged = { ...(await valuesOf(db, request.id)) }
  const allowedKeys = new Set([...mine.map(f => f.id), ...mine.filter(f => f.type === 'radio').map(f => f.group)])
  const now = new Date()
  for (const [k, v] of Object.entries(values || {})) if (allowedKeys.has(k)) merged[k] = v
  // Date signed is always the server's time; signature and initials come from the adoption.
  const needsSig = mine.some(f => f.type === 'sig' || f.type === 'ini')
  if (needsSig) {
    if (!adopted || !String(adopted.text || '').trim()) throw new EngineError('no_signature', 'Adopt your signature first.')
    if (adopted.kind === 'draw' && !adopted.path) throw new EngineError('no_signature', 'Draw your signature first.')
  }
  const adoptedClean = needsSig ? {
    kind: adopted.kind === 'draw' ? 'draw' : 'type', text: String(adopted.text).trim().slice(0, 120),
    initials: String(adopted.initials || initialsOf(adopted.text)).slice(0, 6),
    path: adopted.kind === 'draw' ? String(adopted.path || '').slice(0, 20000).replace(/[^MLQCZmlqcz0-9.,\s-]/g, '') : null,
  } : null
  for (const f of mine) {
    if (f.type === 'date') merged[f.id] = now.toLocaleDateString('en-US', { timeZone: settings.time_zone, month: '2-digit', day: '2-digit', year: 'numeric' })
    if (f.type === 'sig') merged[f.id] = adoptedClean.text
    if (f.type === 'ini') merged[f.id] = adoptedClean.initials
  }
  const unmet = unmetRequirements(fields, merged, signer.role_key)
  if (unmet.length) throw new EngineError('incomplete', unmet[0].message, 422)

  // Values: only this signer's keys.
  const rows = [...allowedKeys].filter(k => merged[k] != null && String(merged[k]) !== '')
    .map(k => ({ org_id: ORG_ID, request_id: request.id, field_id: k, signer_id: signer.id, value: String(merged[k]).slice(0, 2000), filled_at: now.toISOString() }))
  if (rows.length) {
    const { error } = await db.from('sig_field_values').upsert(rows, { onConflict: 'request_id,field_id' })
    if (error) throw new EngineError('save_failed', error.message, 500)
  }
  await db.from('sig_request_signers').update({ adopted_signature: adoptedClean, signed_at: now.toISOString(), status: 'signed', opened_at: signer.opened_at || now.toISOString() }).eq('id', signer.id)
  if (adoptedClean) await appendEvent(db, { requestId: request.id, signerId: signer.id, type: 'signature_adopted', actor: signer.name, ctx, details: { kind: adoptedClean.kind } })
  await appendEvent(db, { requestId: request.id, signerId: signer.id, type: 'signed', actor: signer.name, ctx,
    details: { fields: rows.length, kind: adoptedClean?.kind || 'none', method } })
  return advance(db, request.id, { appUrl, mailer, settings, ctx, sealOptions })
}

async function signersOf(db, requestId) {
  const { data } = await db.from('sig_request_signers').select(SIGNER_PUBLIC).eq('request_id', requestId)
  return data || []
}
async function valuesOf(db, requestId) {
  const { data } = await db.from('sig_field_values').select('field_id, value').eq('request_id', requestId)
  return Object.fromEntries((data || []).map(v => [v.field_id, v.value]))
}

async function refreshStatus(db, requestId) {
  const b = await loadBundle(db, requestId)
  const next = deriveRequestStatus(b.request, b.signers)
  if (next !== b.request.status) await db.from('sig_requests').update({ status: next }).eq('id', requestId)
  return next
}

/** After a signature: route to the next signer, or complete and seal. */
export async function advance(db, requestId, { appUrl, mailer, settings, ctx, sealOptions = {} }) {
  const signers = await signersOf(db, requestId)
  await refreshStatus(db, requestId)
  if (!allDone(signers)) {
    await notifyTurn(db, requestId, { appUrl, mailer, ctx })
    return { completed: false }
  }
  return completeAndSeal(db, requestId, { mailer, settings, appUrl, ...sealOptions })
}

// ── Completion: seal, file, return ─────────────────────────────────────────────────

export async function completeAndSeal(db, requestId, { mailer, settings, fetchImpl, env = process.env }) {
  const b = await loadBundle(db, requestId)
  if (b.request.sealed_path) return { completed: true, sealedSha256: b.request.sealed_sha256 }
  const completedAt = b.request.completed_at || new Date().toISOString()
  if (!b.request.completed_at) await db.from('sig_requests').update({ completed_at: completedAt }).eq('id', requestId)
  const request = { ...b.request, completed_at: completedAt }

  let sealed
  try {
    const { data: blob, error } = await db.storage.from(DOC_BUCKET).download(request.document_path)
    if (error || !blob) throw new Error('document missing')
    const documentBytes = Buffer.from(await blob.arrayBuffer())
    const service = new SealingService({ settings, orgName: settings.org_name, env, fetchImpl })
    sealed = await service.seal({ documentBytes, request, signers: b.signers, fields: request.fields, values: b.values, events: b.events, originalSha256: request.original_sha256 })
  } catch (err) {
    await db.from('sig_requests').update({ seal_attempts: (b.request.seal_attempts || 0) + 1 }).eq('id', requestId)
    await appendEvent(db, { requestId, type: 'seal_failed', actor: 'System', details: { reason: String(err.message).slice(0, 300), attempt: (b.request.seal_attempts || 0) + 1 } })
    return { completed: false, sealPending: true, reason: err.message }
  }

  await appendEvent(db, { requestId, type: 'content_timestamped', actor: sealed.contentTimestamp.tsa_name || 'Timestamp authority',
    details: { gen_time: sealed.contentTimestamp.gen_time, serial: sealed.contentTimestamp.serial, tsa_url: sealed.contentTimestamp.tsa_url, sha256: sealed.contentSha256 } })

  const path = `sealed/${requestId}/${request.envelope_code}.pdf`
  const up = await db.storage.from(DOC_BUCKET).upload(path, sealed.sealedBytes, { contentType: 'application/pdf', upsert: false })
  if (up.error && !/exists/i.test(up.error.message)) {
    await appendEvent(db, { requestId, type: 'seal_failed', actor: 'System', details: { reason: `store: ${up.error.message}` } })
    return { completed: false, sealPending: true }
  }
  const retentionDays = 2555
  await db.from('sig_requests').update({
    status: 'completed', sealed_path: path, sealed_sha256: sealed.sealedSha256,
    seal_timestamp: { content: sealed.contentTimestamp, seal: sealed.sealResult?.timestamp || null, certificate: sealed.sealResult?.certificate || null, provider: sealed.sealResult?.provider || null },
    retention_until: new Date(Date.now() + retentionDays * DAY).toISOString(),
  }).eq('id', requestId)
  await appendEvent(db, { requestId, type: 'sealed', actor: 'System', details: {
    sha256: sealed.sealedSha256, content_sha256: sealed.contentSha256, provider: sealed.sealResult?.provider,
    certificate: sealed.sealResult?.certificate?.subject, self_signed: sealed.sealResult?.certificate?.self_signed,
    seal_timestamp: sealed.sealResult?.timestamp?.gen_time || null, seal_timestamp_serial: sealed.sealResult?.timestamp?.serial || null,
    tsa_url: sealed.sealResult?.timestamp?.tsa_url || null,
  } })

  await fileToRecords(db, { request, signers: b.signers, bytes: sealed.sealedBytes })
  await sendCopies(db, { request: { ...request, sealed_sha256: sealed.sealedSha256 }, signers: b.signers, bytes: sealed.sealedBytes, mailer })
  return { completed: true, sealedSha256: sealed.sealedSha256 }
}

async function fileToRecords(db, { request, signers, bytes }) {
  const subjects = []
  for (const s of signers) {
    if (s.student_id) subjects.push({ subject_type: 'student', student_id: s.student_id, school_name: null })
    else if (s.school_name) subjects.push({ subject_type: 'school', student_id: null, school_name: s.school_name })
  }
  const seen = new Set()
  for (const sub of subjects) {
    const key = sub.student_id || `school:${sub.school_name}`
    if (seen.has(key)) continue
    seen.add(key)
    const path = `${sub.subject_type}/${sub.student_id || createHash('sha256').update(sub.school_name).digest('hex').slice(0, 16)}/${randomUUID()}.pdf`
    const up = await db.storage.from(RECORD_BUCKET).upload(path, bytes, { contentType: 'application/pdf', upsert: false })
    if (up.error) { await appendEvent(db, { requestId: request.id, type: 'filed_to_record', actor: 'System', details: { ok: false, reason: up.error.message } }); continue }
    const { error } = await db.from('record_documents').insert({
      ...sub, title: `${request.title} (signed)`, file_name: `${request.envelope_code}.pdf`, storage_path: path,
      content_type: 'application/pdf', size_bytes: bytes.length, source: 'signature', source_ref: request.id, is_demo: request.is_demo === true,
    })
    await appendEvent(db, { requestId: request.id, type: 'filed_to_record', actor: 'System',
      details: { ok: !error, subject: sub.subject_type, ...(error ? { reason: error.message } : {}) } })
  }
}

async function sendCopies(db, { request, signers, bytes, mailer }) {
  const recipients = signers.filter(s => s.status !== 'replaced').map(s => ({ name: s.name, email: s.email, id: s.id }))
  if (request.sender_email && !recipients.some(r => r.email.toLowerCase() === request.sender_email.toLowerCase())) recipients.push({ name: request.sender_name, email: request.sender_email, id: null })
  let ok = 0
  for (const r of recipients) {
    const mail = completedEmail({ request, recipientName: r.name, sealedSha256: request.sealed_sha256 })
    const sent = await sendMail(mailer, { from: fromLine(request.sender_name), to: r.email, ...mail,
      attachments: [{ filename: `${request.title.replace(/[^\w .-]+/g, '').slice(0, 80) || 'Signed document'} (sealed).pdf`, content: bytes.toString('base64') }] })
    if (sent) { ok++; if (r.id) await db.from('sig_request_signers').update({ completed_copy_sent_at: new Date().toISOString() }).eq('id', r.id) }
  }
  await appendEvent(db, { requestId: request.id, type: 'copies_sent', actor: 'System', details: { recipients: recipients.length, accepted: ok } })
}

// ── Decline, delegate, paper copy ──────────────────────────────────────────────────

export async function declineSigning(db, { signer, request, reason, ctx, mailer, appUrl }) {
  const r = String(reason || '').trim()
  if (!r) throw new EngineError('reason_required', 'Tell the sender why you are declining.')
  const now = new Date().toISOString()
  await db.from('sig_request_signers').update({ declined_at: now, decline_reason: r.slice(0, 500), status: 'declined', session_hash: null }).eq('id', signer.id)
  await db.from('sig_requests').update({ status: 'declined' }).eq('id', request.id)
  await appendEvent(db, { requestId: request.id, signerId: signer.id, type: 'declined', actor: signer.name, ctx, details: { reason: r.slice(0, 500) } })
  await notifySender(mailer, request, `${signer.name} declined to sign`, `Reason: ${r}`, appUrl)
}

export async function requestDelegation(db, { signer, request, name, email, reason, ctx, mailer, appUrl }) {
  if (!String(name || '').trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email || '').trim())) throw new EngineError('invalid', 'Add the new signer\'s name and a valid email.')
  const delegation = { name: String(name).trim().slice(0, 120), email: String(email).trim().slice(0, 200), reason: String(reason || '').trim().slice(0, 500), requested_at: new Date().toISOString(), status: 'pending' }
  await db.from('sig_request_signers').update({ delegation }).eq('id', signer.id)
  await appendEvent(db, { requestId: request.id, signerId: signer.id, type: 'delegation_requested', actor: signer.name, ctx, details: { to_name: delegation.name, to_email: maskEmail(delegation.email), reason: delegation.reason } })
  await notifySender(mailer, request, `${signer.name} asked to reassign ${request.title}`, `To: ${delegation.name} <${delegation.email}>. Reason: ${delegation.reason || 'none given'}. Approve or decline it in Signature requests.`, appUrl)
}

export async function requestPaperCopy(db, { signer, request, ctx, mailer, appUrl }) {
  await db.from('sig_request_signers').update({ paper_copy_requested_at: new Date().toISOString() }).eq('id', signer.id)
  await appendEvent(db, { requestId: request.id, signerId: signer.id, type: 'paper_copy_requested', actor: signer.name, ctx })
  await notifySender(mailer, request, `${signer.name} asked for a paper copy`, `Send a paper copy of ${request.title} to ${signer.name} (${signer.email}) at no cost.`, appUrl)
}

async function notifySender(mailer, request, headline, detail, appUrl) {
  if (!request.sender_email) return
  const mail = senderNoticeEmail({ request, headline, detail, url: `${appUrl}/catalog/signatures?request=${request.id}` })
  await sendMail(mailer, { from: fromLine('ASPIRE Intelligence'), to: request.sender_email, ...mail })
}

// ── Staff actions ──────────────────────────────────────────────────────────────────

export async function voidRequest(db, { requestId, reason, actor, ctx, mailer }) {
  const r = String(reason || '').trim()
  if (!r) throw new EngineError('reason_required', 'A reason is required to void.')
  const b = await loadBundle(db, requestId)
  if (isFinal(b.request.status) || b.request.status === 'draft') throw new EngineError('closed', 'Only a request that is out for signature can be voided.', 409)
  await db.from('sig_requests').update({ status: 'voided', voided_at: new Date().toISOString(), void_reason: r.slice(0, 500) }).eq('id', requestId)
  await db.from('sig_request_signers').update({ session_hash: null }).eq('request_id', requestId)
  await appendEvent(db, { requestId, type: 'voided', actor, ctx, details: { reason: r.slice(0, 500) } })
  for (const s of b.signers.filter(x => x.notified_at && x.status !== 'replaced')) {
    const mail = voidedEmail({ request: b.request, recipientName: s.name, reason: r })
    await sendMail(mailer, { from: fromLine(b.request.sender_name), to: s.email, ...mail })
  }
}

export async function remind(db, { requestId, actor, ctx, appUrl, mailer, auto = false }) {
  const b = await loadBundle(db, requestId)
  if (isFinal(b.request.status) || b.request.status === 'draft') return 0
  let n = 0
  for (const s of currentTurn(b.signers, b.request.signing_order)) {
    const staff = !!s.user_profile_id && s.recipient_type === 'signer'
    const mail = staff
      ? staffTurnEmail({ request: b.request, signer: s, url: `${appUrl}/catalog/signatures?request=${b.request.id}` })
      : invitationEmail({ request: b.request, signer: s, url: signerLink(appUrl, s), reminder: true })
    const sent = await sendMail(mailer, { from: fromLine(b.request.sender_name), to: s.email, ...mail, replyTo: b.request.sender_email })
    await db.from('sig_request_signers').update({ last_reminded_at: new Date().toISOString(), reminder_count: (s.reminder_count || 0) + 1, notified_at: s.notified_at || new Date().toISOString() }).eq('id', s.id)
    await appendEvent(db, { requestId, signerId: s.id, type: 'reminder_sent', actor: auto ? 'System' : actor, ctx, details: { accepted: !!sent, automatic: auto } })
    if (sent) n++
  }
  return n
}

export async function decideDelegation(db, { requestId, signerId, approve, actor, ctx, appUrl, mailer }) {
  const b = await loadBundle(db, requestId)
  const s = b.signers.find(x => x.id === signerId)
  if (!s?.delegation || s.delegation.status !== 'pending') throw new EngineError('no_delegation', 'There is no pending reassignment.', 409)
  if (!approve) {
    await db.from('sig_request_signers').update({ delegation: { ...s.delegation, status: 'rejected' } }).eq('id', s.id)
    await appendEvent(db, { requestId, signerId: s.id, type: 'delegation_rejected', actor, ctx })
    return
  }
  // The original signer is replaced; the new one takes the same role, order and fields.
  await db.from('sig_request_signers').update({ status: 'replaced', session_hash: null, delegation: { ...s.delegation, status: 'approved' } }).eq('id', s.id)
  const { data: created, error } = await db.from('sig_request_signers').insert({
    org_id: ORG_ID, request_id: requestId, role_key: s.role_key, order_index: s.order_index, recipient_type: s.recipient_type,
    name: s.delegation.name, email: s.delegation.email, color: s.color, status: 'pending',
  }).select('id').single()
  if (error) throw new EngineError('insert_failed', error.message, 500)
  await db.from('sig_request_signers').update({ access_token_hash: sha256(linkTokenFor(created.id, 1)) }).eq('id', created.id)
  await appendEvent(db, { requestId, signerId: created.id, type: 'delegation_approved', actor, ctx, details: { from: s.name, to: s.delegation.name } })
  await notifyTurn(db, requestId, { appUrl, mailer, ctx })
}

// ── Staff signing in the app (password) ────────────────────────────────────────────

export async function staffSign(db, { requestId, profile, passwordVerified, values, typedName, agree, ctx, appUrl, mailer, settings, sealOptions = {} }) {
  if (!passwordVerified) throw new EngineError('password', 'That password is not right.', 401)
  if (!agree) throw new EngineError('agree_required', 'Confirm that your typed name is your electronic signature.')
  const b = await loadBundle(db, requestId)
  const s = b.signers.find(x => x.user_profile_id === profile.id && x.recipient_type === 'signer' && x.status !== 'replaced')
  if (!s) throw new EngineError('not_signer', 'You are not a signer on this document.', 403)
  const now = new Date().toISOString()
  await db.from('sig_request_signers').update({ verified_at: now, verify_method: 'password', opened_at: s.opened_at || now }).eq('id', s.id)
  await appendEvent(db, { requestId, signerId: s.id, type: 'opened', actor: s.name, ctx, details: { in_app: true } })
  await appendEvent(db, { requestId, signerId: s.id, type: 'password_verified', actor: s.name, ctx })
  const text = String(typedName || s.name).trim()
  return finishSigning(db, {
    signer: { ...s, opened_at: s.opened_at || now }, request: b.request, values, method: 'password',
    adopted: { kind: 'type', text, initials: initialsOf(text) }, ctx, appUrl, mailer, settings, sealOptions,
  })
}

// ── Maintenance (cron) ─────────────────────────────────────────────────────────────

export async function maintenance(db, { appUrl, mailer, settings, now = Date.now(), sealOptions = {} }) {
  const out = { expired: 0, reminded: 0, resealed: 0 }
  const { data: open } = await db.from('sig_requests').select('id, status, signing_order, expires_at, reminder_rule, sealed_path, completed_at, seal_attempts')
    .in('status', ['sent', 'opened', 'progress']).eq('is_demo', false).limit(500)
  for (const r of open || []) {
    if (r.completed_at && !r.sealed_path && (r.seal_attempts || 0) < 12) {
      const res = await completeAndSeal(db, r.id, { mailer, settings, appUrl, ...sealOptions }); if (res.completed) out.resealed++
      continue
    }
    if (r.expires_at && new Date(r.expires_at).getTime() < now) {
      await db.from('sig_requests').update({ status: 'expired' }).eq('id', r.id)
      await db.from('sig_request_signers').update({ session_hash: null }).eq('request_id', r.id)
      await appendEvent(db, { requestId: r.id, type: 'expired', actor: 'System' })
      out.expired++
      continue
    }
    if (r.reminder_rule === 'off') continue
    const { data: signers } = await db.from('sig_request_signers').select(SIGNER_PUBLIC).eq('request_id', r.id)
    const turn = currentTurn(signers || [], r.signing_order)
    const due = turn.some(s => {
      const last = new Date(s.last_reminded_at || s.notified_at || 0).getTime()
      if (r.reminder_rule === 'every_3_days') return last && now - last >= 3 * DAY
      if (r.reminder_rule === 'once_before_expiry') return !s.reminder_count && r.expires_at && new Date(r.expires_at).getTime() - now <= 2 * DAY
      return false
    })
    if (due) out.reminded += await remind(db, { requestId: r.id, actor: 'System', appUrl, mailer, auto: true })
  }
  return out
}

