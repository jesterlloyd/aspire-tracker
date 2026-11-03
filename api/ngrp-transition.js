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
import { resolveTokenAssignment } from '../lib/server/ngrpTransition.js'
import { runTransitionAction, LINK_INVALID, WINDOW_CLOSED } from '../lib/server/ngrpTransitionActions.js'
import { createMailer } from '../lib/server/email/mailer.js'
import {
  issueCode, checkCode, issueSession, checkSession, maskEmail, transitionCodeEmail,
} from '../lib/server/ngrpTransitionCode.js'

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
  // TRANSITION-SESSION-1: say what to do, not just what happened (Jorge Velasco, 2026-11-02).
  if (rlError || allowed !== true) return res.status(429).json({ error: 'Too many tries in a short time. Wait 10 minutes, then send one code and use the newest one.' })

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

    // TRANSITION-SESSION-1 (2026-11-02): the session slides. Every verified request (load, each
    // autosave, submit) hands back a fresh two-hour session, so someone still typing is never
    // signed out mid-form; two hours of silence still ends it. Jorge Velasco's 2-hour session
    // expired while he was writing, and his repeated code requests then hit the limiter.
    const renewed = issueSession(assignment.id, tokenHash)
    const json = res.json.bind(res)
    res.json = obj => json(res.statusCode < 400 && obj && typeof obj === 'object' && !Array.isArray(obj) ? { ...obj, session: renewed } : obj)

    const out = await runTransitionAction(supabaseAdmin, { action, body, resolved, nowIso, tokenRow })
    return res.status(out.status).json(out.json)
  } catch (err) {
    console.error('[ngrp-transition] unhandled:', err?.message)
    return res.status(500).json({ error: 'Internal error' })
  }
}
