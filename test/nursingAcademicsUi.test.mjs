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
  assert.match(app, /const NA_SECTIONS = new Set\(\['calendar', 'community-benefit', 'contacts', 'messages'\]\)/)
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
  // At A Glance is a flex column because it also carries the masthead above
  // the calendar (the other two sections hold a single child, so they stay
  // 'block'); all three still MOUNT and hide with display, which is what
  // preserves month position, filters, and the loaded report across nav.
  assert.match(portal, /display: view === 'calendar' \? 'flex' : 'none'/)
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

test('Contacts preserves view-only access and conditionally exposes the narrow Contacts Editor controls', () => {
  assert.match(contacts, /fetchAcademicsContacts/)
  assert.match(contacts, /canManageContacts/)
  assert.match(contacts, /createAcademicsContact/)
  assert.match(contacts, /updateAcademicsContact/)
  assert.match(contacts, /Add contact/)
  assert.match(contacts, /Edit contact/)
  assert.match(contacts, /Deactivate/)
  assert.match(contacts, /Reactivate/)
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
  // NA-CONTACTS-SCOPE-1: downloadCSV joined legitimately (the approved Download
  // CSV button); contact.notes joined via CONTACTS-EDITOR-PARITY-1.
  assert.doesNotMatch(contacts, /contacts-upsert|Delete contact|notification_history/)
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

// ── NA-CONTACTS-POLISH-1: consistency + selection-order pass ────────────────

test('contact KPI filter cards follow the canonical FilterKPICard treatment (no colored outline)', () => {
  // Rest state: near-invisible border + 14px radius + s1 shadow, exactly the
  // values FilterKPICard uses in src/components/KPIBand.jsx.
  assert.match(css, /\.ptl-na-contact-kpi \{[\s\S]*?border: 1px solid rgba\(29, 37, 103, 0\.06\); border-radius: 14px;/)
  assert.doesNotMatch(css, /\.ptl-na-contact-kpi \{[\s\S]{0,400}?var\(--ptl-na-contact-border/)
})

test('the list and the detail pane are separate rounded cards, mirroring Student Profiles', () => {
  // The container is a plain grid with a gap, not one joined .ptl-card sheet.
  assert.doesNotMatch(contacts, /ptl-card ptl-na-contact-directory/)
  assert.match(css, /\.ptl-na-contact-directory \{ display: grid;[^}]*gap: 16px;/)
  // POLISH-5: the card chrome lives on the shell; the list inside scrolls.
  assert.match(css, /\.ptl-na-contact-list-shell \{[\s\S]{0,300}?border-radius: 14px;/)
  assert.match(css, /\.ptl-na-contact-detail \{[\s\S]{0,300}?border-radius: 16px;/)
  // The old joined-sheet seams are gone (column divider, stacked divider).
  assert.doesNotMatch(css, /\.ptl-na-contact-list \{[^}]*border-right: 1px solid/)
  assert.doesNotMatch(css, /\.ptl-na-contact-list \{[^}]*border-bottom: 1px solid/)
})

test('the search field keeps a visible focus treatment on the wrapper, not a raw outline ring', () => {
  // POLISH-3: the ring is the app-standard .search-input:focus recipe (nova).
  assert.match(css, /\.ptl-na-contact-search:focus-within \{ border-color: var\(--nova/)
  assert.match(css, /\.ptl-na-contact-search input:focus-visible \{ outline: none; \}/)
})

test('auto-selection always takes the FIRST DISPLAYED row (orderContacts), never fetch order', () => {
  // One ordering pipeline...
  // NA-CONTACTS-SCOPE-4: the pipeline's 4th argument is now ONE derived
  // ordering object carrying both scope-dependent facts (category order and
  // the in-scope units the Unit Leader sort keys on).
  assert.match(contacts, /const orderContacts = \(list, category, query, ordering = DEFAULT_ORDERING\) =>/)
  assert.match(contacts, /const scopeOrdering = \(activeScope\) => \(\{\s*\n\s*categoryOrder: scopedCategoryOrder\(activeScope, CONTACT_CATEGORY_ORDER\),\s*\n\s*scopeUnits: scopeUnitSet\(activeScope\),/)
  // ...feeding the visible list...
  assert.match(contacts, /const filtered = useMemo\(\(\) => orderContacts\(scopedContacts, category, query, ordering\)/)
  // ...and every selection site: category click, search, initial load, deactivation fallback.
  assert.match(contacts, /setSelectedId\(orderContacts\(scopedContacts, value, query, ordering\)\[0\]\?\.id \|\| null\)/)
  assert.match(contacts, /setSelectedId\(orderContacts\(scopedContacts, category, nextQuery, ordering\)\[0\]\?\.id \|\| null\)/)
  assert.match(contacts, /orderContacts\(next\.filter\(contact => contact\.is_active !== false\), 'All', ''\)\[0\]/)
  assert.match(contacts, /setSelectedId\(orderContacts\(remaining, category, query, ordering\)\[0\]\?\.id \|\| null\)/)
  // The scope-change site derives its ordering from the INCOMING scope.
  assert.match(contacts, /orderContacts\(nextScoped, category, query, scopeOrdering\(value\)\)/)
  // No selection site reads raw fetch order any more.
  assert.doesNotMatch(contacts, /setSelectedId\(directoryContacts\.find/)
})

test('profile action buttons share the approved portal look across all three surfaces', () => {
  const btn = read('src/components/ui/ProfileActionButton.jsx')
  // Enabled actions are solid nightfall (primary AND secondary), disabled is the grey ghost.
  assert.match(btn, /primary:\s+SOLID/)
  assert.match(btn, /secondary: SOLID/)
  assert.match(btn, /hoverBg: '#151c55'/)
  assert.match(btn, /background: '#eef0f4', color: '#9ca3af', border: '1px solid #d7dae4'/)
  assert.match(btn, /minHeight:\s+36/)
  assert.match(btn, /fontWeight:\s+700/)
  // Both staff surfaces use the shared button with the portal's lucide icons.
  const sidePanel = read('src/components/StudentSidePanel.jsx')
  const connect = read('src/components/connect/ContactsView.jsx')
  for (const src of [sidePanel, connect]) {
    assert.match(src, /icon=\{<Mail size=\{15\}/)
    assert.match(src, /icon=\{<Phone size=\{15\}/)
    assert.match(src, /icon=\{<Pencil size=\{15\}/)
  }
})

// ── NA-CONTACTS-POLISH-2: status bar, equal heights, LinkedIn ───────────────

test('Deactivate/Reactivate lives in a full-width bar at the card bottom, Connect-styled', () => {
  // Out of the hero action row...
  assert.doesNotMatch(contacts, /ptl-na-contact-action-deactivate/)
  assert.doesNotMatch(contacts, /ptl-na-contact-action-activate/)
  // ...into the bottom status bar, editor grant only, confirm flow kept.
  assert.match(contacts, /ptl-na-contact-status-bar/)
  assert.match(contacts, /ptl-na-contact-status-wide/)
  assert.match(contacts, /Deactivate Contact/)
  assert.match(contacts, /Reactivate Contact/)
  assert.match(contacts, /changeContactStatus\(selected\)/)
  // The Connect port: full width, resting muted, red on hover, navy reactivate.
  assert.match(css, /\.ptl-na-contact-status-wide \{[\s\S]{0,300}?width: 100%;/)
  assert.match(css, /\.ptl-na-contact-status-wide:hover:not\(:disabled\) \{ border-color: #dc2626; color: #dc2626; \}/)
  assert.match(css, /\.ptl-na-contact-status-wide-reactivate \{ border: 1\.5px solid var\(--nightfall/)
  // The old hero deactivate styles are gone from the stylesheet.
  assert.doesNotMatch(css, /ptl-na-contact-action-deactivate/)
  assert.doesNotMatch(css, /ptl-na-contact-action-activate/)
})

test('the list and detail cards stretch to the same height, scrolling internally', () => {
  assert.match(css, /\.ptl-na-contact-directory \{ display: grid;[^}]*align-items: stretch;/)
  assert.match(css, /\.ptl-na-contact-detail \{[\s\S]{0,200}?max-height: 68vh;/)
  assert.match(css, /\.ptl-na-contact-detail-body \{[^}]*flex: 1; overflow-y: auto;/)
  // Stacked mode releases the cap so the page scrolls naturally.
  assert.match(css, /\.ptl-na-contact-detail \{ max-height: none; min-height: 0; \}/)
})

test('LinkedIn: hero chip when stored, editor field, server-allowlisted', () => {
  // The chip mirrors the staff Connect profile (logo image, brand border, new tab).
  assert.match(contacts, /ptl-na-contact-linkedin/)
  assert.match(contacts, /linkedin-logo\.svg/)
  assert.match(contacts, /clean\(selected\.linkedin_url\)/)
  assert.match(contacts, /target="_blank" rel="noreferrer"/)
  assert.match(css, /\.ptl-na-contact-linkedin \{/)
  // The editor collects and validates it client-side, mirroring the server rule.
  assert.match(contacts, /LinkedIn URL/)
  assert.match(contacts, /linkedin_url: clean\(contact\?\.linkedin_url\)/)
  assert.match(contacts, /linkedinTrimmed\.includes\('linkedin\.com'\)/)
  assert.match(contacts, /linkedin_url: linkedinTrimmed/)
  // The portal endpoint reads and writes it.
  const endpoint = read('api/portal/academics-contacts.js')
  assert.match(endpoint, /'linkedin_url', 'avatar_url', 'is_active',/)
  assert.match(endpoint, /invalid_linkedin_url/)
})

// ── NA-CONTACTS-POLISH-3: program cards, chart labels, contacts chrome ──────

test('the Community Benefit program filters follow the canonical FilterKPICard treatment', () => {
  // Accents from the canonical palette, applied per card via CSS vars.
  assert.match(benefit, /const PROGRAM_ACCENTS = Object\.freeze\(\{/)
  assert.match(benefit, /'--ptl-na-program-tint': accent\.tint, '--ptl-na-program-solid': accent\.solid/)
  assert.match(css, /\.ptl-na-program-card \{[\s\S]{0,200}?border: 1px solid rgba\(29, 37, 103, 0\.06\); border-radius: 14px;/)
  assert.match(css, /background: var\(--ptl-na-program-tint, #f7f8fc\)/)
  assert.match(css, /\.ptl-na-program-card-active \{\s*\n\s*background: var\(--ptl-na-program-solid/)
})

test('a full-width chart bar yields room to its value label instead of overflowing', () => {
  assert.match(css, /\.ptl-na-chart-bar \{[^}]*flex-shrink: 1; \}/)
})

test('the Contacts chrome is consolidated: no heading block, controls in one row', () => {
  // The redundant heading (title + management copy + count) is gone; the
  // section keeps an accessible name.
  assert.doesNotMatch(contacts, /ptl-na-section-heading/)
  assert.doesNotMatch(contacts, /Manage the ASPIRE contact directory/)
  assert.doesNotMatch(contacts, /of \{directoryContacts\.length\} contacts/)
  assert.match(contacts, /<section className="ptl-na-contacts" aria-label="Contacts">/)
  // Add contact sits in the controls row between search and Copy visible emails.
  // NA-CONTACTS-SCOPE-2 order: Add contact, search, scope filter, copy, CSV.
  assert.match(contacts, /Add contact[\s\S]{0,1400}?ptl-na-contact-search[\s\S]{0,1400}?ptl-na-scope-filter[\s\S]{0,1400}?Copy visible emails[\s\S]{0,1400}?Download CSV/)
  // Show inactive is retired: the portal lists active contacts only, and the
  // deactivation copy points reactivation at staff Connect.
  assert.doesNotMatch(contacts, /Show inactive|showInactive/)
  assert.match(contacts, /contacts\.filter\(contact => contact\.is_active !== false\)/)
  assert.match(contacts, /reactivated from ASPIRE Connect/)
  assert.doesNotMatch(css, /ptl-na-show-inactive|ptl-na-contact-heading-actions/)
})

// ── NA-CONTACTS-POLISH-4: copy buttons on the contact card ──────────────────

test('email and phone carry Connect-parity copy buttons with the shared Tooltip', () => {
  assert.match(contacts, /import Tooltip from '\.\.\/\.\.\/components\/ui\/Tooltip'/)
  assert.match(contacts, /function ContactCopyButton\(\{ value, label \}\)/)
  assert.match(contacts, /navigator\.clipboard\.writeText\(value\)/)
  assert.match(contacts, /label=\{copied \? 'Copied!' : `Copy \$\{label\}`\}/)
  assert.match(contacts, /ContactCopyButton value=\{clean\(selected\.email\)\} label="email"/)
  assert.match(contacts, /ContactCopyButton value=\{clean\(selected\.phone\)\} label="phone"/)
  assert.match(css, /\.ptl-na-copy-value \{/)
})

// ── NA-CONTACTS-POLISH-5: scrollbar scrub indicator ─────────────────────────

test('dragging the list scrollbar floats a group indicator over the list center', () => {
  // Armed only by a press on the scrollbar gutter; cleared on mouseup.
  assert.match(contacts, /const SCRUB_EDGE_PX = 22/)
  assert.match(contacts, /event\.clientX < list\.getBoundingClientRect\(\)\.right - SCRUB_EDGE_PX/)
  assert.match(contacts, /window\.addEventListener\('mouseup', endScrub, \{ once: true \}\)/)
  // While armed, scroll reads the row at the list's vertical center.
  assert.match(contacts, /document\.elementFromPoint\(rect\.left \+ rect\.width \/ 2, rect\.top \+ rect\.height \/ 2\)/)
  assert.match(contacts, /closest\?\.\('\[data-scrub\]'\)/)
  // Every row and divider carries its group label.
  assert.match(contacts, /data-scrub=\{scrubGroupLabel\(contact, category, query\)\}/)
  assert.match(contacts, /data-scrub=\{item\.label\}/)
  // The label names what the active sort walks through.
  assert.match(contacts, /if \(category === 'Unit Leader'\) return contactUnitList\(contact\)\[0\] \|\| letter/)
  assert.match(contacts, /if \(category === 'All'\) return categoryPluralLabel\(primaryCategory\(contact\)\)/)
  // The indicator overlay: centered, thumb-gray, ignores the pointer.
  assert.match(contacts, /ptl-na-scrub-indicator/)
  assert.match(css, /\.ptl-na-scrub-indicator \{[\s\S]{0,300}?background: rgba\(107, 114, 128, 0\.55\)/)
  assert.match(css, /\.ptl-na-scrub-indicator \{[\s\S]{0,400}?pointer-events: none/)
})

// ── NA-BENEFIT-POLISH-1: export button + rate advisory placement ────────────

test('the portal export is the Settings Download CSV button, nightfall filled', () => {
  assert.match(benefit, /import \{ Download \} from 'lucide-react'/)
  assert.match(benefit, /className="ptl-na-export"[\s\S]{0,200}?<Download size=\{16\}/)
  assert.match(benefit, /'Download CSV'/)
  assert.doesNotMatch(benefit, /Download aggregate CSV/)
  // Nightfall fill mirroring .cb-button-primary.
  assert.match(css, /\.ptl-na-export \{[\s\S]{0,400}?background: var\(--nightfall, #1D2567\);/)
})

test('the missing-rate advisory sits at the BOTTOM of the report, after the quality sections', () => {
  const noteAt = benefit.indexOf('ptl-na-rate-note')
  assert.ok(noteAt > -1)
  assert.ok(noteAt > benefit.indexOf('na-review-heading'), 'note renders after Records for review')
  assert.ok(noteAt > benefit.indexOf('na-needs-data-heading'), 'note renders after Needs reporting data')
  assert.ok(noteAt > benefit.indexOf('ptl-na-kpis'), 'note no longer leads the page')
})

// ── CONTACTS-EDITOR-PARITY-1: Connect-parity card + sectioned editor ────────

test('the contact card mirrors Connect: full name, goes by, no category pill, subline', () => {
  // Full name leads; "goes by" appears when a distinct preferred name exists.
  assert.match(contacts, /<h3>\{clean\(selected\.full_name\) \|\| displayName\(selected\)\}<\/h3>/)
  assert.match(contacts, /goes by <strong>\{selected\.preferred_name\}<\/strong>/)
  // The category pill is gone from the hero; the role pill stays.
  assert.doesNotMatch(contacts, /ptl-na-contact-category/)
  assert.doesNotMatch(css, /\.ptl-na-contact-category/)
  assert.match(contacts, /ptl-na-contact-role/)
  // The per-category subline (organization / school / unit) sits under the pills.
  assert.match(contacts, /\{affiliationLine\(selected\) && <p className="ptl-na-contact-hero-affiliation">/)
  // Notes render on the card for editors only.
  assert.match(contacts, /\{canManageContacts && clean\(selected\.notes\) && \(/)
})

test('the editor follows the staff modal: photo, Category first and required, sections', () => {
  // Photo upload block on top, server-mediated (never a direct bucket write).
  assert.match(contacts, /ptl-na-contact-photo-upload/)
  assert.match(contacts, /uploadAcademicsContactAvatar\(\{ contactId: contact\?\.id \|\| null, file \}\)/)
  assert.doesNotMatch(contacts, /storage\s*\.from\(/)
  assert.match(contacts, /JPEG, PNG, or WebP · max 2 MB/)
  // Category is the first section, required, with the organizing helper.
  const catAt = contacts.indexOf('Category determines how this contact is organized')
  assert.ok(catAt > -1)
  assert.ok(catAt < contacts.indexOf('>Identity<'), 'Category section precedes Identity')
  assert.match(contacts, /<span>Category <span className="ptl-na-contact-required"/)
  assert.match(contacts, /option value="">Select category…<\/option>/)
  // The staff modal's section order.
  for (const [a, b] of [['>Identity<', '>Contact Information<'], ['>Contact Information<', '>Role and Affiliation<'], ['>Role and Affiliation<', '>Online Profile<'], ['>Online Profile<', '>Notes<']]) {
    assert.ok(contacts.indexOf(a) < contacts.indexOf(b), `${a} precedes ${b}`)
  }
  // Free text is a labeled option for every category (shared canon).
  assert.match(contacts, /Other \(free text\)/)
  // Notes ride the save payload; category is required for validity.
  assert.match(contacts, /notes: form\.notes,/)
  assert.match(contacts, /form\.full_name\.trim\(\) && form\.category/)
})

test('the portal endpoint gates notes to editors and accepts avatar_url writes', () => {
  const endpoint = read('api/portal/academics-contacts.js')
  assert.match(endpoint, /EDITOR_ONLY_FIELDS = Object\.freeze\(\['notes'\]\)/)
  assert.match(endpoint, /includeEditorFields: auth\.canManageContacts === true/)
  assert.match(endpoint, /'linkedin_url', 'avatar_url', 'notes',/)
  assert.match(endpoint, /invalid_avatar_url/)
})
