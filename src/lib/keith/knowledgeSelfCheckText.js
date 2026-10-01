// KEITH-KNOWLEDGE-SELFCHECK-1 Phase 2: the words the Knowledge Center uses for a self-check. Plain JS so
// the tests read it without a JSX transform; KnowledgeSelfCheckBar.jsx renders it.
import { fmtDate } from '../../components/settings/knowledgeCategories.js'

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

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
  return `Last checked ${fmtDate(c.started_at)}${c.trigger === 'schedule' ? ' on schedule' : ''}: ${read}; ${filed}${cost}.`
}
