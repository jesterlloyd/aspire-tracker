// test/shiftLogRemember.test.mjs
//
// SHIFT-LOG-REMEMBER-1 and SIGNIN-AUTOFILL-1 (Owner, 2026-11-05): a student typed a long
// school email on every QR scan and every sign-in.
//   * /shift-log runs signed in when the phone holds a Student Portal session, through
//     the portal tab's own endpoint (never a second set of shift-log rules), and falls
//     back to email entry on any refusal.
//   * the email that found an eligible student is remembered on the device, with Forget.
//   * the sign-in email is the password manager's username, and the set-password forms
//     carry the account email as one, so Face ID can fill both.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { classifyStorageKey } from '../src/lib/signOutCleanup.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

test('the remembered email survives guarded storage and only an @ address is kept', async () => {
  const store = new Map()
  globalThis.window = { localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  } }
  const m = await import('../src/lib/shiftLogDevice.js')
  assert.equal(m.readRememberedShiftEmail(), '')
  m.rememberShiftEmail('not-an-email')
  assert.equal(m.readRememberedShiftEmail(), '')
  m.rememberShiftEmail('  jpilla1@u.westcoastuniversity.edu ')
  assert.equal(m.readRememberedShiftEmail(), 'jpilla1@u.westcoastuniversity.edu')
  m.forgetShiftEmail()
  assert.equal(m.readRememberedShiftEmail(), '')
  // Blocked storage reads as nothing remembered, never a throw.
  globalThis.window = { localStorage: { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') }, removeItem() { throw new Error('blocked') } } }
  assert.equal(m.readRememberedShiftEmail(), '')
  assert.doesNotThrow(() => m.rememberShiftEmail('a@b.c'))
  assert.doesNotThrow(() => m.forgetShiftEmail())
  delete globalThis.window
})

test('the key is classified, and survives sign-out as public', () => {
  assert.equal(classifyStorageKey('aspire.shiftLog.email')?.cls, 'public')
})

test('/shift-log tries the session first through the portal endpoint, then falls back to email', () => {
  const page = read('src/components/shift-log-lifecycle/ShiftLogLifecycle.jsx')
  assert.match(page, /import \{ postShiftLifecycle, shiftLifecycleTransport \} from '\.\.\/\.\.\/lib\/myShiftLifecycleApi'/)
  assert.match(page, /useState\('session_check'\)/)
  assert.match(page, /if \(!cancelled && !ok\) setPhase\('email_entry'\)/)
  assert.match(page, /if \(!res\.ok\) return false/)
  // The signed-in path writes through the transport; the email path keeps the plain POST.
  assert.match(page, /transport=\{checkInTransport\}/)
  assert.match(page, /transport=\{checkOutTransport\}/)
  assert.match(page, /presetStudent=\{studentData\} transport=\{pastShiftTransport\}/)
  assert.match(page, /inSession \? shiftLifecycleTransport\('check_in', studentId\) : null/)
  // Remember only an email that found someone who can log shifts.
  assert.match(page, /if \(r\?\.found && r\.eligible\) \{ rememberShiftEmail\(trimmedEmail\)/)
  // The browser never sends a school email on the session path.
  assert.match(read('src/lib/myShiftLifecycleApi.js'), /const \{ school_email: dropped, \.\.\.rest \} = payload/)
})

test('the email screen offers Forget for a remembered email', () => {
  const view = read('src/components/shift-log-lifecycle/EmailEntryView.jsx')
  assert.match(view, /remembered && onForget &&/)
  assert.match(view, /Forget this email/)
})

test('sign-in email is the username; set-password forms carry one', () => {
  assert.match(read('src/pages/Login.jsx'), /id="lg-email"[\s\S]{0,200}autoComplete="username"/)
  for (const p of ['src/pages/ActivateAccountPage.jsx', 'src/pages/ResetPasswordPage.jsx']) {
    assert.match(read(p), /<form onSubmit=\{handleSubmit\}[^\n]*\n\s*<KeychainUsername \/>/, p)
  }
  assert.match(read('src/components/KeychainUsername.jsx'), /autoComplete="username"[^>]*readOnly/)
})
