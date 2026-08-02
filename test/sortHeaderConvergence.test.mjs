// QC polish, Commit 2: the Academic Partner roster sort headers now use the SAME canonical sort
// indicator as the staff app. The treatment was extracted from PreceptorDirectoryTable into a shared
// src/components/shared/SortHeader.jsx and adopted in both surfaces: the staff table (unchanged
// appearance) and the Academic Partner roster (bespoke ▲/▼/↕ glyphs replaced).
//
// Source-guard tests. The canonical indicator is a real <button className="preceptor-dir-sort"> with
// a text arrow (' ↑' ascending, ' ↓' descending, empty when unsorted), aria-sort on the <th>, and a
// dynamic aria-label. No SVG, no icon set, no new glyph vocabulary.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

const shared = read('src/components/shared/SortHeader.jsx')
const staffTable = read('src/components/shared/PreceptorDirectoryTable.jsx')
const ap = read('src/portal/AcademicPartnerPortal.jsx')
const css = read('src/index.css')

test('a single shared SortHeader primitive exists', () => {
  assert.ok(existsSync(join(root, 'src/components/shared/SortHeader.jsx')))
  assert.match(shared, /export default function SortHeader\(\{/)
  assert.match(shared, /sortKey,\s*\n\s*sortBy,\s*\n\s*sortDir,\s*\n\s*onSort,\s*\n\s*children,/)
})

test('the canonical indicator is a text arrow: up ascending, down descending, empty when unsorted', () => {
  // Exactly the staff-app treatment: a trailing glyph inside an aria-hidden span, no glyph unsorted.
  assert.match(shared, /aria-hidden="true">\{active \? \(sortDir === 'asc' \? ' ↑' : ' ↓'\) : ''\}/)
  // No SVG or icon component, and none of the old AP triangle/updown glyphs.
  assert.doesNotMatch(shared, /<svg|RefreshCw|lucide|[▲▼↕]/)
})

test('aria-sort lives on the th and the button carries a dynamic aria-label', () => {
  assert.match(shared, /aria-sort=\{active \? \(sortDir === 'asc' \? 'ascending' : 'descending'\) : 'none'\}/)
  assert.match(shared, /className="preceptor-dir-sort"/)
  assert.match(shared, /aria-label=\{`Sort by \$\{children\} \$\{next\}`\}/)
  assert.match(shared, /onClick=\{\(\) => onSort\?\.\(sortKey\)\}/)
})

test('the th class is overridable and adjacent content renders in a shared inner row', () => {
  // Default keeps the staff cell class; a caller can override it and pass trailing content.
  assert.match(shared, /thClassName = 'am-th am-sortable'/)
  assert.match(shared, /after = null/)
  assert.match(shared, /\{after \? <span className="am-sort-th-inner">\{button\}\{after\}<\/span> : button\}/)
  assert.match(css, /\.am-sort-th-inner \{/)
})

test('the staff PreceptorDirectoryTable adopts the shared header with NO appearance change', () => {
  // It imports the shared component and no longer defines its own; the default th class is unchanged.
  assert.match(staffTable, /import SortHeader from '\.\/SortHeader'/)
  assert.doesNotMatch(staffTable, /function SortHeader\(/)
  // Its columns still pass the same sortKey/sortBy/sortDir/onSort contract (default th class applies).
  assert.match(staffTable, /<SortHeader sortKey="name" sortBy=\{sortBy\} sortDir=\{sortDir\} onSort=\{onSort\}>Name<\/SortHeader>/)
})

test('the Academic Partner roster adopts the shared header and drops its bespoke sort treatment', () => {
  assert.match(ap, /import SortHeader from '\.\.\/components\/shared\/SortHeader'/)
  assert.doesNotMatch(ap, /function SortHeader\(/)
  assert.doesNotMatch(ap, /ptl-ap-sort/)
  assert.doesNotMatch(ap, /[▲▼↕]/)
  // The status header carries the legend through the shared after= slot.
  // STATUS-LEGEND-AUDIENCE-1: the slot now passes the audience prop.
  assert.match(ap, /after=\{<StatusLegendPopover audience="academic_partner" \/>\}/)
})
