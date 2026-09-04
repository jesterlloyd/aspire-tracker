// test/uiConsistency.test.mjs
//
// UI-CONSISTENCY-1: one radius, one card edge, one gap, one first-card offset, one
// table-header size and one secondary-nav hairline across the staff app and every portal.
//
// The root cause this guards against returning: src/styles/aspireBrand.css already held
// the brand tokens, and only the portal imported it. The staff app never saw them, so
// nineteen radii, 123 card-edge colours and 23 gaps grew in the gaps between files. The
// property that matters is therefore not "the values are nice" but "both halves READ THE
// SAME FILE", and everything below follows from that.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const rule = (css, sel) => {
  const m = css.match(new RegExp('(?:^|\\n)' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}'))
  return m ? m[1] : null
}

const brand = read('src/styles/aspireBrand.css')
const index = read('src/index.css')
const portal = read('src/portal/portal.css')
const ngrp = read('src/components/ngrp/ngrp.css')
const chart = read('src/styles/chartTokens.css')

// ── One file, read by both halves ────────────────────────────────────────────

test('the staff app imports the brand tokens the portal already read', () => {
  assert.match(index, /@import '\.\/styles\/aspireBrand\.css';/)
  assert.match(read('src/portal/PortalApp.jsx'), /import '\.\.\/styles\/aspireBrand\.css'/)
})

test('the tokens exist, once, with the decided values', () => {
  for (const [name, value] of [
    ['--aspire-radius-card', '12px'], ['--aspire-radius-control', '10px'],
    ['--aspire-gap-card', '16px'], ['--aspire-page-top', '24px'], ['--aspire-th-size', '11px'],
  ]) {
    const hits = brand.match(new RegExp(`${name}:\\s*${value};`, 'g')) || []
    assert.equal(hits.length, 1, `${name} must be declared exactly once as ${value}`)
  }
  assert.match(brand, /--aspire-shadow-card:/)
  assert.match(brand, /--aspire-nav-line:/)
})

// ── Cards: token radius, no outline, shadow edge ─────────────────────────────

const CARDS = [
  ['staff', index, '.ov-panel '], ['staff', index, '.stat-card'], ['staff', index, '.snap'],
  ['staff', index, '.mast'], ['staff', index, '.unit-card'], ['staff', index, '.matching-board'],
  ['staff', index, '.canonical-calendar-shell'],
  ['portal', portal, '.ptl-card'], ['portal', portal, '.ptl-rotation-switch'],
  ['ngrp', ngrp, '.ngrp-roster'],
]

test('every card reads the radius token and none hard-codes a radius', () => {
  for (const [side, css, sel] of CARDS) {
    const body = rule(css, sel)
    assert.ok(body, `${side} ${sel} rule must exist`)
    assert.match(body, /border-radius:\s*var\(--(?:aspire-radius-card|ptl-radius)/, `${side} ${sel} reads the token`)
    assert.doesNotMatch(body, /border-radius:\s*\d/, `${side} ${sel} hard-codes a radius`)
  }
  // The portal's own alias resolves to the shared token.
  assert.match(portal, /--ptl-radius:\s*var\(--aspire-radius-card,\s*12px\)/)
})

test('every card has no outline and a shadow edge', () => {
  for (const [side, css, sel] of CARDS) {
    const body = rule(css, sel)
    assert.match(body, /\bborder:\s*0;/, `${side} ${sel} must not draw an outline`)
    assert.match(body, /box-shadow:\s*var\(--aspire-shadow-card/, `${side} ${sel} edge is the shadow`)
  }
})

// ── Rhythm ───────────────────────────────────────────────────────────────────

test('sibling cards share one gap and the first card one offset', () => {
  assert.match(rule(index, '.ov-panels'), /gap:\s*var\(--aspire-gap-card\)/)
  assert.match(rule(index, '.dashboard'), /gap:\s*var\(--aspire-gap-card\)/)
  assert.match(rule(index, '.snap'), /margin:\s*var\(--aspire-gap-card\) 20px 0/)
  assert.match(rule(index, '.mast'), /margin:\s*var\(--aspire-gap-card\) 20px 0/)
  assert.match(rule(portal, '.ptl-grid'), /gap:\s*var\(--aspire-gap-card/)
  // Staff: page column 8px + card's own 16px margin = 24. Portal: 24 directly. Same distance.
  assert.match(rule(index, '.app-main'), /padding:\s*calc\(var\(--aspire-page-top\) - var\(--aspire-gap-card\)\) 0 0/)
  assert.match(portal, /\.ptl-main \{[^}]*padding: var\(--aspire-page-top, 24px\) 24px 40px/)
})

// ── Table headers ────────────────────────────────────────────────────────────

test('no table-header rule hard-codes a font size', () => {
  for (const [name, css] of [['index.css', index], ['portal.css', portal], ['ngrp.css', ngrp]]) {
    for (const m of css.matchAll(/(?:^|\n)([^\n{]*(?:\bth\b|thead|table-header|-th\b)[^\n{]*)\{([^}]*)\}/g)) {
      const fs = m[2].match(/font-size:\s*([^;]+);/)
      if (!fs) continue
      // .iv-th-info is a 14px circular "i" glyph that sits INSIDE a header, not a header
      // label; 9px is the right size for a glyph in a 14px circle. The selector heuristic
      // above (anything with -th in it) is what caught it, not the rule.
      if (/\.iv-th-info\b/.test(m[1])) continue
      assert.match(fs[1], /var\(--aspire-th-size/, `${name} ${m[1].trim()} hard-codes ${fs[1]}`)
    }
  }
  for (const f of ['src/portal/unit/UnitClinicalHours.jsx', 'src/components/ClinicalHoursPanel.jsx', 'src/components/AvailabilitySection.jsx']) {
    assert.doesNotMatch(read(f), /<th[^>]*fontSize:\s*10\b/, `${f} inline header hard-codes 10px`)
  }
})

// ── Secondary navs ───────────────────────────────────────────────────────────

test('the staff workspace bar and the portal nav share one hairline', () => {
  assert.match(rule(chart, '.chart-nav'), /border-bottom:\s*1px solid var\(--aspire-nav-line\)/)
  assert.match(rule(portal, '.ptl-nav'), /border-bottom:\s*1px solid var\(--aspire-nav-line/)
  // The navy app-level tab bar is deliberately untouched: it is brand chrome, not a section nav.
  assert.match(rule(index, '.tab-bar'), /background:\s*var\(--nightfall\)/)
})

// ── Titles ───────────────────────────────────────────────────────────────────

test('section, panel, card, chart and drawer titles are Title Case', () => {
  const SMALL = new Set(['a','an','and','as','at','by','for','from','in','of','on','or','the','to','with','per','this'])
  const titles = [
    ['src/portal/na/CommunityBenefitView.jsx', 'Benefit Contribution by School'],
    ['src/portal/na/AcademicsCalendarView.jsx', 'Fiscal-Year Impact'],
    ['src/components/ngrp/AtAGlanceTab.jsx', 'Scope and Rules'],
    ['src/components/ngrp/CohortSettingsModal.jsx', 'Official Program Requirements'],
    ['src/components/settings/AccountDetailsDrawer.jsx', 'Account Details'],
    ['src/components/settings/KeithUsagePanel.jsx', 'Anthropic Billing Reconciliation'],
    ['src/portal/unit/StudentDetailDrawer.jsx', 'Milestone History'],
    ['src/portal/UnitLeaderPortal.jsx', 'Notification Preferences'],
    ['src/portal/StudentPortal.jsx', 'Approved Clinical Hours'],
  ]
  for (const [f, t] of titles) {
    assert.ok(read(f).includes(t), `${f} must render ${JSON.stringify(t)}`)
    for (const [i, w] of t.split(' ').entries()) {
      const core = w.replace(/[^A-Za-z-]/g, '')
      if (i > 0 && SMALL.has(core.toLowerCase())) continue
      assert.match(core, /^[A-Z]/, `${JSON.stringify(t)}: ${w} should be capitalised`)
    }
  }
  // Empty states and prompts stay sentence case on purpose; this one is pinned so a
  // future sweep does not "fix" it into shouting.
  assert.ok(read('src/portal/AcademicPartnerPortal.jsx').includes('No students match this filter'))
})

// ── Photos ───────────────────────────────────────────────────────────────────

test('headshot images decode off the main thread and reserve their box', () => {
  for (const f of ['src/components/StudentAvatar.jsx', 'src/portal/unit/UnitStudentAvatar.jsx']) {
    const src = read(f)
    assert.match(src, /decoding="async"/, `${f}`)
    assert.match(src, /loading="lazy"/, `${f}`)
    assert.match(src, /width=\{size\}\s*\n\s*height=\{size\}/, `${f} reserves its box so rows do not shift`)
  }
})

// ── UI-CONSISTENCY-2: the classes At a Glance really renders, the hover, the tables ──

test('the block that follows the snapshot card is the one that carries the gap', () => {
  // .ov-panels is rendered by no page; the sticky header strip is what follows .snap.
  assert.doesNotMatch(read('src/components/OverviewTab.jsx'), /className="ov-panels"/)
  assert.match(rule(index, '.aggregate-sticky-header'), /margin-top:\s*var\(--aspire-gap-card\)/)
  assert.doesNotMatch(rule(index, '.aggregate-sticky-header'), /border-bottom/, 'no strip-wide hairline across the gap between panels')
})

test('the Placement Capacity / Requests split card reads the canon on both halves', () => {
  const hdr = rule(index, '.aggregate-panel-hdr'), body = rule(index, '.ov-panel-body')
  assert.match(hdr, /\bborder:\s*0;/); assert.match(body, /\bborder:\s*0;/)
  assert.doesNotMatch(hdr + body, /#e0e7ff/, 'the faint outline the Owner pointed at is gone')
  assert.match(hdr, /border-radius:\s*var\(--aspire-radius-card\) var\(--aspire-radius-card\) 0 0/)
  assert.match(body, /border-radius:\s*0 0 var\(--aspire-radius-card\) var\(--aspire-radius-card\)/)
  assert.match(body, /box-shadow:\s*var\(--aspire-shadow-card\)/)
  assert.match(hdr, /border-bottom:\s*1px solid var\(--border-lt\)/, 'the seam belongs to the card')
  for (const sel of ['.aggregate-panel-headers', '.ov-panels-body']) assert.match(rule(index, sel), /gap:\s*var\(--aspire-gap-card\)/)
})

test('a student card lifts on hover like a KPI card, and never changes colour', () => {
  const base = rule(index, '.mast-live-card'), hover = rule(index, '.mast-live-card:hover')
  assert.match(base, /\bborder:\s*0;/); assert.match(base, /border-radius:\s*var\(--aspire-radius-card\)/)
  assert.match(base, /transition:\s*transform 0\.18s cubic-bezier\(0\.2, 0\.7, 0\.2, 1\), box-shadow 0\.18s ease/, 'the same curve KPIBand uses')
  assert.match(hover, /transform:\s*translateY\(-2px\)/)
  assert.match(hover, /box-shadow:\s*var\(--aspire-shadow-card-hover\)/)
  assert.doesNotMatch(hover, /border-color|background/, 'no blue outline, no colour change')
  assert.match(rule(index, '.mast-live-card:active'), /translateY\(0\)/)
})

test('every table header reads the canon: weight, colour, band, tracking, hairline', () => {
  const TH = [
    ['index.css', index, '.iv-th'], ['index.css', index, '.ir-wl-th'], ['index.css', index, '.table-header'],
    ['aspireTable.css', read('src/styles/aspireTable.css'), '.am-th'], ['index.css', index, '.preview-table th'], ['index.css', index, '.rub-legend-table th'],
    ['index.css', index, '.casey-paired-table th'], ['ngrp.css', ngrp, '.ngrp-table thead th'],
    ['portal.css', portal, '.ptl-stu-table thead th'], ['portal.css', portal, '.ptl-na-table th'],
  ]
  for (const [f, css, sel] of TH) {
    const body = rule(css, sel); assert.ok(body, `${f} ${sel}`)
    assert.match(body, /font-weight:\s*var\(--aspire-th-weight/, `${f} ${sel} weight`)
    assert.match(body, /color:\s*var\(--aspire-th-color/, `${f} ${sel} colour`)
    assert.doesNotMatch(body, /font-weight:\s*\d|letter-spacing:\s*0\.\d+em|\bcolor:\s*#|background:\s*(?:#|var\(--sand\))/, `${f} ${sel} still hard-codes a header value`)
  }
  // Canon 1 wears the class its values became; only the active-sort colour is inline.
  const ev = read('src/components/EvaluationTab.jsx')
  assert.match(ev, /<th\s+onClick=\{sortable \? onClick : undefined\}[\s\S]*?className="aspire-th"/)
  assert.doesNotMatch(ev, /fontWeight: 'var\(--aspire-th-weight/)
  // The bad table no longer bolds the sorted header heavier than its neighbours.
  assert.doesNotMatch(read('src/components/InterviewRubricTab.jsx'), /fontWeight: sortBy === key \? 800 : 700/)
})

// ── UI-CONSISTENCY-3: one header sheet, one sort control ─────────────────────

test('both halves import the shared table sheet, and the sort control lives there', () => {
  assert.match(index, /@import '\.\/styles\/aspireTable\.css';/)
  assert.match(read('src/portal/PortalApp.jsx'), /import '\.\.\/styles\/aspireTable\.css'/)
  const sheet = read('src/styles/aspireTable.css')
  assert.match(sheet, /\.aspire-th \{[^}]*font-size: var\(--aspire-th-size/s)
  // The button inside a sortable header inherits everything typographic from the cell.
  const btn = sheet.match(/\.preceptor-dir-sort \{([^}]*)\}/)[1]
  for (const prop of ['font: inherit', 'color: inherit', 'text-transform: inherit', 'letter-spacing: inherit']) assert.ok(btn.includes(prop), `sort button must ${prop}`)
  assert.doesNotMatch(index, /\n\.preceptor-dir-sort\s*\{/, 'not also in index.css, where the portals cannot see it')
})

test('no resting sort glyph anywhere: the arrow appears only on the sorted column', () => {
  const offenders = []
  const walk = (dir) => { for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
    if (/ \d+\.|node_modules/.test(e.name)) continue
    const rel = `${dir}/${e.name}`
    // A sort control always pairs an up glyph with a down one; a lone down-triangle is a
    // disclosure chevron (OutreachView's "Other templates" toggle pairs it with a right-pointing
    // one), not a sort indicator, so only the up-triangle and the double arrow are matched.
    if (e.isDirectory()) walk(rel); else if (/\.jsx$/.test(e.name) && /↕|am-sort-icon|'\u25B2'/.test(read(rel))) offenders.push(rel)
  } }
  walk('src')
  assert.deepEqual(offenders, [], 'these still show a glyph on an unsorted column')
})

test('no header cell carries its own inline typography', () => {
  const offenders = []
  const walk = (dir) => { for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
    if (/ \d+\.|node_modules/.test(e.name)) continue
    const rel = `${dir}/${e.name}`
    if (e.isDirectory()) walk(rel); else if (/\.jsx$/.test(e.name)) {
      for (const m of read(rel).matchAll(/<th\b[^>]*style=\{\{([^}]*)\}/g)) if (/fontSize|fontWeight|textTransform|letterSpacing/.test(m[1])) offenders.push(rel)
    }
  } }
  walk('src')
  assert.deepEqual([...new Set(offenders)], [], 'these header cells style their own type instead of using .aspire-th')
})

test('the Academic Partner roster has no Rotation column', () => {
  const ap = read('src/portal/AcademicPartnerPortal.jsx')
  assert.doesNotMatch(ap, /<th scope="col">Rotation<\/th>/); assert.doesNotMatch(ap, /rotationText/)
})

// ── UI-CONSISTENCY-5: portal roster bodies and the Academic Partner Shift column ──────

test('portal roster bodies read at the Alumni Roster density', () => {
  // Owner decision: 12px cells and 10px 12px padding, the values .ngrp-table uses, so a
  // school's or a unit leader's table is the same density as staff's.
  assert.match(rule(portal, '.ptl-table'), /font-size:\s*12px/)
  assert.match(rule(portal, '.ptl-table td'), /padding:\s*10px 12px/)
  assert.match(rule(ngrp, '.ngrp-table'), /font-size:\s*12px/)
  assert.match(rule(ngrp, '.ngrp-table tbody td'), /padding:\s*10px 12px/)
})

test('the Academic Partner roster shows the assigned shift, and only the shift type', () => {
  const ap = read('src/portal/AcademicPartnerPortal.jsx'), ep = read('api/portal/school-students.js')
  assert.match(ap, /<th scope="col">Shift<\/th>/)
  assert.match(ap, /\{s\.shift_assigned \|\| <span className="ptl-muted">Not set<\/span>\}/)
  // The allowlist widened by exactly the two fields the Owner approved. Shift-log content
  // (narratives, review, support) stays out; the privacy test pins that list separately.
  assert.match(ep, /'shift_assigned'/)
  // program_type is on the school endpoint's FORBIDDEN list (an earlier Owner decision, pinned in
  // test/academicPartnerPrivateFieldExclusion.test.mjs); the roster must not reach for it.
  for (const forbidden of ['program_type', 'shift_logs', 'support_needed', 'learning_highlight', 'admin_notes']) assert.ok(!ep.includes(`'${forbidden}'`), `${forbidden} must stay out of the school allowlist`)
  // Identity cell matches the Alumni Roster's avatar size. No program sub-line: see above.
  assert.match(ap, /<UnitStudentAvatar url=\{photos\.peek\(s\.id\)\} name=\{displayName\(s\)\} size=\{40\} \/>/)
  assert.doesNotMatch(ap, /s\.program_type/)
})

test('no em dash in the token file or the new test', () => {
  const EM = String.fromCharCode(0x2014)
  for (const f of ['src/styles/aspireBrand.css', 'test/uiConsistency.test.mjs']) assert.ok(!read(f).includes(EM), f)
})
