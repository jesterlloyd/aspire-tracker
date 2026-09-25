// HOME-1 (2026-09-24): the Today card, two tabs.
//
// Schedule: today's planner items (interviews, events, holidays, due dates), each with a
// time or "All day", a title, a detail line and a type tag; the item in progress is
// marked. On campus today: students with a shift today, grouped by shift with the
// canonical window times from src/lib/shiftWindows.js, the group in progress marked
// "On shift now" and a finished group "Ended".
//
// SOURCES: logged shifts carry their own type. Planned shifts (student_shift_plans) store
// the date and the preceptor's NAME only, so a planned shift works alongside its preceptor:
// it takes that preceptor's shift_type (matched by name), then the student's assigned
// preceptor's, then the student's assigned shift, and only then Day. A preceptor recorded
// as Variable says nothing about today, so it is skipped. Pure.

import { SHIFT_WINDOWS, getShiftWindow } from '../shiftWindows.js'
import { slotStartDate } from '../interviewsToday.js'
import { hoursProgress } from '../clinicalHours.js'

const fmtTime = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
const hm = (h, m) => fmtTime(new Date(2000, 0, 1, h, m))

/** "Day shift · 7:00 AM to 7:30 PM" from the canonical windows. */
export function shiftGroupLabel(type) {
  const w = SHIFT_WINDOWS[type]
  if (!w || type === 'Variable') return `${type || 'Other'} shift`
  return `${type} shift · ${hm(w.startHour, w.startMinute)} to ${hm(w.endHour, w.endMinute)}`
}

/** 'live' while the window holds now, 'ended' after it, 'later' before it, 'unknown' without a window. */
export function shiftGroupState(type, today, now = new Date()) {
  const win = getShiftWindow(today, type)
  if (!win) return 'unknown'
  if (now < win.start) return 'later'
  if (now > win.end) return 'ended'
  return 'live'
}

export const initialsOf = (name = '') => String(name).trim().split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase()

const SHIFT_ORDER = ['Day', 'Mid', 'Night', 'Variable']
const normalizeShift = (v) => {
  const s = String(v || '').trim()
  const hit = SHIFT_ORDER.find(k => k.toLowerCase() === s.toLowerCase())
  if (hit) return hit
  if (/night|noc/i.test(s)) return 'Night'
  if (/mid/i.test(s)) return 'Mid'
  if (/day/i.test(s)) return 'Day'
  return null
}

/**
 * @param plans student_shift_plans rows for today (student_id, preceptor_name, cancelled_at)
 * @param logs student_shift_logs rows for today (student_id, shift_type, planned_shift_type, unit_name, preceptor_name, status)
 * @param students the cohort's students
 * @param unitNameFor (unitId) => name
 * @param preceptorNameFor (student) => name
 * @param displayName (student) => name
 */
const nameKey = (v) => String(v || '').trim().toLowerCase().replace(/\s+/g, ' ')
const knownShift = (v) => { const t = normalizeShift(v); return t && t !== 'Variable' ? t : null }

/** The type a planned shift is worked on, from the best evidence available. */
export function plannedShiftType({ plan, student, preceptorsByName = new Map(), assignedPreceptorShift = null } = {}) {
  return knownShift(preceptorsByName.get(nameKey(plan?.preceptor_name))?.shift_type)
    || knownShift(assignedPreceptorShift)
    || knownShift(student?.shift_assigned)
    || 'Day'
}

export function onCampusGroups({
  plans = [], logs = [], students = [], preceptors = [], unitNameFor = () => '', preceptorNameFor = () => '',
  assignedPreceptorShiftFor = () => null, displayName = (s) => s?.first_name || '',
  today, now = new Date(),
} = {}) {
  const byId = new Map((students || []).map(s => [s.id, s]))
  const preceptorsByName = new Map((preceptors || []).map(p => [nameKey(p.full_name), p]))
  const seen = new Map()   // studentId -> { student, type, unit, preceptor }
  const rejected = new Set(['Rejected', 'rejected'])
  for (const l of logs || []) {
    const s = byId.get(l?.student_id)
    if (!s || rejected.has(l.status)) continue
    const type = normalizeShift(l.shift_type || l.planned_shift_type) || normalizeShift(s.shift_assigned) || 'Day'
    seen.set(s.id, { student: s, type, unit: l.unit_name || unitNameFor(s.matched_unit_id), preceptor: l.preceptor_name || preceptorNameFor(s), source: 'log' })
  }
  for (const p of plans || []) {
    const s = byId.get(p?.student_id)
    if (!s || p.cancelled_at || seen.has(s.id)) continue
    const type = plannedShiftType({ plan: p, student: s, preceptorsByName, assignedPreceptorShift: assignedPreceptorShiftFor(s) })
    seen.set(s.id, { student: s, type, unit: unitNameFor(s.matched_unit_id), preceptor: p.preceptor_name || preceptorNameFor(s), source: 'plan' })
  }
  const groups = new Map()
  for (const e of seen.values()) {
    if (!groups.has(e.type)) groups.set(e.type, [])
    const p = hoursProgress(e.student)
    groups.get(e.type).push({
      id: e.student.id,
      name: displayName(e.student),
      initials: initialsOf(displayName(e.student)),
      meta: [e.unit, e.preceptor ? `with ${e.preceptor}` : null].filter(Boolean).join(' · '),
      hours: p.known ? `${Math.round(p.approved)} of ${Math.round(p.required)} h` : `${Math.round(p.approved)} h`,
      source: e.source,
    })
  }
  const out = []
  for (const type of SHIFT_ORDER) {
    const rows = groups.get(type)
    if (!rows?.length) continue
    rows.sort((a, b) => a.name.localeCompare(b.name))
    out.push({ key: type, label: shiftGroupLabel(type), state: shiftGroupState(type, today, now), rows })
  }
  return { groups: out, count: seen.size }
}

/**
 * Which Today view opens (Owner, 2026-09-25): Schedule when it has anything; otherwise On
 * campus today when someone is on campus; with both empty, Schedule. A choice the person
 * makes wins over this for the rest of the visit.
 */
export function defaultTodayView(scheduleCount = 0, campusCount = 0) {
  if (scheduleCount > 0) return 'schedule'
  if (campusCount > 0) return 'campus'
  return 'schedule'
}

// ── Schedule ────────────────────────────────────────────────────────────────────

const dayOf = (iso) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const isMidnight = (iso) => { const d = new Date(iso); return d.getHours() === 0 && d.getMinutes() === 0 }

/**
 * @param interviews today's booked interview_slots (students embedded)
 * @param events aspire_events rows (title, event_type, start_at, end_at, location)
 * @param holidays [{ name }] today's US holidays
 * @param dueItems [{ id, title, kind, count }] Catalog items with people due today
 */
export function scheduleRows({
  interviews = [], events = [], holidays = [], dueItems = [], interviewerNameFor = () => '', displayName = (s) => s?.first_name || '',
  today, now = new Date(),
} = {}) {
  const rows = []
  const nowMs = now.getTime()
  for (const slot of interviews || []) {
    const student = Array.isArray(slot.students) ? slot.students[0] : slot.students
    const start = slotStartDate(slot)
    if (!student || !start) continue
    const end = start.getTime() + ((Number(slot.duration_minutes) || 30) * 60000)
    const who = interviewerNameFor(slot)
    rows.push({
      id: `iv:${slot.id}`, sortKey: start.getTime(), time: fmtTime(start),
      title: `Interview · ${displayName(student)}`,
      meta: [student.school, who ? `with ${who}` : null].filter(Boolean).join(' · '),
      tag: 'Interview', tone: 'navy', inProgress: nowMs >= start.getTime() && nowMs < end,
      to: `/interviews?student=${encodeURIComponent(student.id)}`,
    })
  }
  for (const ev of events || []) {
    if (!ev?.start_at || dayOf(ev.start_at) !== today && !(ev.end_at && dayOf(ev.start_at) <= today && dayOf(ev.end_at) >= today)) continue
    const allDay = isMidnight(ev.start_at) && (!ev.end_at || isMidnight(ev.end_at))
    const start = new Date(ev.start_at).getTime()
    const end = ev.end_at ? new Date(ev.end_at).getTime() : start + 3600000
    const kind = ev.event_type === 'deadline' || ev.event_type === 'ngrp_deadline' ? 'Due' : 'Event'
    rows.push({
      id: `ev:${ev.id}`, sortKey: allDay ? -1 : start, time: allDay ? 'All day' : fmtTime(new Date(ev.start_at)),
      title: ev.title || 'Event',
      meta: [ev.location, ev.audience_label].filter(Boolean).join(' · '),
      tag: kind, tone: kind === 'Due' ? 'red' : 'amber', inProgress: !allDay && nowMs >= start && nowMs < end,
      to: '/interviews',
    })
  }
  for (const h of holidays || []) {
    rows.push({ id: `hol:${h.name}`, sortKey: -2, time: 'All day', title: h.name, meta: 'US holiday', tag: 'Event', tone: 'amber', inProgress: false, to: '/interviews' })
  }
  for (const d of dueItems || []) {
    rows.push({
      id: `due:${d.id}`, sortKey: -1, time: 'All day',
      title: `${d.title} due`, meta: `${d.count} ${d.count === 1 ? 'person' : 'people'} · ${d.kind === 'signature' ? 'signature' : 'form'}`,
      tag: 'Due', tone: 'red', inProgress: false, to: `/catalog?resource=${encodeURIComponent(d.slug || '')}`,
    })
  }
  rows.sort((a, b) => a.sortKey - b.sortKey || a.title.localeCompare(b.title))
  return rows
}

/** Catalog items with a completion due today, from the tracker rows. */
export function dueTodayItems(trackerRows = [], items = [], today) {
  const counts = new Map()
  for (const r of trackerRows || []) {
    if (!r?.id || r.completed_at || !r.due_at || dayOf(r.due_at) !== today) continue
    counts.set(r.id, (counts.get(r.id) || 0) + 1)
  }
  return (items || []).filter(it => counts.has(it.id)).map(it => ({ id: it.id, title: it.title, slug: it.slug, kind: it.kind, count: counts.get(it.id) }))
}
