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
import supabaseAdmin from '../lib/server/evaluation/supabase_admin.js'
import { hashToken, isWellFormedRawToken } from '../lib/server/evaluation/tokens.js'
import { bucketKey, extractClientIp } from '../lib/server/evaluation/rate_limit.js'
import {
  resolveTokenAssignment, validateSubmission, submitRevision, effectiveFormClose,
} from '../lib/server/ngrpTransition.js'
import { validateApplicationChecklist } from '../lib/server/ngrpEligibility.js'
import { recordNgrpAudit } from '../lib/server/ngrpAudit.js'

const LINK_INVALID = 'This form link is no longer valid.'
const WINDOW_CLOSED = 'The window for this Transition Form has closed.'
const ACTIONS = new Set(['load', 'save_draft', 'submit'])
const RATE = {
  load:       { window: 60, max: 20 },
  save_draft: { window: 60, max: 30 },
  submit:     { window: 60, max: 5 },
}

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

    // Active units + checklist come from the CYCLE's configuration.
    const unitsRes = await supabaseAdmin.from('ngrp_cycle_units')
      .select('unit_name, is_active, display_order')
      .eq('cycle_id', cycle.id).eq('is_active', true).order('display_order')
    if (unitsRes.error) return res.status(500).json({ error: 'Internal error' })
    const activeUnitNames = (unitsRes.data || []).map(u => u.unit_name)
    const checklist = validateApplicationChecklist(cycle.application_checklist)

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
        .select('first_name, last_name, preferred_first_name, name, school, program_type, aspire_cohort, school_email, personal_email')
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
        suggestedEmail: (stu.data.school_email || stu.data.personal_email || '').trim(),
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
