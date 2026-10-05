// lib/server/keith/provenanceCards.js
//
// KEITH-FOUNDATION-1: what the Keith mark's hover card may show, cut down on the server so nothing
// else leaves it. /api/keith-provenance calls these.
//
// A record reaches a caller only when the caller may see the entity it is attached to:
//   budget_receipt   the Owner only (Program Budget decision 5: receipts are the Owner's)
//   anything else    staff with Keith access (keith_chat: Owner, Admin, Co-Lead, Interviewer)
// A portal user (student, school, preceptor, unit leader, leadership) holds neither, so no record
// ever reaches one: the mark is internal only, and this is the server half of that rule.
//
// What a card carries: state, the Skill's display name, when, a COUNT of what Keith read (by type;
// a receipt's file name, which the Owner already sees on the slip), who acted and when,
// confidence, reason, mode. Never the output, never the input IDs.

import { can } from '../access.js'
import { isStaffViewer, readSummary, MARK_STATES } from '../../../src/lib/keith/provenanceModel.js'
import { INPUT_LABELS, SKILL_DEFS } from './skillDefs.js'
import { normalizeStaffRole } from '../../../src/lib/permissions.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const MAX_IDS = 200

/** May this caller see provenance attached to this kind of entity? */
export function canSeeEntity(profile, entityType) {
  if (!isStaffViewer(profile)) return false
  if (entityType === 'budget_receipt') return profile?.is_owner === true
  // RESUME-REVIEW-1: a résumé review is read by the same people as the review itself.
  if (entityType === 'resume_review') {
    return profile?.is_owner === true || ['owner', 'admin', 'co-lead'].includes(normalizeStaffRole(String(profile?.role || '').toLowerCase()))
  }
  return can(profile, 'keith_chat')
}

/** Card records for the ids the caller may see; the rest are simply absent. */
export async function provenanceCards(db, profile, ids) {
  const list = [...new Set((Array.isArray(ids) ? ids : []).filter(x => UUID.test(String(x))))].slice(0, MAX_IDS)
  if (!list.length || !isStaffViewer(profile)) return {}
  const { data, error } = await db.from('keith_provenance')
    .select('id, skill_key, entity_type, entity_id, input_refs, confidence, reason, mode, state, human_action_by, human_action_at, created_at')
    .in('id', list)
  if (error) return {}
  const rows = (data || []).filter(r => canSeeEntity(profile, r.entity_type) && MARK_STATES.includes(r.state))
  if (!rows.length) return {}

  // A Skill's step (review-resume-draft, knowledge-self-check-draft) is named by its Skill's row.
  const slugOf = key => SKILL_DEFS[key]?.skillSlug || key
  const skills = [...new Set(rows.map(r => slugOf(r.skill_key)))]
  const people = [...new Set(rows.map(r => r.human_action_by).filter(Boolean))]
  const receipts = [...new Set(rows.filter(r => r.entity_type === 'budget_receipt').map(r => r.entity_id))]
  const [sk, pp, rc] = await Promise.all([
    db.from('keith_skills').select('slug, display_name').in('slug', skills),
    people.length ? db.from('user_profiles').select('id, full_name, email').in('id', people) : { data: [] },
    receipts.length ? db.from('budget_receipts').select('id, file_name').in('id', receipts) : { data: [] },
  ])
  const skillName = new Map((sk.data || []).map(s => [s.slug, s.display_name]))
  const personName = new Map((pp.data || []).map(p => [p.id, p.full_name || p.email || '']))
  const fileName = new Map((rc.data || []).map(r => [r.id, r.file_name]))

  const out = {}
  for (const r of rows) {
    let read = readSummary(r.input_refs, INPUT_LABELS)
    if (r.entity_type === 'budget_receipt' && fileName.get(r.entity_id)) {
      const others = (r.input_refs || []).filter(x => x?.type !== 'budget_receipt_file')
      read = [fileName.get(r.entity_id), readSummary(others, INPUT_LABELS)].filter(Boolean).join(', ')
    }
    out[r.id] = {
      id: r.id, state: r.state, mode: r.mode, skill_name: skillName.get(slugOf(r.skill_key)) || r.skill_key,
      created_at: r.created_at, read, confidence: r.confidence || null, reason: r.reason || null,
      human_action_by_name: r.human_action_by ? personName.get(r.human_action_by) || '' : '', human_action_at: r.human_action_at || null,
    }
  }
  return out
}
