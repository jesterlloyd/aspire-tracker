// Commit 2: the Unit Leader Add Preceptor modal converges on the canonical main-app modal
// (PreceptorFormModal): same title, labels, placeholders, field grid, and footer button pairing.
// The Unit Leader write path (portal RPC, unit-scope authorization) is unchanged, and the canonical
// Notes field is intentionally omitted because the create_unit_preceptor RPC does not accept notes.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const stripJs = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const modal = read('src/portal/unit/UnitPreceptorCreateModal.jsx')
const modalCode = stripJs(modal)
const canonical = read('src/components/PreceptorFormModal.jsx')
const manager = read('src/portal/unit/UnitLeaderPreceptorManager.jsx')
const api = read('api/portal/unit-preceptor-manage.js')
const portalCss = read('src/portal/portal.css')

// ── canonical title, labels, placeholders ─────────────────────────────────────
test('the modal uses the canonical title, labels, and placeholders', () => {
  assert.match(modal, /<h2 id="ul-create-preceptor-title">Add Preceptor<\/h2>/)
  // Labels match the canonical modal wording (rendered uppercase by .form-label).
  assert.match(modal, /Full Name \*/)
  assert.match(modal, /Email \*/)
  assert.match(modal, />Phone</)
  assert.match(modal, />Unit</)
  assert.match(modal, />Shift Type</)
  // Placeholders match the canonical modal exactly.
  assert.match(modal, /placeholder="Jane Smith"/)
  assert.match(modal, /placeholder="jane\.smith@cshs\.org"/)
  assert.match(modal, /placeholder="\(310\) 555-0000"/)
  assert.match(modal, /<option value="">Select unit…<\/option>/)
})

// ── Add Preceptor action copy everywhere ──────────────────────────────────────
test('every create action reads "Add Preceptor", never "Create preceptor"', () => {
  assert.match(modal, />\s*\{saving \? 'Saving…' : 'Add Preceptor'\}/)
  assert.doesNotMatch(modalCode, /Create [Pp]receptor/)
  assert.doesNotMatch(modalCode, /Add preceptor/)   // no lowercase-p variant
  assert.doesNotMatch(modalCode, /Creating/)
})

// ── canonical modal / form / footer primitives are reused ─────────────────────
test('the modal reuses the canonical modal, form, and button classes', () => {
  assert.match(modal, /className="modal-overlay"/)
  assert.match(modal, /className="modal"/)
  assert.match(modal, /className="modal-header"/)
  assert.match(modal, /className="modal-body"/)
  assert.match(modal, /className="modal-footer"/)
  assert.match(modal, /className="form-field"/)
  assert.match(modal, /className="form-grid form-grid-2"/)
  assert.match(modal, /className="form-input"/)
  assert.match(modal, /className="form-select"/)
  // Footer pair shares the .btn base, so Cancel cannot render larger than the primary.
  assert.match(modal, /className="btn btn-outline-modal"[^>]*>Cancel</)
  assert.match(modal, /className="btn btn-primary"/)
  // The portal-only modal classes are gone.
  assert.doesNotMatch(modal, /ptl-modal|ptl-form-grid|ptl-btn|ptl-input/)
})

// ── autofocus + Escape / backdrop / close-button behavior ─────────────────────
test('focus and close behavior match the portal dialog conventions', () => {
  assert.match(modal, /autoFocus/)                                   // Full Name autofocuses
  assert.match(modal, /event\.key === 'Escape'/)                     // Escape closes
  assert.match(modal, /className="modal-overlay" onMouseDown=\{close\}/) // backdrop closes
  assert.match(modal, /onMouseDown=\{event => event\.stopPropagation\(\)\}/) // inner click does not
  assert.match(modal, /className="modal-close" onClick=\{close\}/)   // the × closes
  assert.match(modal, /role="dialog" aria-modal="true" aria-labelledby="ul-create-preceptor-title"/)
})

// ── supported payload fields only; Notes is never silently discarded ──────────
test('only the RPC-supported fields are collected, and Notes is absent', () => {
  // The create_unit_preceptor RPC accepts exactly these and no notes column.
  for (const field of ['full_name', 'email', 'phone', 'unit_key', 'shift']) {
    assert.ok(modalCode.includes(field), field)
  }
  // Scope to the create_preceptor branch: it forwards no p_notes (the set_secondary branch does).
  const createBranch = api.slice(api.indexOf("action === 'create_preceptor'"), api.indexOf('} else {'))
  assert.match(createBranch, /p_full_name: body\.full_name/)
  assert.doesNotMatch(createBranch, /p_notes/)
  // The modal shows no Notes control (which would be discarded on save). Scan code, not the comment
  // that documents the omission.
  assert.doesNotMatch(modalCode, /Notes/)
  assert.doesNotMatch(modalCode, /textarea/)
})

// ── the Unit Leader write path and authorization are unchanged ────────────────
test('the Unit Leader create path stays scoped and portal-mediated', () => {
  assert.match(modal, /createUnitPreceptor/)
  assert.match(modal, /unitKeys\.map\(unit =>/)       // only the leader's authorized units
  assert.match(api, /action === 'create_preceptor'/)
  assert.match(api, /rpc = 'create_unit_preceptor'/)
  assert.doesNotMatch(modalCode, /from\('units'\)|PreceptorFormModal|supabase/)
})

// ── footer button sizing parity (create modal + assignment manager) ───────────
test('paired footer buttons share one baseline and height', () => {
  // The stray standalone top-margin on .ptl-btn is neutralized inside modal footers so the outline
  // Cancel cannot sit taller than the confirm action (Change Primary / End role).
  assert.match(portalCss, /\.ptl-modal-actions > button \{ margin-top: 0; \}/)
  // The assignment manager keeps its equal 44px touch target and its confirm/cancel pairing.
  assert.match(portalCss, /\.ptl-asn-actions button \{ min-height: 44px; \}/)
  assert.match(manager, /className="ptl-modal-actions ptl-asn-actions"/)
  assert.match(manager, /className="ptl-btn-outline"[^>]*>Cancel</)
})

// ── Manage Preceptor Assignments semantics unchanged ──────────────────────────
test('the assignment manager behavior is untouched', () => {
  assert.match(manager, /intent\.action === 'change_primary'/)
  assert.match(manager, /\? 'Change Primary' : 'Assign Primary'/)
})

// ── the canonical main-app Add Preceptor modal is unchanged ───────────────────
test('PreceptorFormModal (main app) keeps its structure and its Notes field', () => {
  assert.match(canonical, /\{initialData \? 'Edit Preceptor' : 'Add Preceptor'\}/)
  assert.match(canonical, /placeholder="Optional notes…"/)     // main-app modal still has Notes
  assert.match(canonical, /supabase\.from\('preceptors'\)\.insert/)
  assert.match(canonical, /className="btn btn-outline-modal"/)
  assert.match(canonical, /className="btn btn-primary"/)
})
