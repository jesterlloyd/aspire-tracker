// ACCOUNTS-ACCESS-DIRECTORY-2: static guards for the server/auth half of the
// once-per-session last-login stamp. AuthContext (src/contexts/AuthContext.jsx)
// calls the tracked touch_my_last_login RPC exactly once per authenticated
// session, guarded by a ref, and never from refreshUserProfile. The migration
// (supabase/migrations/20260730000000_touch_my_last_login.sql) creates that
// RPC following the repo's function-hardening pattern and awaits the Owner SQL
// gate. get_my_profile (dashboard-created, untracked) is left untouched.
// Run: node --test test/accountsAccessDirectory2Server.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

const authCtx = read('src/contexts/AuthContext.jsx')
const mig = read('supabase/migrations/20260730000000_touch_my_last_login.sql')

test('AuthContext: touch_my_last_login is called once per session, guarded by a ref', () => {
  assert.match(authCtx, /const touchedLoginRef = useRef\(null\)/)
  assert.match(authCtx, /if \(touchedLoginRef\.current !== user\.id\) \{/)
  assert.match(authCtx, /touchedLoginRef\.current = user\.id/)
  assert.match(authCtx, /supabase\.rpc\('touch_my_last_login'\)/)
  // Reset on sign-out so the next session (same or different user) stamps again.
  assert.match(authCtx, /event === 'SIGNED_OUT'[\s\S]{0,400}touchedLoginRef\.current = null/)
})

test('AuthContext: the touch_my_last_login call swallows every error silently', () => {
  const start = authCtx.indexOf("supabase.rpc('touch_my_last_login')")
  const end = authCtx.indexOf('});', start) + '});'.length
  const call = authCtx.slice(start, end)
  assert.match(call, /\.then\(\(\{ error: touchError \}\) => \{/)
  assert.match(call, /console\.debug\(/, 'a missing-function error is logged at debug level only')
  assert.ok(!/console\.error/.test(call), 'the touch call must not use console.error')
  assert.ok(!/throw/.test(call), 'the touch call must not throw')
})

test('AuthContext: touch_my_last_login is never called from refreshUserProfile', () => {
  const start = authCtx.indexOf('const refreshUserProfile = useCallback(async () => {')
  assert.ok(start > -1, 'refreshUserProfile exists')
  const end = authCtx.indexOf('}, []);', start)
  const body = authCtx.slice(start, end)
  assert.ok(!body.includes('touch_my_last_login'), 'refreshUserProfile must not stamp last_login_at')
  // refreshUserProfile keeps calling get_my_profile exactly as before.
  assert.match(body, /supabase\.rpc\('get_my_profile'\)/)
})

test('AuthContext: get_my_profile call sites are unchanged (loadUserProfile + refreshUserProfile only)', () => {
  const matches = authCtx.match(/rpc\('get_my_profile'\)/g) || []
  assert.equal(matches.length, 2, 'exactly the two existing get_my_profile call sites remain')
  assert.match(authCtx, /get_my_profile is a dashboard-created RPC/, 'the stale comment is replaced with an honest one')
})

test('the migration file exists, is a fixed-search_path SECURITY DEFINER function', () => {
  assert.match(mig, /CREATE OR REPLACE FUNCTION public\.touch_my_last_login\(\)/)
  assert.match(mig, /RETURNS void/)
  assert.match(mig, /SECURITY DEFINER/)
  assert.match(mig, /SET search_path = public/)
})

test('the migration updates only the caller\'s own row via auth.uid(), with a 5-minute debounce', () => {
  assert.match(mig, /UPDATE public\.user_profiles/)
  assert.match(mig, /SET last_login_at = now\(\)/)
  assert.match(mig, /WHERE auth_user_id = auth\.uid\(\)/)
  assert.match(mig, /last_login_at IS NULL OR last_login_at < now\(\) - interval '5 minutes'/)
})

test('the migration revokes from PUBLIC/anon and grants EXECUTE to authenticated + service_role', () => {
  assert.match(mig, /REVOKE ALL ON FUNCTION public\.touch_my_last_login\(\) FROM PUBLIC, anon/)
  assert.match(mig, /GRANT EXECUTE ON FUNCTION public\.touch_my_last_login\(\) TO authenticated, service_role/)
})

test('the migration explains get_my_profile is untracked and does not alter it', () => {
  assert.match(mig, /get_my_profile is a dashboard-created RPC and is untracked/)
  assert.match(mig, /PHASE_0A_ACCESS_AUDIT\.md/)
  assert.match(mig, /does not alter it in any way/)
  assert.match(mig, /OWNER_SQL_GATE\.md/)
})

test('no em dash anywhere in the migration file', () => {
  const emDash = String.fromCharCode(0x2014)
  assert.ok(!mig.includes(emDash), 'no em dash')
})

test('no em dash in the AuthContext comments touched by this feature', () => {
  const emDash = String.fromCharCode(0x2014)
  const block = authCtx.slice(authCtx.indexOf('ACCOUNTS-ACCESS-DIRECTORY-2'), authCtx.indexOf('touchedLoginRef.current = null;') + 40)
  assert.ok(!block.includes(emDash), 'no em dash')
})
