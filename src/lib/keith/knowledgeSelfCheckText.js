// KEITH-KNOWLEDGE-SELFCHECK-1 Phase 2: the words the Knowledge Center uses for a self-check. Plain JS so
// the tests read it without a JSX transform; KnowledgeSelfCheckBar.jsx renders it.
import { fmtDate } from '../../components/settings/knowledgeCategories.js'

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

/**
 * What the strip says while a check runs. The check is one request with no stages to report, so this
 * is the time gone and what Keith is usually doing by then (measured: the read takes about a minute,
 * the writing about another), and it never claims a step has finished.
 */
export function progressText(seconds = 0) {
  const s = Math.max(0, Math.floor(seconds))
  const doing = s < 75
    ? 'Keith is reading the app changes, the questions he could not answer and your entries.'
    : s < 240
      ? 'Keith is writing his suggestions, one for each thing he found.'
      : 'Still working. A check with a lot to write can take up to five minutes.'
  return `${doing} ${clock(s)} so far; a check usually takes about two minutes. You can leave this page: the check keeps running.`
}

/** One sentence about the latest check. */
export function describeCheck(c) {
  if (!c) return 'Keith has not checked the Knowledge Center yet.'
  if (c.status === 'running') return 'A check is running now.'
  if (c.status === 'failed') return `The last check on ${fmtDate(c.started_at)} did not finish.`
  const read = `read ${plural(c.changes_read || 0, 'app change')} and ${plural(c.questions_read || 0, 'unanswered question')}`
  const filed = (c.suggestions || 0) + (c.drafts || 0) === 0
    ? 'nothing needed your attention'
    : `suggested ${plural(c.suggestions || 0, 'edit')} and wrote ${plural(c.drafts || 0, 'Draft')}`
  const cost = typeof c.cost_usd === 'number' && c.cost_usd > 0 ? ` (about $${c.cost_usd < 0.01 ? '0.01' : c.cost_usd.toFixed(2)})` : ''
  const cut = (c.skipped || []).some(x => x?.reason === 'history_truncated') ? ' Older app changes in this period were not read.' : ''
  return `Last checked ${fmtDate(c.started_at)}${c.trigger === 'schedule' ? ' on schedule' : ''}: ${read}; ${filed}${cost}.${cut}`
}
