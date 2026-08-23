// api/portal/my-access-state.js
//
// PORTAL-ACCESS-STATE: why this caller has no portal to open.
//
// The portal client can already tell that a person has no active portal role,
// because get_my_portal_access() returns an empty roles array. What it cannot
// tell is WHY, since that RPC reports only grants that are currently in force:
// a grant that was revoked, a grant that reached its end date, and a grant that
// never existed are all the same empty array. That is what let one "being
// prepared" message stand in for every one of them.
//
// This endpoint answers the why, and nothing else. It returns a single state
// string about the CALLER'S OWN account. It exposes no program data, no other
// person's record, no dates, and no grant rows.
//
// AUTHORIZATION. Unchanged from every other portal endpoint: verifyPortalCaller,
// which requires a verified JWT and an active profile. A deactivated caller is
// refused here exactly as elsewhere, and that is deliberate rather than a gap:
// the client already knows it is deactivated from its own profile and never
// needs to ask. Nothing about S-05 is loosened to serve this screen.

import { verifyPortalCaller, getServiceDb } from '../lib/portalAuth.js'

// The roles that open a portal. A grant for anything else is not what this
// screen is about and is ignored.
const PORTAL_ROLES = ['student', 'unit_leader', 'academic_partner']

export const STATES = {
  ACTIVE: 'active',
  PENDING: 'pending',
  REVOKED: 'revoked',
  EXPIRED: 'expired',
  NOT_PROVISIONED: 'not_provisioned',
}

const ms = (v) => (v ? new Date(v).getTime() : null)

// Classify a set of grant rows into the one state worth telling someone.
//
// An active grant wins, then a grant that has not started yet. Otherwise every
// grant has ended, and the honest answer is why the MOST RECENT one ended:
// someone revoked earlier access and later access then lapsed on its own should
// be told "expired", not "revoked", because the lapse is the current situation.
export function classifyGrants(rows, now = Date.now()) {
  const grants = (rows || []).filter((g) => PORTAL_ROLES.includes(g.role))
  if (grants.length === 0) return STATES.NOT_PROVISIONED

  const live = grants.filter((g) => !g.revoked_at)
  if (live.some((g) => ms(g.starts_at) <= now && (g.expires_at == null || ms(g.expires_at) > now))) {
    return STATES.ACTIVE
  }
  if (live.some((g) => ms(g.starts_at) > now)) return STATES.PENDING

  // Everything has ended. Take the latest ending and report its cause.
  let latest = null
  for (const g of grants) {
    const endedAt = g.revoked_at ? ms(g.revoked_at) : ms(g.expires_at)
    if (endedAt == null) continue
    if (latest == null || endedAt > latest.endedAt) {
      latest = { endedAt, reason: g.revoked_at ? STATES.REVOKED : STATES.EXPIRED }
    }
  }
  // A grant row with neither an end nor a start we can read: say the neutral
  // thing rather than inventing a reason.
  return latest ? latest.reason : STATES.NOT_PROVISIONED
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Cache-Control', 'no-store')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })

  const auth = await verifyPortalCaller(req)
  if (!auth.authenticated) {
    return res.status(auth.status || 401).json({ error: auth.reason || 'unauthorized' })
  }

  const db = getServiceDb()
  const { data, error } = await db
    .from('user_role_grants')
    .select('role, starts_at, expires_at, revoked_at')
    .eq('user_profile_id', auth.profile.id)

  // A failed lookup must NOT read as "you were never set up". The client shows
  // its could-not-check wording for this, with a way to try again.
  if (error) return res.status(503).json({ error: 'state_unavailable' })

  return res.status(200).json({ state: classifyGrants(data) })
}
