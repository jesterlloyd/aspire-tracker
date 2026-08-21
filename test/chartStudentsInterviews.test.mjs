// ASPIRE-CHART: static-source guards for the Students and Interviews reworks -
// handler-driven URL state (ids and fixed keys only), keyboard-accessible
// rows, honest action labels, the interview-to-placement handoff, and the
// responsive reflows.
// Run: node --test test/chartStudentsInterviews.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const spt = read('src/components/StudentProfilesTab.jsx')
const access = read('src/components/AccessTab.jsx')
const listPanel = read('src/components/StudentListPanel.jsx')
const irt = read('src/components/InterviewRubricTab.jsx')
const matching = read('src/components/MatchingTab.jsx')
const app = read('src/App.jsx')
const css = read('src/index.css')

test('Students URL state', async (t) => {
  await t.test('initializes from the querystring and fails closed', () => {
    assert.match(spt, /useState\(\(\) => searchParams\.get\('student'\) \|\| null\)/)
    assert.match(spt, /FILTER_KEYS\[searchParams\.get\('filter'\)\] \?\? null/)
    assert.doesNotMatch(spt, /SORT_KEYS|searchParams\.get\('sort'\)|updateUrl\(\{ sort:/)
  })

  await t.test('URL writes live in user-action handlers, never effects', () => {
    // The workspace tabs stay mounted while hidden and StrictMode re-runs
    // effects; an effect-based sync once stripped deep links with a
    // boot-time closure. Guard the architecture, not just the behavior.
    assert.match(spt, /const selectStudent = \(id\) => \{ setSelectedStudentId\(id\); updateUrl\(\{ student: id \}\) \}/)
    assert.doesNotMatch(spt, /useEffect\(\(\) => \{\s*\n\s*if \(location\.pathname/)
    const effects = spt.split('useEffect').slice(1)
    for (const e of effects) {
      assert.doesNotMatch(e.slice(0, 400), /setSearchParams/, 'no effect calls setSearchParams')
    }
  })

  await t.test('no PII can enter the URL: fixed keys and opaque ids only', () => {
    assert.match(spt, /never names,\s*\n\s*\/\/ emails, or free-typed search text/)
    // The free-text filter input writes component state only.
    assert.match(spt, /onChange=\{e => setUnifiedSearch\(e\.target\.value\)\}/)
    // Every URL write uses one of the three fixed keys.
    const writes = [...spt.matchAll(/updateUrl\(\{ (\w+):/g)].map(m => m[1])
    assert.ok(writes.length >= 3, 'updateUrl call sites found')
    for (const key of writes) {
      assert.ok(['student', 'filter', 'mode'].includes(key), `unexpected URL key: ${key}`)
    }
  })
})

test('Students rows are keyboard targets', () => {
  assert.match(listPanel, /role="button"/)
  assert.match(listPanel, /tabIndex=\{0\}/)
  assert.match(listPanel, /aria-current=\{sel \? 'true' : undefined\}/)
  assert.match(listPanel, /e\.key === 'Enter' \|\| e\.key === ' '/)
})

test('Student search, school, and KPI filters apply to List, Grid, and CS-Link Access', () => {
  assert.match(spt, /const displayedStudents = useMemo\(\(\) => \{[\s\S]*?if \(activeSchoolFilter\)[\s\S]*?if \(activeStatusFilter\)[\s\S]*?return sortStudentsByLastName\(list\)/)
  assert.match(spt, /<StudentListPanel\s*\n\s*students=\{displayedStudents\}/,
    'Profiles List and Grid must receive the shared filtered roster')
  assert.match(spt, /<AccessTab students=\{displayedStudents\}/,
    'CS-Link Access must receive the same shared filtered roster')
  assert.doesNotMatch(spt, /<AccessTab students=\{students\}/,
    'CS-Link Access must never bypass the active KPI or search filter')
})

test('Students toolbar uses cohort schools instead of a redundant sort menu', () => {
  assert.match(spt, /placeholder="Search student"/)
  assert.match(spt, /aria-label="Search student"/)
  assert.match(spt, /aria-label="Filter students by school"/)
  assert.match(spt, /<option value="">All Schools<\/option>/)
  assert.match(spt, /schoolOptions\.map\(school =>/)
  assert.match(spt, /new Set\(students\.map\(s => String\(s\.school \|\| ''\)\.trim\(\)\)/)
  assert.doesNotMatch(spt, /Last Name A–Z|Last Name Z–A|School A–Z|sortBy|changeSort/)
})

test('CS-Link Access has one filtering surface and no redundant export row', () => {
  for (const retired of ['am-filter-row', 'All Schools', 'All ASPIRE Statuses', 'Export Access Log CSV']) {
    assert.ok(!access.includes(retired), `retired CS-Link control survived: ${retired}`)
  }
  assert.doesNotMatch(access, /filterSchool|filterStatus|downloadCSV/)
  assert.match(access, /const sorted = \[\.\.\.students\]\.sort/,
    'AccessTab consumes the roster already filtered by Student Profiles')
})

test('Students responsive reflow', () => {
  assert.match(spt, /className="profiles-kpis"/)
  assert.match(css, /\.profiles-kpis \{ grid-template-columns: repeat\(8, 1fr\); \}/)
  assert.match(css, /@media \(max-width: 980px\) \{[\s\S]*?\.profiles-slide-container \{\s*\n\s*flex-direction: column/)
  assert.match(css, /\.profiles-panel-slide \.sp-content \{ overflow-y: visible/)
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\n\s*\.profiles-panel-slide \{ animation: none; \}/)
})

test('Interviews worklist', async (t) => {
  await t.test('has text search that stays out of the URL', () => {
    assert.match(irt, /aria-label="Search the interview worklist"/)
    assert.match(irt, /setWorklistSearch/)
    assert.doesNotMatch(irt, /set\('search'|set\('q'/)
  })

  await t.test('sort headers are buttons with aria-sort', () => {
    assert.match(irt, /aria-sort=\{sortBy === key \? \(sortDir === 'asc' \? 'ascending' : 'descending'\) : undefined\}/)
    assert.match(irt, /<button\s*\n\s*key=\{key\}\s*\n\s*type="button"\s*\n\s*className=\{`ir-wl-th/)
  })

  await t.test('rows are keyboard targets', () => {
    assert.match(irt, /className="ir-wl-row" role="button" tabIndex=\{0\}/)
    assert.match(irt, /Open interview record for/)
  })

  await t.test('action labels are honest: no Send Invite that sends nothing', () => {
    assert.doesNotMatch(irt, /label:'Send Invite'/)
    // CONNECT-SCHEDULING-LINK-1: the schedule action no longer composes an email itself, it launches
    // ASPIRE Connect, so the honest label comes from the shared gate ('Send'/'Resend Scheduling
    // Link') - the same wording Student Profiles and the Action Center already use. The old
    // 'Email Scheduling Link' would now overclaim.
    assert.match(irt, /const gate = canSendSchedulingLink\(s, communications\)\s*\n\s*return \{ label: gate\.label, type:'schedule'/)
    assert.doesNotMatch(irt, /label:'Email Scheduling Link'/)
    assert.match(irt, /navigate\('\/connect\/outreach\?launch=1'\)/)
  })

  await t.test('rubric deep link uses a handler, not an effect', () => {
    assert.match(irt, /const selectStudent = \(id\) => \{\s*\n\s*setSelectedStudentId\(id\)/)
    const effects = irt.split('useEffect').slice(1)
    for (const e of effects) {
      assert.doesNotMatch(e.slice(0, 400), /setSearchParams/, 'no effect calls setSearchParams')
    }
  })

  await t.test('responsive: KPI reflow and horizontal-scroll worklist', () => {
    assert.match(irt, /className="ir-kpis"/)
    assert.match(css, /\.ir-kpis \{ grid-template-columns: repeat\(6, 1fr\); \}/)
    assert.match(css, /@media \(max-width: 900px\) \{[\s\S]*?\.rub-scroll-area-month \{ overflow-x: auto; \}[\s\S]*?\.ir-worklist \{ min-width: 720px; \}/)
  })
})

test('interview-to-placement handoff', async (t) => {
  await t.test('Ready to place uses exactly the existing placement semantics', () => {
    assert.match(irt, /const readyToPlace = students\.filter\(s => s\.status === 'Interviewed'\)/)
    assert.match(irt, /Ready to place: \{readyToPlace\.length\} → Placement Board/)
    assert.match(irt, /if \(s\.status === 'Interviewed'\)\s*return \{ label:'Place →', type:'place' \}/)
  })

  await t.test('App routes with the student pre-selected; cohort unchanged', () => {
    assert.match(app, /const goToPlacementStudent = id => \{ setFocusMatchStudentId\(id\); navigate\('\/rotation\/matrix'\) \}/)
    assert.match(app, /onNavigateToPlacement=\{goToPlacementStudent\}/)
    assert.match(app, /focusMatchStudentId=\{focusMatchStudentId\}/)
  })

  await t.test('the board pre-selects through the existing mechanic and fails closed', () => {
    assert.match(matching, /if \(!focusMatchStudentId\) return/)
    // PLACEMENT-POOL-READINESS-1: this now fails closed HARDER - the student
    // must also still be pool-eligible (unmatched, not terminal), so a stale
    // route cannot select somebody the Placement Board does not list.
    assert.match(matching, /if \(s && isPoolEligible\(s\)\) setSelectedStudent\(s\)/)
    assert.match(matching, /onFocusMatchConsumed\?\.\(\)/)
    // No new placement path: selection only, the click-to-place flow is untouched.
    assert.doesNotMatch(matching, /focusMatchStudentId[\s\S]{0,300}onMatch\(/)
  })
})
