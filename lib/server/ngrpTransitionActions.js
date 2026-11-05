// lib/server/ngrpTransitionActions.js
//
// TRANSITION-PORTAL-1 (2026-11-02): the Transition Form's load, save_draft and submit, moved
// VERBATIM out of api/ngrp-transition.js so two doors run one set of rules:
//   - the emailed link (api/ngrp-transition.js): token, then a one-time code, then this;
//   - the Student Portal's Residency tab (api/portal/my-residency.js): the portal session,
//     then this. No code: the alumnus is already signed in as themselves.
// Same deadline (effectiveFormClose, re-enforced inside the save and submit transactions),
// same validation, same audit, same first-open bookkeeping. Only the link's token use is
// door-specific: it is stamped when the link opened the form, and the portal has no token.
//
// runTransitionAction(db, { action, body, resolved, nowIso, tokenRow }) -> { status, json }
//   resolved = { closed, assignment, candidate, cycle } (resolveTokenAssignment's shape)
import { ALUMNUS_ROUTE, resolveStudentEmail } from '../../src/lib/notifications/studentEmailLifecycle.js'
import { validateSubmission, submitRevision, effectiveFormClose, isFormClosed, liveAssignmentForCandidate } from './ngrpTransition.js'
import { formReadinessChecklist } from './ngrpEligibility.js'
import { recordNgrpAudit } from './ngrpAudit.js'

export const LINK_INVALID = 'This form link is no longer valid.'
export const WINDOW_CLOSED = 'The window for this Transition Form has closed.'
export const FORM_ACTIONS = new Set(['load', 'save_draft', 'submit'])

export async function runTransitionAction(db, { action, body = {}, resolved, nowIso, tokenRow = null }) {
  const reply = (status, json) => ({ status, json })
  const { assignment, candidate, cycle } = resolved
  // Active units + checklist come from the CYCLE's configuration.
  const unitsRes = await db.from('ngrp_cycle_units')
    .select('unit_name, is_active, display_order')
    .eq('cycle_id', cycle.id).eq('is_active', true).order('display_order')
  if (unitsRes.error) return reply(500, { error: 'Internal error' })
  const activeUnitNames = (unitsRes.data || []).map(u => u.unit_name)
  const checklist = formReadinessChecklist(cycle.application_checklist)

  // ── load ─────────────────────────────────────────────────────────────────
  if (action === 'load') {
    // First-open bookkeeping (never on save/submit; never twice) - and
    // NEVER after closure: an expired link may render the safe closed
    // page, but it must not create first_used_at, an Opened state, or a
    // form_opened audit event. Every update result is checked.
    if (!resolved.closed) {
      if (tokenRow && !tokenRow.first_used_at) {
        const used = await db.from('ngrp_transition_tokens')
          .update({ first_used_at: nowIso }).eq('id', tokenRow.id)
        if (used.error) return reply(500, { error: 'Internal error' })
      }
      if (assignment.status === 'sent') {
        const opened = await db.from('ngrp_transition_assignments')
          .update({ status: 'opened', opened_at: nowIso }).eq('id', assignment.id)
        if (opened.error) return reply(500, { error: 'Internal error' })
        await recordNgrpAudit(db, {
          eventType: 'form_opened', cycleId: cycle.id, candidateId: candidate.id,
          assignmentId: assignment.id, studentId: candidate.student_id, actorKind: 'alumnus',
        })
      }
    }

    // Prefill identity from the canonical student row (their own record).
    const stu = await db.from('students')
      .select('first_name, last_name, preferred_first_name, name, school, program_type, aspire_cohort, school_email, personal_email, status, rotation:cohort_school_rotation_id ( rotation_end_date ), residency_outcomes:ngrp_residency_outcomes ( hired_at, separated_at, cs_email )')
      .eq('id', candidate.student_id).maybeSingle()
    if (stu.error || !stu.data) return reply(500, { error: 'Internal error' })

    // Base payload: the active draft wins, else the latest submitted
    // revision (for the revise flow), else nothing.
    let base = null
    let baseKind = 'none'
    const draft = await db.from('ngrp_transition_drafts')
      .select('payload, saved_at').eq('assignment_id', assignment.id).maybeSingle()
    if (draft.error) return reply(500, { error: 'Internal error' })
    if (draft.data) { base = draft.data.payload; baseKind = 'draft' }
    else if (assignment.revision_count > 0) {
      const rev = await db.from('ngrp_transition_revisions')
        .select('payload').eq('assignment_id', assignment.id)
        .eq('revision_number', assignment.revision_count).maybeSingle()
      if (rev.error) return reply(500, { error: 'Internal error' })
      if (rev.data) { base = rev.data.payload; baseKind = 'revision' }
    }

    return reply(200, {
      state: resolved.closed ? 'closed' : 'form',
      studentName: (stu.data.preferred_first_name || stu.data.first_name || '').trim(),
      studentFullName: stu.data.name || `${stu.data.first_name || ''} ${stu.data.last_name || ''}`.trim(),
      school: stu.data.school || '',
      program: stu.data.program_type || '',
      aspireCohort: stu.data.aspire_cohort || '',
      suggestedEmail: resolveStudentEmail(stu.data, undefined, ALUMNUS_ROUTE).email,
      cycleName: cycle.name,
      closeAt: effectiveFormClose(cycle, assignment),
      // FORM-DISCLAIMER-1: the form says when the real application opens.
      applicationOpenDate: cycle.application_open_date || null,
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
  if (resolved.closed) return reply(410, { error: WINDOW_CLOSED })

  // ── save_draft ───────────────────────────────────────────────────────────
  // ONE database transaction (ngrp_save_draft_tx): draft upsert AND the
  // assignment lifecycle move together, the deadline is re-enforced inside
  // the transaction, and saved:true is returned ONLY when everything
  // committed - never after a failed assignment update.
  if (action === 'save_draft') {
    const canonical = validateSubmission(body.payload, {
      activeUnitNames, checklist, rules: cycle.qualification_rules, requireComplete: false,
    })
    if (!canonical.ok) return reply(422, { error: 'Invalid draft payload.' })
    const saved = await db.rpc('ngrp_save_draft_tx', {
      p_assignment_id: assignment.id, p_payload: canonical.payload,
    })
    if (saved.error) {
      const msg = saved.error.message || ''
      if (msg.includes('NGRP_CLOSED')) return reply(410, { error: WINDOW_CLOSED })
      if (msg.includes('NGRP_GONE')) return reply(410, { error: LINK_INVALID })
      return reply(500, { error: 'Internal error' })
    }
    return reply(200, { saved: true, savedAt: saved.data?.saved_at || nowIso })
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
    if (!canonical.ok) return reply(422, { error: 'Invalid response payload.', errors: canonical.errors })
    const result = await submitRevision(db, {
      cycle, candidate, assignment, payload: canonical.payload,
    })
    if (!result.ok) {
      if (result.reason === 'closed') return reply(410, { error: WINDOW_CLOSED })
      if (result.reason === 'gone') return reply(410, { error: LINK_INVALID })
      return reply(500, { error: 'Internal error' })
    }
    return reply(200, { success: true, submittedAt: nowIso, revisionNumber: result.revisionNumber })
  }

  return reply(400, { error: 'Invalid request body' })
}

// The portal door: the alumnus's own live assignment in this residency cohort, found by who they
// are signed in as, never by anything the browser sent. A form never sent (no assignment, or a
// pending one the provider never accepted) is 'not_sent': there is nothing to open yet.
export async function resolveStudentAssignment(db, { cycleId, studentId, nowIso }) {
  if (!cycleId || !studentId) return { state: 'not_sent' }
  const cand = await db.from('ngrp_candidates').select('*').eq('cycle_id', cycleId).eq('student_id', studentId).maybeSingle()
  if (cand.error) return { state: 'error' }
  if (!cand.data) return { state: 'not_sent' }
  const live = await liveAssignmentForCandidate(db, cand.data.id)
  if (live.error) return { state: 'error' }
  if (!live.assignment || live.assignment.status === 'pending') return { state: 'not_sent' }
  const cyc = await db.from('ngrp_cycles').select('*').eq('id', cycleId).maybeSingle()
  if (cyc.error || !cyc.data) return { state: 'error' }
  return {
    state: 'ok', closed: isFormClosed(cyc.data, live.assignment, nowIso),
    assignment: live.assignment, candidate: cand.data, cycle: cyc.data,
  }
}
