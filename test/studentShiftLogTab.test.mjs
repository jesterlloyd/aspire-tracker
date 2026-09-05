// test/studentShiftLogTab.test.mjs
//
// STUDENT-SHIFT-TAB-1 (Owner decision, 2026-09-05): shift logging inside the Student Portal
// with the session as identity. Pins the endpoint's authorization boundary, the delegation
// to the public handlers (one implementation of the rules), the client transport that never
// sends an email, the views' portal mode, the fourth tab and its routes, and the canon text.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const strip = (t) => t.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const endpoint = read('api/portal/my-shift-lifecycle.js')
const endpointCode = strip(endpoint)
const transport = read('src/lib/myShiftLifecycleApi.js')
const tab = read('src/portal/StudentShiftLog.jsx')
const nav = read('src/portal/PortalNav.jsx')
const app = read('src/portal/PortalApp.jsx')
const home = read('src/portal/StudentPortal.jsx')

test('the endpoint authorizes exactly like the other portal shift endpoint: JWT, student grant, active links', () => {
  assert.match(endpointCode, /const auth = await verifyPortalCaller\(req\)/)
  assert.match(endpointCode, /hasActiveRoleGrant\(db, profileId, 'student'\)/)
  assert.match(endpointCode, /const allowlist = await getActiveStudentLinks\(db, profileId\)/)
  assert.match(endpointCode, /if \(allowlist\.length === 0\) return res\.status\(403\)/)
  // A named student outside the allowlist is answered like one that does not exist.
  assert.match(endpointCode, /if \(!allowlist\.includes\(requestedId\)\) return res\.status\(404\)\.json\(\{ error: 'not_found' \}\)/)
  // The client's school_email is discarded before anything reads it; the server resolves its own.
  assert.match(endpointCode, /const \{ action, student_id: requestedId, school_email: clientEmail, \.\.\.intake \} = raw/)
  assert.match(endpointCode, /\.select\('id, school_email'\)\s*\.eq\('id', studentId\)/)
  assert.match(endpointCode, /body: \{ \.\.\.intake, school_email: schoolEmail \}/)
  // The lookup answer never carries the email back to the browser.
  assert.match(endpointCode, /const \{ school_email: dropped, \.\.\.safe \} = result\.student/)
  // Identity is pinned end to end: the record the email resolves to must be the allowlisted one,
  // for the lookup AND before any delegated write (security review, 2026-09-05).
  assert.match(endpointCode, /const result = await lookupStudentByEmail\(schoolEmail\)\s*if \(result\.student && result\.student\.id !== studentId\) \{\s*return res\.status\(409\)\.json\(\{ error: 'identity_mismatch' \}\)/)
  const pin = endpointCode.indexOf("error: 'identity_mismatch'"); const del = endpointCode.indexOf('const run = await delegate(action)')
  assert.ok(pin > 0 && del > pin, 'the identity pin runs before any delegated write')
  // Cache posture matches the manage endpoint.
  assert.match(endpointCode, /res\.setHeader\('Cache-Control', 'no-store, private'\)/)
})

test('every write is delegated to the public handler, so the rules exist once', () => {
  for (const f of ['check-in', 'check-out', 'submit-past-shift']) {
    assert.match(endpoint, new RegExp(`await import\\('\\.\\./shift-log/${f}\\.js'\\)`), `delegates ${f}`)
  }
  // Lazy, so the throttle's import-time pepper requirement never makes this module unloadable.
  assert.doesNotMatch(endpoint, /^import .* from '\.\.\/shift-log\//m)
  assert.doesNotMatch(endpoint, /^import .* from '\.\.\/lib\/publicRateLimit\.js'/m)
  // The delegated request carries the caller's own headers and socket (the throttle keys on them).
  assert.match(endpointCode, /headers: req\.headers,\s*socket: req\.socket,/)
  // The public page's wildcard CORS header never reaches an authenticated response.
  assert.match(endpointCode, /\/\^access-control-\/i\.test\(String\(name\)\)/)
  assert.match(endpointCode, /return await run\(delegated, withoutCors\(res\)\)/)
  // Nothing here inserts, updates, or calls an RPC itself.
  assert.doesNotMatch(endpointCode, /\.insert\(|\.update\(|\.rpc\(/)
})

test('the browser transport carries the session token and never a school email', () => {
  assert.match(transport, /authorization: `Bearer \$\{token\}`/)
  assert.match(transport, /const \{ school_email: dropped, \.\.\.rest \} = payload \|\| \{\}/)
  assert.match(transport, /const ENDPOINT = '\/api\/portal\/my-shift-lifecycle'/)
  assert.doesNotMatch(transport, /\/api\/shift-log\//)
})

test('the lifecycle views take a transport and drop their email affordances inside the portal', () => {
  for (const hook of ['useCheckIn', 'useCheckOut']) {
    const src = read(`src/components/shift-log-lifecycle/${hook}.js`)
    assert.match(src, new RegExp(`export function ${hook}\\(transport = null\\)`))
    assert.match(src, /transport\?\.send\s*\?\s*await transport\.send\(payload, controller\.signal\)/)
  }
  assert.match(read('src/components/shift-log-lifecycle/CheckInView.jsx'), /\{onDifferentEmail && <button/)
  assert.match(read('src/components/shift-log-lifecycle/CheckOutView.jsx'), /\{onDifferentEmail && \(/)
  const result = read('src/components/shift-log-lifecycle/LifecycleResultView.jsx')
  assert.equal((result.match(/\{onTryDifferentEmail && <button/g) || []).length, 5)
  const page = read('src/components/ShiftLogPage.jsx')
  assert.match(page, /presetStudent = null, transport = null, embedded = false/)
  assert.match(page, /useState\(presetStudent \? 'form' : 'email'\)/)
  assert.match(page, /if \(!embedded\) document\.title = 'ASPIRE Shift Log'/)
  assert.match(page, /transport\?\.send\s*\?\s*await transport\.send\(payload\)/)
  // The public page's own behaviour is untouched: no transport means the plain POST.
  assert.match(page, /await fetch\('\/api\/shift-log\/submit-past-shift'/)
})

test('the tab opens on the truth (open shift or not), hides in staff preview, and never asks for an email', () => {
  assert.match(tab, /postShiftLifecycle\('lookup', \{\}, \{ studentId: id \}\)/)
  assert.match(tab, /setPhase\(data\.open_shift \? 'check_out' : 'check_in'\)/)
  assert.match(tab, /if \(readOnlyPreview\)/)
  assert.match(tab, /onTryDifferentEmail=\{null\}/)
  assert.doesNotMatch(tab, /EmailEntryView|onDifferentEmail=/)
  assert.match(tab, /useRegisterPortalRefresh\(refresh, active && !readOnlyPreview\)/)
  // Several linked records: the server's own allowlist answer drives the picker.
  assert.match(tab, /data\.error === 'student_required'/)
  assert.match(tab, /shiftLifecycleTransport\('check_in', studentId\)/)
  assert.match(tab, /shiftLifecycleTransport\('check_out', studentId\)/)
  assert.match(tab, /shiftLifecycleTransport\('past_shift', studentId\)/)
})

test('the fourth tab, its routes, and the Home button all lead to the same place', () => {
  assert.match(nav, /data-tour="portal-nav-shiftlog"/)
  assert.match(nav, /<span className="ptl-nav-label">Shift Log<\/span>/)
  assert.match(nav, /onShiftLog, messagesEnabled = true/)
  assert.match(app, /const StudentShiftLog = lazy\(\(\) => import\('\.\/StudentShiftLog'\)\)/)
  assert.match(app, /location\.pathname\.startsWith\('\/portal\/shift-log'\) \|\| location\.pathname\.startsWith\('\/portal\/student\/shift-log'\) \? 'shiftlog'/)
  assert.match(app, /const goShiftLog = useCallback\(\(\) => navigate\(staffPreview \? '\/portal\/student\/shift-log' : '\/portal\/shift-log'\)/)
  assert.match(app, /onShiftLog=\{goShiftLog\}/)
  assert.match(app, /onOpenShiftLog=\{goShiftLog\}/)
  assert.match(app, /<StudentShiftLog active readOnlyPreview=\{staffPreview\} \/>/)
  assert.match(home, /onClick=\{\(\) => onOpenShiftLog\?\.\(\)\}/)
  assert.doesNotMatch(home, /href="\/shift-log"/)
  // The public page is not retired.
  assert.match(read('src/App.jsx'), /<Route path="\/shift-log\/\*"/)
})

test('CLAUDE.md carries the delegation rule', () => {
  const canon = read('CLAUDE.md')
  for (const must of ['STUDENT-SHIFT-TAB-1', 'my-shift-lifecycle.js', 'never re-implement the shift-log rules']) {
    assert.ok(canon.includes(must), `CLAUDE.md names ${must}`)
  }
})
