// src/lib/evaluation/moderationStacks.js
//
// MODERATION-STACKS-1 (Owner, 2026-10-07): the Unit Leader release board groups the responses
// waiting on moderation into one stack per unit, the way Apple groups notifications by app.
// Reference: docs/mockups/moderation-stacks.html. A stack shows what that unit's leader would
// see (the allowlisted numbers, never comments), and one action clears and releases every
// response in it. A unit with a single response is never anonymous, so it stands alone and is
// left out of Release all. A low rating stays in (Owner): it is what a leader should see. Pure.

import { instrumentMetricPaths, metricLabel, fmtMetric } from '../unitEvaluationDisplay.js'

const OVERALL = 'overall_experience.overall_rating'

// The instrument's own anchors (lib/server/evaluation/content/student_preceptor_eval.json).
export const OVERALL_RATING_WORDS = Object.freeze({ 5: 'Excellent', 4: 'Very good', 3: 'Good', 2: 'Fair', 1: 'Poor' })

/** A Unit Leader slip whose only blocker is moderation nobody has done yet. */
export function isAwaitingModeration(item) {
  return item?.workflowId === 'unitLeaderRelease'
    && item.state === 'blocked'
    && item.blocker?.action === 'moderate'
    && item.row?.moderation_state !== 'blocked'
}

/** What the leader would see for one response: [{ path, label, value, text, tone }]. */
export function leaderSees(row) {
  const values = row?.leader_sees || {}
  return instrumentMetricPaths(row?.instrument_slug)
    .filter(path => typeof values[path] === 'number' || typeof values[path] === 'string')
    .map(path => {
      const value = values[path]
      if (path === OVERALL) {
        return { path, label: metricLabel(path), value, text: `${OVERALL_RATING_WORDS[value] || fmtMetric(value)}`,
          tone: value >= 4 ? 'ok' : value === 3 ? 'warn' : 'bad' }
      }
      // UL-CHOICE-WORDS-1: a Preceptor's Assessment answer is its own phrase.
      return { path, label: metricLabel(path), value, text: typeof value === 'string' ? `${metricLabel(path)}: ${value}` : `${metricLabel(path)} ${fmtMetric(value)}`, tone: 'plain' }
    })
}

/** A Fair or Poor overall rating. It is flagged in words; it never holds a stack back. */
export function isLowRating(row) {
  const v = row?.leader_sees?.[OVERALL]
  return typeof v === 'number' && v <= 2
}

// Preceptor's Assessment answers are stored as words, and the leader allowlist passes numbers
// only, so those responses show the leader nothing (found live, 2026-10-07). Say so plainly.
function summaryOf(items) {
  const counts = new Map()
  let other = 0, none = 0
  for (const it of items) {
    const v = it.row?.leader_sees?.[OVERALL]
    if (typeof v === 'number') counts.set(v, (counts.get(v) || 0) + 1)
    else if (leaderSees(it.row).length) other += 1
    else none += 1
  }
  const parts = [...counts.entries()].sort((a, b) => b[0] - a[0])
    .map(([v, n]) => `${OVERALL_RATING_WORDS[v] || v} ${n}`)
  if (other) parts.push(`${other} with other measures`)
  if (none) parts.push(`${none} with no numbers`)
  return parts.join(' · ')
}

/**
 * The stacks: one per unit, most responses first, then by unit name. Items with no unit go in
 * a stack of their own named "No unit". `single` marks a unit with one response.
 */
export function buildModerationStacks(items = []) {
  const byUnit = new Map()
  for (const it of items) {
    if (!isAwaitingModeration(it)) continue
    const unit = it.row?.unit_key || 'No unit'
    if (!byUnit.has(unit)) byUnit.set(unit, [])
    byUnit.get(unit).push(it)
  }
  return [...byUnit.entries()]
    .map(([unit, list]) => ({
      key: `unit:${unit}`, unit, items: list, count: list.length,
      single: list.length === 1,
      low: list.some(it => isLowRating(it.row)),
      summary: summaryOf(list),
    }))
    .sort((a, b) => b.count - a.count || a.unit.localeCompare(b.unit))
}

/** What Release all covers: every stack with more than one response. */
export function releaseAllPlan(stacks = []) {
  const included = stacks.filter(s => !s.single)
  return {
    stacks: included,
    responses: included.reduce((n, s) => n + s.count, 0),
    leftOut: stacks.filter(s => s.single).map(s => s.unit),
  }
}
