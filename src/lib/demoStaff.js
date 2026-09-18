// src/lib/demoStaff.js
//
// DEMO-MODE-1: the fabricated staff directory.
//
// WHY THIS IS THE ONE PLACE THE BOUNDARY WORKS DIFFERENTLY
//
// Everywhere else, demo mode filters real queries to fabricated ROWS. user_profiles
// cannot work that way. Filtering it would hide the signed-in user's own profile, and
// that row is what resolves permissions, the Owner/Admin flags, the greeting and the
// avatar. The app would not so much show demo data as stop working.
//
// The directory escapes that because it does not share a path with the session:
//   src/contexts/AuthContext.jsx  -> get_my_profile        (one row, always REAL)
//   AccountsDirectory.jsx         -> get_all_user_profiles (the list, substituted here)
//
// Two RPCs, two purposes. Swapping the second changes what is drawn on one panel and
// touches nothing about who you are or what you may do. That is the whole reason this
// exception is safe, and if those two ever merge into one call, this file has to go.
//
// The names are invented. The roles and the shape of the team are plausible, because a
// directory of six identical "Test User" rows demonstrates nothing: an audience should
// see an Owner, admins, an interviewer and a deactivated account, which is what the
// panel is actually for.
//
// These are NOT database rows. They exist only in the browser, only while demo mode is
// on, and no write reaches them: every mutation in the directory goes to a server
// endpoint that resolves its own target, and a fabricated id matches nothing there.

import { DEMO_EMAIL_DOMAIN } from '../../shared/demoIdentity.js'

const at = (local) => `${local}@${DEMO_EMAIL_DOMAIN}`

/**
 * The fabricated staff list, in the shape get_all_user_profiles returns.
 *
 * Fields are the ones AccountsDirectory reads: id, full_name, email, role, is_owner,
 * is_active, can_conduct_interviews, interviewer_color, last_login_at. The last one is
 * stored here as an OFFSET and resolved by demoStaffRows(); see below.
 *
 * Ids carry the same 0de0 prefix the seeded rows use, so anything that ever leaks one
 * into a log is immediately recognisable as fabricated.
 */
export const DEMO_STAFF = Object.freeze([
  {
    id: '0de0a000-0000-4000-8000-000000000001',
    full_name: 'Delphine Marchetti',
    email: at('delphine.marchetti'),
    role: 'owner',
    is_owner: true,
    is_active: true,
    can_conduct_interviews: true,
    interviewer_color: '#1D2567',
    last_login_hours_ago: 2,
  },
  {
    id: '0de0a000-0000-4000-8000-000000000002',
    full_name: 'Augustin Bello',
    email: at('augustin.bello'),
    role: 'admin',
    is_owner: false,
    is_active: true,
    can_conduct_interviews: true,
    interviewer_color: '#128756',
    last_login_hours_ago: 6,
  },
  {
    id: '0de0a000-0000-4000-8000-000000000003',
    full_name: 'Winifred Osei',
    email: at('winifred.osei'),
    role: 'admin',
    is_owner: false,
    is_active: true,
    can_conduct_interviews: false,
    interviewer_color: null,
    last_login_hours_ago: 28,
  },
  {
    id: '0de0a000-0000-4000-8000-000000000004',
    full_name: 'Casimir Nowak',
    email: at('casimir.nowak'),
    role: 'interviewer',
    is_owner: false,
    is_active: true,
    can_conduct_interviews: true,
    interviewer_color: '#A5690F',
    last_login_hours_ago: 51,
  },
  {
    id: '0de0a000-0000-4000-8000-000000000005',
    full_name: 'Perpetua Lindgren',
    email: at('perpetua.lindgren'),
    role: 'viewer',
    is_owner: false,
    is_active: true,
    can_conduct_interviews: false,
    interviewer_color: null,
    last_login_hours_ago: 120,
  },
  // A deactivated account, because the directory's whole job includes showing one and
  // an audience should see what that looks like.
  {
    id: '0de0a000-0000-4000-8000-000000000006',
    full_name: 'Thaddeus Rourke',
    email: at('thaddeus.rourke'),
    role: 'viewer',
    is_owner: false,
    is_active: false,
    can_conduct_interviews: false,
    interviewer_color: null,
    last_login_hours_ago: 2200,
  },
])

/**
 * The rows, with last_login_at resolved NOW.
 *
 * The offsets are stored rather than the timestamps, and the timestamp is computed on
 * every read, because a module-load constant drifts: a talk can run for an hour, and
 * "last seen 2 hours ago" quietly becoming "3 hours ago" is the kind of detail that
 * makes a demo look like a fixture instead of a working system.
 *
 * Returns fresh objects, so a caller sorting or mutating the list cannot corrupt the
 * source.
 */
export function demoStaffRows() {
  const now = Date.now()
  return DEMO_STAFF.map(({ last_login_hours_ago, ...row }) => ({
    ...row,
    last_login_at: new Date(now - last_login_hours_ago * 3600 * 1000).toISOString(),
  }))
}
