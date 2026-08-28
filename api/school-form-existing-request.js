/* global process */
// api/school-form-existing-request.js
//
// PLACEMENT-RESUBMIT-1: "does this school already have a placement request in
// this cohort?" for the PUBLIC /school-form page, so the coordinator is warned
// BEFORE submitting rather than after overwriting.
//
// Gated exactly like api/school-form-submit.js: rate limit first, then the
// cohort's accepting_submissions flag, then the S-08 server-side cohort
// password. Without the password gate this endpoint would be an oracle for
// which schools have submitted to which cohort, so it asks the same question
// of the same RPCs as the submit path and cannot drift from it.
//
// The response is the public-safe summary from describeExistingRequest: dates,
// coordinator NAME, and a student COUNT. Never the roster, never an email.

import { createClient } from '@supabase/supabase-js'
import { lookupExistingPlacementRequest } from './lib/schoolPlacementUpsert.js'
import { consumePublicRateLimit, SCHOOL_SUBMIT_LIMITS, TOO_MANY_REQUESTS } from './lib/publicRateLimit.js'

function getDb() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase service role credentials')
  return createClient(url, key)
}

export function createExistingRequestHandler({ db: injectedDb, lookup = lookupExistingPlacementRequest, rateLimit = consumePublicRateLimit } = {}) {
  return async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    if (req.method === 'OPTIONS') return res.status(200).end()
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

    const { cohortId, school } = req.body || {}
    if (!cohortId || !String(school || '').trim()) {
      return res.status(400).json({ error: 'cohortId and school are required' })
    }

    let db
    try { db = injectedDb || getDb() } catch { return res.status(500).json({ error: 'internal_error' }) }

    if (!(await rateLimit(db, req, SCHOOL_SUBMIT_LIMITS))) {
      return res.status(429).json({ error: 'rate_limited', message: TOO_MANY_REQUESTS })
    }

    const { data: cohort } = await db
      .from('cohorts').select('id, accepting_submissions').eq('id', cohortId).single()
    if (!cohort?.accepting_submissions) {
      return res.status(400).json({ error: 'This cohort is not currently accepting submissions.' })
    }

    // S-08 password gate, same shape as the submit path. One refusal message
    // for missing and wrong, so this never reveals whether a cohort is
    // protected at all.
    let requiresPassword
    try {
      const { data, error } = await db.rpc('school_form_requires_password', { p_cohort_id: cohortId })
      if (error) throw error
      requiresPassword = data === true
    } catch {
      return res.status(500).json({ error: 'We could not verify access for this form right now. Please try again shortly.' })
    }
    if (requiresPassword) {
      const entered = typeof req.body?.password === 'string' ? req.body.password.trim() : ''
      const refuse = () => res.status(403).json({ error: 'The cohort password is incorrect. Please check with the ASPIRE team.' })
      if (!entered) return refuse()
      let ok
      try {
        const { data, error } = await db.rpc('verify_school_form_password', {
          p_cohort_id: cohortId, p_entered_password: entered,
        })
        if (error) throw error
        ok = data === true
      } catch {
        return res.status(500).json({ error: 'We could not verify access for this form right now. Please try again shortly.' })
      }
      if (!ok) return refuse()
    }

    try {
      return res.status(200).json({ existing: await lookup(db, { cohortId, school }) })
    } catch (err) {
      console.error('[school-form-existing-request] lookup error:', err)
      return res.status(500).json({ error: 'internal_error' })
    }
  }
}

export default createExistingRequestHandler()
