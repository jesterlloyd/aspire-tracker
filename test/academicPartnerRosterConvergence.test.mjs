// AP Phase visual convergence, Commit 2: the Academic Partner roster reuses the canonical status
// pill (ASPIRE_STATUS_CONFIG), the canonical Status Legend (staff disposition detail hidden), the
// Unit Leader circular avatar (secure resolved photo via the school-scoped file endpoint, initials
// fallback), and the canonical hours progress bar (deriveClinicalHours). Source guards + pure-helper
// tests.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { deriveClinicalHours } from '../src/lib/portalProgress.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const stripJs = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const portal = read('src/portal/AcademicPartnerPortal.jsx')
const portalCode = stripJs(portal)
const pill = read('src/components/StatusPill.jsx')
const legend = read('src/components/StatusLegendPopover.jsx')
const css = read('src/index.css')

test('the status column uses the canonical StatusPill (ASPIRE_STATUS_CONFIG), not a new palette', () => {
  assert.ok(existsSync(join(root, 'src/components/StatusPill.jsx')))
  assert.match(pill, /import \{ ASPIRE_STATUS_CONFIG \} from '\.\.\/lib\/constants'/)
  assert.match(pill, /const cfg = ASPIRE_STATUS_CONFIG\[status\] \|\| ASPIRE_STATUS_CONFIG\['Pending Outreach'\]/)
  assert.match(pill, /className="aspire-status-pill" style=\{\{ background: cfg\.bg, color: cfg\.text, borderColor: cfg\.border \}\}/)
  assert.match(pill, />\s*\{status\}\s*</)                                      // exact status text preserved
  assert.match(css, /\.aspire-status-pill \{/)
  // The roster renders it and drops the old soft chip.
  assert.match(portal, /<StatusPill status=\{s\.status\} \/>/)
  assert.doesNotMatch(portalCode, /ptl-chip ptl-chip-soft/)
  // No new status color system: the AP portal never hardcodes status hex colors.
  assert.doesNotMatch(portalCode, /#[0-9a-fA-F]{6}/)
})

test('the ASPIRE status header opens the canonical legend with staff disposition detail hidden', () => {
  // STATUS-LEGEND-AUDIENCE-1: showStaffDetail became audience="academic_partner".
  assert.match(portal, /sortKey="status"[\s\S]*?after=\{<StatusLegendPopover audience="academic_partner" \/>\}[\s\S]*?>\s*ASPIRE status\s*<\/SortHeader>/)
  // The legend gates the staff-only disposition breakdown behind audience === 'staff'
  // (default keeps the main app unchanged).
  assert.match(legend, /export default function StatusLegendPopover\(\{ position = 'bottom-left', dark = false, audience = 'staff' \}\)/)
  assert.match(legend, /\{staffDetail && \(/)
  assert.doesNotMatch(legend, /REASON_CATEGORIES/)                              // never the internal reasons
})

test('the legend is accessible: info-icon trigger, Escape close, and focus return to the trigger', () => {
  assert.match(legend, /aria-label="View status legend"/)
  assert.match(legend, /aria-expanded=\{isOpen\}/)
  assert.match(legend, /aria-label="Close status legend"/)
  assert.match(legend, /e\.key === 'Escape'/)
  // Focus returns to the trigger on close, without a setState-in-effect.
  assert.match(legend, /if \(wasOpen\.current && !isOpen\) triggerRef\.current\?\.focus\(\)/)
})

test('the Student cell reuses the circular avatar with a securely resolved photo and initials fallback', () => {
  assert.match(portal, /import UnitStudentAvatar from '\.\/unit\/UnitStudentAvatar'/)
  // Secure-photo fast-follow: photos are served through the school-scoped file-access endpoint, so
  // the avatar takes an already-resolved signed URL from the shared cache (or null => initials). No
  // raw storage path is ever exposed in the roster UI.
  assert.match(portal, /<UnitStudentAvatar url=\{photos\.peek\(s\.id\)\} name=\{displayName\(s\)\} size=\{40\} \/>/)
  const avatar = read('src/portal/unit/UnitStudentAvatar.jsx')
  assert.match(avatar, /function initials\(name\)/)
  assert.doesNotMatch(portalCode, /headshot_url|storage\.from|createSignedUrl|signed_url|getStudentFileUrl/)
})

test('the hours column uses the canonical progress bar with an accessible text equivalent', () => {
  assert.match(portal, /import \{ deriveClinicalHours \} from '\.\.\/lib\/portalProgress'/)
  assert.match(portal, /const h = deriveClinicalHours\(\{ required: hours\.required, approved: hours\.approved, pending: hours\.pending \}\)/)
  assert.match(portal, /if \(!h\.reliable\) return <span className="ptl-muted ptl-small">Not set<\/span>/)
  assert.match(portal, /<span className="ptl-mini-progress" role="img"/)
  assert.match(portal, /const complete = h\.completed >= h\.required/)
  assert.match(portal, /aria-label=\{`\$\{h\.completed\} of \$\{h\.required\} required hours approved\$\{complete \? '\. Hours complete' : ''\}\$\{pendingText\}`\}/)
  assert.match(portal, /<i style=\{\{ width: `\$\{h\.pct\}%` \}\} \/>/)          // width from the capped pct
  assert.match(portal, /\{complete && <span className="ptl-hours-complete">Hours complete<\/span>\}/)
  assert.match(portal, /<ApHoursCell hours=\{s\.hours\} \/>/)
})

test('deriveClinicalHours caps over-completion at 100% and never counts pending as approved', () => {
  // Over-completion: 60 of 40 required -> 100% (not 150), remaining 0.
  const over = deriveClinicalHours({ required: 40, approved: 60, pending: 0 })
  assert.equal(over.pct, 100)
  assert.equal(over.remaining, 0)
  // Normal, with pending kept separate (pending is not approved).
  const mid = deriveClinicalHours({ required: 100, approved: 25, pending: 10 })
  assert.equal(mid.pct, 25)
  assert.equal(mid.completed, 25)
  // Unreliable when required is missing or zero -> no bar.
  assert.equal(deriveClinicalHours({ required: 0, approved: 5 }).reliable, false)
  assert.equal(deriveClinicalHours({ required: null, approved: 5 }).reliable, false)
})

test('the Academic Partner roster keeps its Phase 1 columns and adds no drawer or later-phase surface', () => {
  for (const col of ['Student', 'Cohort', 'ASPIRE status', 'Confirmed unit', 'Primary preceptor', 'Rotation', 'Hours']) {
    assert.ok(portal.includes(col), `roster keeps the ${col} column`)
  }
  assert.doesNotMatch(portalCode, /onRowClick|openDrawer|StudentDetailDrawer|OnCampusNow|Needs Attention|ptl-detail-drawer/)
})
