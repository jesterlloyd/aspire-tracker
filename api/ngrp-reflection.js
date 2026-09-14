// api/ngrp-reflection.js
//
// RESIDENCY-REFLECTION-1: the PUBLIC reflection endpoint. Residents reach it
// from the tokenized link only: no portal account (they lost the student one at
// graduation), no authentication, and no identifier is ever accepted from the
// client. The period is derived server-side from the token hash.
//
// Follows the Transition Form endpoint's order exactly:
//   no-store → method → tolerant parse → token shape gate (BEFORE any db work)
//   → rate limit (fail closed) → hash → resolve → act.
// Unknown and revoked tokens return the same generic 410.
//
// Actions (POST { action, token, ... }):
//   load        -> period meta + the form's config + draft or submission
//   save_draft  -> the one autosave draft on the period row
//   submit      -> validate + one immutable submission (a second is refused)
import supabaseAdmin from '../lib/server/evaluation/supabase_admin.js'
import { hashToken, isWellFormedRawToken } from '../lib/server/evaluation/tokens.js'
import { bucketKey, extractClientIp } from '../lib/server/evaluation/rate_limit.js'
import { resolveReflectionToken, periodClosesAt, PERIODS, SUBMISSIONS, TOKENS } from '../lib/server/ngrpReflection.js'
import { validateReflection, DIFFICULTY_AREAS, closesOn } from '../src/lib/ngrp/ngrpReflectionForm.js'
import { recordNgrpAudit } from '../lib/server/ngrpAudit.js'

const LINK_INVALID = 'This reflection link is no longer valid.'
const WINDOW_CLOSED = 'This reflection period has closed.'
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

  const limits = RATE[action]
  const { data: allowed, error: rlError } = await supabaseAdmin.rpc('consume_evaluation_rate_limit', {
    p_bucket_key: bucketKey(`ngrp_reflection_${action}`, extractClientIp(req)),
    p_window_seconds: limits.window,
    p_max_per_window: limits.max,
  })
  if (rlError || allowed !== true) return res.status(429).json({ error: 'Too many requests' })

  const tokenHash = hashToken(token)
  const nowIso = new Date().toISOString()

  try {
    const resolved = await resolveReflectionToken(supabaseAdmin, tokenHash, nowIso)
    if (resolved.state === 'error') return res.status(500).json({ error: 'Internal error' })
    if (resolved.state === 'unknown') return res.status(410).json({ error: LINK_INVALID })
    const { token: tokenRow, period, run } = resolved

    const submission = await supabaseAdmin.from(SUBMISSIONS)
      .select('payload, submitted_at').eq('period_id', period.id).maybeSingle()
    if (submission.error) return res.status(500).json({ error: 'Internal error' })

    // ── load ─────────────────────────────────────────────────────────────────
    if (action === 'load') {
      // First-open bookkeeping, never after closure and never after submission.
      if (!resolved.closed && !submission.data) {
        if (!tokenRow.first_used_at) {
          const used = await supabaseAdmin.from(TOKENS).update({ first_used_at: nowIso }).eq('id', tokenRow.id)
          if (used.error) return res.status(500).json({ error: 'Internal error' })
        }
        if (period.status === 'sent') {
          const opened = await supabaseAdmin.from(PERIODS).update({ status: 'opened', opened_at: nowIso }).eq('id', period.id)
          if (opened.error) return res.status(500).json({ error: 'Internal error' })
          await recordNgrpAudit(supabaseAdmin, {
            eventType: 'reflection_opened', cycleId: run.cycle_id, candidateId: run.candidate_id,
            studentId: run.student_id, actorKind: 'alumnus', metadata: { period_number: period.period_number },
          })
        }
      }
      const stu = await supabaseAdmin.from('students')
        .select('first_name, last_name, preferred_first_name, name').eq('id', run.student_id).maybeSingle()
      if (stu.error || !stu.data) return res.status(500).json({ error: 'Internal error' })
      const unit = await supabaseAdmin.from('ngrp_residency_outcomes')
        .select('hired_unit').eq('candidate_id', run.candidate_id).maybeSingle()
      // Period 1's own "About you" answer, when it exists, names the unit for
      // every later period so the resident does not retype it.
      let priorUnit = ''
      if (period.period_number > 1) {
        const first = await supabaseAdmin.from(SUBMISSIONS)
          .select('payload').eq('candidate_id', run.candidate_id).order('submitted_at', { ascending: true }).limit(1).maybeSingle()
        priorUnit = first.data?.payload?.about?.unit || ''
      }

      return res.status(200).json({
        state: submission.data ? 'submitted' : resolved.closed ? 'closed' : 'form',
        residentName: (stu.data.preferred_first_name || stu.data.first_name || '').trim(),
        residentFullName: stu.data.name || `${stu.data.first_name || ''} ${stu.data.last_name || ''}`.trim(),
        unit: unit.data?.hired_unit || priorUnit || '',
        periodNumber: period.period_number,
        periodCount: run.period_count,
        opensOn: period.opens_on,
        dueOn: period.due_on,
        closesOn: closesOn(period),
        closesAt: periodClosesAt(period),
        difficultyAreas: DIFFICULTY_AREAS,
        base: submission.data?.payload || period.draft || null,
        baseKind: submission.data ? 'submission' : period.draft ? 'draft' : 'none',
        submittedAt: submission.data?.submitted_at || null,
      })
    }

    if (submission.data) return res.status(409).json({ error: 'This period has already been submitted.' })
    if (resolved.closed) return res.status(410).json({ error: WINDOW_CLOSED })

    // ── save_draft ───────────────────────────────────────────────────────────
    if (action === 'save_draft') {
      const canonical = validateReflection(body.payload, { periodNumber: period.period_number, requireComplete: false })
      if (!canonical.ok) return res.status(422).json({ error: 'Invalid draft payload.' })
      const saved = await supabaseAdmin.from(PERIODS).update({
        draft: canonical.payload, last_saved_at: nowIso,
        ...(period.status === 'sent' || period.status === 'opened' ? { status: 'in_progress' } : {}),
      }).eq('id', period.id)
      if (saved.error) return res.status(500).json({ error: 'Internal error' })
      return res.status(200).json({ saved: true, savedAt: nowIso })
    }

    // ── submit ───────────────────────────────────────────────────────────────
    if (action === 'submit') {
      const canonical = validateReflection(body.payload, { periodNumber: period.period_number, requireComplete: true })
      if (!canonical.ok) return res.status(422).json({ error: 'Please complete the required parts.', errors: canonical.errors })
      const ins = await supabaseAdmin.from(SUBMISSIONS).insert({
        period_id: period.id, candidate_id: run.candidate_id, student_id: run.student_id,
        payload: canonical.payload, submitted_at: nowIso,
      }).select('id').maybeSingle()
      if (ins.error) {
        if (ins.error.code === '23505') return res.status(409).json({ error: 'This period has already been submitted.' })
        return res.status(500).json({ error: 'Internal error' })
      }
      const upd = await supabaseAdmin.from(PERIODS)
        .update({ status: 'submitted', submitted_at: nowIso, draft: null }).eq('id', period.id)
      if (upd.error) console.error('[ngrp-reflection] period status update failed after submission:', upd.error.message)
      await recordNgrpAudit(supabaseAdmin, {
        eventType: 'reflection_submitted', cycleId: run.cycle_id, candidateId: run.candidate_id,
        studentId: run.student_id, actorKind: 'alumnus', metadata: { period_number: period.period_number },
      })
      // The last submission completes the run on its own.
      if (period.period_number === run.period_count) {
        await supabaseAdmin.from('ngrp_reflection_runs').update({ status: 'completed' }).eq('id', run.id).eq('status', 'active')
      }
      return res.status(200).json({ success: true, submittedAt: nowIso })
    }

    return res.status(400).json({ error: 'Invalid request body' })
  } catch (err) {
    console.error('[ngrp-reflection] unhandled:', err?.message)
    return res.status(500).json({ error: 'Internal error' })
  }
}
