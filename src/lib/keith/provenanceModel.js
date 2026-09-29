// src/lib/keith/provenanceModel.js
//
// KEITH-FOUNDATION-1 (2026-09-28): the rules for a Keith provenance record, pure and shared by the
// server (runKeithSkill, recordKeithOutcome, /api/keith-provenance) and the browser (KeithMark).
// Reference: docs/mockups/keith-workflow.html.
//
//   STATES         drafted | edited | accepted | rejected | reverted
//   nextState      what a person's action does to a record (accept, edit, reject, undo, revert)
//   markFor        what the Keith mark draws for a state; rejected and reverted draw nothing,
//                  because they are not on screen
//   accessibleName the mark's name: "Drafted by Keith. Show details", and so on
//   cardView       the hover card's fields, from a record (a count of what Keith read, never what)
//   computeAgreement  shadow mode's figure: total, agreed, and a breakdown by Keith's label
//   isStaffViewer  the mark is internal only: staff roles see it, nobody else does

export const STATES = Object.freeze(['drafted', 'edited', 'accepted', 'rejected', 'reverted'])
export const MODES = Object.freeze(['off', 'shadow', 'on'])
export const ACTIONS = Object.freeze(['edit', 'accept', 'reject', 'undo', 'revert', 'observe'])

/** The three states a mark can draw. Anything else draws nothing. */
export const MARK_STATES = Object.freeze(['drafted', 'edited', 'accepted'])

const LABELS = Object.freeze({
  drafted: 'Drafted by Keith',
  edited: 'Edited after Keith drafted it',
  accepted: 'Suggested by Keith, accepted',
})

/** Badge colours from the approved mockup. Fixed in both themes: they sit on the orb, not the page. */
export const BADGES = Object.freeze({
  edited: { fill: '#F5B530', ink: '#5A2E0A' },
  accepted: { fill: '#3FD6AE', ink: '#14205C' },
})

export const markFor = (state) => (MARK_STATES.includes(state) ? state : null)
export const stateLabel = (state) => LABELS[state] || ''
export const accessibleName = (state) => (LABELS[state] ? `${LABELS[state]}. Show details` : '')

/**
 * A skill's mode from its keith_skills row. OFF is the existing switch (not active, or disabled);
 * otherwise run_mode, which reads as 'on' until the foundation migration adds the column.
 */
export function skillMode(skill) {
  if (!skill || skill.status !== 'active' || skill.enabled !== true) return 'off'
  return skill.run_mode === 'shadow' ? 'shadow' : 'on'
}

/**
 * What a person's action does to a record's state.
 *   edit    drafted -> edited; edited stays edited
 *   accept  drafted -> accepted; edited stays edited (it was accepted WITH changes, and the mark
 *           keeps saying so)
 *   reject  -> rejected
 *   undo    reverses an accept or a reject back to the state before it (`prior`)
 *   revert  -> reverted: the person took back something Keith's output had done
 *   observe (shadow mode) records the person's own decision beside Keith's; the state is unchanged
 * An action that does not apply returns null, and the caller writes nothing.
 */
export function nextState(current, action, { prior = null } = {}) {
  if (!STATES.includes(current)) return null
  switch (action) {
    case 'edit': return current === 'drafted' || current === 'edited' ? 'edited' : null
    case 'accept': return current === 'drafted' ? 'accepted' : current === 'edited' ? 'edited' : null
    case 'reject': return current === 'rejected' ? null : 'rejected'
    case 'undo': {
      // Undo of a revert (KEITH-CHECKIN-1: Undo after Reopen) puts Keith's action back too.
      if (current !== 'accepted' && current !== 'rejected' && current !== 'edited' && current !== 'reverted') return null
      return prior === 'edited' ? 'edited' : 'drafted'
    }
    case 'revert': return current === 'reverted' ? null : 'reverted'
    case 'observe': return current
    default: return null
  }
}

const MAX_DIFF = 60

/**
 * Merge what a person changed into what was already recorded, one entry per field (and line), keeping
 * the FIRST `from` (what Keith said) and the LATEST `to`. A value changed back to Keith's own drops out.
 */
export function mergeDiff(prev, next) {
  const out = new Map()
  const keyOf = (e) => `${e.field}|${e.line ?? e.item ?? e.added ?? e.removed ?? ''}`
  for (const e of Array.isArray(prev) ? prev : []) out.set(keyOf(e), e)
  for (const e of Array.isArray(next) ? next : []) {
    const k = keyOf(e)
    const was = out.get(k)
    if (was && 'added' in was && 'removed' in e) { out.delete(k); continue }   // added, then removed: no change
    if (was && 'from' in was && 'to' in e) {
      const merged = { ...was, to: e.to }
      if (String(merged.from ?? '') === String(merged.to ?? '')) out.delete(k)
      else out.set(k, merged)
    } else out.set(k, e)
  }
  return [...out.values()].slice(0, MAX_DIFF)
}

/** The lowest confidence among lines, or null when none carries one. */
export function lowestConfidence(list) {
  const seen = (Array.isArray(list) ? list : []).map(x => x?.confidence).filter(Boolean)
  if (!seen.length) return null
  if (seen.includes('low')) return 'low'
  if (seen.includes('medium')) return 'medium'
  return 'high'
}

const CONF_LABEL = { high: 'High', medium: 'Medium', low: 'Low' }

function when(iso, now = new Date()) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const sameDay = d.toDateString() === now.toDateString()
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  if (sameDay) return `Today, ${time}`
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) })
  return `${date}, ${time}`
}

/** "1 file", "3 replies": a count of what Keith read, by type, never its contents. */
export function readSummary(refs, labels = {}) {
  const list = Array.isArray(refs) ? refs : []
  if (!list.length) return ''
  const counts = new Map()
  for (const r of list) counts.set(r?.type || 'record', (counts.get(r?.type || 'record') || 0) + 1)
  return [...counts.entries()].map(([type, n]) => {
    const [one, many] = labels[type] || ['record', 'records']
    return `${n} ${n === 1 ? one : many}`
  }).join(', ')
}

/** What the Person line says for a state, or '' when nobody has acted. */
function personLine(record, now) {
  if (!record.human_action_by_name) return ''
  const t = when(record.human_action_at, now)
  const verb = record.state === 'edited' ? 'Edited by' : record.state === 'accepted' ? 'Accepted by' : 'By'
  return `${verb} ${record.human_action_by_name}${t ? `, ${t}` : ''}`
}

/**
 * The hover card, from a record the server has already cut down to what a card may show. `read` is
 * the count line (the server composes it, so it can name a receipt's file without sending the IDs).
 */
export function cardView(record, { now = new Date() } = {}) {
  if (!record || !markFor(record.state)) return null
  return {
    state: record.state,
    title: stateLabel(record.state),
    rows: [
      record.skill_name ? ['Skill', record.skill_name] : null,
      record.created_at ? ['When', when(record.created_at, now)] : null,
      record.read ? ['Read', record.read] : null,
      personLine(record, now) ? ['Person', personLine(record, now)] : null,
      record.confidence ? ['Confidence', CONF_LABEL[record.confidence] || record.confidence] : null,
      record.mode === 'shadow' ? ['Mode', 'Shadow mode: Keith took no action'] : null,
    ].filter(Boolean),
    why: record.reason ? String(record.reason) : '',
    footer: 'Internal only. Logged in Keith › Usage & Cost.',
  }
}

/**
 * Shadow mode agreement for one skill. Each row is { keith, human }: the label Keith gave and the
 * decision the person made on the same entity. Rows with no human decision yet are not counted.
 * `agrees(keith, human)` decides a match when a person's decisions do not map one to one onto
 * Keith's labels (KEITH-CHECKIN-1); the default is equality.
 */
export function computeAgreement(rows, agrees = (k, h) => String(h) === String(k)) {
  const byLabel = {}
  let total = 0
  let agreed = 0
  for (const r of Array.isArray(rows) ? rows : []) {
    if (r?.keith == null || r?.human == null) continue
    const k = String(r.keith)
    const ok = agrees(k, String(r.human)) === true
    total += 1
    if (ok) agreed += 1
    byLabel[k] = byLabel[k] || { total: 0, agreed: 0 }
    byLabel[k].total += 1
    if (ok) byLabel[k].agreed += 1
  }
  return { total, agreed, rate: total ? agreed / total : null, byLabel }
}

/** "96%", or an en dash when nothing has been compared yet. */
export const agreementPercent = (a) => (a?.rate == null ? '–' : `${Math.round(a.rate * 100)}%`)

/**
 * The mark is internal only (Owner, KEITH-FOUNDATION-1): it renders for staff and for nobody else. A
 * portal user (student, school, preceptor, unit leader, leadership) has none of these roles.
 */
const STAFF = new Set(['owner', 'admin', 'co-lead', 'co_lead', 'interviewer', 'viewer'])
export function isStaffViewer(profile) {
  if (!profile) return false
  if (profile.is_owner === true) return true
  return STAFF.has(String(profile.role || '').trim().toLowerCase())
}
