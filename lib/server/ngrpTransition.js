// lib/server/ngrpTransition.js
//
// NGRP-RELEASE-2 (integrity correction): the Transition Form lifecycle core -
// assignment/token issuance, the per-recipient send unit of work, the public
// load/save/submit logic, and submission validation. Node-safe and
// db-injected so every rule is unit-testable with a mocked client.
//
// TOKEN POSTURE (the evaluation-token rules, verbatim):
// - Raw tokens exist only inside the sending function's scope and inside the
//   emailed URL fragment. They are never stored, logged, or returned to any
//   staff payload. Only the HMAC hash + its 8-char prefix persist.
// - The minting function is INJECTED (lib/server/evaluation/tokens.js in
//   production) so this module never touches the pepper directly.
// - Revocation is always BY TOKEN ID, never by assignment_id.
//
// DELIVERY-SAFE TOKEN LIFECYCLE: a resend PREPARES the replacement token as
// 'pending' - unusable by the public endpoint - while the OLD token stays
// active. Only after the provider ACCEPTED the email does
// ngrp_activate_token_tx atomically activate the new token, revoke the old
// one, and (for a first send) flip the pending assignment to 'sent'. Only an
// EXPLICIT provider rejection runs ngrp_fail_token_tx (pending token failed;
// a never-delivered first-send assignment revoked); after acceptance the
// emailed token is never failed - an activation failure leaves it pending
// and RECOVERABLE, and a same-batch replay resumes it (see
// sendOneTransitionForm). Nothing can ever read as Sent before acceptance
// AND activation, and a failed resend can never strand the alumnus without
// a working link.
import { computeEligibility, extractEligibilityFacts, validateApplicationChecklist, validateQualificationRules } from './ngrpEligibility.js'

export const FORM_STATUSES = ['pending', 'sent', 'opened', 'in_progress', 'submitted', 'revised']

const isDateShape = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

// A REAL calendar date - shape alone is not enough (2026-99-99 must fail).
export function isRealDate(v) {
  if (!isDateShape(v)) return false
  const [y, m, d] = v.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

// 11:59:59.999 PM in America/Los_Angeles on the given date, as a UTC ISO
// instant, DST-aware: a PST date resolves to 07:59:59.999Z the next day, a
// PDT date to 06:59:59.999Z. This is the SAME rule the database enforces in
// ngrp_pacific_deadline(), so server enforcement, email copy, the public
// form, Planning readiness, and assignment creation all share one close.
export function pacificEndOfDay(dateStr) {
  if (!isRealDate(dateStr)) return null
  const [y, m, d] = dateStr.split('-').map(Number)
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false,
  })
  for (const offsetHours of [7, 8]) {   // PDT, then PST
    const utcMs = Date.UTC(y, m - 1, d, 23 + offsetHours, 59, 59, 999)
    const parts = fmt.formatToParts(new Date(utcMs))
    const get = t => parts.find(p => p.type === t)?.value
    if (`${get('year')}-${get('month')}-${get('day')}` === dateStr && get('hour') === '23') {
      return new Date(utcMs).toISOString()
    }
  }
  // Unreachable for America/Los_Angeles (transitions happen at 2 AM), but a
  // deterministic PST fallback beats throwing inside a request.
  return new Date(Date.UTC(y, m - 1, d + 1, 7, 59, 59, 999)).toISOString()
}

// The effective close of a form: the assignment's own deadline when one was
// set, else Pacific end-of-day on the cycle's application deadline. Null
// means "no close is configured" - sending is refused upstream in that case.
// The transactional submit/save functions re-enforce the same rule in-db.
export function effectiveFormClose(cycle, assignment) {
  if (assignment?.deadline_at) return assignment.deadline_at
  if (isRealDate(cycle?.application_deadline)) return pacificEndOfDay(cycle.application_deadline)
  return null
}

// NGRP-TRANSITION-COPY-2: the optional per-send close date. BLANK IS THE NORMAL CASE and
// means "use the residency cohort's application deadline" - exactly what every send did
// before this field existed, so an untouched panel behaves identically.
//
// A supplied date is a calendar date in Pacific terms, resolved to Pacific end-of-day by
// the same helper the cohort deadline uses, so both sources produce the same kind of
// instant and the email formats one rule, not two. A past date is refused rather than
// clamped: it would mail a link that is already closed.
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
export function parseFormCloseDate(raw, nowIso) {
  if (raw === undefined || raw === null || raw === '') return { closeAt: null }
  if (typeof raw !== 'string' || !DATE_ONLY.test(raw)) return { error: 'invalid_form_close_date' }
  const [y, m, d] = raw.split('-').map(Number)
  const probe = new Date(Date.UTC(y, m - 1, d))
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    return { error: 'invalid_form_close_date' }
  }
  const closeAt = pacificEndOfDay(raw)
  if (nowIso && closeAt <= nowIso) return { error: 'form_close_date_in_past' }
  return { closeAt }
}

export function isFormClosed(cycle, assignment, nowIso) {
  const close = effectiveFormClose(cycle, assignment)
  return Boolean(close && nowIso && nowIso > close)
}

// ── Recipient classification (pure) ─────────────────────────────────────────
// Decide, per selected student, what a send would do. A live PENDING
// assignment (a crashed or failed earlier attempt that was never delivered)
// is NOT "already sent" - it goes back into the send bucket and is reused.
export function classifySendRecipients({ students, candidatesByStudent, liveAssignmentsByCandidate, resend = false }) {
  const send = [], reissue = [], skipped = []
  for (const s of students || []) {
    if (s.status !== 'Completed') { skipped.push({ student: s, reason: 'not_completed' }); continue }
    if (!s.has_email) { skipped.push({ student: s, reason: 'missing_email' }); continue }
    const candidate = candidatesByStudent.get(s.id) || null
    const assignment = candidate ? (liveAssignmentsByCandidate.get(candidate.id) || null) : null
    const delivered = assignment && assignment.status !== 'pending' ? assignment : null
    if (!delivered) { send.push({ student: s, candidate, assignment: assignment || null }); continue }
    if (resend) reissue.push({ student: s, candidate, assignment })
    else skipped.push({ student: s, reason: 'already_sent' })
  }
  return { send, reissue, skipped }
}

// ── Candidate / assignment / token db helpers ───────────────────────────────

export async function ensureCandidate(db, { cycleId, studentId }) {
  const existing = await db.from('ngrp_candidates')
    .select('*').eq('cycle_id', cycleId).eq('student_id', studentId).maybeSingle()
  if (existing.error) return { error: existing.error }
  if (existing.data) return { candidate: existing.data, created: false }
  const inserted = await db.from('ngrp_candidates')
    .insert({ cycle_id: cycleId, student_id: studentId }).select('*').maybeSingle()
  if (inserted.data) return { candidate: inserted.data, created: true }
  // Unique (cycle_id, student_id) race: someone else inserted - re-read.
  const reread = await db.from('ngrp_candidates')
    .select('*').eq('cycle_id', cycleId).eq('student_id', studentId).maybeSingle()
  if (reread.data) return { candidate: reread.data, created: false }
  return { error: inserted.error || reread.error || new Error('candidate_upsert_failed') }
}

export async function liveAssignmentForCandidate(db, candidateId) {
  const { data, error } = await db.from('ngrp_transition_assignments')
    .select('*').eq('candidate_id', candidateId).is('revoked_at', null).maybeSingle()
  if (error) return { error }
  return { assignment: data || null }
}

// Always by token id (never by assignment_id). Staff revocation of a live
// link: status + revoked_at move together (the DB CHECK ties them).
export async function revokeTokensById(db, tokenIds, actorProfileId) {
  if (!tokenIds || tokenIds.length === 0) return { ok: true }
  const { error } = await db.from('ngrp_transition_tokens')
    .update({ status: 'revoked', revoked_at: new Date().toISOString(), revoked_by_profile_id: actorProfileId })
    .in('id', tokenIds)
  if (error) return { ok: false, error }
  return { ok: true }
}

const rpcMessage = err => String(err?.message || '')

// ── The per-recipient send unit of work (durable and replay-safe) ───────────
// ctx: { db, cycle, student, candidate|null, assignment|null, batchId,
//        actorProfileId, generateToken, sendEmail, buildEmail, baseUrl }
// generateToken: () => { raw, hash, hashPrefix }   (injected)
// sendEmail: async ({ to, subject, html, idempotencyKey }) => { ok, providerId?, reason? }
// buildEmail: ({ student, cycle, url, closeText }) => { subject, html }
//
// ONE KEY ⇄ ONE TOKEN: the durable (batch_id, candidate_id) delivery row is
// claimed BEFORE any token exists and bound (token_id) to the exact prepared
// token BEFORE the provider is called, so the provider idempotency key
// (batch + candidate) can only ever correspond to one tokenized email body.
// A same-batch replay therefore NEVER mints another token and NEVER calls
// the provider again - it resumes the recorded attempt:
//   accepted row                          -> skipped (already sent)
//   token active, ledger lagging          -> repair the ledger only
//   provider accepted, token still pending-> retry activation of THAT token
//   failed / indeterminate attempting     -> recovery_required_new_batch
// (a deliberate re-attempt uses a NEW batch id: new token, new key).
//
// Returns { outcome: 'sent'|'resent'|'repaired'|'skipped'|'failed', reason?,
//           candidateId?, assignmentId?, tokenHashPrefix?, providerId?,
//           providerAccepted?, recoverable?, activatedOnReplay?, warnings }
// - never the raw token. 'sent'/'resent' means the provider ACCEPTED the
// email AND its exact token was activated; every failure leaves any
// previously working link untouched.
export async function sendOneTransitionForm(ctx) {
  const { db, cycle, student, batchId } = ctx
  const warnings = []
  if (!batchId) return { outcome: 'failed', reason: 'batch_required', warnings }

  // 1. Candidate attempt (idempotent).
  let candidate = ctx.candidate
  if (!candidate) {
    const ensured = await ensureCandidate(db, { cycleId: cycle.id, studentId: student.id })
    if (ensured.error) return { outcome: 'failed', reason: 'candidate_write_failed', warnings }
    candidate = ensured.candidate
  }

  // 2. Claim the durable delivery row. A unique-key conflict means this
  //    batch has already attempted this alumnus: RESUME that attempt.
  const claimed = await db.from('ngrp_transition_deliveries')
    .insert({
      batch_id: batchId, cycle_id: cycle.id, candidate_id: candidate.id,
      student_id: student.id, status: 'attempting',
    })
    .select('*').maybeSingle()
  if (claimed.data) return freshDeliveryAttempt(ctx, candidate, claimed.data, warnings)
  if (claimed.error?.code !== '23505') {
    return { outcome: 'failed', reason: 'ledger_unavailable', candidateId: candidate.id, warnings }
  }
  const existing = await db.from('ngrp_transition_deliveries')
    .select('*').eq('batch_id', batchId).eq('candidate_id', candidate.id).maybeSingle()
  if (existing.error || !existing.data) {
    return { outcome: 'failed', reason: 'ledger_unavailable', candidateId: candidate.id, warnings }
  }
  return resumeDeliveryAttempt(ctx, candidate, existing.data, warnings)
}

// A brand-new (batch, candidate) attempt: prepare -> bind -> send -> record
// acceptance -> activate the exact token -> settle the ledger.
async function freshDeliveryAttempt(ctx, candidate, delivery, warnings) {
  const { db, cycle, student, actorProfileId, generateToken, sendEmail, buildEmail, baseUrl, batchId, formCloseAt = null } = ctx
  const fail = (reason, extra = {}) => ({ outcome: 'failed', reason, candidateId: candidate.id, warnings, ...extra })
  const markRow = patch => db.from('ngrp_transition_deliveries').update(patch).eq('id', delivery.id)

  // Assignment: reuse the live one (a delivered one keeps its lifecycle
  // history; a leftover pending one is simply retried), or create a fresh
  // PENDING row - it becomes 'sent' only on provider acceptance.
  let assignment = ctx.assignment || null
  if (!assignment) {
    const live = await liveAssignmentForCandidate(db, candidate.id)
    if (live.error) {
      await markRow({ status: 'failed', failed_reason: 'assignment_read_failed' })
      return fail('assignment_read_failed')
    }
    assignment = live.assignment
  }
  if (!assignment) {
    const inserted = await db.from('ngrp_transition_assignments')
      .insert({
        candidate_id: candidate.id, sent_by_profile_id: actorProfileId, status: 'pending', sent_at: null,
        deadline_at: formCloseAt,
      })
      .select('*').maybeSingle()
    if (!inserted.data) {
      await markRow({ status: 'failed', failed_reason: 'assignment_write_failed' })
      return fail('assignment_write_failed')
    }
    assignment = inserted.data
  }

  // NGRP-TRANSITION-COPY-2: a per-send close date governs the assignment this email
  // points at, INCLUDING a reused one - the date the sender just chose is the date the
  // email will state, so the form has to enforce that same date rather than the cohort
  // default. This runs BEFORE any token is minted, so a failure costs nothing: the
  // pending assignment is simply not sent.
  //
  // FAIL CLOSED, and this one matters. If the write fails and the send continued, the
  // email would promise a date effectiveFormClose does not honor. An extended date would
  // read as "you have until the 20th" while the form shut on the 5th, and the student
  // would find that out by being locked out. A refused send is recoverable; that is not.
  if (formCloseAt && assignment.deadline_at !== formCloseAt) {
    const dated = await db.from('ngrp_transition_assignments')
      .update({ deadline_at: formCloseAt }).eq('id', assignment.id).select('*').maybeSingle()
    if (!dated.data) {
      await markRow({ status: 'failed', failed_reason: 'form_close_write_failed' })
      return fail('form_close_write_failed')
    }
    assignment = dated.data
  }

  // Prepare the REPLACEMENT token as 'pending'. Any old active token stays
  // valid: nothing is revoked until the new email is accepted.
  const { raw, hash, hashPrefix } = generateToken()
  const insertedToken = await db.from('ngrp_transition_tokens')
    .insert({
      assignment_id: assignment.id, token_hash: hash, token_hash_prefix: hashPrefix,
      status: 'pending', created_by_profile_id: actorProfileId,
    })
    .select('id').maybeSingle()
  if (!insertedToken.data) {
    await markRow({ status: 'failed', failed_reason: 'token_write_failed' })
    return fail('token_write_failed')
  }
  const tokenId = insertedToken.data.id

  // BIND the delivery attempt to the exact prepared token BEFORE the
  // provider call. If binding fails, the provider is NOT called (the key
  // must never fly unbound) and the untouched pending token simply expires
  // into irrelevance - it is deliberately not failed (no provider verdict).
  const bound = await markRow({ token_id: tokenId, token_hash_prefix: hashPrefix })
  if (bound.error) return fail('ledger_unavailable')

  // Send. The URL carries the raw token in the FRAGMENT only, and the
  // idempotency key is now permanently tied to THIS token's email.
  const url = `${baseUrl}/ngrp/transition#t=${raw}`
  const closeText = effectiveFormClose(cycle, assignment)
  const { subject, html } = buildEmail({ student, cycle, url, closeText })
  const sent = await sendEmail({
    to: student.email, subject, html,
    idempotencyKey: `ngrp-transition/${batchId}:${candidate.id}`,
  })

  if (!sent.ok) {
    if (sent.reason === 'provider_rejected') {
      // ONLY an explicit provider rejection fails the pending token (and,
      // for an undelivered first send, revokes the pending assignment) -
      // atomically, without touching any old active token.
      await db.rpc('ngrp_fail_token_tx', {
        p_token_id: tokenId, p_actor: actorProfileId, p_reason: 'provider_rejected',
      })
      const marked = await markRow({ status: 'failed', failed_reason: 'provider_rejected' })
      if (marked.error) warnings.push({ student_id: student.id, warning: 'delivery_ledger_update_failed' })
      return fail('provider_rejected')
    }
    // Indeterminate provider error (exception/timeout): the email MAY be
    // out, so nothing is failed or revoked - the row stays 'attempting' and
    // a same-batch replay reports recovery-required instead of guessing.
    return fail(sent.reason || 'provider_error', { indeterminate: true })
  }

  // Provider ACCEPTED: record acceptance against this delivery + token
  // BEFORE activation, so a crash here is resumable without another email.
  const acceptedProvider = await markRow({
    provider_accepted_at: new Date().toISOString(),
    provider_email_id: sent.providerId || null,
  })
  if (acceptedProvider.error) warnings.push({ student_id: student.id, warning: 'provider_acceptance_record_failed' })

  // Activate the EXACT emailed token (atomic: activates-new, revokes-old,
  // flips a first send's pending assignment to 'sent', audits in-tx).
  const act = await db.rpc('ngrp_activate_token_tx', { p_token_id: tokenId, p_actor: actorProfileId })
  if (act.error) {
    // The alumnus HAS this token's email: keep it pending and recoverable -
    // it is deliberately NOT failed. A same-batch replay retries activation
    // of this same token with no further provider call.
    return fail('activation_failed', { providerAccepted: true, recoverable: true })
  }

  // Settle the ledger AFTER activation; a failure here is repaired by a
  // same-batch replay without sending anything.
  const done = await markRow({ status: 'accepted', accepted_at: new Date().toISOString() })
  if (done.error) warnings.push({ student_id: student.id, warning: 'delivery_ledger_update_failed' })

  return {
    outcome: act.data?.first_send ? 'sent' : 'resent',
    candidateId: candidate.id,
    assignmentId: assignment.id,
    tokenHashPrefix: hashPrefix,
    providerId: sent.providerId || null,
    subject,
    warnings,
  }
}

// A same-batch replay: resume the recorded attempt. This path NEVER calls
// the provider and NEVER mints a token - the recorded token_id is the only
// token this batch may ever act on.
async function resumeDeliveryAttempt(ctx, candidate, delivery, warnings) {
  const { db, student, actorProfileId } = ctx
  const fail = (reason, extra = {}) => ({ outcome: 'failed', reason, candidateId: candidate.id, warnings, ...extra })
  const markRow = patch => db.from('ngrp_transition_deliveries').update(patch).eq('id', delivery.id)

  if (delivery.status === 'accepted') {
    return { outcome: 'skipped', reason: 'already_sent_in_batch', candidateId: candidate.id, warnings }
  }

  let token = null
  if (delivery.token_id) {
    const tok = await db.from('ngrp_transition_tokens')
      .select('id, status, token_hash_prefix').eq('id', delivery.token_id).maybeSingle()
    if (tok.error) return fail('ledger_unavailable')
    token = tok.data
  }

  // Activation already completed; only the ledger lagged. Repair it without
  // touching the provider or any token.
  if (token?.status === 'active') {
    const repaired = await markRow({
      status: 'accepted',
      accepted_at: new Date().toISOString(),
      provider_accepted_at: delivery.provider_accepted_at || new Date().toISOString(),
    })
    if (repaired.error) return fail('ledger_unavailable')
    return {
      outcome: 'repaired', candidateId: candidate.id,
      tokenHashPrefix: token.token_hash_prefix, providerId: delivery.provider_email_id || null,
      warnings,
    }
  }

  // The provider accepted the ORIGINAL email and its exact token is still
  // pending: retry activation of THAT token. The alumnus already holds this
  // link - activating any other token would strand them.
  if (delivery.provider_accepted_at && token?.status === 'pending') {
    const act = await db.rpc('ngrp_activate_token_tx', { p_token_id: token.id, p_actor: actorProfileId })
    if (act.error) return fail('activation_failed', { providerAccepted: true, recoverable: true })
    const done = await markRow({ status: 'accepted', accepted_at: new Date().toISOString() })
    if (done.error) warnings.push({ student_id: student.id, warning: 'delivery_ledger_update_failed' })
    return {
      outcome: act.data?.first_send ? 'sent' : 'resent',
      activatedOnReplay: true,
      candidateId: candidate.id,
      tokenHashPrefix: token.token_hash_prefix, providerId: delivery.provider_email_id || null,
      warnings,
    }
  }

  // Failed, or an indeterminate 'attempting' state with no recorded
  // provider acceptance: this batch may not re-arm the row and mail again.
  // A deliberate new send uses a NEW batch id (new token, new key).
  return fail('recovery_required_new_batch')
}

// ── Public form resolution (token → exactly one assignment) ─────────────────
// ONLY 'active' tokens resolve: pending (prepared, not yet delivered),
// failed, and revoked tokens are all one indistinguishable 'unknown'.
export async function resolveTokenAssignment(db, tokenHash, nowIso) {
  const tok = await db.from('ngrp_transition_tokens')
    .select('*').eq('token_hash', tokenHash).maybeSingle()
  if (tok.error) return { state: 'error' }
  if (!tok.data || tok.data.status !== 'active' || tok.data.revoked_at) return { state: 'unknown' }

  const asg = await db.from('ngrp_transition_assignments')
    .select('*').eq('id', tok.data.assignment_id).maybeSingle()
  if (asg.error) return { state: 'error' }
  if (!asg.data || asg.data.revoked_at || asg.data.status === 'pending') return { state: 'unknown' }

  const cand = await db.from('ngrp_candidates')
    .select('*').eq('id', asg.data.candidate_id).maybeSingle()
  if (cand.error || !cand.data) return { state: 'error' }

  const cyc = await db.from('ngrp_cycles')
    .select('*').eq('id', cand.data.cycle_id).maybeSingle()
  if (cyc.error || !cyc.data) return { state: 'error' }

  const closed = isFormClosed(cyc.data, asg.data, nowIso)
  return {
    state: 'ok', closed,
    token: tok.data, assignment: asg.data, candidate: cand.data, cycle: cyc.data,
  }
}

// ── Submission payload validation (pure) ────────────────────────────────────
// Canonicalizes the alumnus payload: unexpected keys are dropped, required
// structure is enforced, and with requireComplete the submission must carry
// every fact the ACTIVE cycle rules need to calculate eligibility - a
// submitted form may never sit at Pending because the server accepted an
// incomplete one. Readiness checkboxes are a snapshot, never required true.
const INTERESTS = ['interested', 'undecided', 'not_interested']
const CS_EMPLOYMENT = ['not_employed', 'per_diem', 'part_time', 'full_time', 'other']
const CERT_STATUSES = ['active', 'expired', 'none', 'pending']
const LICENSE_STATUSES = ['active', 'pending', 'none']
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const str = (v, max = 400) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const longStr = (v, max = 8000) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const dateOrNull = v => (isRealDate(v) ? v : null)
const numOrNull = v => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}
const boolOrNull = v => (v === true ? true : v === false ? false : null)

export function validateSubmission(rawPayload, { activeUnitNames = [], checklist = null, rules = null, requireComplete = true } = {}) {
  const p = (rawPayload && typeof rawPayload === 'object' && !Array.isArray(rawPayload)) ? rawPayload : {}
  const errors = []
  const identity = p.identity || {}
  const education = p.education || {}
  const aspire = p.aspire || {}
  const lic = p.licensure || {}
  const ri = p.residency_interest || {}
  const readiness = (p.readiness && typeof p.readiness === 'object') ? p.readiness : {}
  const att = p.attestation || {}

  const canonical = {
    identity: {
      preferred_email: str(identity.preferred_email, 200),
      preferred_phone: str(identity.preferred_phone, 40),
      cs_employment_status: CS_EMPLOYMENT.includes(identity.cs_employment_status) ? identity.cs_employment_status : null,
    },
    education: {
      school: str(education.school, 200),
      program: str(education.program, 200),
      degree_type: str(education.degree_type, 80),
      completion_date: dateOrNull(education.completion_date),
      gpa: numOrNull(education.gpa),
      us_accredited: boolOrNull(education.us_accredited),
    },
    aspire: {
      aspire_cohort: str(aspire.aspire_cohort, 80),
      precepted_unit: str(aspire.precepted_unit, 120),
      rotation_hours: numOrNull(aspire.rotation_hours),
      prior_ngrp_applied: boolOrNull(aspire.prior_ngrp_applied),
      prior_ngrp_details: str(aspire.prior_ngrp_details, 600),
    },
    licensure: {
      ca_rn_status: LICENSE_STATUSES.includes(lic.ca_rn_status) ? lic.ca_rn_status : null,
      license_number: str(lic.license_number, 40),
      nclex_scheduled_date: dateOrNull(lic.nclex_scheduled_date),
      paid_rn_months: numOrNull(lic.paid_rn_months),
      bls_status: CERT_STATUSES.includes(lic.bls_status) ? lic.bls_status : null,
      bls_issuer: str(lic.bls_issuer, 120),
      bls_expiration: dateOrNull(lic.bls_expiration),
      acls_required: lic.acls_required === true,
      acls_status: CERT_STATUSES.includes(lic.acls_status) ? lic.acls_status : null,
      acls_issuer: str(lic.acls_issuer, 120),
      acls_expiration: dateOrNull(lic.acls_expiration),
    },
    residency_interest: {
      interest: INTERESTS.includes(ri.interest) ? ri.interest : null,
      unit_preferences: Array.isArray(ri.unit_preferences)
        ? ri.unit_preferences.map(u => str(u, 120)).filter(Boolean).slice(0, 3)
        : [],
      interest_statement: longStr(ri.interest_statement),
      strengths_statement: longStr(ri.strengths_statement),
    },
    readiness: {},
    attestation: {
      accurate: att.accurate === true,
      consent_followup: att.consent_followup === true,
    },
  }

  const checklistItems = validateApplicationChecklist(checklist)
  for (const item of checklistItems) canonical.readiness[item.key] = readiness[item.key] === true

  if (requireComplete) {
    const activeRules = validateQualificationRules(rules)
    const push = (field, message) => errors.push({ field, message })

    // Identity: a reachable preferred email is required.
    if (!canonical.identity.preferred_email || !EMAIL_SHAPE.test(canonical.identity.preferred_email)) {
      push('identity.preferred_email', 'Enter a valid preferred email address.')
    }

    // Education facts the engine needs. A malformed or impossible date
    // (e.g. 2026-99-99) canonicalizes to null and lands here.
    if (!canonical.education.completion_date) {
      push('education.completion_date', 'Enter a valid program completion or graduation date.')
    }
    if (canonical.education.gpa === null) {
      push('education.gpa', 'Enter your nursing GPA.')
    } else if (canonical.education.gpa < 0 || canonical.education.gpa > 4) {
      push('education.gpa', 'Nursing GPA must be between 0.00 and 4.00.')
    }
    if (activeRules.require_accreditation && canonical.education.us_accredited === null) {
      push('education.us_accredited', 'Answer whether your nursing program is US accredited.')
    }

    // Licensure facts the engine needs.
    if (!canonical.licensure.ca_rn_status) {
      push('licensure.ca_rn_status', 'Select your California RN license status.')
    }
    if (canonical.licensure.ca_rn_status === 'active' && !canonical.licensure.license_number) {
      push('licensure.license_number', 'Enter your California RN license number.')
    }
    if (canonical.licensure.ca_rn_status === 'pending'
        && activeRules.nclex_exception_enabled && activeRules.conditional.license.enabled
        && !canonical.licensure.nclex_scheduled_date) {
      push('licensure.nclex_scheduled_date', 'Enter a valid scheduled NCLEX date.')
    }
    if (canonical.licensure.paid_rn_months === null) {
      push('licensure.paid_rn_months', 'Enter your months of paid RN experience (0 if none).')
    } else if (canonical.licensure.paid_rn_months < 0) {
      push('licensure.paid_rn_months', 'Paid RN experience cannot be negative.')
    }
    if (!canonical.licensure.bls_status) {
      push('licensure.bls_status', 'Select your BLS status.')
    }
    if (canonical.licensure.bls_status === 'active') {
      if (!canonical.licensure.bls_issuer) push('licensure.bls_issuer', 'Enter your BLS issuer.')
      if (!canonical.licensure.bls_expiration) push('licensure.bls_expiration', 'Enter a valid BLS expiration date.')
    }
    if (canonical.licensure.acls_required && !canonical.licensure.acls_status) {
      push('licensure.acls_status', 'Select your ACLS status.')
    }

    // Interest + attestations (unchanged rules).
    if (!canonical.residency_interest.interest) push('residency_interest.interest', 'Select your residency interest.')
    if (!canonical.attestation.accurate) push('attestation.accurate', 'Confirm the information is accurate.')
    if (!canonical.attestation.consent_followup) push('attestation.consent_followup', 'Consent to ASPIRE follow-up is required.')

    if (canonical.residency_interest.interest === 'interested') {
      const prefs = canonical.residency_interest.unit_preferences
      const activeSet = new Set(activeUnitNames)
      if (prefs.length !== 3) {
        push('residency_interest.unit_preferences', 'Rank exactly three units.')
      } else if (new Set(prefs).size !== 3) {
        push('residency_interest.unit_preferences', 'Each ranked unit must be different.')
      } else if (prefs.some(u => !activeSet.has(u))) {
        push('residency_interest.unit_preferences', 'Ranked units must come from the participating-unit list.')
      }
    } else {
      // Preferences only make sense with interest; a non-interested
      // submission never carries rankings that could be mistaken for one.
      canonical.residency_interest.unit_preferences = []
    }
  }

  if (errors.length) return { ok: false, errors }
  return { ok: true, payload: canonical }
}

// ── Submit: ONE database transaction via ngrp_submit_revision_tx ────────────
// Eligibility is computed here (pure, deterministic from the canonical
// payload + cycle rules) and the COMPLETE write - locked serial revision
// number, lifecycle, interest, eligibility + requirement rows, draft
// cleanup, audit - commits atomically or not at all. The deadline is
// re-enforced INSIDE the function, so nothing can commit after closure.
export async function submitRevision(db, { cycle, candidate, assignment, payload }) {
  const facts = extractEligibilityFacts(payload)
  const computed = computeEligibility({ cycle, rules: cycle.qualification_rules, facts })
  const interest = payload?.residency_interest?.interest || null

  const { data, error } = await db.rpc('ngrp_submit_revision_tx', {
    p_assignment_id: assignment.id,
    p_payload: payload,
    p_interest: interest,
    p_result: computed.result,
    p_reasons: computed.reasons,
    p_requirements: computed.requirements.map(r => ({
      code: r.code, status: r.status, label: r.label,
      detail: r.detail || null, deadline: r.deadline || null,
    })),
  })
  if (error) {
    if (rpcMessage(error).includes('NGRP_CLOSED')) return { ok: false, reason: 'closed' }
    if (rpcMessage(error).includes('NGRP_GONE')) return { ok: false, reason: 'gone' }
    return { ok: false, reason: 'submit_tx_failed' }
  }
  void candidate
  return { ok: true, revisionNumber: data?.revision_number, result: computed.result }
}

// Recalculate from the given (or latest) revision + current cycle config.
// The candidate's calculated result/reasons and the requirement rows are
// written TOGETHER through ngrp_set_candidate_eligibility_tx (one
// transaction). NEVER touches eligibility_effective.
export async function recalculateEligibility(db, { cycle, candidate, revision = null }) {
  let rev = revision
  if (!rev) {
    const asg = await liveAssignmentForCandidate(db, candidate.id)
    if (asg.error) return { ok: false, reason: 'assignment_read_failed' }
    if (asg.assignment && asg.assignment.revision_count > 0) {
      const latest = await db.from('ngrp_transition_revisions')
        .select('id, payload, revision_number')
        .eq('assignment_id', asg.assignment.id)
        .eq('revision_number', asg.assignment.revision_count)
        .maybeSingle()
      if (latest.error) return { ok: false, reason: 'revision_read_failed' }
      rev = latest.data
    }
  }

  let result, reasons, requirements
  if (!rev) {
    // No submission yet: pending, with a single explanatory reason.
    result = 'pending'
    reasons = [{ code: 'form', label: 'Transition Form', met: false, status: 'unknown', detail: 'No submitted Transition Form yet.' }]
    requirements = []
  } else {
    const facts = extractEligibilityFacts(rev.payload)
    const computed = computeEligibility({ cycle, rules: cycle.qualification_rules, facts })
    result = computed.result
    reasons = computed.reasons
    requirements = computed.requirements
  }

  const { error } = await db.rpc('ngrp_set_candidate_eligibility_tx', {
    p_candidate_id: candidate.id,
    p_result: result,
    p_reasons: reasons,
    p_requirements: requirements.map(r => ({
      code: r.code, status: r.status, label: r.label,
      detail: r.detail || null, deadline: r.deadline || null,
    })),
    p_revision_id: rev?.id || null,
  })
  if (error) return { ok: false, reason: 'eligibility_tx_failed' }
  return { ok: true, result, reasons }
}
