// src/components/budget/budgetSheetTools.js
//
// BUDGET-V2 item 9 (2026-09-29): Program Budget's sheets keep number and date formats, Group by,
// Freeze, + Row, Delete row and Columns. Text styling, alignment, clear formatting and + Column are
// not offered here. Both budget sheets (the Sheet and Subscriptions) pass this to EditableSheet.
export const BUDGET_TOOLS = Object.freeze({ text: false, align: false, clear: false, newColumn: false })

// BUDGET-FIXES-1 release 2 (Owner, 2026-09-30): one Stage column in place of State, Status and Concur,
// which said the same thing three ways. A layout saved with the old columns keeps its place, width,
// visibility and grouping on Stage.
const OLD_STAGE_KEYS = ['status', 'state', 'concur']
export function withStage(layout) {
  const order = layout.order || []
  const had = (k) => order.includes(k)
  const next = { ...layout }
  if (!had('stage') && OLD_STAGE_KEYS.some(had)) {
    const at = order.findIndex(k => OLD_STAGE_KEYS.includes(k))
    next.order = [...order.slice(0, at), 'stage', ...order.slice(at).filter(k => !OLD_STAGE_KEYS.includes(k))]
  }
  if (OLD_STAGE_KEYS.includes(layout.groupBy)) next.groupBy = 'stage'
  if ((layout.hidden || []).includes('status')) next.hidden = [...new Set([...(layout.hidden || []).filter(k => !OLD_STAGE_KEYS.includes(k)), 'stage'])]
  else if (layout.hidden) next.hidden = layout.hidden.filter(k => !OLD_STAGE_KEYS.includes(k))
  if (layout.widths?.status && !layout.widths.stage) next.widths = { ...layout.widths, stage: Math.max(layout.widths.status, 170) }
  return next
}

// BUDGET-CONCUR-1: a saved layout gets the Submitted to Concur checkbox right after Receipt, not at the
// far end where a column missing from the saved order would land.
export function withConcurColumn(layout) {
  const order = layout.order || []
  if (!order.length || order.includes('concur_done')) return layout
  const at = order.indexOf('receipt')
  return { ...layout, order: at < 0 ? [...order, 'concur_done'] : [...order.slice(0, at + 1), 'concur_done', ...order.slice(at + 1)] }
}
