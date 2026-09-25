// HOME-1 (2026-09-24): Needs you, the one queue across every module.
//
// Six sources, one shape. Each builder below takes the rows its module already produces
// (the Messages list, the signature tracker, the Review & Release queues, the Catalog
// tracker, today's interview slots, the cohort's students) and returns one GROUP:
//
//   { key, name, sub, pills: [{ text, tone }], rows: [ROW], open: { label, to }, count }
//   ROW = { id, title, meta, pill: { text, tone }, ageMs, to }
//
// Rules the builders keep, from the build prompt and the table canon:
//   - A row is NAVIGATION. It carries `to`, the screen where the decision lives, and
//     never an action. Release, Sign, Assign, Dismiss stay where they are.
//   - Rows sort by age, oldest first, and a group shows its top three.
//   - A group with nothing in it is not returned (hidden), so "All caught up" means
//     every source was read and every one was empty.
//   - Tones are the mockup's: plum (your turn), amber (waiting on you), red (late or
//     unassigned), green (ready), navy (today), grey (state).
//
// Pure: no React, no I/O, `now` is passed in.

import { needsYourReply, isUnassigned } from '../messages/messagesTriage.js'
import { currentTurn } from '../signatures/sigModel.js'
import { completionStatus } from '../catalog/catalogModel.js'
import { hoursPace } from '../clinicalHours.js'
import { EXITED_STATUSES } from '../placementCoverage.js'
import { slotStartDate } from '../interviewsToday.js'
import { knownDate } from './cyclePhase.js'

export const ROWS_PER_GROUP = 3
const DAY = 86400000

export const GROUP_ORDER = Object.freeze(['signatures', 'messages', 'reviewRelease', 'formsDocs', 'interviews', 'placement'])

/** "Today", "2d", "9d": how long a row has been waiting. */
export function ageLabel(iso, now = Date.now()) {
  const t = iso ? new Date(iso).getTime() : NaN
  if (!Number.isFinite(t)) return ''
  const days = Math.floor((now - t) / DAY)
  return days <= 0 ? 'Today' : `${days}d`
}

/** Oldest first: the row that has waited longest leads. */
export function sortByAge(rows) {
  return rows.slice().sort((a, b) => (b.ageMs || 0) - (a.ageMs || 0) || String(a.title).localeCompare(String(b.title)))
}

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`
const shortDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '')
const shortTime = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

function finish(group) {
  if (!group.rows.length && !group.count) return null
  const sorted = sortByAge(group.rows)
  return { ...group, rows: sorted.slice(0, ROWS_PER_GROUP), allRows: sorted, total: group.rows.length }
}

// ── Messages ────────────────────────────────────────────────────────────────────

/** @param conversations rows from /api/messages-staff-list (view active, attention all) */
export function messagesGroup({ conversations = [], now = Date.now() } = {}) {
  const rows = []
  let reply = 0, unassigned = 0
  for (const c of conversations || []) {
    if (!c || c.status === 'resolved') continue
    const needs = needsYourReply(c)
    const open = isUnassigned(c)
    if (!needs && !open) continue
    if (needs) reply += 1
    if (open) unassigned += 1
    const ageMs = now - new Date(c.last_message_at || 0).getTime()
    const who = c.participant_name || 'Someone'
    const days = Math.floor(ageMs / DAY)
    const wrote = days <= 0 ? 'They wrote today' : `They wrote ${plural(days, 'day')} ago`
    rows.push({
      id: `msg:${c.id}`,
      title: `${who} · ${c.subject || 'No subject'}`,
      meta: open ? `${wrote} · Unassigned` : wrote,
      pill: { text: ageLabel(c.last_message_at, now), tone: open && !needs ? 'red' : 'amber' },
      ageMs,
      to: `/connect/messages?conversation=${encodeURIComponent(c.id)}`,
    })
  }
  const pills = []
  if (reply) pills.push({ text: `${reply} reply`, tone: 'amber' })
  if (unassigned) pills.push({ text: `${unassigned} unassigned`, tone: 'red' })
  return finish({
    key: 'messages', name: 'Messages', sub: 'Support threads', pills, rows,
    open: { label: 'Open Messages', to: '/connect/messages' }, count: rows.length,
  })
}

// ── Signatures ──────────────────────────────────────────────────────────────────

const FINAL_SIG = new Set(['completed', 'declined', 'voided', 'expired', 'draft'])

/** @param requests, signers from sig-staff `list`; meId the viewer's profile id */
export function signaturesGroup({ requests = [], signers = [], meId = null, now = Date.now() } = {}) {
  const byRequest = new Map()
  for (const s of signers || []) {
    if (!byRequest.has(s.request_id)) byRequest.set(s.request_id, [])
    byRequest.get(s.request_id).push(s)
  }
  const rows = []
  for (const r of requests || []) {
    if (!r || FINAL_SIG.has(r.status)) continue
    const turn = currentTurn(byRequest.get(r.id) || [], r.signing_order)
    if (!meId || !turn.some(s => s.user_profile_id && s.user_profile_id === meId)) continue
    const signed = (byRequest.get(r.id) || []).filter(s => s.signed_at).sort((a, b) => new Date(b.signed_at) - new Date(a.signed_at))
    const last = signed[0]
    const meta = last
      ? `${last.name || 'A signer'} signed ${shortDate(last.signed_at)} · you sign next`
      : `Sent ${shortDate(r.sent_at)} · you sign first`
    rows.push({
      id: `sig:${r.id}`,
      title: r.title || 'Signature request',
      meta,
      pill: { text: 'Your turn', tone: 'plum' },
      ageMs: now - new Date(last?.signed_at || r.sent_at || r.created_at || 0).getTime(),
      to: `/catalog/signatures?tab=requests&request=${encodeURIComponent(r.id)}`,
    })
  }
  return finish({
    key: 'signatures', name: 'Signatures', sub: 'Waiting on you',
    pills: rows.length ? [{ text: `${rows.length} your turn`, tone: 'plum' }] : [], rows,
    open: { label: 'Open Signature requests', to: '/catalog/signatures?tab=requests' }, count: rows.length,
  })
}

// ── Review & Release ────────────────────────────────────────────────────────────

/**
 * @param queues { [workflowKey]: { items: [{ state, since?, person? }] } } from the adapters
 * @param workflows [{ key, label }] the catalog's order
 */
export function reviewReleaseGroup({ queues = {}, workflows = [], now = Date.now() } = {}) {
  const rows = []
  let ready = 0, blocked = 0
  for (const w of workflows || []) {
    const items = queues?.[w.key]?.items || []
    const r = items.filter(i => i.state === 'ready').length
    const b = items.filter(i => i.state === 'blocked').length
    if (!r && !b) continue
    ready += r; blocked += b
    const oldest = items
      .filter(i => i.state === 'ready' || i.state === 'blocked')
      .map(i => new Date(i.since || i.sinceIso || 0).getTime())
      .filter(Number.isFinite)
    const ageMs = oldest.length ? now - Math.min(...oldest) : 0
    const meta = r
      ? `${plural(r, 'student')} ready to release${b ? ` · ${b} blocked` : ''}`
      : `${plural(b, 'student')} blocked by a prerequisite`
    rows.push({
      id: `rr:${w.key}`,
      title: w.label,
      meta,
      pill: r ? { text: `${r} ready`, tone: 'green' } : { text: 'Blocked', tone: 'amber' },
      // Ready before blocked, then by age: a release that can happen now leads.
      ageMs: (r ? DAY * 3650 : 0) + Math.max(0, ageMs),
      to: `/evaluation?workflow=${encodeURIComponent(w.key)}`,
    })
  }
  const pills = []
  if (ready) pills.push({ text: `${ready} ready`, tone: 'green' })
  if (blocked) pills.push({ text: `${blocked} blocked`, tone: 'amber' })
  return finish({
    key: 'reviewRelease', name: 'Review & Release', sub: 'Survey workflows', pills, rows,
    open: { label: 'Open Review & Release', to: '/evaluation?workflow=caseyFinkPreRotation' }, count: ready + blocked,
  })
}

// ── Forms and documents ─────────────────────────────────────────────────────────

/**
 * @param trackerRows [{ id: catalog_resource_id, due_at, opened_at, completed_at }] from form-staff `tracker`
 * @param items Catalog rows [{ id, slug, title, kind }]
 */
export function formsDocsGroup({ trackerRows = [], items = [], now = Date.now() } = {}) {
  const byItem = new Map()
  for (const r of trackerRows || []) {
    if (!r?.id) continue
    if (!byItem.has(r.id)) byItem.set(r.id, { total: 0, done: 0, overdue: 0, oldestDue: null })
    const s = byItem.get(r.id)
    s.total += 1
    const st = completionStatus(r, now)
    if (st === 'done') s.done += 1
    if (st === 'overdue') {
      s.overdue += 1
      const due = new Date(r.due_at).getTime()
      if (!s.oldestDue || due < s.oldestDue) s.oldestDue = due
    }
  }
  const rows = []
  let overduePeople = 0
  for (const it of items || []) {
    const s = byItem.get(it.id)
    if (!s || !s.overdue) continue
    overduePeople += s.overdue
    const word = it.kind === 'signature' ? 'signed' : 'done'
    rows.push({
      id: `cat:${it.id}`,
      title: it.title,
      meta: `${s.done} of ${s.total} ${word} · due ${shortDate(new Date(s.oldestDue).toISOString())}`,
      pill: { text: `${s.overdue} overdue`, tone: 'red' },
      ageMs: now - s.oldestDue,
      to: `/catalog?resource=${encodeURIComponent(it.slug || '')}`,
    })
  }
  return finish({
    key: 'formsDocs', name: 'Forms and documents', sub: 'Out for completion',
    pills: overduePeople ? [{ text: `${overduePeople} overdue`, tone: 'red' }] : [], rows,
    open: { label: 'Open Catalog tracking', to: '/catalog' }, count: overduePeople,
  })
}

// ── Interviews ──────────────────────────────────────────────────────────────────

/**
 * @param slots today's booked interview_slots (with students embedded), already scoped to the viewer
 * @param students the cohort's students
 * @param communications the cohort's communications rows (type 'scheduling_link' marks an invite)
 * @param interviewerNameFor (slot) => name
 * @param displayName (student) => name
 */
export function interviewsGroup({
  slots = [], students = [], communications = [], interviewerNameFor = () => '', displayName = (s) => s?.first_name || '',
  now = Date.now(),
} = {}) {
  const rows = []
  let today = 0, unscheduled = 0
  for (const slot of slots || []) {
    const student = Array.isArray(slot.students) ? slot.students[0] : slot.students
    if (!student) continue
    const start = slotStartDate(slot)
    if (start && start.getTime() + (n(slot.duration_minutes) || 30) * 60000 < now) continue   // already happened
    today += 1
    const who = interviewerNameFor(slot)
    rows.push({
      id: `iv:${slot.id}`,
      title: `${displayName(student)} · ${student.school || ''}`.replace(/ · $/, ''),
      meta: `Today ${start ? shortTime(start) : ''}${who ? ` · with ${who}` : ''}`.trim(),
      pill: { text: 'Today', tone: 'navy' },
      ageMs: start ? -(start.getTime() - now) : 0,
      to: `/interviews?student=${encodeURIComponent(student.id)}`,
    })
  }
  const invited = new Set((communications || []).filter(c => c?.type === 'scheduling_link').map(c => c.student_id))
  for (const s of students || []) {
    if (s?.status !== 'Form Received' || s.interview_scheduled_date || !invited.has(s.id)) continue
    unscheduled += 1
    const sent = (communications || []).filter(c => c.student_id === s.id && c.type === 'scheduling_link')
      .map(c => new Date(c.sent_at || c.created_at || 0).getTime()).filter(Number.isFinite)
    const sentAt = sent.length ? Math.max(...sent) : now
    rows.push({
      id: `iv-open:${s.id}`,
      title: `${displayName(s)} · ${s.school || ''}`.replace(/ · $/, ''),
      meta: 'Scheduling link sent · no slot booked',
      pill: { text: 'No slot', tone: 'amber' },
      ageMs: now - sentAt,
      to: `/interviews?student=${encodeURIComponent(s.id)}`,
    })
  }
  const pills = []
  if (today) pills.push({ text: `${today} today`, tone: 'navy' })
  if (unscheduled) pills.push({ text: `${unscheduled} unscheduled`, tone: 'amber' })
  return finish({
    key: 'interviews', name: 'Interviews', sub: 'Candidates', pills, rows,
    open: { label: 'Open Interviews', to: '/interviews' }, count: today + unscheduled,
  })
}

// ── Placement and rotation ──────────────────────────────────────────────────────

/**
 * @param students the cohort's students
 * @param units the cohort's units (is_participating, total_slots)
 * @param rotations cohort_school_rotations rows (school_name, rotation_start_date, rotation_end_date)
 * @param schoolKey (name) => group key, so a student finds their school's window
 * @param today local 'YYYY-MM-DD'
 */
export function placementGroup({
  students = [], units = [], rotations = [], schoolKey = (s) => s, unitNameFor = () => '', displayName = (s) => s?.first_name || '',
  today, now = Date.now(),
} = {}) {
  const participating = (units || []).filter(u => u?.is_participating)
  const totalSlots = participating.reduce((s, u) => s + n(u.total_slots), 0)
  const filled = (students || []).filter(s => s?.matched_unit_id).length
  const openSlots = Math.max(0, totalSlots - filled)

  const windows = new Map()
  for (const r of rotations || []) {
    const k = schoolKey(r?.school_name)
    if (k) windows.set(k, { start: knownDate(r.rotation_start_date), end: knownDate(r.rotation_end_date) })
  }

  const rows = []
  const unplaced = (students || []).filter(s => s && !EXITED_STATUSES.has(s.status) && s.status === 'Interviewed' && !s.matched_unit_id)
  for (const s of unplaced) {
    const pref = s.unit_preference_1 || null
    rows.push({
      id: `pl:${s.id}`,
      title: `${displayName(s)} · ${s.school || ''}`.replace(/ · $/, ''),
      meta: pref ? `Unplaced · 1st choice ${pref}` : 'Unplaced · interviewed, no unit yet',
      pill: { text: 'Unplaced', tone: 'amber' },
      ageMs: now - new Date(s.interview_scheduled_date || s.updated_at || s.created_at || 0).getTime(),
      to: '/rotation/matrix',
    })
  }
  let behind = 0
  for (const s of students || []) {
    if (s?.status !== 'Active Rotation') continue
    const pace = hoursPace(s, windows.get(schoolKey(s.school)) || {}, today)
    if (pace.pace !== 'behind') continue
    behind += 1
    rows.push({
      id: `hrs:${s.id}`,
      title: `${displayName(s)} · ${unitNameFor(s.matched_unit_id) || s.school || ''}`.replace(/ · $/, ''),
      meta: `${Math.round(n(s.approved_hours))} of ${Math.round(n(s.hours_required))} h · about ${Math.round(pace.deficit)} h behind pace`,
      pill: { text: 'Behind', tone: 'amber' },
      ageMs: Math.round(pace.deficit) * DAY,   // the further behind, the older it reads
      to: `/students?student=${encodeURIComponent(s.id)}`,
    })
  }
  // Open slots with nobody waiting for one is still work (a unit is hosting and empty),
  // so it gets one row naming the units, rather than a pill with nothing under it.
  if (openSlots && !unplaced.length) {
    const byUnit = {}
    for (const s of students || []) if (s?.matched_unit_id) byUnit[s.matched_unit_id] = (byUnit[s.matched_unit_id] || 0) + 1
    const openUnits = participating.filter(u => n(u.total_slots) > (byUnit[u.id] || 0)).map(u => u.unit_name).filter(Boolean)
    rows.push({
      id: 'pl:open',
      title: `${plural(openSlots, 'open slot')} · no student waiting`,
      meta: openUnits.length ? openUnits.join(', ') : 'Hosting units still have room',
      pill: { text: `${openSlots} open`, tone: 'amber' },
      ageMs: 0,
      to: '/rotation/matrix',
    })
  }
  const pills = []
  if (openSlots) pills.push({ text: `${openSlots} open`, tone: 'amber' })
  if (unplaced.length) pills.push({ text: `${unplaced.length} unplaced`, tone: 'amber' })
  if (behind) pills.push({ text: `${behind} behind`, tone: 'amber' })
  return finish({
    key: 'placement', name: 'Placement and rotation', sub: 'Slots and hours', pills, rows,
    open: { label: 'Open Placement Board', to: '/rotation/matrix' }, count: openSlots + unplaced.length + behind,
  })
}

// ── The queue ───────────────────────────────────────────────────────────────────

/** Order the non-empty groups the way the mockup lists them. */
export function orderGroups(groups = []) {
  const rank = Object.fromEntries(GROUP_ORDER.map((k, i) => [k, i]))
  return groups.filter(Boolean).slice().sort((a, b) => (rank[a.key] ?? 99) - (rank[b.key] ?? 99))
}

/** "[N] items across [M] areas". Items are the groups' counts (people, requests, workflows). */
export function needsYouSummary(groups = []) {
  const live = groups.filter(Boolean)
  const items = live.reduce((s, g) => s + (g.count || 0), 0)
  return { items, areas: live.length, caption: `${plural(items, 'item')} across ${plural(live.length, 'area')}` }
}

/** The chip row: All, then one chip per non-empty area. */
export function filterChips(groups = []) {
  const { items } = needsYouSummary(groups)
  return [{ key: 'all', label: 'All', count: items }, ...groups.filter(Boolean).map(g => ({ key: g.key, label: g.name, count: g.count || 0 }))]
}

/** A second click on the active chip returns to All. */
export function nextFilter(current, clicked) {
  return clicked !== 'all' && current === clicked ? 'all' : clicked
}

/**
 * How many rows a group shows, by how much room it has (Owner, 2026-09-25: the queue looked
 * empty with one area). One area on screen: up to 8, in two columns. Two: up to 5 each.
 * More: the top 3, and "Open ..." for the rest.
 */
export function rowsFor(group, shownGroups = 1) {
  const all = group?.allRows || group?.rows || []
  const limit = shownGroups <= 1 ? 8 : shownGroups === 2 ? 5 : ROWS_PER_GROUP
  return { rows: all.slice(0, limit), more: Math.max(0, all.length - limit), wide: shownGroups <= 1 && all.length > 1 }
}

export function visibleGroups(groups = [], filter = 'all') {
  const live = groups.filter(Boolean)
  return filter === 'all' ? live : live.filter(g => g.key === filter)
}
