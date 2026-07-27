// Portal context convergence, Commit 1: unified Nightfall role+scope headers. PortalShell exposes two
// header slots (a scope line after the role subtitle, and a right-aligned controls area) that each
// portal fills via createPortal. Redundant page-level "School · X" / "Unit · X" context rows are
// removed. Source-guard tests.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const stripJs = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const shell = read('src/portal/PortalShell.jsx')
const slots = read('src/portal/PortalHeaderSlots.jsx')
const ap = read('src/portal/AcademicPartnerPortal.jsx')
const plr = read('src/portal/ap/PlacementRequestsView.jsx')
const student = read('src/portal/StudentPortal.jsx')
const unit = read('src/portal/UnitLeaderPortal.jsx')

test('PortalShell renders the header scope + controls slots and provides them to children', () => {
  assert.ok(existsSync(join(root, 'src/portal/PortalHeaderSlots.jsx')))
  assert.match(shell, /import \{ PortalHeaderSlotsContext \} from '\.\/PortalHeaderSlots'/)
  assert.match(shell, /<span className="ptl-header-sub">\{title\}<span className="ptl-header-scope" ref=\{setScopeSlot\} \/><\/span>/)
  assert.match(shell, /<span className="ptl-header-controls" ref=\{setControlsSlot\} \/>/)
  assert.match(shell, /<PortalHeaderSlotsContext\.Provider value=\{\{ scopeSlot, controlsSlot \}\}>/)
})

test('PortalHeaderSlots exports scope + controls components that portal into the header', () => {
  assert.match(slots, /export function PortalHeaderScope\(/)
  assert.match(slots, /export function PortalHeaderControls\(/)
  assert.match(slots, /createPortal\(children, scopeSlot\)/)
  assert.match(slots, /createPortal\(children, controlsSlot\)/)
})

test('the Academic Partner Students view puts school scope + cohort picker in the header, not the page', () => {
  assert.match(ap, /import \{ PortalHeaderScope, PortalHeaderControls \} from '\.\/PortalHeaderSlots'/)
  assert.match(ap, /<PortalHeaderScope>\{schools\.length === 1 \? <> · \{school\.school_key\}<\/> : null\}<\/PortalHeaderScope>/)
  assert.match(ap, /<span className="ptl-header-ctl-label">Cohort<\/span>/)
  assert.match(ap, /<span className="ptl-header-ctl-label">School<\/span>/)  // multi-school selector
  // The redundant page-level school context row and the in-page picker block are gone.
  assert.doesNotMatch(stripJs(ap), /ptl-ap-schoolline/)
  assert.doesNotMatch(stripJs(ap), /School · <b>/)
  assert.doesNotMatch(stripJs(ap), /className="ptl-ap-pickers"/)
})

test('the Placement Requests view also carries school scope + cohort in the header, not the page', () => {
  assert.match(plr, /import \{ PortalHeaderScope, PortalHeaderControls \} from '\.\.\/PortalHeaderSlots'/)
  assert.match(plr, /<PortalHeaderScope>\{schools\.length === 1/)
  assert.doesNotMatch(stripJs(plr), /ptl-ap-schoolline/)
  assert.doesNotMatch(stripJs(plr), /School · <b>/)
})

test('the Student portal shows its school in the header subtitle and has no cohort switcher', () => {
  assert.match(student, /import \{ PortalHeaderScope \} from '\.\/PortalHeaderSlots'/)
  assert.match(student, /<PortalHeaderScope> · \{student\.school\}<\/PortalHeaderScope>/)
  // Students remain in one cohort: no header controls (no cohort picker) are rendered for them.
  assert.doesNotMatch(student, /PortalHeaderControls/)
  assert.doesNotMatch(stripJs(student), /htmlFor="[^"]*cohort"/)
})

test('the Unit Leader portal shows the unit in the header and removes the page-level Unit switcher', () => {
  assert.match(unit, /import \{ PortalHeaderScope, PortalHeaderControls \} from '\.\/PortalHeaderSlots'/)
  assert.match(unit, /unitKeys\.length === 1 && <PortalHeaderScope> · \{unitKeys\[0\]\}<\/PortalHeaderScope>/)
  // Multi-unit gets an authorized unit selector in the header, on unit-scoped views.
  assert.match(unit, /unitKeys\.length > 1 && UNIT_SCOPED_VIEWS\.includes\(view\)/)
  assert.match(unit, /<span className="ptl-header-ctl-label">Viewing<\/span>/)
  // The old page-level <UnitSwitcher> render and its import are gone.
  assert.doesNotMatch(stripJs(unit), /<UnitSwitcher /)
  assert.doesNotMatch(unit, /\bUnitSwitcher,/)
})
