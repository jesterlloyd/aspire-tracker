// test/useBeforeDefineRatchet.test.mjs
//
// HOME-1 (2026-09-25): a const read above its own declaration throws a ReferenceError (the
// temporal dead zone). In a component body that runs on every render, it takes the whole
// screen down. That shipped to the At a Glance preview: StaffApp read `activeTab` twelve
// lines above `const activeTab`, and every signed-in staff render hit the error boundary.
// noUndefGate cannot see it (the name IS defined, just later), the bundler cannot, and no
// source-reading test did.
//
// This is a RATCHET, like uiCanonRatchet: these files already use helpers before their
// declaration inside callbacks and effects, which is safe because those run later. The
// counts below were measured on 2026-09-25 with the fix in place. A new top-level read
// above a declaration raises the count and fails here; lower a number when you clean up.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ESLint } from 'eslint'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE = {
  'src/staff/StaffApp.jsx': 14,
  'src/components/OverviewTab.jsx': 0,
  'src/components/Keith.jsx': 1,        // handleSend, read in an effect and guarded
  'src/components/home/HomeBanner.jsx': 0,
  'src/components/home/Launcher.jsx': 0,
  'src/components/home/NeedsYou.jsx': 0,
  'src/components/home/TodayCard.jsx': 0,
  'src/components/home/PlacementCard.jsx': 0,
}

const eslint = new ESLint({
  cwd: root,
  overrideConfig: { rules: { 'no-use-before-define': ['error', { functions: false, classes: false, variables: true }] } },
})
const report = await eslint.lintFiles(Object.keys(BASELINE))

test('no new use-before-define in the staff shell and the home page', () => {
  const over = []
  for (const file of report) {
    const rel = file.filePath.replace(root + '/', '')
    const hits = file.messages.filter(m => m.ruleId === 'no-use-before-define')
    if (hits.length > BASELINE[rel]) {
      over.push(`${rel}: ${hits.length} (baseline ${BASELINE[rel]})\n    ` + hits.map(m => `${m.line}: ${m.message}`).join('\n    '))
    }
  }
  assert.deepEqual(over, [], 'A const read above its declaration throws on render. Move the read below the declaration.\n' + over.join('\n'))
})

test('the gate can fail: the exact bug it exists for is flagged', async () => {
  const [res] = await eslint.lintText(
    "export function App() {\n  const hide = activeTab === 'overview'\n  const activeTab = 'overview'\n  return hide\n}\n",
    { filePath: join(root, 'src/staff/Probe.jsx') })
  assert.ok(res.messages.some(m => m.ruleId === 'no-use-before-define' && /activeTab/.test(m.message)))
})
