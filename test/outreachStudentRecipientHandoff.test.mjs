import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
const sidePanel = read('src/components/StudentSidePanel.jsx')
const outreach = read('src/components/connect/OutreachView.jsx')
const bulkComposer = read('src/components/connect/BulkManualComposer.jsx')

test('student profile Email handoff preserves school-first recipient sources', () => {
  assert.match(sidePanel, /email:\s+data\.school_email \|\| data\.personal_email \|\| null/)
  assert.match(sidePanel, /school_email:\s+data\.school_email \|\| null/)
  assert.match(sidePanel, /personal_email:\s+data\.personal_email \|\| null/)
  assert.doesNotMatch(sidePanel, /email:\s+data\.personal_email \|\| data\.school_email/)
})

test('legacy student route state fetches explicit email sources before resolving', () => {
  assert.match(outreach, /const studentHasDisplayInfo = !!\(\(effectiveStudent\?\.school_email \|\| effectiveStudent\?\.personal_email\)/)
  assert.match(outreach, /select\('id, first_name, last_name, preferred_first_name, personal_email, school_email/)
  assert.match(outreach, /effectiveStudent\?\.school_email[\s\S]*effectiveStudent\?\.personal_email[\s\S]*fetchedStudent\?\.personal_email/)
})

test('preview failures expose an actionable status instead of a generic unavailable message', () => {
  assert.match(outreach, /Preview request failed \(HTTP \$\{res\.status\}\)/)
  assert.match(outreach, /Preview request could not reach the server/)
  assert.match(bulkComposer, /Preview request failed \(HTTP \$\{res\.status\}\)/)
  assert.match(bulkComposer, /Preview request could not reach the server/)
})

test('draft actions are named for the preview they open, while final review keeps the send action', () => {
  assert.match(outreach, /Preview Email/)
  assert.match(bulkComposer, /Preview Email \(\{recipients\.length\}\)/)
  assert.match(outreach, /\{dmSendInFlight \? 'Sending…' : 'Send Email'\}/)
})
