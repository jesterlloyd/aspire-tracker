// STAFF-DEVICE-1 (2026-11-19): Student Profiles on a phone is list, then the full record; on a
// tablet it keeps the split. The layout follows the screen's width, never the device model.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const css = read('src/index.css')
const tab = read('src/components/StudentProfilesTab.jsx')
const hook = read('src/hooks/useMediaQuery.js')
const panel = read('src/components/StudentSidePanel.jsx')

test('the phone breakpoint is one number in JS and CSS', () => {
  const m = hook.match(/PHONE_MAX_WIDTH = ([\d.]+)/)
  assert.ok(m, 'PHONE_MAX_WIDTH is exported')
  assert.match(css, new RegExp(`@media \\(max-width: ${m[1].replace('.', '\\.')}px\\)`))
  assert.doesNotMatch(hook, /userAgent|navigator\.platform/, 'no device sniffing: width decides')
})

test('a phone shows the list, then the record with a way back', () => {
  assert.match(tab, /usePhoneLayout\(\)/)
  assert.match(tab, /profiles-phone-record/)
  assert.match(tab, /className="profiles-phone-back"/)
  assert.match(tab, /All Students/)
  assert.match(css, /\.profiles-phone:not\(\.profiles-phone-record\) \.profiles-panel-slide \{ display: none; \}/)
  // The record is the whole screen and takes the window's height, so the binder's own
  // scroller (and its index tabs) keep working.
  assert.match(css, /\.profiles-phone-record \.profiles-panel-slide \{[\s\S]*?flex: none;[\s\S]*?--profiles-phone-record-h/)
})

test('a tablet keeps the list and the record side by side', () => {
  const tablet = css.match(/@media \(min-width: 740px\) and \(max-width: 980px\) \{[\s\S]*?\n\}/)
  assert.ok(tablet, 'the tablet block exists')
  assert.match(tablet[0], /\.student-profiles-tab \.profiles-slide-container \{\s*\n\s*flex-direction: row;/)
  assert.match(tablet[0], /\.student-profiles-tab \.profiles-list-narrow \{\s*\n\s*flex: 0 0 clamp\(/)
})

test('Residency keeps the stacked split: the new rules are scoped to Student Profiles', () => {
  const phone = css.match(/@media \(max-width: 739\.98px\) \{\n  \.profiles-phone \.profiles-slide-container[\s\S]*?\n\}/)
  assert.ok(phone, 'the phone block exists')
  for (const rule of phone[0].split('\n').filter(l => /\{/.test(l) && !/^@media/.test(l))) {
    assert.match(rule, /\.profiles-phone/, `phone rule must be scoped: ${rule.trim()}`)
  }
  assert.match(css, /\.profiles-list-narrow \{\s*\n\s*min-width: 0;\s*\n\s*height: auto;\s*\n\s*max-height: 44vh;/)
})

test('the desktop toolbar is unchanged: the actions wrapper is display: contents', () => {
  assert.match(css, /\.profiles-toolbar-actions \{ display: contents; \}/)
})

test('a failed shift-log read cannot loop the binder (NO-LOOP-1)', () => {
  assert.match(panel, /const EMPTY_SHIFT_LOGS = \[\]/)
  assert.match(panel, /data: shiftLogs = EMPTY_SHIFT_LOGS/)
})
