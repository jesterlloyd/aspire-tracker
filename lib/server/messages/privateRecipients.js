// lib/server/messages/privateRecipients.js
//
// TA-MESSAGES-1 (Owner, 2026-10-07): who may be messaged PRIVATELY, from verified server state.
//
//   Talent Acquisition  -> one unit leader (active unit_leader grant and at least one active unit
//                          scope) or one alumnus (a Completed student with an active Student Portal
//                          link and grant). "Alumni" means Completed, nothing else.
//   a unit leader       -> one Talent Acquisition member (active talent_acquisition grant).
//   an alumnus          -> one Talent Acquisition member. A student who is not Completed has no
//                          private thread to start: their Messages stays the ASPIRE Team's.
//
// Every recipient is an ACTIVE profile with an email, because a private message is announced by
// email. The same predicates decide the picker's list and the start endpoint's check, so a picker
// entry is always startable and a forged profile id is refused exactly like an absent one.
// messages_start_private_conversation re-checks both parties' access in the database.

const PICKER_LIMIT = 50

function isActiveWindow(row, now = Date.now()) {
  if (row.revoked_at) return false
  if (row.starts_at && Date.parse(row.starts_at) > now) return false
  if (row.expires_at && Date.parse(row.expires_at) <= now) return false
  return true
}

/** Which kinds this caller may start a private conversation with. */
export function privateRecipientKinds(actorKind) {
  if (actorKind === 'talent_acquisition') return ['unit_leader', 'student']
  if (actorKind === 'unit_leader' || actorKind === 'student') return ['talent_acquisition']
  return []
}

/** An alumnus is a student caller with at least one Completed linked student. */
export async function isAlumnusCaller(db, studentIds = []) {
  if (!studentIds.length) return false
  const { data, error } = await db.from('students').select('id, status').in('id', studentIds)
  if (error) throw error
  return (data || []).some((s) => s.status === 'Completed')
}

async function grantedProfiles(db, role) {
  const { data, error } = await db.from('user_role_grants')
    .select('user_profile_id, starts_at, expires_at, revoked_at').eq('role', role)
  if (error) throw error
  return [...new Set((data || []).filter((g) => isActiveWindow(g)).map((g) => g.user_profile_id))]
}

async function activeProfiles(db, ids) {
  if (!ids.length) return []
  const { data, error } = await db.from('user_profiles')
    .select('id, full_name, email, is_active').in('id', ids)
  if (error) throw error
  return (data || []).filter((p) => p.is_active !== false && p.email)
}

const matches = (q, ...fields) => !q || fields.some((f) => String(f || '').toLowerCase().includes(q))

async function unitLeaders(db, q) {
  const ids = await grantedProfiles(db, 'unit_leader')
  if (!ids.length) return []
  const { data: scopes, error } = await db.from('user_unit_scopes')
    .select('user_profile_id, unit_key, starts_at, expires_at, revoked_at').in('user_profile_id', ids)
  if (error) throw error
  const units = new Map()
  for (const s of (scopes || []).filter((x) => isActiveWindow(x))) {
    units.set(s.user_profile_id, [...(units.get(s.user_profile_id) || []), s.unit_key])
  }
  return (await activeProfiles(db, ids.filter((id) => units.has(id))))
    .map((p) => ({ profile_id: p.id, kind: 'unit_leader', name: p.full_name || 'Unit Leader', detail: units.get(p.id).sort().join(', '), email: p.email }))
    .filter((r) => matches(q, r.name, r.detail))
}

async function alumni(db, populationDb, q) {
  const ids = await grantedProfiles(db, 'student')
  if (!ids.length) return []
  const { data: links, error } = await db.from('user_student_links')
    .select('user_profile_id, student_id, revoked_at').in('user_profile_id', ids).is('revoked_at', null)
  if (error) throw error
  const studentIds = [...new Set((links || []).map((l) => l.student_id))]
  if (!studentIds.length) return []
  // The population-scoped client: a demo alumnus never appears to a real HR member, or the reverse.
  const { data: students, error: sErr } = await populationDb.from('students')
    .select('id, first_name, last_name, preferred_first_name, school, status').in('id', studentIds).eq('status', 'Completed')
  if (sErr) throw sErr
  const byId = new Map((students || []).map((s) => [s.id, s]))
  const profiles = await activeProfiles(db, [...new Set((links || []).filter((l) => byId.has(l.student_id)).map((l) => l.user_profile_id))])
  const pById = new Map(profiles.map((p) => [p.id, p]))
  const out = []
  for (const l of links || []) {
    const s = byId.get(l.student_id); const p = pById.get(l.user_profile_id)
    if (!s || !p) continue
    const name = `${s.preferred_first_name || s.first_name || ''} ${s.last_name || ''}`.trim() || p.full_name || 'Alumnus'
    out.push({ profile_id: p.id, kind: 'student', name, detail: ['Alumnus', s.school].filter(Boolean).join(' · '), email: p.email })
  }
  const seen = new Set()
  return out.filter((r) => (seen.has(r.profile_id) ? false : seen.add(r.profile_id))).filter((r) => matches(q, r.name, r.detail))
}

async function talentAcquisition(db, q) {
  return (await activeProfiles(db, await grantedProfiles(db, 'talent_acquisition')))
    .map((p) => ({ profile_id: p.id, kind: 'talent_acquisition', name: p.full_name || 'Talent Acquisition', detail: 'Talent Acquisition · Residency', email: p.email }))
    .filter((r) => matches(q, r.name, r.detail))
}

/**
 * The picker's list for this caller and kind. Never includes the caller. Emails are dropped
 * before anything leaves the server; the start endpoint resolves the address again itself.
 */
export async function listPrivateRecipients(db, populationDb, { actorKind, selfProfileId, kind, query = '' }) {
  if (!privateRecipientKinds(actorKind).includes(kind)) return []
  const q = String(query || '').trim().toLowerCase().slice(0, 80)
  const rows = kind === 'unit_leader' ? await unitLeaders(db, q)
    : kind === 'student' ? await alumni(db, populationDb, q)
    : await talentAcquisition(db, q)
  return rows
    .filter((r) => r.profile_id !== selfProfileId)
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, PICKER_LIMIT)
    .map((r) => ({ profile_id: r.profile_id, kind: r.kind, name: r.name, detail: r.detail }))
}

/** The counterpart for a start, or null when this caller may not message that profile. */
export async function resolvePrivateRecipient(db, populationDb, { actorKind, selfProfileId, kind, profileId }) {
  if (!privateRecipientKinds(actorKind).includes(kind) || !profileId || profileId === selfProfileId) return null
  const rows = kind === 'unit_leader' ? await unitLeaders(db, '')
    : kind === 'student' ? await alumni(db, populationDb, '')
    : await talentAcquisition(db, '')
  const hit = rows.find((r) => r.profile_id === profileId)
  return hit ? { profileId: hit.profile_id, email: hit.email, fullName: hit.name, kind, role: kind } : null
}
