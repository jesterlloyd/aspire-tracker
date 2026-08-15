// api/cron/evaluation-reminders-recovery.js
//
// EVALUATION-REMINDERS-1 - the hourly recovery sweep.
//
// A SEPARATE PATH ON PURPOSE. Vercel invokes cron paths with a plain production
// GET, and this behaviour must not hinge on a query parameter: an entry whose
// sweep flag arrived in the query string would silently become a full weekly
// send if that parameter were ever dropped or normalised away. The mode is
// therefore fixed in code here, and the path itself is the contract.
//
// It reconciles ONLY attempts that already reached the provider - it selects no
// new recipients - so recipient cadence stays at 7/14/21 days while ambiguous
// sends are resolved inside the provider's 24-hour idempotency window.
//
// Its runs are recorded under the cron name 'evaluation-reminders-recovery', so
// a healthy sweep can never make a missed weekly run look fine, and its counts
// never dilute the weekly send metrics the Automations card reports.

import { runEvaluationReminders } from './evaluation-reminders.js';

export default function handler(req, res) {
  return runEvaluationReminders(req, res, { sweep: true });
}
