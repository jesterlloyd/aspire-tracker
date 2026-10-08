// lib/server/homeDoneThreads.js
//
// HOME-ACTIVITY-DONE-1: the "resolved" source of At a Glance > Recent activity,
// read by api/home-activity.js. A thread marked Done (status resolved, which is
// what Messages' Done and the Action Center's Done both write) in the window,
// who marked it, and whose thread it was.
//
// Every column read here exists (supabase/migrations/20260716000000): the
// student is conversations.related_student_id, and the participant's name comes
// from conversation_participants -> user_profiles, exactly as the staff inbox
// reads it. Until this module, the endpoint selected participant_name and
// student_id from conversations; neither column exists, so the read failed
// every time and tryRead hid it, and no Done thread ever reached the feed.
//
// conversations has no is_demo: a thread belongs to its student's population.
// The students read goes through the caller's population-scoped client, so a
// student id it does not return is the other population's. A thread naming no
// student is real.

export async function readDoneThreads(db, { since, isDemo, limit }) {
  // TA-MESSAGES-1: a private conversation is not the ASPIRE team's, so it never reaches this feed.
  // Before 20261114000000 there is no visibility column (42703) and no private thread either.
  const read = (cols) => db.from('conversations')
    .select(cols)
    .eq('status', 'resolved').gte('resolved_at', since)
    .order('resolved_at', { ascending: false }).limit(limit)
  let { data: raw, error } = await read('id, subject, resolved_at, related_student_id, visibility')
  if (error && error.code === '42703') ({ data: raw, error } = await read('id, subject, resolved_at, related_student_id'))
  if (error) throw error
  raw = (raw || []).filter((r) => r.visibility !== 'private')

  const sids = [...new Set((raw || []).map((r) => r.related_student_id).filter(Boolean))]
  const { data: inPop, error: popError } = sids.length
    ? await db.from('students').select('id').in('id', sids)
    : { data: [] }
  if (popError) throw popError
  const pop = new Set((inPop || []).map((s) => s.id))
  const threads = (raw || []).filter((r) => (r.related_student_id ? pop.has(r.related_student_id) : !isDemo))
  const ids = threads.map((r) => r.id)
  if (!ids.length) return []

  const [{ data: evs, error: evError }, { data: parts, error: partError }] = await Promise.all([
    db.from('conversation_events').select('conversation_id, actor_profile_id, created_at')
      .in('conversation_id', ids).eq('event_type', 'resolved').order('created_at', { ascending: false }),
    db.from('conversation_participants').select('conversation_id, participant_profile_id, added_at')
      .in('conversation_id', ids).is('removed_at', null).order('added_at', { ascending: true }),
  ])
  if (evError) throw evError
  if (partError) throw partError

  const actorFor = new Map()
  for (const e of evs || []) if (!actorFor.has(e.conversation_id)) actorFor.set(e.conversation_id, e.actor_profile_id)
  const participantFor = new Map()
  for (const p of parts || []) if (!participantFor.has(p.conversation_id)) participantFor.set(p.conversation_id, p.participant_profile_id)

  const profileIds = [...new Set([...actorFor.values(), ...participantFor.values()].filter(Boolean))]
  const { data: profiles, error: profileError } = profileIds.length
    ? await db.from('user_profiles').select('id, full_name').in('id', profileIds)
    : { data: [] }
  if (profileError) throw profileError
  const nameOf = new Map((profiles || []).map((p) => [p.id, p.full_name]))

  return threads.map((r) => {
    const pid = actorFor.get(r.id) || null
    const who = nameOf.get(pid) || 'A teammate'
    const participant = nameOf.get(participantFor.get(r.id)) || null
    return {
      id: `conv:${r.id}`, kind: 'resolved', at: r.resolved_at, actorProfileId: pid, actorName: who,
      // MESSAGES-SIMPLIFY-1 renamed Resolved to Done in every staff surface.
      sentence: { pre: '', actor: who, post: ` marked ${participant ? `${participant}'s` : 'a'} thread done` },
      detail: r.subject || '',
      to: `/connect/messages?conversation=${encodeURIComponent(r.id)}`,
    }
  })
}
