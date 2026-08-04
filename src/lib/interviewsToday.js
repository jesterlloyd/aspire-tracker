// INTERVIEWS-TODAY-COMPACT-1: the pure logic behind the compact Interviews
// Today cards, shared by the Interviews workspace and the At a Glance band so
// both surfaces scope, sort, and label identically.
//
// CANONICAL INTERVIEWER SCOPING. `interview_slots` carries only
// `interviewer_name` (TEXT); the canonical `interviewer_profile_id` lives on the
// parent `interview_availability_blocks` row. Scoping therefore resolves
//   slot -> block (slot.block_id) -> interviewer_profile_id
// and compares PROFILE IDS. Display-name matching is never used: names are not
// unique, they change, and that is exactly the drift the preceptor and
// staff-invite canonicalization work removed elsewhere in this app.
//
// This module holds no data access and no authorization. It filters only what a
// caller already fetched under existing RLS, so it can never widen exposure.

export const INTERVIEW_STATES = ['in_progress', 'upcoming', 'completed', 'canceled']

/**
 * The canonical interviewer profile id for a slot, via its parent block.
 * Returns null when the slot has no resolvable block (never a name).
 */
export function slotInterviewerProfileId(slot, blocksById) {
  if (!slot) return null
  const blockId = slot.block_id
  if (!blockId) return null
  const block = blocksById instanceof Map ? blocksById.get(blockId) : blocksById?.[blockId]
  return block?.interviewer_profile_id || null
}

/**
 * Role-aware scoping. Owner/Admin see every interview the caller already
 * fetched; an interviewer sees only slots whose parent block names THEM by
 * profile id. Any other role gets the same self-only rule, so no role is ever
 * broadened here.
 */
export function scopeInterviewsForViewer(slots, { blocksById, viewerProfileId, isAdmin }) {
  const list = Array.isArray(slots) ? slots : []
  if (isAdmin) return list
  if (!viewerProfileId) return []
  return list.filter(s => slotInterviewerProfileId(s, blocksById) === viewerProfileId)
}

/** The parent availability block for a slot, or null. */
export function slotBlock(slot, blocksById) {
  const blockId = slot?.block_id
  if (!blockId) return null
  return (blocksById instanceof Map ? blocksById.get(blockId) : blocksById?.[blockId]) || null
}

/**
 * The booked interviewer's display name for a slot, resolved CANONICALLY:
 *   slot.block_id -> block.interviewer_profile_id -> that staff profile's name.
 * Identity always comes from the profile id; names are only ever the OUTPUT of
 * that lookup, never the key it is matched on.
 *
 * Two recorded fallbacks keep a genuinely booked interview from reading as
 * unassigned: the block's own denormalized interviewer_name (the canonical
 * booking row, used when the profile no longer resolves - for example an
 * interviewer who left staff), then the slot's. Both are stored booking facts,
 * not inference. Returns null only when nothing was ever recorded, which is the
 * only case that should surface as "Interviewer pending".
 */
export function resolveSlotInterviewerName(slot, { blocksById, nameByProfileId } = {}) {
  const profileId = slotInterviewerProfileId(slot, blocksById)
  if (profileId) {
    const name = nameByProfileId instanceof Map
      ? nameByProfileId.get(profileId)
      : nameByProfileId?.[profileId]
    if (name) return name
  }
  return slotBlock(slot, blocksById)?.interviewer_name || slot?.interviewer_name || null
}

/**
 * Map of student id -> booked interviewer name across a cohort's slots, so the
 * interviewer appears the moment a slot is BOOKED rather than only after a
 * rubric is submitted. A student who rebooked resolves to their latest booked
 * slot, which is the appointment every other surface shows; ties fall back to
 * the immutable slot id so the result is stable across renders.
 */
function isLaterSlot(a, b) {
  const ta = slotStartDate(a)?.getTime() ?? 0
  const tb = slotStartDate(b)?.getTime() ?? 0
  if (ta !== tb) return ta > tb
  return String(a?.id) > String(b?.id)
}

export function buildInterviewerNameByStudent(slots, { blocksById, nameByProfileId } = {}) {
  const latest = new Map()
  for (const slot of slots || []) {
    const studentId = slot?.booked_by_student_id
    if (!studentId || slot.is_booked === false) continue
    const prev = latest.get(studentId)
    if (!prev || isLaterSlot(slot, prev)) latest.set(studentId, slot)
  }
  const out = new Map()
  for (const [studentId, slot] of latest) {
    const name = resolveSlotInterviewerName(slot, { blocksById, nameByProfileId })
    if (name) out.set(studentId, name)
  }
  return out
}

/**
 * Lifecycle state for a slot at a given moment. Only states the data model can
 * actually express are produced: a canceled/missed flag is honored when present,
 * otherwise the clock decides between upcoming, in progress, and completed.
 */
export function interviewState(slot, now = new Date()) {
  if (!slot) return 'upcoming'
  if (slot.canceled_at || slot.status === 'canceled' || slot.status === 'missed') return 'canceled'
  const start = slotStartDate(slot)
  if (!start) return 'upcoming'
  const durationMs = (Number(slot.duration_minutes) || 30) * 60000
  const end = new Date(start.getTime() + durationMs)
  if (now < start) return 'upcoming'
  if (now >= end) return 'completed'
  return 'in_progress'
}

/** Local Date for a slot's start, or null when the time is unusable. */
export function slotStartDate(slot) {
  const time = slot?.slot_time
  const date = slot?.slot_date
  if (!time || !date) return null
  // slot_time arrives as HH:MM or HH:MM:SS; normalize so both parse locally.
  const hhmmss = String(time).length === 5 ? `${time}:00` : String(time).slice(0, 8)
  const d = new Date(`${date}T${hhmmss}`)
  return Number.isNaN(d.getTime()) ? null : d
}

const STATE_RANK = { in_progress: 0, upcoming: 1, completed: 2, canceled: 3 }

/**
 * Prompt-specified order: in progress, then upcoming earliest first, then
 * completed most recent first, then canceled/missed. Ties fall back to the
 * immutable slot id so the order is stable across renders.
 */
export function compareInterviews(a, b, now = new Date()) {
  const sa = interviewState(a, now); const sb = interviewState(b, now)
  if (sa !== sb) return STATE_RANK[sa] - STATE_RANK[sb]
  const ta = slotStartDate(a)?.getTime() ?? 0
  const tb = slotStartDate(b)?.getTime() ?? 0
  if (ta !== tb) return sa === 'completed' ? tb - ta : ta - tb
  return String(a?.id) < String(b?.id) ? -1 : String(a?.id) > String(b?.id) ? 1 : 0
}

export function sortInterviews(slots, now = new Date()) {
  return [...(slots || [])].sort((a, b) => compareInterviews(a, b, now))
}

/** "9:30 AM" for a slot, or an em dash when the time is unusable. */
export function formatSlotTime(slot) {
  const d = slotStartDate(slot)
  return d ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '–'
}

/** The student object off a slot join, tolerating array or object shape. */
export function slotStudent(slot) {
  const s = slot?.students
  return Array.isArray(s) ? s[0] : s
}

const STATE_BADGE = {
  in_progress: { label: 'In progress', tone: 'day' },
  upcoming:    { label: 'Upcoming',    tone: 'mid' },
  completed:   { label: 'Completed',   tone: 'night' },
  canceled:    { label: 'Canceled',    tone: 'night' },
}

/**
 * Map scoped, sorted slots into the EXISTING OnCampusNow row contract
 * ({ key, avatar, name, subLabel, badge, statusText, statusWarn, onClick,
 * ariaLabel }) so the compact cards reuse that renderer with no new component
 * and no duplicated CSS. Missing school/program/interviewer degrade to a
 * shorter label rather than rendering an empty separator.
 */
export function buildInterviewRows(slots, { now = new Date(), avatarFor, interviewerNameFor, onOpen } = {}) {
  return (slots || []).map(slot => {
    const student = slotStudent(slot)
    if (!student) return null
    const state = interviewState(slot, now)
    const name = [student.first_name, student.last_name].filter(Boolean).join(' ') || 'Student'
    const time = formatSlotTime(slot)
    const interviewer = interviewerNameFor ? interviewerNameFor(slot) : (slot.interviewer_name || '')
    const subLabel = [student.school || student.program_type, interviewer].filter(Boolean).join(' · ')
    return {
      key: slot.id,
      avatar: avatarFor ? avatarFor(student, slot) : null,
      name,
      subLabel,
      badge: STATE_BADGE[state] || null,
      statusText: time,
      statusWarn: false,
      subdued: state === 'completed' || state === 'canceled',
      onClick: onOpen ? () => onOpen(slot) : undefined,
      ariaLabel: `${name}, ${STATE_BADGE[state]?.label || 'Interview'} at ${time}${interviewer ? `, with ${interviewer}` : ''}`,
    }
  }).filter(Boolean)
}
