// HOME-1 (2026-09-24): the figures on the two phase-specific lead cards. Pure.
//
// Applications and outreach (Recruitment, Interviewing): applications received, received
// this week, applications missing documents, the open rate of the latest outreach.
// Surveys and results (Evaluation): ready to release, needing a reminder, Casey-Fink
// matched pairs, certificates issued. A figure whose source is not available is null and
// the card leaves its clause out.

const DAY = 86400000
const EXITED = new Set(['Declined', 'Not Proceeding'])

export function applicationsSummary(students = [], nowMs = Date.now()) {
  const list = (students || []).filter(Boolean)
  const weekAgo = nowMs - 7 * DAY
  const received = list.length
  const thisWeek = list.filter(s => s.created_at && new Date(s.created_at).getTime() >= weekAgo).length
  const missingDocs = list.filter(s => !EXITED.has(s.status) && !String(s.resume_url || '').trim()).length
  return { received, thisWeek, missingDocs }
}

/** The latest outreach batch (by subject and send minute) and the share of it that was opened. */
export function latestOutreachOpenRate(rows = []) {
  const list = (rows || []).filter(r => r && r.sent_at)
  if (!list.length) return null
  list.sort((a, b) => new Date(b.sent_at) - new Date(a.sent_at))
  const head = list[0]
  const key = (r) => `${r.subject || ''}|${String(r.sent_at).slice(0, 16)}`
  const batch = list.filter(r => key(r) === key(head))
  const opened = batch.filter(r => r.opened_at || r.status === 'opened' || r.status === 'clicked').length
  return { subject: head.subject || 'Latest outreach', sent: batch.length, opened, pct: Math.round((opened / batch.length) * 100) }
}

const slugOf = (a) => { const i = a?.evaluation_instruments; return (Array.isArray(i) ? i[0] : i)?.slug }

export function surveysSummary({ queues = {}, evidence = null, nowMs = Date.now(), reminderAfterDays = 7 } = {}) {
  let ready = 0
  for (const q of Object.values(queues || {})) for (const it of (q?.items || [])) if (it.state === 'ready') ready += 1
  if (!evidence) return { ready, needReminder: null, pairs: null, certificates: null }
  const assignments = evidence.assignments || []
  const needReminder = assignments.filter(a =>
    ['sent', 'opened'].includes(a.status) && !a.completed_at && !a.revoked_at
    && (!a.expires_at || new Date(a.expires_at).getTime() > nowMs)
    && a.sent_at && nowMs - new Date(a.sent_at).getTime() >= reminderAfterDays * DAY).length
  const done = new Map()
  for (const a of assignments) {
    if (slugOf(a) !== 'casey_fink_readiness_2024' || !a.completed_at) continue
    if (!done.has(a.student_id)) done.set(a.student_id, new Set())
    done.get(a.student_id).add(a.timepoint)
  }
  let pairs = 0
  for (const tps of done.values()) if (tps.has('baseline') && tps.has('post_rotation')) pairs += 1
  return { ready, needReminder, pairs, certificates: (evidence.certificates || []).length }
}
