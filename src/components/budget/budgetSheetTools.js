// src/components/budget/budgetSheetTools.js
//
// BUDGET-V2 item 9 (2026-09-29): Program Budget's sheets keep number and date formats, Group by,
// Freeze, + Row, Delete row and Columns. Text styling, alignment, clear formatting and + Column are
// not offered here. Both budget sheets (the Sheet and Subscriptions) pass this to EditableSheet.
export const BUDGET_TOOLS = Object.freeze({ text: false, align: false, clear: false, newColumn: false })
