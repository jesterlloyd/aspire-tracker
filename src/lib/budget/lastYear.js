// src/lib/budget/lastYear.js
//
// BUDGET-TRACKER-1 (Owner, 2026-09-30): the fiscal year last opened in the Budget Tracker is the one it
// opens on next time, until a hard refresh or a new sign-in. So it lives in memory only: never in
// browser storage (a refresh would keep it), and signOutCleanup forgets it on sign-out. The staff app
// and the Nursing Education & Leadership portal each keep their own.
let remembered = {}
export const rememberedYear = (source) => remembered[source] ?? null
export function rememberYear(source, fy) { if (Number.isInteger(fy)) remembered = { ...remembered, [source]: fy } }
export function forgetRememberedYears() { remembered = {} }
