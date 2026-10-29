import { resolveStudentEmail } from '../src/lib/notifications/studentEmailLifecycle.js'
// api/ngrp-transition.js
//
// NGRP-RELEASE-2: the PUBLIC Transition Form endpoint. Alumni reach it from
// the tokenized link only - no portal account, no authentication, and no
// identifier is ever accepted from the client: the assignment is derived
// SERVER-SIDE from the token hash, so one token can resolve exactly one
// assignment and can never expose another alumnus.
//
// Follows the evaluation public-endpoint order exactly:
//   no-store → method → tolerant parse → token shape gate (BEFORE any db
//   work) → rate limit (fail closed) → hash → resolve → act.
// Unknown and revoked tokens return the SAME generic 410; expiration and
// revocation are enforced here, server-side, on every action.
//
// Actions (POST { action, token, ... }):
//   load        -> form content + prefill + draft/latest-revision base
//                  (marks first open; sets token first_used_at once)
//   save_draft  -> upsert the single autosave draft (never a revision)
//   submit      -> validate + immutable revision + eligibility recalc
//   send_code   -> email a one-time code to the alumnus's own address
//   verify_code -> { code } -> a session; load/save_draft/submit need it
//                  (TRANSITION-FORM-CODE-1: a forwarded link opens nothing)
import supabaseAdmin from '../lib/server/evaluation/supabase_admin.js'
import { hashToken, isWellFormedRawToken } from '../lib/server/evaluation/tokens.js'
import { bucketKey, extractClientIp } from '../lib/server/evaluation/rate_limit.js'
import {
  resolveTokenAssignment, validateSubmission, submitRevision, effectiveFormClose,
} from '../lib/server/ngrpTransition.js'
import { formReadinessChecklist } from '../lib/server/ngrpEligibility.js'
import { recordNgrpAudit } from '../lib/server/ngrpAudit.js'
import { createMailer } from '../lib/server/email/mailer.js'
import {
  issueCode, checkCode, issueSession, checkSession, maskEmail, transitionCodeEmail,
} from '../lib/server/ngrpTransitionCode.js'

const LINK_INVALID = 'This form link is no longer valid.'
const WINDOW_CLOSED = 'The window for this Transition Form has closed.'
const ACTIONS = new Set(['load', 'save_draft', 'submit', 'send_code', 'verify_code'])
const RATE = {
  load:       { window: 60, max: 20 },
  save_draft: { window: 60, max: 30 },
  submit:     { window: 60, max: 5 },
  send_code:   { window: 600, max: 5 },
  verify_code: { window: 600, max: 10 },
}
// Wrong codes per LINK, whatever the network: five tries in ten minutes.
const VERIFY_PER_LINK = { window: 600, max: 5 }
const CODE_FROM = 'ASPIRE at Cedars-Sinai <noreply@aspire-program.com>'
const STUDENT_ROUTE_FIELDS = 'first_name, preferred_first_name, school_email, personal_email, status, rotation:cohort_school_rotation_id ( rotation_end_date ), residency_outcomes:ngrp_residency_outcomes ( hired_at, separated_at, cs_email )'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  let body
  try {
    body = (req.body && typeof req.body === 'object') ? req.body : JSON.parse(req.body || '{}')
  } catch {
    return res.status(400).json({ error: 'Invalid request body' })
  }
  const action = typeof body.action === 'string' ? body.action : null
  const token = body.token
  if (!action || !ACTIONS.has(action) || !token || typeof token !== 'string' || !isWellFormedRawToken(token)) {
    return res.status(400).json({ error: 'Invalid request body' })
  }

  // Rate limit - fail closed.
  const limits = RATE[action]
  const { data: allowed, error: rlError } = await supabaseAdmin.rpc('consume_evaluation_rate_limit', {
    p_bucket_key: bucketKey(`ngrp_transition_${action}`, extractClientIp(req)),
    p_window_seconds: limits.window,
    p_max_per_window: limits.max,
  })
  if (rlError || allowed !== true) return res.status(429).json({ error: 'Too many requests' })

  const tokenHash = hashToken(token)
  const nowIso = new Date().toISOString()

  try {
    const resolved = await resolveTokenAssignment(supabaseAdmin, tokenHash, nowIso)
    if (resolved.state === 'error') return res.status(500).json({ error: 'Internal error' })
    if (resolved.state === 'unknown') return res.status(410).json({ error: LINK_INVALID })
    const { token: tokenRow, assignment, candidate, cycle } = resolved

    // ── TRANSITION-FORM-CODE-1: the one-time code ───────────────────────────
    // The address is the one the form was sent to: the same routing rule as the send.
    const routeStudent = async () => {
      const r = await supabaseAdmin.from('students').select(STUDENT_ROUTE_FIELDS)
        .eq('id', candidate.student_id).maybeSingle()
      if (r.error || !r.data) return null
      return { student: r.data, email: resolveStudentEmail(r.data).email }
    }
    if (action === 'send_code') {
      if (resolved.closed) return res.status(410).json({ error: WINDOW_CLOSED })
      const routed = await routeStudent()
      if (!routed) return res.status(500).json({ error: 'Internal error' })
      if (!routed.email) return res.status(409).json({ error: 'No email address is on file. Contact the ASPIRE team at aspire@cshs.org.' })
      const { subject, html } = transitionCodeEmail({
        code: issueCode(assignment.id, tokenHash),
        firstName: routed.student.preferred_first_name || routed.student.first_name,
      })
      const sent = await createMailer().emails.send({ from: CODE_FROM, to: routed.email, subject, html })
      if (sent?.error) return res.status(502).json({ error: 'The code could not be sent. Try again in a minute.' })
      return res.status(200).json({ sent: true, maskedEmail: maskEmail(routed.email) })
    }
    if (action === 'verify_code') {
      const { data: linkOk, error: linkErr } = await supabaseAdmin.rpc('consume_evaluation_rate_limit', {
        p_bucket_key: bucketKey('ngrp_transition_verify_link', tokenHash),
        p_window_seconds: VERIFY_PER_LINK.window,
        p_max_per_window: VERIFY_PER_LINK.max,
      })
      if (linkErr || linkOk !== true) return res.status(429).json({ error: 'Too many tries. Ask for a new code in a few minutes.' })
      if (!checkCode(body.code, assignment.id, tokenHash)) return res.status(422).json({ error: 'That code is not right, or it has expired.' })
      return res.status(200).json({ session: issueSession(assignment.id, tokenHash) })
    }
    if (!checkSession(body.session, assignment.id, tokenHash)) {
      if (action !== 'load') return res.status(401).json({ error: 'verify_required' })
      // Nothing about the person or their answers before the code: a closed window says
      // only that, and an open one says where the code will go, masked.
      if (resolved.closed) return res.status(200).json({ state: 'closed' })
      const routed = await routeStudent()
      if (!routed) return res.status(500).json({ error: 'Internal error' })
      return res.status(200).json({ state: 'verify', maskedEmail: maskEmail(routed.email), cycleName: cycle.name })
    }

    // Active units + checklist come from the CYCLE's configuration.
    const unitsRes = await supabaseAdmin.from('ngrp_cycle_units')
      .select('unit_name, is_active, display_order')
      .eq('cycle_id', cycle.id).eq('is_active', true).order('display_order')
    if (unitsRes.error) return res.status(500).json({ error: 'Internal error' })
    const activeUnitNames = (unitsRes.data || []).map(u => u.unit_name)
    const checklist = formReadinessChecklist(cycle.application_checklist)

    // ── load ─────────────────────────────────────────────────────────────────
    if (action === 'load') {
      // First-open bookkeeping (never on save/submit; never twice) - and
      // NEVER after closure: an expired link may render the safe closed
      // page, but it must not create first_used_at, an Opened state, or a
      // form_opened audit event. Every update result is checked.
      if (!resolved.closed) {
        if (!tokenRow.first_used_at) {
          const used = await supabaseAdmin.from('ngrp_transition_tokens')
            .update({ first_used_at: nowIso }).eq('id', tokenRow.id)
          if (used.error) return res.status(500).json({ error: 'Internal error' })
        }
        if (assignment.status === 'sent') {
          const opened = await supabaseAdmin.from('ngrp_transition_assignments')
            .update({ status: 'opened', opened_at: nowIso }).eq('id', assignment.id)
          if (opened.error) return res.status(500).json({ error: 'Internal error' })
          await recordNgrpAudit(supabaseAdmin, {
            eventType: 'form_opened', cycleId: cycle.id, candidateId: candidate.id,
            assignmentId: assignment.id, studentId: candidate.student_id, actorKind: 'alumnus',
          })
        }
      }

      // Prefill identity from the canonical student row (their own record).
      const stu = await supabaseAdmin.from('students')
        .select('first_name, last_name, preferred_first_name, name, school, program_type, aspire_cohort, school_email, personal_email, status, rotation:cohort_school_rotation_id ( rotation_end_date ), residency_outcomes:ngrp_residency_outcomes ( hired_at, separated_at, cs_email )')
        .eq('id', candidate.student_id).maybeSingle()
      if (stu.error || !stu.data) return res.status(500).json({ error: 'Internal error' })

      // Base payload: the active draft wins, else the latest submitted
      // revision (for the revise flow), else nothing.
      let base = null
      let baseKind = 'none'
      const draft = await supabaseAdmin.from('ngrp_transition_drafts')
        .select('payload, saved_at').eq('assignment_id', assignment.id).maybeSingle()
      if (draft.error) return res.status(500).json({ error: 'Internal error' })
      if (draft.data) { base = draft.data.payload; baseKind = 'draft' }
      else if (assignment.revision_count > 0) {
        const rev = await supabaseAdmin.from('ngrp_transition_revisions')
          .select('payload').eq('assignment_id', assignment.id)
          .eq('revision_number', assignment.revision_count).maybeSingle()
        if (rev.error) return res.status(500).json({ error: 'Internal error' })
        if (rev.data) { base = rev.data.payload; baseKind = 'revision' }
      }

      return res.status(200).json({
        state: resolved.closed ? 'closed' : 'form',
        studentName: (stu.data.preferred_first_name || stu.data.first_name || '').trim(),
        studentFullName: stu.data.name || `${stu.data.first_name || ''} ${stu.data.last_name || ''}`.trim(),
        school: stu.data.school || '',
        program: stu.data.program_type || '',
        aspireCohort: stu.data.aspire_cohort || '',
        suggestedEmail: resolveStudentEmail(stu.data).email,
        cycleName: cycle.name,
        closeAt: effectiveFormClose(cycle, assignment),
        units: activeUnitNames,
        checklist,
        base,
        baseKind,
        status: assignment.status,
        revisionCount: assignment.revision_count,
        submittedAt: assignment.submitted_at,
        revisedAt: assignment.revised_at,
      })
    }

    // Both mutations are refused once the window has closed - the retained
    // submitted revisions stay reviewable by staff, but nothing changes.
    if (resolved.closed) return res.status(410).json({ error: WINDOW_CLOSED })

    // ── save_draft ───────────────────────────────────────────────────────────
    // ONE database transaction (ngrp_save_draft_tx): draft upsert AND the
    // assignment lifecycle move together, the deadline is re-enforced inside
    // the transaction, and saved:true is returned ONLY when everything
    // committed - never after a failed assignment update.
    if (action === 'save_draft') {
      const canonical = validateSubmission(body.payload, {
        activeUnitNames, checklist, rules: cycle.qualification_rules, requireComplete: false,
      })
      if (!canonical.ok) return res.status(422).json({ error: 'Invalid draft payload.' })
      const saved = await supabaseAdmin.rpc('ngrp_save_draft_tx', {
        p_assignment_id: assignment.id, p_payload: canonical.payload,
      })
      if (saved.error) {
        const msg = saved.error.message || ''
        if (msg.includes('NGRP_CLOSED')) return res.status(410).json({ error: WINDOW_CLOSED })
        if (msg.includes('NGRP_GONE')) return res.status(410).json({ error: LINK_INVALID })
        return res.status(500).json({ error: 'Internal error' })
      }
      return res.status(200).json({ saved: true, savedAt: saved.data?.saved_at || nowIso })
    }

    // ── submit ───────────────────────────────────────────────────────────────
    // ONE database transaction (ngrp_submit_revision_tx): the locked
    // assignment serializes the revision number, the deadline is re-enforced
    // in-transaction (a request that passed the check above cannot commit
    // after closure), and revision + lifecycle + interest + eligibility +
    // requirement rows + draft cleanup + audit land together or not at all.
    if (action === 'submit') {
      const canonical = validateSubmission(body.payload, {
        activeUnitNames, checklist, rules: cycle.qualification_rules, requireComplete: true,
      })
      if (!canonical.ok) return res.status(422).json({ error: 'Invalid response payload.', errors: canonical.errors })
      const result = await submitRevision(supabaseAdmin, {
        cycle, candidate, assignment, payload: canonical.payload,
      })
      if (!result.ok) {
        if (result.reason === 'closed') return res.status(410).json({ error: WINDOW_CLOSED })
        if (result.reason === 'gone') return res.status(410).json({ error: LINK_INVALID })
        return res.status(500).json({ error: 'Internal error' })
      }
      return res.status(200).json({ success: true, submittedAt: nowIso, revisionNumber: result.revisionNumber })
    }

    return res.status(400).json({ error: 'Invalid request body' })
  } catch (err) {
    console.error('[ngrp-transition] unhandled:', err?.message)
    return res.status(500).json({ error: 'Internal error' })
  }
}
