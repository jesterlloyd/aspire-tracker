// NURSING-ACADEMICS-1: the portal experience UI - source assertions in the
// house style (the same genre as academicPartnerShell / portalHomeWidthSpacing)
// plus pure unit tests over the color module.
// Pure unit and source assertions. No network, no live database, no email.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

const chrome = read('src/portal/na/NursingAcademicsChrome.jsx')
const portal = read('src/portal/na/NursingAcademicsPortal.jsx')
const calendar = read('src/portal/na/AcademicsCalendarView.jsx')
const benefit = read('src/portal/na/CommunityBenefitView.jsx')
const contacts = read('src/portal/na/AcademicsContactsView.jsx')
const css = read('src/portal/portal.css')
const app = read('src/portal/PortalApp.jsx')

// ── Routing and shell ────────────────────────────────────────────────────────

test('the route namespace is /portal/academics with three sections, At A Glance default', () => {
  assert.match(app, /const NA_SECTIONS = new Set\(\['calendar', 'community-benefit', 'contacts'\]\)/)
  assert.match(app, /\/portal\\\/academics\\\//)
  assert.match(app, /navigate\(`\/portal\/academics\/\$\{key\}`\)/)
  assert.match(app, /return 'calendar'/)
})

test('the nav uses the shared .ptl-nav language with stable tour anchors and aria-current', () => {
  assert.match(chrome, /className="ptl-nav"/)
  assert.match(chrome, /data-tour=\{`portal-nav-\$\{key\}`\}/)
  assert.match(chrome, /aria-current=\{view === key \? 'page' : undefined\}/)
  assert.match(chrome, /PortalNavRefresh/)
  assert.match(chrome, /'calendar'[\s\S]{0,80}At A Glance/)
  assert.match(chrome, /'community-benefit'[\s\S]{0,80}Community Benefit/)
  assert.match(chrome, /'contacts'[\s\S]{0,80}Contacts/)
})

test('sections stay mounted and hide with display, matching the other portals', () => {
  assert.match(portal, /display: view === 'calendar' \? 'block' : 'none'/)
  assert.match(portal, /display: view === 'community-benefit' \? 'block' : 'none'/)
  assert.match(portal, /display: view === 'contacts' \? 'block' : 'none'/)
  assert.match(portal, /GreetingMasthead/)
})

// ── School color consistency ─────────────────────────────────────────────────

test('school colors are deterministic, alias-stable, and shared by calendar and charts', async () => {
  const { schoolColor, NA_SCHOOL_PALETTE } = await import('../src/portal/na/naSchoolColors.js')
  // Same school, same color, every call.
  assert.deepEqual(schoolColor('UCLA'), schoolColor('UCLA'))
  // Known aliases resolve to one identity and therefore one color.
  assert.deepEqual(schoolColor('CSUN'), schoolColor('Cal State Northridge'))
  assert.deepEqual(schoolColor('CSUN'), schoolColor('California State University, Northridge'))
  // Every color is a palette entry with fill + ink.
  const c = schoolColor('West Coast University')
  assert.ok(NA_SCHOOL_PALETTE.includes(c))
  assert.ok(c.fill && c.ink && c.soft)
  // Both views consume the SAME module.
  assert.match(calendar, /from '\.\/naSchoolColors'/)
  assert.match(benefit, /from '\.\/naSchoolColors'/)
})

// ── Calendar behavior ────────────────────────────────────────────────────────

test('the calendar is timeline-first on the shared canonical foundation with month navigation', () => {
  assert.match(calendar, /CanonicalCalendarLayout/)
  assert.match(calendar, /CanonicalCalendarNav/)
  assert.match(calendar, /CanonicalCalendarMonthTitle/)
  // One rotation per row: the timeline row structure.
  assert.match(calendar, /ptl-na-row/)
  assert.match(calendar, /ptl-na-bar/)
  // Month navigation moves a month cursor.
  assert.match(calendar, /getMonth\(\) - 1/)
  assert.match(calendar, /getMonth\(\) \+ 1/)
  // No calendar library import.
  assert.doesNotMatch(calendar, /@fullcalendar|react-big-calendar|dayjs|moment/)
})

test('all four filters exist and sentinel rotations surface in the Needs dates panel', () => {
  for (const f of ['Fiscal year', 'Cohort', 'School', 'Program']) {
    assert.ok(calendar.includes(`'${f}'`) || calendar.includes(`label: '${f}'`), `filter ${f} present`)
  }
  assert.match(calendar, /Needs dates/)
  assert.match(calendar, /has_dates/)
  // Ranges are always printed in text next to the bar (bar is never the only carrier).
  assert.match(calendar, /rangeText/)
  assert.match(calendar, /aria-label=\{`\$\{r\.school\}/)
})

test('the calendar orders cohorts through the established chronological utility', () => {
  assert.match(calendar, /orderCohortsByTimeline/)
  assert.match(calendar, /from '\.\.\/\.\.\/lib\/derivations\/cohortOrder'/)
})

// ── Community Benefit view ───────────────────────────────────────────────────

test('the report view renders honest loading, error, empty, rate-not-set, and retry states', () => {
  assert.match(benefit, /LoadingState/)
  assert.match(benefit, /ErrorState detail=\{error\} onRetry=\{reload\}/)
  assert.match(benefit, /EmptyState/)
  assert.match(benefit, /Rate not set/)
  assert.match(benefit, /Needs reporting data/)
  assert.match(benefit, /Records for review/)
  assert.match(benefit, /ASPIRE status/)
  assert.match(benefit, /r\.status/)
})

test('the CSV download calls the dedicated server export and never assembles rows client-side', () => {
  assert.match(benefit, /fetchBenefitExportCsv/)
  assert.match(benefit, /downloadCSV\(res\.csv/)
  // No client-side row-to-CSV assembly of the detail table.
  assert.doesNotMatch(benefit, /detail_rows[\s\S]{0,80}\.join\(','\)/)
})

test('both views hand access refusals up to the shell instead of rendering a dead retry', () => {
  for (const src of [calendar, benefit, contacts]) {
    assert.match(src, /useReportPortalFailure/)
    assert.match(src, /ACCESS_FAILURE\.ACCESS_ENDED/)
  }
})

// ── CSS namespace and responsiveness ─────────────────────────────────────────

test('the experience owns its own .ptl-na-* namespace and no new shared-class coupling', () => {
  assert.match(css, /NURSING-ACADEMICS-1/)
  assert.match(css, /\.ptl-na-page/)
  assert.match(css, /\.ptl-na-timeline/)
  assert.match(css, /\.ptl-na-table-scroll \{ overflow: auto;/)
  assert.match(css, /\.ptl-na-table th \{[\s\S]{0,100}position: sticky/)
  // The NA block adapts at the house phone breakpoint.
  const naBlock = css.slice(css.indexOf('NURSING-ACADEMICS-1'))
  assert.match(naBlock, /@media \(max-width: 760px\)/)
  assert.doesNotMatch(css, /ptl-main-wide|1800px/)
})

test('the API client follows the house contract: bearer token, never throws on denial', () => {
  const api = read('src/portal/na/nursingAcademicsApi.js')
  assert.match(api, /supabase\.auth\.getSession\(\)/)
  assert.match(api, /Authorization: `Bearer \$\{token\}`/)
  assert.match(api, /return \{ ok: false, status: 401/)
  assert.match(api, /academics-community-benefit/)
  assert.match(api, /academics-calendar/)
  assert.match(api, /academics-benefit-export/)
  assert.match(api, /academics-contacts/)
})

test('Community Benefit uses program KPI filters, compact labels, and table controls', () => {
  assert.match(benefit, /All Programs.*ABSN.*BSN.*ELMN.*MECN/)
  assert.match(benefit, /placeholder="Search student"/)
  assert.match(benefit, /All Schools/)
  assert.match(benefit, /All Cohorts/)
  assert.match(benefit, /Student A–Z/)
  assert.match(benefit, /Cohort timeline/)
  const labels = read('src/portal/na/naDisplayLabels.js')
  for (const value of ['APU', 'CSULA', 'CSULB', 'CSUN', 'WCU-Anaheim', 'WCU-NoHo', 'UCLA']) assert.match(labels, new RegExp(value))
  for (const value of ['ELMN', 'ABSN', 'BSN \\(Semester\\)', 'BSN \\(Trimester\\)', 'BSN \\(Quarter\\)']) assert.match(labels, new RegExp(value))
})

test('Contacts is a read-only server-backed directory with local contact actions', () => {
  assert.match(contacts, /fetchAcademicsContacts/)
  assert.match(contacts, /Read-only access/)
  assert.match(contacts, /ptl-na-contact-kpis/)
  assert.match(contacts, /All Contacts/)
  assert.match(contacts, /CONTACT_CATEGORY_ORDER/)
  assert.match(contacts, /contact\.avatar_url/)
  assert.match(contacts, /ptl-na-contact-detail-hero/)
  assert.match(contacts, /displayListName/)
  assert.match(contacts, /ptl-na-contact-row-role/)
  assert.match(contacts, /contactRoleChipColors/)
  assert.match(contacts, />Affiliation</)
  assert.match(contacts, /mailto:/)
  assert.match(contacts, /tel:/)
  assert.match(contacts, /Copy visible emails/)
  assert.match(contacts, /visibleEmails\.join\(','\)/)
  assert.match(contacts, /navigator\.clipboard\.writeText/)
  assert.doesNotMatch(contacts, /<select[^>]+na-contact-category|All Categories/)
  assert.doesNotMatch(contacts, /contacts-upsert|downloadCSV|Delete contact|Edit contact|notification_history|contact\.notes/)
})

test('Contacts shares the main directory role-pill colors', () => {
  const categories = read('src/lib/contactCategories.js')
  const mainContacts = read('src/components/connect/ContactsView.jsx')
  assert.match(categories, /CONTACT_ROLE_CHIP_STYLES/)
  assert.match(categories, /contactRoleChipColors/)
  assert.match(mainContacts, /contactRoleChipColors/)
  assert.doesNotMatch(mainContacts, /const ROLE_COLORS/)
})

// ── Settings panel ───────────────────────────────────────────────────────────

test('the Settings panel warns about non-clinical-hour double-counting and defers all authority to the server', () => {
  const panel = read('src/components/settings/CommunityBenefitPanel.jsx')
  assert.match(panel, /NOT already recorded as clinical shift hours/)
  assert.match(panel, /can_edit/)
  assert.match(panel, /api\/community-benefit-admin/)
  assert.match(panel, /SCHOOLS\.map/)
  assert.match(panel, /<select id="cb-cap-school"/)
  assert.match(panel, /Additional non-clinical hours/)
  const sections = read('src/components/settings/settingsSections.js')
  assert.match(sections, /communityBenefit/)
  assert.match(sections, /\/settings\/community-benefit/)
})
