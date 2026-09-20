// src/components/shared/dataSheetSort.js
//
// TABLE-CANON-1: the DataSheet's sort and banding rules, in a plain module so a caller
// that needs the same order the sheet shows (an export that mirrors the view) runs the
// same code, and so DataSheet.jsx exports components only.

export const PAGE_ROWS = 8

export function nextSort(sort, key) {
  if (sort?.key === key) return { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' }
  return { key, dir: 'asc' }
}

// null, undefined and '' sort last whichever direction is chosen; numbers compare as
// numbers; everything else as case-insensitive strings.
export function compareValues(a, b, dir = 'asc') {
  const aMissing = a == null || a === ''
  const bMissing = b == null || b === ''
  if (aMissing && bMissing) return 0
  if (aMissing) return 1
  if (bMissing) return -1
  const c = typeof a === 'number' && typeof b === 'number'
    ? a - b
    : String(a).localeCompare(String(b), undefined, { sensitivity: 'base', numeric: true })
  return dir === 'desc' ? -c : c
}

export function sortRows(rows, columns, sort) {
  if (!sort?.key) return rows.slice()
  const col = columns.find(c => c.key === sort.key)
  if (!col?.sortValue) return rows.slice()
  return rows
    .map((row, i) => ({ row, i, v: col.sortValue(row) }))
    .sort((x, y) => compareValues(x.v, y.v, sort.dir) || x.i - y.i)
    .map(x => x.row)
}

// Rows 1 and 2 of every four take the band (table canon §3.1).
export const bandFor = (indexInPage) => (indexInPage % 4 < 2 ? 1 : 0)
