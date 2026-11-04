// lib/server/sheet/readAll.js
//
// SHEET-READ-ALL-1 (2026-11-03): every row of a query, a page at a time. PostgREST returns at
// most 1,000 rows per request whatever .limit() asks for, so a Sheet that read its cells in one
// request silently lost everything past the thousandth row. An upsert rewrites a row at the end of
// the table, so the cells dropped were the ones edited most recently: the Residency applicant Sheet
// showed highlights and corrections that had saved, then lost them on the next visit.
//
// `build()` returns a fresh, filtered query with a stable `.order()` (the table's key), so pages
// neither repeat nor skip a row. Resolves { data, error } like a single query.

export const PAGE_ROWS = 1000

export async function readAll(build, { pageRows = PAGE_ROWS, maxRows = 200000 } = {}) {
  const out = []
  for (let from = 0; from < maxRows; from += pageRows) {
    const { data, error } = await build().range(from, from + pageRows - 1)
    if (error) return { data: null, error }
    out.push(...(data || []))
    if (!data || data.length < pageRows) break
  }
  return { data: out, error: null }
}
