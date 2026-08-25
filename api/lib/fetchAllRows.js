// Read every row from a PostgREST query without relying on the project's
// server-side maximum row setting. Callers provide a fresh, deterministically
// ordered query for each page.

export const REPORT_PAGE_SIZE = 1000

export async function fetchAllRows(makeQuery, errorCode, pageSize = REPORT_PAGE_SIZE) {
  const rows = []
  let from = 0

  while (true) {
    const { data, error } = await makeQuery().range(from, from + pageSize - 1)
    if (error) throw new Error(errorCode)
    const page = data || []
    rows.push(...page)
    if (page.length < pageSize) return rows
    from += pageSize
  }
}
