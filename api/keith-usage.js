// KEITH-USAGE-1: the ONLY read path for Keith usage telemetry.
//
// Settings > Keith > Usage & Cost is served from here, never from direct
// browser reads of keith_requests - that table is deny-all at the RLS layer
// (zero policies, no authenticated grant) and stays that way. Same governance
// shape as api/keith-skills-admin.js: one POST, an { action, ...params } body,
// a strict per-action key allow-list, server-verified identity, Owner/Admin
// only.
//
// WHAT LEAVES THIS ENDPOINT: aggregate numbers and per-request metadata (time,
// staff name/role, intent, skill, model, token counts, estimated cost, latency,
// outcome). Never prompts, answers, resume text, or student identifiers -
// keith_requests has no content column to leak, and the recent-activity rows
// deliberately exclude request_id and student linkage.
//
// COST FIGURES ARE ESTIMATES. They price ASPIRE's own recorded base token
// counts at the official Anthropic per-model rates in modelPricing.js. The
// Anthropic Console is the billing authority; no Anthropic billing or admin
// credential exists here or anywhere in this app.

/* global process */
// ^ the repo's flat ESLint config has no node env for api/; existing endpoints
// carry that as recorded technical debt. This file declares the one global it
// uses instead of adding seven more errors to the pile.

import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'
import { summarizeUsage, rangeStart, USAGE_RANGES } from '../lib/server/keith/usageSummary.js'
import { pricingTable, PRICING_AS_OF, PRICING_SOURCE } from '../lib/server/keith/modelPricing.js'

// Metadata columns only. request_id is deliberately not selected: it exists to
// correlate server logs, and echoing it to the browser buys nothing.
const USAGE_COLUMNS = 'id, created_at, profile_id, role, intent, skill_id, model, model_route, input_tokens, output_tokens, duration_ms, outcome, rate_limited'

// Bounded fetch. At current volume a 30-day window is hundreds of rows; the cap
// is a safety valve for growth, and hitting it is REPORTED (truncated: true in
// the response), never silent.
const ROW_CAP = 10000
const RECENT_LIMIT = 50

const ACTION_SCHEMAS = {
  usage_summary: ['range'],
}

function serviceClient() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

async function verifyCaller(req) {
  const authHeader = req.headers['authorization'] || req.headers['Authorization'] || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) return { authenticated: false, status: 401, reason: 'missing_token' }

  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY

  let user
  try {
    const userClient = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
    const { data, error } = await userClient.auth.getUser()
    if (error || !data?.user) return { authenticated: false, status: 401, reason: 'invalid_token' }
    user = data.user
  } catch {
    return { authenticated: false, status: 401, reason: 'verify_threw' }
  }

  try {
    const admin = serviceClient()
    const { data: profile, error: pErr } = await admin
      .from('user_profiles')
      .select('id, role, is_owner, is_active')
      .eq('auth_user_id', user.id)
      .maybeSingle()
    if (pErr) return { authenticated: false, status: 401, reason: 'profile_lookup_failed' }
    if (!profile) return { authenticated: false, status: 403, reason: 'no_profile' }
    if (profile.is_active === false) return { authenticated: false, status: 403, reason: 'deactivated' }
    return {
      authenticated: true,
      profileId: profile.id,
      role: profile.role || '',
      isOwner: profile.is_owner === true,
    }
  } catch {
    return { authenticated: false, status: 401, reason: 'profile_threw' }
  }
}

// Owner/Admin only, decided in the v1 plan: Keith spend, usage analytics, and
// API-consumption detail are not exposed to Co-Lead, Interviewer, Viewer, or
// portal roles. Same predicate keith-skills-admin uses.
function canViewUsage(role, isOwner) {
  if (isOwner) return true
  return role === 'admin'
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  const requestId = `ku_${randomUUID().slice(0, 8)}`
  const auth = await verifyCaller(req)
  if (!auth.authenticated) return res.status(auth.status || 401).json({ error: auth.reason || 'unauthorized' })
  if (!canViewUsage(auth.role, auth.isOwner)) return res.status(403).json({ error: 'forbidden' })

  const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {}
  const action = String(body.action || '')
  const schema = ACTION_SCHEMAS[action]
  if (!schema) return res.status(400).json({ error: 'unknown_action' })

  const extra = Object.keys(body).filter(k => k !== 'action' && !schema.includes(k))
  if (extra.length) return res.status(400).json({ error: 'unexpected_field', field: extra[0] })

  const range = USAGE_RANGES.includes(body.range) ? body.range : '30d'
  const db = serviceClient()

  try {
    const now = new Date()
    const since = rangeStart(range, now).toISOString()

    const { data: rows, error } = await db
      .from('keith_requests')
      .select(USAGE_COLUMNS)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(ROW_CAP)
    if (error) {
      console.error('[keith-usage] query failed', { request_id: requestId, code: error.code })
      return res.status(500).json({ error: 'internal_error' })
    }

    const usage = rows || []
    const truncated = usage.length >= ROW_CAP
    if (truncated) console.warn('[keith-usage] row cap hit', { request_id: requestId, range, cap: ROW_CAP })

    // Label lookups, bounded to ids actually present in the window.
    const skillIds = [...new Set(usage.map(r => r.skill_id).filter(Boolean))]
    const profileIds = [...new Set(usage.map(r => r.profile_id).filter(Boolean))]

    const skillNames = new Map()
    if (skillIds.length) {
      const { data: skills } = await db.from('keith_skills').select('id, display_name, slug').in('id', skillIds)
      for (const s of skills || []) skillNames.set(s.id, s.display_name || s.slug)
    }
    const profileNames = new Map()
    if (profileIds.length) {
      const { data: profiles } = await db.from('user_profiles').select('id, full_name').in('id', profileIds)
      for (const p of profiles || []) profileNames.set(p.id, p.full_name || null)
    }

    const summary = summarizeUsage({
      rows: usage, skillNames, profileNames, range, now, truncated, recentLimit: RECENT_LIMIT,
    })

    return res.status(200).json({
      summary,
      pricing: {
        source: PRICING_SOURCE,
        asOf: PRICING_AS_OF,
        perModel: pricingTable(),
        note: 'Estimated from recorded base input/output tokens at official Anthropic rates. The Anthropic Console is the billing authority.',
      },
    })
  } catch (err) {
    console.error('[keith-usage] unhandled', { request_id: requestId, action, reason: err?.message })
    return res.status(500).json({ error: 'internal_error' })
  }
}
