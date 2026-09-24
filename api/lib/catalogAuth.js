// api/lib/catalogAuth.js
//
// CATALOG-REVAMP-1: the caller check the Catalog's newer endpoints share. It is the same
// check catalog-resource-upload.js and catalog-resource-update.js write out inline: a
// Bearer session, an active user_profiles row (S-05), and Owner or Admin. Kept as one
// function here so the personal-file review and the record-document download cannot
// drift from each other.

import { createClient } from '@supabase/supabase-js'
import process from 'node:process'
import { isActiveProfile, INACTIVE_STATUS, INACTIVE_REASON, INACTIVE_MESSAGE } from './activeAccount.js'

/** Resolves to the active Owner/Admin profile or { ok: false, status, body }. */
export async function verifyOwnerAdmin(req, admin) {
  const header = req.headers?.authorization || req.headers?.Authorization || ''
  const token = String(header).replace(/^Bearer\s+/i, '').trim()
  if (!token) return { ok: false, status: 401, body: { error: 'Unauthorized' } }

  let user
  try {
    const userClient = createClient(
      process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
      process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY,
      { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } },
    )
    const { data, error } = await userClient.auth.getUser()
    if (error || !data?.user) return { ok: false, status: 401, body: { error: 'Unauthorized' } }
    user = data.user
  } catch {
    return { ok: false, status: 401, body: { error: 'Unauthorized' } }
  }

  const { data: profile, error: pErr } = await admin
    .from('user_profiles').select('id, role, is_owner, is_active').eq('auth_user_id', user.id).maybeSingle()
  if (pErr) return { ok: false, status: 401, body: { error: 'Unauthorized' } }
  if (!profile) return { ok: false, status: 403, body: { error: 'Forbidden' } }
  if (!isActiveProfile(profile)) return { ok: false, status: INACTIVE_STATUS, body: { error: 'Forbidden', reason: INACTIVE_REASON, message: INACTIVE_MESSAGE } }
  const ownerAdmin = profile.is_owner === true || profile.role === 'owner' || profile.role === 'admin'
  if (!ownerAdmin) return { ok: false, status: 403, body: { error: 'Forbidden' } }
  return {
    ok: true,
    profileId: profile.id,
    role: profile.role || '',
    isOwner: profile.is_owner === true || profile.role === 'owner',
  }
}
