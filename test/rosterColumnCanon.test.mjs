// test/rosterColumnCanon.test.mjs
//
// UI-CONSISTENCY-6 (Owner decisions, 2026-09-03): one column canon for the student rosters, the
// inset header band for tables that sit inside a padded card, and Evaluation > Responses row
// banding everywhere. Pins the three tables the Owner reviewed side by side, the endpoint fields
// that feed the Academic Partner Rotation Timeline and Preceptor(s) columns, the legend audience
// the NEL report gained, and the canon text a future portal reads.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  LEGEND_AUDIENCES, STATUS_DESCRIPTIONS_BY_AUDIENCE, legendColorRows,
} from '../src/lib/statusLegendCopy.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const stripJsx = (t) => t.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const ap = read('src/portal/AcademicPartnerPortal.jsx')
const ul = read('src/portal/UnitLeaderPortal.jsx')
const nel = read('src/portal/na/CommunityBenefitView.jsx')
const endpoint = read('api/portal/school-students.js')
const portalCss = read('src/portal/portal.css')
const brand = read('src/styles/aspireBrand.css')
const sheet = read('src/styles/aspireTable.css')
const canon = read('CLAUDE.md')

const ROSTER = ['Student', 'ASPIRE Status', 'Cohort', 'Rotation Timeline', 'Assigned Unit', 'Shift', 'Preceptor(s)', 'Hours']

// Header labels in document order from the first <thead> after `from`.
function headerLabels(src, from) {
  const start = src.indexOf('<thead>', src.indexOf(from))
  assert.ok(start > 0, `thead after ${from}`)
  const head = stripJsx(src.slice(start, src.indexOf('</thead>', start)))
  return [...head.matchAll(/>\s*([A-Za-z][A-Za-z().\s]*?)\s*</g)].map(m => m[1].trim()).filter(Boolean)
}
const rule = (css, sel) => { const i = css.indexOf(sel + ' {'); return i < 0 ? '' : css.slice(i, css.indexOf('}', i)) }

// ── The three rosters ────────────────────────────────────────────────────────

test('the Academic Partner roster carries the shared columns in the shared order', () => {
  assert.deepEqual(headerLabels(ap, 'ptl-ap-table'), ROSTER)
  // Each column reads the endpoint field that feeds it.
  assert.match(ap, /<StatusPill status=\{s\.status\} \/>/)
  assert.match(ap, /s\.rotation \? `\$\{fmtShortDate\(s\.rotation\.start\)\} to \$\{fmtShortDate\(s\.rotation\.end\)\}`/)
  assert.match(ap, /\{s\.unit_name \|\| <span className="ptl-muted">Not yet assigned<\/span>\}/)
  assert.match(ap, /\{s\.shift_assigned \|\| <span className="ptl-muted">Not set<\/span>\}/)
  assert.match(ap, /<PreceptorList assignments=\{s\.preceptors\} fallbackName=\{s\.preceptor_name\}/)
  assert.match(ap, /import PreceptorList from '\.\/unit\/PreceptorList'/)
  assert.match(ap, /import \{ fmtShortDate \} from '\.\/unit\/unitLeaderApi'/)
  assert.doesNotMatch(stripJsx(ap), /Confirmed unit|Primary preceptor|Not yet confirmed/)
})

test('the Unit Leader roster carries the same columns, then its Actions gutter', () => {
  const labels = headerLabels(ul, 'function StudentRoster')
  assert.deepEqual(labels.slice(0, ROSTER.length), ROSTER)
  assert.equal(labels[ROSTER.length], 'Actions')
  const row = ul.slice(ul.indexOf('function StudentRow'), ul.indexOf('function PreceptorScreen'))
  const dataLabels = [...row.matchAll(/data-label="([^"]+)"/g)].map(m => m[1])
  assert.deepEqual(dataLabels, [...ROSTER, 'Actions'])
  assert.match(row, /<td data-label="Assigned Unit">\{orDash\(s\.unit_key\)\}<\/td>/)
  assert.match(ul, /heading="Your Students"/)
  // One fmtShortDate, shared with the Academic Partner roster.
  assert.doesNotMatch(ul, /function fmtShortDate/)
  assert.match(ul, /fmtShortDate, ASPIRE_AUTHORITY_NOTE/)
  assert.match(read('src/portal/unit/unitLeaderApi.js'), /export function fmtShortDate\(ymd\)/)
})

test('the NEL Student Detail report leads with the shared columns, pills its status, and carries the legend', () => {
  assert.deepEqual(headerLabels(nel, 'ptl-na-table'), [
    'Student', 'ASPIRE Status', 'Cohort', 'Rotation Timeline', 'School', 'Program', 'Course Type',
    'Primary Preceptor', 'Required', 'Completed', 'Category', 'Est. Benefit',
  ])
  assert.match(nel, /<StatusPill status=\{r\.status\} \/>/)
  assert.match(nel, /<StatusLegendPopover audience="nursing_academic" \/>/)
  assert.match(nel, /Student Detail \(\{report\.fiscal_year_label\}\)/)
  assert.doesNotMatch(stripJsx(nel), /Student detail|<td>\{r\.status\}<\/td>/)
  // The row order matches the header order.
  const body = nel.slice(nel.indexOf('<tbody>', nel.indexOf('ptl-na-table')))
  const cells = ['r.student_name', 'StatusPill', 'r.cohort', 'r.rotation_start', 'r.school', 'r.program', 'r.course_type', 'r.preceptor_name', 'r.required_hours', 'r.approved_hours', 'r.benefit_category', 'r.estimated_benefit']
  const positions = cells.map(c => body.indexOf(c))
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, 'cells render in header order')
  // Column widths were re-keyed to the new order: Rotation Timeline is the wide fourth column.
  assert.match(portalCss, /\.ptl-na-table th:nth-child\(4\) \{ width: 12%; \}/)
  assert.match(portalCss, /\.ptl-na-table th:nth-child\(8\) \{ width: 10%; \}/)
  assert.equal((portalCss.match(/\.ptl-na-table th:nth-child\(\d+\)/g) || []).length, 12)
})

// ── The endpoint behind the two new Academic Partner columns ─────────────────

test('school-students returns the rotation window and every active preceptor, nothing more', () => {
  assert.match(endpoint, /'cohort_school_rotation_id',/)
  assert.match(endpoint, /\.from\('cohort_school_rotations'\)\s*\.select\('id, rotation_start_date, rotation_end_date'\)/)
  assert.match(endpoint, /const ROTATION_SENTINEL = '1900-01-01'/)
  assert.match(endpoint, /rotation: rotationById\[s\.cohort_school_rotation_id\] \|\| null,/)
  assert.match(endpoint, /\.select\('student_id, role, status, start_date, end_date, preceptors \( full_name \)'\)/)
  assert.match(endpoint, /push\(\{\s*name,\s*role: a\.role,\s*start_date: a\.start_date \|\| null,\s*end_date: a\.end_date \|\| null,\s*\}\)/)
  assert.match(endpoint, /preceptors: assignmentsByStudent\[s\.id\] \|\| \[\],/)
  // The single-name field survives for existing readers, primary first, legacy text last.
  assert.match(endpoint, /preceptor_name: assignmentsByStudent\[s\.id\]\?\.\[0\]\?\.name \|\| s\.preceptor_name \|\| null,/)
  // shift_type is a Unit Leader detail; the school roster never selects it.
  assert.doesNotMatch(endpoint, /shift_type/)
})

// ── The legend audience the NEL report gained ────────────────────────────────

test('nursing_academic is a complete legend audience with the neutral amber line', () => {
  assert.ok(LEGEND_AUDIENCES.includes('nursing_academic'))
  const map = STATUS_DESCRIPTIONS_BY_AUDIENCE.nursing_academic
  for (const status of Object.keys(STATUS_DESCRIPTIONS_BY_AUDIENCE.staff)) {
    assert.equal(typeof map[status], 'string', `nursing_academic must describe ${status}`)
  }
  assert.equal(legendColorRows('nursing_academic').find(r => r.key === 'amber').description, 'Follow-up may be needed.')
})

// ── The inset band and the banding ───────────────────────────────────────────

test('tables inside a padded card wear the inset band; tables that are the card keep the canon band', () => {
  assert.match(brand, /--aspire-th-bg-inset: #eef1f8;/)
  assert.match(brand, /--aspire-th-color-inset: #4b5675;/)
  assert.match(brand, /--aspire-row-band: #fafafa;/)
  for (const sel of ['.ptl-table th', '.ptl-na-table th']) {
    const body = rule(portalCss, sel)
    assert.match(body, /background: var\(--aspire-th-bg-inset, #eef1f8\)/, `${sel} band`)
    assert.match(body, /color: var\(--aspire-th-color-inset, #4b5675\)/, `${sel} label colour`)
  }
  assert.match(rule(portalCss, '.ptl-stu-table thead th'), /background: var\(--aspire-th-bg, #f9fafb\)/)
  assert.match(rule(sheet, '.am-th'), /background: var\(--aspire-th-bg\)/)
  for (const family of ['.ptl-table', '.ptl-na-table']) {
    assert.match(portalCss, new RegExp(`\\${family} th:first-child \\{ border-top-left-radius: var\\(--aspire-radius-control\\); \\}`))
    assert.match(portalCss, new RegExp(`\\${family} th:last-child \\{ border-top-right-radius: var\\(--aspire-radius-control\\); \\}`))
  }
})

test('even rows carry the Evaluation > Responses banding in every roster family, and hover still wins', () => {
  assert.match(portalCss, /\.ptl-table tbody tr:nth-child\(even\) > td \{ background: var\(--aspire-row-band, #fafafa\); \}/)
  assert.match(portalCss, /\.ptl-na-table tbody tr:nth-child\(even\) > td \{ background: var\(--aspire-row-band, #fafafa\); \}/)
  assert.match(portalCss, /\.ptl-stu-table tbody tr:nth-child\(even\):not\(:hover\) \{ background: var\(--aspire-row-band, #fafafa\); \}/)
  assert.match(sheet, /\.am-table tbody tr:nth-child\(even\):not\(:hover\) \{ background: var\(--aspire-row-band, #fafafa\); \}/)
  // Evaluation > Responses, the source of the value, now reads the token it defined.
  assert.match(read('src/components/EvaluationTab.jsx'), /idx % 2 === 0 \? '#ffffff' : 'var\(--aspire-row-band, #fafafa\)'/)
  // Stacked phone rows are cards of their own.
  assert.match(portalCss, /\.ptl-table tbody tr:nth-child\(even\) > td \{ background: transparent; \}/)
  // Every banded portal table actually has a <tbody> for the selector to find.
  for (const [name, src] of [['AP', ap], ['UL', ul], ['NEL', nel]]) assert.match(src, /<tbody>/, `${name} tbody`)
})

test('CLAUDE.md carries the roster column canon and the inset-band rule', () => {
  for (const must of ['Student, ASPIRE\nStatus, Cohort, Rotation Timeline, Assigned Unit, Shift, Preceptor(s), Hours',
    '--aspire-th-bg-inset', '--aspire-row-band', '"Your Students"', 'UI-CONSISTENCY-6']) {
    assert.ok(canon.includes(must), `CLAUDE.md names ${must}`)
  }
})
