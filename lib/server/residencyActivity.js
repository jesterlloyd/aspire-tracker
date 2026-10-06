// lib/server/residencyActivity.js
//
// RESIDENCY-TA-1: the rows behind Settings > Residency Activity, newest first, with the names
// that make them readable (who acted, which alumnus, which residency cohort). One population:
// a demo session reads events about demo students only, and a real one never sees them
// (ngrp_audit_events has no is_demo, so the student answers; an event with no student is real).
import { displayName } from '../../src/lib/utils.js'

const FIELDS = 'id, event_type, cycle_id, student_id, actor_profile_id, actor_kind, metadata, created_at'

export async function loadResidencyActivity(db, { limit = 200, before = null, demo = false } = {}) {
  let q = db.from('ngrp_audit_events').select(FIELDS).order('created_at', { ascending: false }).limit(Math.min(Math.max(Number(limit) || 200, 1), 500))
  if (before) q = q.lt('created_at', before)
  const ev = await q
  if (ev.error) return { error: ev.error }
  const rows = ev.data || []
  const ids = key => [...new Set(rows.map(r => r[key]).filter(Boolean))]
  const [st, pr, cy] = await Promise.all([
    ids('student_id').length ? db.from('students').select('id, first_name, last_name, preferred_first_name, name, is_demo').in('id', ids('student_id')) : { data: [] },
    ids('actor_profile_id').length ? db.from('user_profiles').select('id, full_name, role').in('id', ids('actor_profile_id')) : { data: [] },
    ids('cycle_id').length ? db.from('ngrp_cycles').select('id, name').in('id', ids('cycle_id')) : { data: [] },
  ])
  if (st.error || pr.error || cy.error) return { error: st.error || pr.error || cy.error }
  const students = new Map((st.data || []).map(s => [s.id, s]))
  const people = new Map((pr.data || []).map(p => [p.id, p]))
  const cycles = new Map((cy.data || []).map(c => [c.id, c]))
  const out = []
  for (const r of rows) {
    const s = r.student_id ? students.get(r.student_id) : null
    const isDemo = s ? s.is_demo === true : false
    if (isDemo !== demo) continue
    const p = r.actor_profile_id ? people.get(r.actor_profile_id) : null
    out.push({
      ...r,
      student_name: s ? displayName(s) : null,
      actor_name: p?.full_name || null,
      actor_role: p?.role ? String(p.role).toLowerCase() : null,
      cycle_name: r.cycle_id ? cycles.get(r.cycle_id)?.name || null : null,
    })
  }
  return { rows: out, nextBefore: rows.length ? rows[rows.length - 1].created_at : null, more: rows.length >= Math.min(Number(limit) || 200, 500) }
}
