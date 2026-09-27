// lib/server/forms/xlsx.js
//
// BUDGET-SHEET-0b (2026-09-27): the workbook writer moved to lib/server/sheet/xlsx.js, shared by
// every Editable sheet (the Forms Sheet and Program Budget's ledger). Re-exported here so the
// forms engine and its tests import exactly what they did.
export { colLetter, xlsxBook, xlsxFor } from '../sheet/xlsx.js'
