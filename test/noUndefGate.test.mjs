// test/noUndefGate.test.mjs
//
// THE INCIDENT THIS EXISTS BECAUSE OF, 2026-09-18.
//
// ScopePicker read `cohortIsDemo` twice in its body and never destructured it from
// props. Every render of the staff header threw "ReferenceError: cohortIsDemo is not
// defined", which took down the whole staff app, on every route, in a clean incognito
// window, for everyone. It reached production.
//
// It was two eslint errors away from being caught. `no-undef`, two occurrences, instant.
// The file was simply not linted, because linting was "the files I remembered to lint"
// rather than a gate.
//
// It was also invisible to everything else: the bundler does not resolve free variables,
// and 6657 tests passed while the app was completely broken, because none of them
// renders a component.
//
// So this runs eslint over src/ and fails if a single no-undef survives. A ZERO gate,
// not a ratchet, because src/ reached zero the day this was written and an undefined
// identifier in frontend code is never acceptable. A ratchet would permit the tenth one.
//
// WHY src/ AND NOT api/: api/ has 359 of these, almost all `process`, because Vercel
// functions run in Node and the config does not declare Node globals for them. That is
// pre-existing noise with a different cause, and folding it in here would mean starting
// at 359 and learning nothing. src/ is the browser, where a free variable is always a
// bug.
//
// TWO THINGS HAD TO BE FIXED to get src/ to zero, and both were real:
//   - StudentListPanel had a dead EmailCopyBtn rendering <Check> and <Copy>, neither
//     imported. It would have thrown the moment anyone used it. Deleted.
//   - src/lib/notifications/{index,recipients}.js use process.env and say "Server-side
//     only" in their own headers, but never declared the global every api/ file
//     declares. Declared.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ESLint } from 'eslint'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// ONE lint pass, shared by both tests. Spawning `npx eslint` twice cost 36 seconds on a
// suite that otherwise runs in 13, which is the kind of tax that gets a gate deleted.
// The ESLint API in-process does the same work in a fraction of it.
const report = await new ESLint({ cwd: root }).lintFiles(['src'])

test('no file in src/ references an undefined identifier', () => {
  const offenders = []
  for (const file of report) {
    for (const m of file.messages) {
      if (m.ruleId !== 'no-undef') continue
      offenders.push(`${file.filePath.replace(root + '/', '')}:${m.line}  ${m.message}`)
    }
  }

  assert.deepEqual(offenders, [],
    'An undefined identifier in src/ is a ReferenceError the moment that line runs, and ' +
    'neither the bundler nor this test suite will catch it. This is exactly how the ' +
    'staff app went down on 2026-09-18.\n\n' +
    'If the identifier is a legitimate runtime global (process in a server-only module ' +
    'under src/lib), declare it with /* global process */ as every api/ file does. ' +
    'Otherwise it is a missing import or a missing prop.\n\n' +
    offenders.map(o => '  ' + o).join('\n'))
})

test('the gate is real: eslint actually ran and saw the tree', () => {
  // A gate that silently lints nothing passes forever. The portal-split work in this
  // repo already shipped one of those, and it gave a false PASS.
  assert.ok(report.length > 200,
    `eslint reported on ${report.length} files; src/ has far more than that, so the ` +
    'gate above was not actually looking at the tree')

  const linted = report.map(r => r.filePath)
  assert.ok(linted.some(p => p.endsWith('src/components/Header/scope/ScopePicker.jsx')),
    'ScopePicker must be in the linted set; it is the file whose omission caused the incident')
})
