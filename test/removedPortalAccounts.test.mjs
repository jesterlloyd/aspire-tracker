import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('listing removes deleted-login rows and counts without mutating retained data', async () => {
  const removed = [
    '244fb7c1-62c5-44a5-b6a3-764a3641d4c1',
    '8dea4b02-2a73-49ef-bb3b-894351973eab',
    '3c1f4c05-d1d0-4d42-9e54-b549440fe609',
    '220ec54e-d589-4239-af68-6cb5a09a68b5',
    '88ec7126-8303-40d5-9afb-ad838fcbbe97',
  ]
  const profiles = removed.map(id => ({ id, full_name: 'Removed', email: id + '@example.org',
    role: 'portal', auth_user_id: null, login_enabled: false, is_active: false }))
  profiles.push(
    { id: 'active', role: 'portal', auth_user_id: 'auth-active', login_enabled: true, is_active: true },
    { id: 'pending', role: 'portal', email: 'pending@example.org', auth_user_id: 'auth-pending', login_enabled: true, is_active: true },
    { id: 'revoked-kept', role: 'portal', auth_user_id: 'auth-kept', login_enabled: false, is_active: false },
    { id: 'regranted', role: 'portal', auth_user_id: null, login_enabled: false, is_active: false },
  )
  const grant = (id, revoked = true) => ({ id: 'grant-' + id, user_profile_id: id,
    role: 'student', granted_at: '2026-01-01', starts_at: '2026-01-01',
    revoked_at: revoked ? '2026-10-02' : null })
  const grants = [...removed.map(id => grant(id)), { ...grant(removed[2]), id: 'duplicate-history' },
    grant('active', false), grant('pending', false), grant('revoked-kept'), grant('regranted', false)]
  const tables = { user_profiles: profiles, user_role_grants: grants }
  const before = JSON.stringify(tables)
  const db = {
    auth: { getUser: async () => ({ data: { user: { id: 'owner-auth' } } }),
      admin: { listUsers: async () => ({ data: { users: [{ email: 'pending@example.org', invited_at: '2026-01-01' }] } }) } },
    from(table) {
      let rows = tables[table] || []
      const query = {
        select() { return query }, order() { return query }, limit() { return query },
        not() { return query },
        in(key, values) { rows = rows.filter(r => values.includes(r[key])); return query },
        eq(key, value) {
          if (table === 'user_profiles' && key === 'auth_user_id' && value === 'owner-auth') {
            rows = [{ id: 'owner', role: 'admin', is_owner: true, is_active: true }]
          } else rows = rows.filter(r => r[key] === value)
          return query
        },
        maybeSingle: async () => ({ data: rows[0] || null }),
        then(resolve, reject) { return Promise.resolve({ data: rows }).then(resolve, reject) },
      }
      return query
    },
  }
  globalThis.__removedAccountsDb = db
  const envKeys = ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_URL']
  const saved = envKeys.map(k => process.env[k])
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture'
  process.env.SUPABASE_URL = 'https://fixture.invalid'
  try {
    let source = readFileSync(new URL('../api/list-portal-access.js', import.meta.url), 'utf8')
    source = source.replace("import { createClient } from '@supabase/supabase-js'",
      'const createClient = () => globalThis.__removedAccountsDb')
    source = source.replace("'../src/lib/emailUtils.js'", JSON.stringify(new URL('../src/lib/emailUtils.js', import.meta.url).href))
    const { default: handler } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))
    const call = async query => {
      const res = { setHeader() {}, status(n) { this.code = n; return this }, json(body) { this.body = body; return this } }
      await handler({ method: 'GET', headers: { authorization: 'Bearer fixture' }, query }, res)
      assert.equal(res.code, 200)
      return res.body
    }
    const all = await call({})
    assert.deepEqual(all.accounts.map(r => r.user_profile_id), ['active', 'pending', 'revoked-kept', 'regranted'])
    assert.equal(all.total, 4)
    assert.equal(all.counts.all_grants, 4)
    assert.equal(all.counts.by_role.student, 4)
    assert.equal(all.counts.revoked, 1)
    assert.equal(all.pending.length, 1)
    assert.equal((await call({ search: 'Removed' })).total, 0)
    assert.equal((await call({ status: 'revoked' })).total, 1)
    assert.equal((await call({ limit: '1', offset: '1' })).accounts[0].user_profile_id, 'pending')
    assert.equal(JSON.stringify(tables), before, 'all profile/grant history is retained without writes')
    assert.ok(all.accounts.every(r => !('auth_user_id' in r)))
  } finally {
    delete globalThis.__removedAccountsDb
    envKeys.forEach((key, i) => { if (saved[i] === undefined) delete process.env[key]; else process.env[key] = saved[i] })
  }
})
