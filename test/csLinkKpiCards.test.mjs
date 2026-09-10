// CS-LINK-KPI-1: Student Profiles swaps its KPI cards with the view, the CS-Link stage
// labels read "<thing> <state>", and the Profiles / CS-Link Access picker sits above the
// cards like the Rotation and Evaluation pickers.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { CS_LINK_STATUS_CONFIG } from '../src/lib/utils.js'
import { summarizeCsLink } from '../src/lib/derivations/csLink.js'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const spt = read('src/components/StudentProfilesTab.jsx')
const css = read('src/index.css')

test('CS-Link stage labels read thing, then state', () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(CS_LINK_STATUS_CONFIG).map(([k, v]) => [k, v.label])),
    {
      not_started: 'CS-Link Not Started',
      stage1_pending: 'Account Pending',
      account_active: 'Account Active',
      cslink_pending: 'CS-Link Pending',
      complete: '✓ CS-Link Active',
    })
  // The plain labels Keith and the KPI cards read (check glyph stripped).
  assert.deepEqual(summarizeCsLink([]).map(r => r.label),
    ['CS-Link Not Started', 'Account Pending', 'Account Active', 'CS-Link Pending', 'CS-Link Active'])
})

test('CS-Link Access shows the four stage cards, labelled and counted by summarizeCsLink', () => {
  const cards = [...spt.matchAll(/\{ status: '(\w+)', +urlKey: '([\w-]+)'/g)].map(m => [m[1], m[2]])
  assert.deepEqual(cards, [
    ['stage1_pending', 'account-pending'],
    ['account_active', 'account-active'],
    ['cslink_pending', 'cslink-pending'],
    ['complete', 'cslink-active'],
  ])
  assert.match(spt, /const csLinkCounts = useMemo\(\(\) => summarizeCsLink\(students\), \[students\]\)/)
  assert.match(spt, /\{view === 'access' \? CSLINK_CARDS\.map\(c => \(\s*\n\s*<FilterKPICard[^\n]*label=\{csLinkLabel\(c\.status\)\}/)
  assert.match(spt, /data-kpi-set=\{view === 'access' \? 'cslink' : 'pathway'\}/)
  assert.match(css, /\.profiles-kpis\[data-kpi-set="cslink"\] \{ grid-template-columns: repeat\(4, 1fr\); \}/)
})

test('the CS-Link filter is its own state, in the URL as a fixed key, cleared by the toolbar chip', () => {
  assert.match(spt, /useState\(\(\) => cslinkFromKey\(searchParams\.get\('cslink'\)\)\)/)
  assert.match(spt, /const changeCsLinkFilter = \(v\) => \{ setCsLinkFilter\(v\); updateUrl\(\{ cslink: cslinkToKey\(v\) \}\) \}/)
  assert.match(spt, /\{kpiFilterOn && \(\s*\n\s*<button onClick=\{clearKpiFilter\}/)
})

test('the Profiles / CS-Link Access picker sits above the KPI cards, not in the toolbar', () => {
  const picker = spt.indexOf("onClick={() => changeView('records')}")
  const kpis = spt.indexOf('className="profiles-kpis"')
  const toolbar = spt.indexOf('Unified toolbar')
  const split = spt.indexOf('Profiles: always-open split view')
  assert.ok(picker > 0 && picker < kpis, 'picker renders before the KPI strip')
  assert.ok(!spt.slice(toolbar, split).includes('changeView('), 'the toolbar no longer carries the view toggle')
  assert.equal((spt.match(/changeView\('access'\)/g) || []).length, 1, 'exactly one CS-Link Access button')
})
