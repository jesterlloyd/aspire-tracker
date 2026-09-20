// src/lib/evaluation/reviewQueueShape.js
//
// REVIEW-RELEASE-1: three states, one shape.
//
// Every Review & Release workflow returns its items in this shape, and one queue component
// renders them all. The shape is the contract between six detectors that were written
// years apart with six vocabularies and one screen that should not know or care which of
// them produced a row. Nothing in here detects anything: the adapters in
// reviewQueueAdapters.js translate each classifier's own output INTO this shape, and the
// classifiers themselves are untouched.
//
// {
//   id, workflowId, period?,                 // period only for the preceptor workflow
//   person: { name, sub },                   // sub = program and unit, or the feedback target
//   hours: { approved, required, threshold } | null,   // null for the pre-rotation workflow
//   state: 'ready' | 'blocked' | 'notEligible',
//   stamp: { tone: 'ok'|'soon'|'late', text },
//   chain: [ { role:'before'|'this'|'after', status:'done'|'this'|'next'|'waiting'|'fix', label, detail } ],
//   blocker?: { text, action: 'remind'|'fix'|'jump'|'activity'|'moderate', target? },
//   sendTo?: string,                         // ready items only: who the release goes to
//   release?: { ... }                        // ready items only: what the release call needs
// }
//
// WHAT IS NOT IN ANY OF THE THREE STATES. An item already sent for this period appears
// on the Sent log and, where a downstream workflow depends on it, as a Waiting node on
// that item's chain. That is the whole replacement for the old Suppressed (existing)
// table: a sent thing is not something to act on, so it is not a row.

export const ITEM_STATES = Object.freeze(['ready', 'blocked', 'notEligible'])
export const STAMP_TONES = Object.freeze(['ok', 'soon', 'late'])
export const NODE_STATUSES = Object.freeze(['done', 'this', 'next', 'waiting', 'fix'])
export const BLOCKER_ACTIONS = Object.freeze(['remind', 'fix', 'jump', 'activity', 'moderate'])

/** Anything older than this is stamped late, whatever the blocker (Owner brief, section 3). */
export const LATE_AFTER_DAYS = 7

const DAY_MS = 24 * 60 * 60 * 1000

/** Whole days between two instants, floored, never negative. */
export function daysBetween(fromIso, nowMs) {
  if (!fromIso) return 0
  const t = new Date(fromIso).getTime()
  if (!Number.isFinite(t)) return 0
  return Math.max(0, Math.floor((nowMs - t) / DAY_MS))
}

/** "Sep 12" for a date this year, "Sep 12, 2025" otherwise. */
export function shortDate(iso, nowMs = Date.now()) {
  if (!iso) return ''
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return ''
  const sameYear = d.getFullYear() === new Date(nowMs).getFullYear()
  return d.toLocaleDateString('en-US', sameYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' })
}

/** A chain node. Kept as a function so every adapter builds the same object. */
export function node(role, status, label, detail = '') {
  return { role, status, label, detail }
}

/** A stamp, with the tone derived from the state and the age when the caller has one. */
export function stamp(tone, text) {
  return { tone, text }
}

/**
 * The tone a blocked item's stamp should carry. A data fix is late from the start, because
 * nothing will change until a person changes it. A waiting prerequisite is soon until it
 * has been waiting a week, then it is late too.
 */
export function blockedTone({ isFix = false, sinceIso = null, nowMs = Date.now() } = {}) {
  if (isFix) return 'late'
  if (sinceIso && daysBetween(sinceIso, nowMs) >= LATE_AFTER_DAYS) return 'late'
  return 'soon'
}

/** Empty counts, so a workflow that has not loaded yet still adds up. */
export const EMPTY_COUNTS = Object.freeze({ ready: 0, blocked: 0, notEligible: 0 })

/** Count a workflow's items by state. */
export function countsOf(items = []) {
  const c = { ready: 0, blocked: 0, notEligible: 0 }
  for (const it of items) if (c[it.state] !== undefined) c[it.state] += 1
  return c
}

/** Sum counts across workflows. */
export function sumCounts(countsByWorkflow = {}) {
  const total = { ready: 0, blocked: 0, notEligible: 0 }
  for (const c of Object.values(countsByWorkflow)) {
    if (!c) continue
    total.ready += c.ready || 0
    total.blocked += c.blocked || 0
    total.notEligible += c.notEligible || 0
  }
  return total
}

/** Whether a sent-log line's time falls on the same calendar day as `nowMs`. */
export function isToday(iso, nowMs = Date.now()) {
  if (!iso) return false
  const d = new Date(iso), n = new Date(nowMs)
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()
}

/**
 * "9:41 AM" for today, "Sep 12" for an earlier date this year, otherwise the year too.
 * The Sent log shows a time for today's releases and a date for older ones (section 4).
 */
export function whenLabel(iso, nowMs = Date.now()) {
  if (!iso) return ''
  if (isToday(iso, nowMs)) {
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  }
  return shortDate(iso, nowMs)
}

/** "submitted Sep 12" or "not yet submitted", for a sent-log line. */
export function submissionLabel(completedAtIso, nowMs = Date.now()) {
  return completedAtIso ? `submitted ${shortDate(completedAtIso, nowMs)}` : 'not yet submitted'
}

/** Sort sent-log lines newest first and keep the most recent `limit`. */
export function recentSent(lines = [], limit = 5) {
  return lines
    .slice()
    .sort((a, b) => new Date(b.at || 0).getTime() - new Date(a.at || 0).getTime())
    .slice(0, limit)
}

/** Format a number of hours the way the old tables did: integers bare, otherwise 2dp. */
export function fmtHours(n) {
  if (n == null || !Number.isFinite(Number(n))) return '-'
  const v = Number(n)
  return Number.isInteger(v) ? String(v) : v.toFixed(2)
}

/** Today as YYYY-MM-DD in the browser's own calendar, never the UTC day. */
export function localToday(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** A calendar day ("2026-09-12", or any ISO stamp) as "Sep 12", read as a local day. */
export function fmtDay(v) {
  if (!v) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v))
  const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(v)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
