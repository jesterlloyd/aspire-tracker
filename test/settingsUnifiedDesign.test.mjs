// SETTINGS-UNIFIED-DESIGN-1: static-source + pure-helper guards for the unified-design half of
// the Settings coherence pass (Knowledge Center, Preceptor Assignment Parity, Accounts & Access
// directory sorting). Companion to the settingsUnifiedIa suite (settingsSections/SettingsShell/
// GeneralPanel/AboutPanel), which this file does not touch.
// Run: node --test test/settingsUnifiedDesign.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

const kc = read('src/components/settings/KnowledgeCenterPanel.jsx')
const parity = read('src/components/settings/PreceptorParityPanel.jsx')
const shared = read('src/components/settings/accountsShared.jsx')
const dir = read('src/components/settings/AccountsDirectory.jsx')

// ── Knowledge Center: one state-filtering surface ──────────────────────────────

test('Knowledge Center unifies on FilterKPICard - MetricCard/FilterChip and STATE_CHIPS are gone', () => {
  assert.match(kc, /import \{ FilterKPICard \} from '\.\.\/KPIBand'/, 'must import FilterKPICard from KPIBand')
  assert.doesNotMatch(kc, /import MetricCard from '\.\.\/ui\/MetricCard'/, 'MetricCard import must be removed')
  assert.doesNotMatch(kc, /import FilterChip from '\.\.\/ui\/FilterChip'/, 'FilterChip import must be removed')
  assert.doesNotMatch(kc, /<MetricCard/, 'no MetricCard usage should remain')
  assert.doesNotMatch(kc, /<FilterChip/, 'no FilterChip usage should remain')
  assert.doesNotMatch(kc, /STATE_CHIPS/, 'STATE_CHIPS constant must be deleted')
})

test('Knowledge Center renders five FilterKPICard cards with the specified accents', () => {
  assert.match(kc, /<FilterKPICard/)
  assert.match(kc, /\{ key: 'all', accent: 'nightfall' \}/, 'missing nightfall accent for All')
  const stateAccents = { draft: 'dawn', active: 'sage', deprecated: 'lavender', archived: 'marina' }
  for (const [state, accent] of Object.entries(stateAccents)) {
    assert.match(kc, new RegExp(`${state}: '${accent}'`), `missing ${state} -> ${accent} accent mapping`)
  }
})

test('Knowledge Center cards drive stateFilter and reset the active card to all', () => {
  assert.match(kc, /setStateFilter\(f => \(f === c\.key \? 'all' : c\.key\)\)/, 'clicking the active card must reset to all')
  assert.match(kc, /active=\{stateFilter === c\.key\}/)
})

test('Knowledge Center KPI grid uses the specified layout', () => {
  assert.match(kc, /gridTemplateColumns: 'repeat\(auto-fit, minmax\(150px, 1fr\)\)'/)
  assert.match(kc, /gap: 10, marginBottom: 16/)
})

test('Knowledge Center keeps the rest of the surface intact', () => {
  assert.match(kc, /<Toolbar/, 'Toolbar (search + category + New Entry) must remain')
  assert.match(kc, /<DataTable/, 'DataTable must remain')
  assert.match(kc, /<KnowledgeEntryDrawer/, 'drawer flow must remain')
  assert.match(kc, /const allowed = isAdmin/, 'permissions guard must remain')
  assert.match(kc, /<StateBadge state=\{e\.state\} \/>/, 'StateBadge in rows must remain')
})

// ── Preceptor Assignment Parity: canonical chrome, distinct diagnostic copy ────

test('Preceptor Parity replaces local Stat cards with card-driven FilterKPICard filtering', () => {
  assert.doesNotMatch(parity, /function Stat\(/, 'local Stat component must be deleted')
  assert.doesNotMatch(parity, /<Stat /, 'no Stat usage should remain')
  assert.match(parity, /import \{ FilterKPICard \} from '\.\.\/KPIBand'/)
  assert.match(parity, /const \[parityFilter, setParityFilter\] = useState\('all'\)/)
  for (const accent of ['nightfall', 'sage', 'dawn', 'chroma', 'periwinkle']) {
    assert.match(parity, new RegExp(`accent: '${accent}'`), `missing ${accent} accent mapping`)
  }
  assert.match(parity, /setParityFilter\(f => \(f === c\.parity \? 'all' : c\.parity\)\)/, 'clicking the active card must reset to all')
})

test('Preceptor Parity KPI grid uses the specified layout', () => {
  assert.match(parity, /gridTemplateColumns: 'repeat\(auto-fit, minmax\(150px, 1fr\)\)'/)
  assert.match(parity, /gap: 10, marginBottom: 16/)
})

test('Preceptor Parity moves onto the canonical DataTable primitive', () => {
  assert.match(parity, /import DataTable from '\.\.\/ui\/DataTable'/)
  assert.match(parity, /<DataTable/)
  assert.doesNotMatch(parity, /<table/, 'the hand-rolled <table> must be gone')
  for (const label of ['Student', 'Current primary', 'Active-primary', 'Role / Status', 'Parity']) {
    assert.match(parity, new RegExp(`label: '${label.replace(/\//g, '\\/')}'`), `missing ${label} column`)
  }
})

test('Preceptor Parity keeps the diagnostic wording and pill labels verbatim', () => {
  assert.match(parity, /Read-only diagnostic over the <strong>union<\/strong>/, 'header paragraph must be preserved')
  assert.match(parity, /Mismatch, current primary changed since assignment foundation/)
  assert.match(parity, /Mismatch, current primary cleared since assignment foundation/)
  assert.match(parity, /Missing assignment, no active-primary row found/)
  assert.match(parity, /fontFamily: 'monospace'/, 'monospace id sub-lines must be preserved')
})

test('Preceptor Parity has a canonical loading row, an error state with Retry, and a canonical empty message', () => {
  assert.match(parity, /Loading parity…/)
  assert.match(parity, /Retry/)
  assert.match(parity, /onClick=\{loadParity\}/, 'Retry must re-run the extracted load function')
  assert.match(parity, /const loadParity = useCallback\(async \(\) => \{/, 'load function must be extracted for Retry')
  assert.match(parity, /No students match this parity filter\./)
  assert.match(parity, /No students with a current primary or an active-primary assignment\./)
})

test('Preceptor Parity stays strictly read-only', () => {
  assert.doesNotMatch(parity, /\.insert\(/, 'no writes: insert')
  assert.doesNotMatch(parity, /\.update\(/, 'no writes: update')
  assert.doesNotMatch(parity, /\.upsert\(/, 'no writes: upsert')
  assert.doesNotMatch(parity, /\.delete\(/, 'no writes: delete')
  assert.match(parity, /STRICT SCOPE/, 'the scope comment block must stay')
  assert.match(parity, /READ-ONLY: only \.select\(\) calls\. Writes NOTHING to any table/)
})

// ── Accounts & Access directory: alphabetical sorting ──────────────────────────

// compareAccountsByName is a pure function co-located in a .jsx file (it sits next to
// UserInitials, which uses JSX), so it can't be imported directly under plain `node --test`
// (no JSX loader is registered for this suite). Extracting its exact source and evaluating it
// keeps the test both runnable and honest to what's actually shipped.
const fnMatch = shared.match(/export function compareAccountsByName\(a, b\) \{[\s\S]*?\n\}/)
assert.ok(fnMatch, 'compareAccountsByName must be defined and exported from accountsShared.jsx')
const compareAccountsByName = Function(fnMatch[0].replace(/^export function/, 'return function'))()

test('compareAccountsByName sorts case-insensitively', () => {
  const a = { full_name: 'zed adams', email: 'z@x.com' }
  const b = { full_name: 'Amy Brooks', email: 'a@x.com' }
  assert.ok(compareAccountsByName(a, b) > 0, 'Amy should sort before zed regardless of case')
  assert.ok(compareAccountsByName(b, a) < 0)
})

test('compareAccountsByName trims whitespace before comparing', () => {
  const a = { full_name: '  Amy Brooks  ', email: 'a@x.com' }
  const b = { full_name: 'Amy Brooks', email: 'a@x.com' }
  assert.equal(compareAccountsByName(a, b), 0)
})

test('compareAccountsByName is accent-insensitive (sensitivity: base)', () => {
  // Same email on both sides isolates the name comparison from the email tie-break.
  const a = { full_name: 'Zoe Alvarez', email: 'same@x.com' }
  const b = { full_name: 'Zoë Alvarez', email: 'same@x.com' }
  assert.equal(compareAccountsByName(a, b), 0, 'accented and unaccented forms of the same name should tie')
})

test('compareAccountsByName tie-breaks on email when names match', () => {
  const a = { full_name: 'Sam Lee', email: 'sam.b@x.com' }
  const b = { full_name: 'Sam Lee', email: 'sam.a@x.com' }
  assert.ok(compareAccountsByName(a, b) > 0, 'sam.b should sort after sam.a')
  assert.ok(compareAccountsByName(b, a) < 0)
})

test('compareAccountsByName falls back to email when full_name is missing', () => {
  const a = { full_name: '', email: 'aaron@x.com' }
  const b = { full_name: 'Bianca Cruz', email: 'bianca@x.com' }
  assert.ok(compareAccountsByName(a, b) < 0, 'aaron@x.com (used as the name) should sort before Bianca Cruz')
})

test('compareAccountsByName is stable/pure for equal inputs', () => {
  const list = [
    { full_name: 'Carla Diaz', email: 'c@x.com' },
    { full_name: 'Ben Ortiz', email: 'b@x.com' },
    { full_name: '', email: 'a-noname@x.com' },
  ]
  const sorted = [...list].sort(compareAccountsByName).map(u => u.email)
  assert.deepEqual(sorted, ['a-noname@x.com', 'b@x.com', 'c@x.com'])
  // Re-running sort on the same input is deterministic (pure comparator).
  const sortedAgain = [...list].sort(compareAccountsByName).map(u => u.email)
  assert.deepEqual(sortedAgain, sorted)
})

test('AccountsDirectory imports compareAccountsByName and sorts both the staff and portal lists', () => {
  assert.match(dir, /import \{[^}]*compareAccountsByName[^}]*\} from '\.\/accountsShared'/)
  assert.match(dir, /\.sort\(compareAccountsByName\)/, 'at least one list must be sorted')
  const sortCount = (dir.match(/\.sort\(compareAccountsByName\)/g) || []).length
  assert.equal(sortCount, 2, 'both the staffUsers memo and the portalAccounts array must be sorted')
})

test('portal sort is applied after the expiring filter and before pagination slicing', () => {
  assert.match(
    dir,
    /const portalAccounts = \(portalData\.accounts \|\| \[\]\)\.filter\(r => !expiringOnly \|\| r\.expiring_soon === true\)\.sort\(compareAccountsByName\)/,
    'portalAccounts must filter by expiringOnly, then sort, before any slice(0, limit)'
  )
})
