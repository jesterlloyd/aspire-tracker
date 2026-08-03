// api/portal-activation-event.js
//
// PORTAL-ACTIVATION-RELIABILITY-1: privacy-safe activation diagnostics. The
// activation and recovery screens report WHAT happened (event type plus a broad
// category), never HOW (no tokens, no token hashes, no links, no passwords).
//
// Authentication: the caller's own session JWT. Only a signed-in user can
// record an event, and only about themselves (the target email is taken from
// the verified session, never from the body). Unauthenticated failures (e.g. a
// dead link with no session) are intentionally NOT recordable here: they are
// unattributable client-side and already visible in auth.audit_log_entries.
//
// DEFENSIVE BY DESIGN: the ledger table arrives with an Owner-gated migration
// (20260804000000). Until it is applied, and on any insert failure, this
// endpoint still returns 200: diagnostics must never break activation.

/* global process */
// Node/Vercel runtime global; the flat ESLint config registers browser globals
// only (same convention as lib/server/appUrl.js).

import { createClient } from '@supabase/supabase-js'

const EVENT_TYPES = new Set(['activation_succeeded', 'activation_failed', 'recovery_requested'])
const CATEGORIES = new Set(['password_update_failed', 'link_invalid', 'link_expired'])

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !anonKey || !serviceKey) return res.status(200).json({ recorded: false })

  const authHeader = req.headers['authorization'] || req.headers['Authorization'] || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) return res.status(401).json({ error: 'unauthorized' })

  const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {}
  const eventType = typeof body.event_type === 'string' ? body.event_type : ''
  const category = typeof body.category === 'string' && CATEGORIES.has(body.category) ? body.category : null
  if (!EVENT_TYPES.has(eventType)) return res.status(400).json({ error: 'invalid_request' })

  try {
    const userClient = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
    const { data, error } = await userClient.auth.getUser()
    if (error || !data?.user?.email) return res.status(401).json({ error: 'unauthorized' })

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
    // Best-effort profile linkage; the event is still useful without it.
    let profileId = null
    try {
      const { data: profile } = await admin
        .from('user_profiles').select('id').eq('auth_user_id', data.user.id).maybeSingle()
      profileId = profile?.id || null
    } catch { /* linkage is optional */ }

    try {
      // STRICT ALLOWLIST: exactly these four fields, with the event type and
      // category already validated against fixed sets above and the email
      // taken from the verified session. Nothing from the request body (and
      // therefore no token, hash, link, password, or header) can reach the row.
      await admin.from('portal_invitation_events').insert({
        event_type: eventType,
        target_email: data.user.email.trim().toLowerCase(),
        target_profile_id: profileId,
        category,
      })
    } catch { /* ledger absent or failed: never break activation */ }

    return res.status(200).json({ recorded: true })
  } catch {
    return res.status(200).json({ recorded: false })
  }
}
