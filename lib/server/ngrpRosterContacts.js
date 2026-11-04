// lib/server/ngrpRosterContacts.js
//
// RESIDENCY-PROFILES-TOOLBAR-1 (Owner, 2026-11-03): Residency > Profiles & Interest > Profiles has
// Student Profiles' Copy visible emails and Send Message to All. The roster strips emails to
// `has_email` (sanitizeStudent), so the addresses and numbers travel only on this read, for the
// alumni the caller is looking at, and only for alumni on this cohort's roster.
//
// Which address: residencyRecipient's pre-hire rule, the Transition Form's preferred email, else
// the personal email (never the school email: an alumnus has left school).
//
// Who sees what (RESIDENCY-APPLICANT-PROFILE-1's rule, applied to a list):
//   - the ASPIRE team: everyone they asked for;
//   - Talent Acquisition: only alumni who SUBMITTED the Transition Form, where they consent to
//     share with Talent Acquisition. The rest are counted as `withheld`, never named.
import { residencyRecipient } from './ngrpResidencyRecipient.js'
import { hasSubmittedForm, TALENT_ACQUISITION } from './ngrpTalentAcquisition.js'
import { fetchLatestRevisions } from './ngrpResidencyExport.js'

const MAX_IDS = 2000

// Pure. `students` are full student rows (personal_email, phone), already limited to the roster.
export function shapeRosterContacts({ studentIds, students, candidates, revisionsByAssignment, audience }) {
  const byStudent = new Map((students || []).map(s => [s.id, s]))
  const candOf = new Map((candidates || []).map(c => [c.student_id, c]))
  const contacts = []
  let withheld = 0
  for (const id of studentIds) {
    const st = byStudent.get(id)
    if (!st) continue
    const cand = candOf.get(id) || null
    if (audience === TALENT_ACQUISITION && !hasSubmittedForm(cand?.form_status)) { withheld++; continue }
    const identity = cand?.assignment_id ? revisionsByAssignment?.get(cand.assignment_id)?.identity : null
    const route = residencyRecipient({ formPreferredEmail: identity?.preferred_email || null, student: st })
    contacts.push({ student_id: id, email: route.email || null, phone: st.phone || null })
  }
  return { contacts, withheld }
}

// payload is loadApplicantsPayload's (the roster). Asked-for ids off the roster are dropped.
export async function loadRosterContacts(db, { payload, studentIds, audience }) {
  const onRoster = new Set((payload.students || []).map(s => s.id))
  const ids = [...new Set((Array.isArray(studentIds) ? studentIds : []).filter(x => typeof x === 'string'))]
    .slice(0, MAX_IDS).filter(id => onRoster.has(id))
  if (!ids.length) return { contacts: [], withheld: 0 }
  const rows = []
  for (let i = 0; i < ids.length; i += 200) {
    const r = await db.from('students').select('id, personal_email, phone').in('id', ids.slice(i, i + 200))
    if (r.error) return { error: r.error }
    rows.push(...(r.data || []))
  }
  const candidates = (payload.candidates || []).filter(c => ids.includes(c.student_id))
  const revisions = await fetchLatestRevisions(db, candidates)
  if (revisions.error) return { error: revisions.error }
  return shapeRosterContacts({ studentIds: ids, students: rows, candidates, revisionsByAssignment: revisions.byAssignment, audience })
}
