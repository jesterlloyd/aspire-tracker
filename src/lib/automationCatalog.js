// AUTOMATION-MONITORING-1: the monitored automations, their cron names, and how
// often each is expected to run.
//
// TWO DEFECTS THIS EXISTS TO FIX
//
// 1. /api/automation-runs read the 150 most recent cron_runs rows across EVERY
//    cron. Three delivery workers run every 10 minutes (432 rows/day) and the
//    clock-out sweep runs hourly, so 150 rows is roughly the last EIGHT HOURS.
//    Any automation whose last run is older than that simply vanished from the
//    dashboard and its card read "Never run". That is why Coordinator Weekly
//    Digest - a Friday automation - showed Never run on a Thursday, and why
//    every daily automation went dark each evening. The runs query now filters
//    to the monitored cron names, so the workers can no longer crowd them out.
//
// 2. Health had no notion of cadence. A successful run was "Healthy" forever,
//    and an automation that silently stopped running looked identical to one
//    that ran fine this morning. `maxAgeHours` gives each automation its own
//    freshness budget, so a missed weekly run is distinguishable from a
//    brand-new automation that has not reached its first window.
//
// maxAgeHours is deliberately generous: it answers "has this stopped running?",
// not "did it run on time". Values allow for a full cycle plus slack, so a
// single late or skipped execution never cries wolf.

export const AUTOMATION_CATALOG = Object.freeze([
  {
    id: 'teams_invite_reminders',
    cronName: 'teams-invite-reminders',
    automationKey: 'teams_invite_reminders',
    // Weekdays only: a Friday run must still look fresh on Monday morning.
    maxAgeHours: 96,
  },
  {
    id: 'interview_reminders',
    cronName: 'interview-reminders',
    automationKey: 'interview_reminders',
    maxAgeHours: 30,
  },
  {
    id: 'student_birthday_greetings',
    cronName: 'student-birthday-greetings',
    automationKey: 'student_birthday_greetings',
    maxAgeHours: 30,
  },
  {
    id: 'midpoint_checkin',
    cronName: 'midpoint-checkin',
    automationKey: null,          // cohort-scoped setting, not a global key
    maxAgeHours: 30,
  },
  {
    id: 'coordinator_weekly_digest',
    cronName: 'coordinator-weekly-digest',
    automationKey: 'coordinator_weekly_digest',
    // Weekly (Fridays). Eight days leaves a full cycle plus slack.
    maxAgeHours: 192,
  },
  {
    id: 'clockout_reminders',
    cronName: 'clockout-reminders-scheduled',
    automationKey: 'clockout_reminders',
    maxAgeHours: 4,
  },
])

/** Cron names the Automations dashboard monitors. The runs query filters to these. */
export const MONITORED_CRON_NAMES = Object.freeze(AUTOMATION_CATALOG.map(a => a.cronName))

const BY_ID = new Map(AUTOMATION_CATALOG.map(a => [a.id, a]))
export function automationById(id) {
  return BY_ID.get(id) || null
}

/**
 * Is the latest run older than this automation's freshness budget?
 *
 * Answers only "has it stopped running". A paused automation is never overdue -
 * not running is what paused means - and that check belongs to the caller,
 * which already knows the setting.
 */
export function isRunStale({ lastRunIso, maxAgeHours, nowIso }) {
  if (!lastRunIso || !maxAgeHours) return false
  const last = new Date(lastRunIso).getTime()
  const now = new Date(nowIso || Date.now()).getTime()
  if (!Number.isFinite(last) || !Number.isFinite(now)) return false
  return now - last > maxAgeHours * 3600 * 1000
}

/**
 * An automation with NO recorded run at all: is that expected, or a problem?
 *
 * A newly deployed automation legitimately has no runs until its first window,
 * so "Never run" is correct and must stay correct. But it cannot stay correct
 * forever: once more than a full cadence has passed since the automation became
 * monitorable and still nothing has been recorded, the automation is not new,
 * it is silent - and that is a monitoring problem, not a fresh install.
 *
 * `firstSeenIso` is when this automation first became observable. The caller
 * supplies it; when it is unknown, the honest answer is "not yet a problem",
 * because claiming a missed run we cannot evidence would be inventing history.
 */
export function isNeverRunOverdue({ firstSeenIso, maxAgeHours, nowIso }) {
  if (!firstSeenIso || !maxAgeHours) return false
  return isRunStale({ lastRunIso: firstSeenIso, maxAgeHours, nowIso })
}
