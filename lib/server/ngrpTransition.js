// lib/server/ngrpTransition.js
//
// NGRP-RELEASE-2: the Transition Form lifecycle core - assignment/token
// issuance, the per-recipient send unit of work, the public load/save/submit
// logic, and submission validation. Node-safe and db-injected so every rule
// is unit-testable with a mocked client.
//
// TOKEN POSTURE (the evaluation-token rules, verbatim):
// - Raw tokens exist only inside the sending function's scope and inside the
//   emailed URL fragment. They are never stored, logged, or returned to any
//   staff payload. Only the HMAC hash + its 8-char prefix persist.
// - The minting function is INJECTED (lib/server/evaluation/tokens.js in
//   production) so this module never touches the pepper directly.
// - Revocation is always BY TOKEN ID, never by assignment_id - killing every
//   token for an assignment would destroy a link just delivered.
//
// SEND-TRUTH RULE: an assignment may only remain live if its email was
// handed to the provider successfully. A provider failure revokes the token
// AND (for a first send) the just-created assignment, so a failed delivery
// can never read as "Sent" anywhere.
import { computeEligibility, extractEligibilityFacts, validateApplicationChecklist } from './ngrpEligibility.js'

export const FORM_STATUSES = ['sent', 'opened', 'in_progress', 'submitted', 'revised']

const isDateStr = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

// The effective close of a form: the assignment's own deadline when one was
// set, else end-of-day UTC on the cycle's application deadline. Null means
// "no close is configured" - sending is refused upstream in that case, but a
// legacy assignment without any close stays open rather than silently dying.
export function effectiveFormClose(cycle, assignment) {
  if (assignment?.deadline_at) return assignment.deadline_at
  if (isDateStr(cycle?.application_deadline)) return `${cycle.application_deadline}T23:59:59.999Z`
  return null
}

export function isFormClosed(cycle, assignment, nowIso) {
  const close = effectiveFormClose(cycle, assignment)
  return Boolean(close && nowIso && nowIso > close)
}

// ── Recipient classification (pure) ─────────────────────────────────────────
// Decide, per selected student, what a send would do. students carry
// has_email; candidatesByStudent/assignmentsByCandidate come from the db.
export function classifySendRecipients({ students, candidatesByStudent, liveAssignmentsByCandidate, resend = false }) {
  const send = [], reissue = [], skipped = []
  for (const s of students || []) {
    if (s.status !== 'Completed') { skipped.push({ student: s, reason: 'not_completed' }); continue }
    if (!s.has_email) { skipped.push({ student: s, reason: 'missing_email' }); continue }
    const candidate = candidatesByStudent.get(s.id) || null
    const assignment = candidate ? (liveAssignmentsByCandidate.get(candidate.id) || null) : null
    if (!assignment) { send.push({ student: s, candidate }); continue }
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

async function activeTokenIds(db, assignmentId) {
  const { data, error } = await db.from('ngrp_transition_tokens')
    .select('id').eq('assignment_id', assignmentId).is('revoked_at', null)
  if (error) return { error }
  return { ids: (data || []).map(t => t.id) }
}

// Always by token id (never by assignment_id).
export async function revokeTokensById(db, tokenIds, actorProfileId) {
  if (!tokenIds || tokenIds.length === 0) return { ok: true }
  const { error } = await db.from('ngrp_transition_tokens')
    .update({ revoked_at: new Date().toISOString(), revoked_by_profile_id: actorProfileId })
    .in('id', tokenIds)
  if (error) return { ok: false, error }
  return { ok: true }
}

// ── The per-recipient send unit of work ─────────────────────────────────────
// ctx: { db, cycle, student, candidate|null, assignment|null (live, for a
//        resend), actorProfileId, generateToken, sendEmail, buildEmail }
// generateToken: () => { raw, hash, hashPrefix }   (injected)
// sendEmail: async ({ to, subject, html }) => { ok, providerId?, reason? }
// buildEmail: ({ student, cycle, url, closeText }) => { subject, html }
// Returns { outcome: 'sent'|'resent'|'failed', reason?, candidateId?,
//           assignmentId?, tokenHashPrefix? } - never the raw token.
export async function sendOneTransitionForm(ctx) {
  const { db, cycle, student, actorProfileId, generateToken, sendEmail, buildEmail, baseUrl } = ctx

  // 1. Candidate attempt (idempotent).
  let candidate = ctx.candidate
  if (!candidate) {
    const ensured = await ensureCandidate(db, { cycleId: cycle.id, studentId: student.id })
    if (ensured.error) return { outcome: 'failed', reason: 'candidate_write_failed' }
    candidate = ensured.candidate
  }

  // 2. Assignment: reuse the live one (resend keeps lifecycle history), or
  //    create a fresh 'sent' row.
  let assignment = ctx.assignment || null
  let assignmentCreated = false
  if (!assignment) {
    const live = await liveAssignmentForCandidate(db, candidate.id)
    if (live.error) return { outcome: 'failed', reason: 'assignment_read_failed' }
    assignment = live.assignment
  }
  if (!assignment) {
    const inserted = await db.from('ngrp_transition_assignments')
      .insert({ candidate_id: candidate.id, sent_by_profile_id: actorProfileId })
      .select('*').maybeSingle()
    if (!inserted.data) return { outcome: 'failed', reason: 'assignment_write_failed' }
    assignment = inserted.data
    assignmentCreated = true
  }
  const isResend = !assignmentCreated

  // 3. Rotate tokens: any previously live token is revoked BEFORE the new
  //    one is issued (the partial unique index also enforces one-live).
  const prior = await activeTokenIds(db, assignment.id)
  if (prior.error) return { outcome: 'failed', reason: 'token_read_failed' }
  if (prior.ids.length) {
    const revoked = await revokeTokensById(db, prior.ids, actorProfileId)
    if (!revoked.ok) return { outcome: 'failed', reason: 'token_rotate_failed' }
  }

  // 4. Mint. The raw token exists only from here to the provider call.
  const { raw, hash, hashPrefix } = generateToken()
  const insertedToken = await db.from('ngrp_transition_tokens')
    .insert({
      assignment_id: assignment.id, token_hash: hash, token_hash_prefix: hashPrefix,
      created_by_profile_id: actorProfileId,
    })
    .select('id').maybeSingle()
  if (!insertedToken.data) return { outcome: 'failed', reason: 'token_write_failed' }
  const tokenId = insertedToken.data.id

  // 5. Send. The URL carries the raw token in the FRAGMENT only.
  const url = `${baseUrl}/ngrp/transition#t=${raw}`
  const closeText = effectiveFormClose(cycle, assignment)
  const { subject, html } = buildEmail({ student, cycle, url, closeText })
  const sent = await sendEmail({ to: student.email, subject, html })

  if (!sent.ok) {
    // SEND-TRUTH: undo what this call created so nothing reads as Sent.
    await revokeTokensById(db, [tokenId], actorProfileId)
    if (assignmentCreated) {
      await db.from('ngrp_transition_assignments')
        .update({
          revoked_at: new Date().toISOString(),
          revoked_by_profile_id: actorProfileId,
          revoked_reason: 'delivery_failed',
        })
        .eq('id', assignment.id)
    }
    return { outcome: 'failed', reason: sent.reason || 'provider_failed', candidateId: candidate.id }
  }

  return {
    outcome: isResend ? 'resent' : 'sent',
    candidateId: candidate.id,
    assignmentId: assignment.id,
    tokenHashPrefix: hashPrefix,
    providerId: sent.providerId || null,
    subject,
  }
}

// ── Public form resolution (token → exactly one assignment) ─────────────────
// Returns { state } where state ∈ ok | invalid | revoked_or_unknown (single
// public-facing bucket) | closed, plus the joined rows on ok. The caller has
// already hashed the raw token; nothing here ever sees a raw token.
export async function resolveTokenAssignment(db, tokenHash, nowIso) {
  const tok = await db.from('ngrp_transition_tokens')
    .select('*').eq('token_hash', tokenHash).maybeSingle()
  if (tok.error) return { state: 'error' }
  if (!tok.data || tok.data.revoked_at) return { state: 'unknown' }   // never distinguish revoked vs never-existed

  const asg = await db.from('ngrp_transition_assignments')
    .select('*').eq('id', tok.data.assignment_id).maybeSingle()
  if (asg.error) return { state: 'error' }
  if (!asg.data || asg.data.revoked_at) return { state: 'unknown' }

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
// structure is enforced, and ranked preferences must be exactly three
// DISTINCT active participating units when the person is interested.
const INTERESTS = ['interested', 'undecided', 'not_interested']
const CS_EMPLOYMENT = ['not_employed', 'per_diem', 'part_time', 'full_time', 'other']
const CERT_STATUSES = ['active', 'expired', 'none', 'pending']
const LICENSE_STATUSES = ['active', 'pending', 'none']

const str = (v, max = 400) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const longStr = (v, max = 8000) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const dateOrNull = v => (isDateStr(v) ? v : null)
const numOrNull = v => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}
const boolOrNull = v => (v === true ? true : v === false ? false : null)

export function validateSubmission(rawPayload, { activeUnitNames = [], checklist = null, requireComplete = true } = {}) {
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
    if (!canonical.attestation.accurate) errors.push({ field: 'attestation.accurate', message: 'Confirm the information is accurate.' })
    if (!canonical.attestation.consent_followup) errors.push({ field: 'attestation.consent_followup', message: 'Consent to ASPIRE follow-up is required.' })
    if (!canonical.residency_interest.interest) errors.push({ field: 'residency_interest.interest', message: 'Select your residency interest.' })

    if (canonical.residency_interest.interest === 'interested') {
      const prefs = canonical.residency_interest.unit_preferences
      const activeSet = new Set(activeUnitNames)
      if (prefs.length !== 3) {
        errors.push({ field: 'residency_interest.unit_preferences', message: 'Rank exactly three units.' })
      } else if (new Set(prefs).size !== 3) {
        errors.push({ field: 'residency_interest.unit_preferences', message: 'Each ranked unit must be different.' })
      } else if (prefs.some(u => !activeSet.has(u))) {
        errors.push({ field: 'residency_interest.unit_preferences', message: 'Ranked units must come from the participating-unit list.' })
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

// ── Submit: immutable revision + lifecycle + eligibility recalc ─────────────
// Ordered so a partial failure is always recoverable and never fabricates
// progress: revision insert (unique-numbered) → assignment lifecycle →
// candidate interest/eligibility + requirement rows → draft cleanup.
export async function submitRevision(db, { cycle, candidate, assignment, payload, nowIso }) {
  const revisionNumber = (assignment.revision_count || 0) + 1
  const revIns = await db.from('ngrp_transition_revisions')
    .insert({ assignment_id: assignment.id, revision_number: revisionNumber, payload, submitted_at: nowIso })
    .select('id').maybeSingle()
  if (!revIns.data) return { ok: false, reason: 'revision_write_failed' }

  const isFirst = revisionNumber === 1
  const patch = isFirst
    ? { status: 'submitted', submitted_at: nowIso, revision_count: revisionNumber, last_saved_at: nowIso }
    : { status: 'revised', revised_at: nowIso, revision_count: revisionNumber, last_saved_at: nowIso }
  const asgUpd = await db.from('ngrp_transition_assignments').update(patch).eq('id', assignment.id)
  if (asgUpd.error) return { ok: false, reason: 'assignment_update_failed' }

  const recalc = await recalculateEligibility(db, {
    cycle, candidate, revision: { id: revIns.data.id, payload }, nowIso,
  })
  if (!recalc.ok) return { ok: false, reason: recalc.reason }

  // Interest is a candidate-level fact the roster shows directly.
  const interest = payload?.residency_interest?.interest
  if (interest) {
    await db.from('ngrp_candidates').update({ interest }).eq('id', candidate.id)
  }

  await db.from('ngrp_transition_drafts').delete().eq('assignment_id', assignment.id)
  return { ok: true, revisionNumber, revisionId: revIns.data.id, result: recalc.result }
}

// Recalculate from the given (or latest) revision + current cycle config.
// Writes candidate.eligibility_calculated + eligibility_reasons and replaces
// the per-code requirement rows. NEVER touches eligibility_effective.
export async function recalculateEligibility(db, { cycle, candidate, revision = null, nowIso }) {
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

  const candUpd = await db.from('ngrp_candidates')
    .update({ eligibility_calculated: result, eligibility_reasons: reasons })
    .eq('id', candidate.id)
  if (candUpd.error) return { ok: false, reason: 'candidate_update_failed' }

  const del = await db.from('ngrp_candidate_requirements').delete().eq('candidate_id', candidate.id)
  if (del.error) return { ok: false, reason: 'requirements_replace_failed' }
  if (requirements.length) {
    const ins = await db.from('ngrp_candidate_requirements').insert(requirements.map(r => ({
      candidate_id: candidate.id, code: r.code, status: r.status, label: r.label,
      detail: r.detail || null, deadline: r.deadline || null,
      computed_from_revision_id: rev?.id || null, computed_at: nowIso,
    })))
    if (ins.error) return { ok: false, reason: 'requirements_write_failed' }
  }
  return { ok: true, result, reasons }
}
