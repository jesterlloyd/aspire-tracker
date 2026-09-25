// test/s16AvatarUploadsServerOnly.test.mjs
//
// S-16: every avatar write goes through the server, and avatar_url is only ever a file in
// ASPIRE's own Storage.
//
//   * SWEEP: no file under src/ uploads to, or builds a public URL for, the avatars or
//     contact-avatars bucket, calls update_my_avatar, or writes user_profiles.avatar_url
//     from the browser. A new browser writer fails the suite.
//   * the one rule (api/lib/avatarImage.js): what an avatar_url may be.
//   * the two new endpoints, through their factories, with the auth and db mocked.
//   * the three value writers (contacts-upsert, academics-contacts, admin-users) call the
//     rule; the two upload clients post to the server.
//   * the migration, on real Postgres (PGlite): the column grant, the RPC grant and the
//     bucket write policies go; the read policy and the other column grants stay; every
//     audit section is executable and POST 1 to 3 say what the file says they say.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import {
  isOwnAvatarStorageUrl, validateAvatarUrlChange, decodeImageBody, sniffImageType, storagePublicOrigin,
} from '../api/lib/avatarImage.js'
import { createMyAvatarHandler } from '../api/my-avatar.js'
import { createContactAvatarUploadHandler } from '../api/contact-avatar-upload.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

const MIGRATION_PATH = 'supabase/migrations/20261001000000_s16_avatar_writes_server_only.sql'
const AUDIT_PATH = 'db/audit/s16_avatar_writes_server_only_checks.sql'
const migration = read(MIGRATION_PATH)
const audit = read(AUDIT_PATH)

const ORIGIN = 'https://abcdefghijkl.supabase.co'
const OWN_AVATAR = `${ORIGIN}/storage/v1/object/public/avatars/11111111-1111-1111-1111-111111111111/avatar.jpg?v=1700000000000`
const OWN_CONTACT = `${ORIGIN}/storage/v1/object/public/contact-avatars/22222222-2222-4222-8222-222222222222-1700000000000.png`

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (/ \d\.(jsx?|mjs)$/.test(name)) continue // the untracked " 2." duplicates
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (['.js', '.jsx'].includes(extname(name))) out.push(p)
  }
  return out
}

// ── SWEEP ───────────────────────────────────────────────────────────────────

test('SWEEP: no browser file writes an avatar bucket, calls update_my_avatar, or writes avatar_url itself', () => {
  const offenders = []
  for (const file of walk(join(root, 'src'))) {
    const code = stripComments(readFileSync(file, 'utf8'))
    const rel = file.slice(root.length + 1)
    if (/storage\s*\.from\(\s*['"`](avatars|contact-avatars)['"`]\s*\)/.test(code)) offenders.push(`${rel}: storage.from(<avatar bucket>)`)
    if (/['"`](avatars|contact-avatars)['"`][^\n]*\.(upload|createSignedUploadUrl|uploadToSignedUrl)\(/.test(code)) offenders.push(`${rel}: upload to an avatar bucket`)
    if (/rpc\(\s*['"`]update_my_avatar['"`]/.test(code)) offenders.push(`${rel}: rpc('update_my_avatar')`)
    if (/from\(\s*['"`]user_profiles['"`]\s*\)\s*\.update\(\s*\{[^}]*avatar_url/.test(code)) offenders.push(`${rel}: browser update of user_profiles.avatar_url`)
  }
  assert.deepEqual(offenders, [], 'avatar writes belong to the server:\n' + offenders.join('\n'))
})

// ── The rule ────────────────────────────────────────────────────────────────

test('an avatar_url is empty, or a public object in one of the two avatar buckets on this project, and nothing else', () => {
  const opts = { origin: ORIGIN }
  assert.equal(isOwnAvatarStorageUrl('', opts), true)
  assert.equal(isOwnAvatarStorageUrl(null, opts), true)
  assert.equal(isOwnAvatarStorageUrl(OWN_AVATAR, opts), true)
  assert.equal(isOwnAvatarStorageUrl(OWN_CONTACT, opts), true)
  for (const bad of [
    'https://evil.example/avatars/x.jpg',
    `${ORIGIN}/storage/v1/object/public/student-files/c/s/headshot.jpg`,
    `${ORIGIN}/storage/v1/object/sign/avatars/x.jpg`,
    `${ORIGIN}/storage/v1/object/public/avatars/`,
    `${ORIGIN}/storage/v1/object/public/avatars/../contact-avatars/x.jpg`,
    `${ORIGIN}/storage/v1/object/public/avatars/x.jpg?redirect=1`,
    `${ORIGIN}/storage/v1/object/public/avatars/x.jpg#frag`,
    `http://abcdefghijkl.supabase.co/storage/v1/object/public/avatars/x.jpg`,
    'javascript:alert(1)',
    'data:image/png;base64,iVBORw0KGgo=',
    'not a url',
    42,
    'a'.repeat(700),
  ]) {
    assert.equal(isOwnAvatarStorageUrl(bad, opts), false, `refused: ${String(bad).slice(0, 60)}`)
  }
  // No configured origin means nothing non-empty can be trusted.
  assert.equal(isOwnAvatarStorageUrl(OWN_AVATAR, { origin: '' }), false)
  assert.equal(storagePublicOrigin({ VITE_SUPABASE_URL: `${ORIGIN}/` }), ORIGIN)
  assert.equal(storagePublicOrigin({}), '')
})

test('a change is validated; an unchanged stored value passes so legacy rows keep saving', () => {
  const opts = { origin: ORIGIN }
  assert.deepEqual(validateAvatarUrlChange(undefined, 'https://legacy.example/p.jpg', opts), { ok: true, value: undefined })
  assert.deepEqual(validateAvatarUrlChange('https://legacy.example/p.jpg', 'https://legacy.example/p.jpg', opts), { ok: true, value: 'https://legacy.example/p.jpg', unchanged: true })
  assert.equal(validateAvatarUrlChange('https://legacy.example/other.jpg', 'https://legacy.example/p.jpg', opts).ok, false)
  assert.deepEqual(validateAvatarUrlChange('', 'https://legacy.example/p.jpg', opts), { ok: true, value: '' })
  assert.deepEqual(validateAvatarUrlChange(`  ${OWN_CONTACT} `, null, opts), { ok: true, value: OWN_CONTACT })
  assert.equal(validateAvatarUrlChange({ url: OWN_CONTACT }, null, opts).ok, false)
})

test('decodeImageBody: fixed type map, decoded-size cap, magic bytes', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
  assert.equal(sniffImageType(png), 'image/png')
  assert.equal(sniffImageType(jpg), 'image/jpeg')
  assert.equal(sniffImageType(Buffer.from('GIF89a')), null)
  const ok = decodeImageBody({ content_type: 'image/png', data_base64: `data:image/png;base64,${png.toString('base64')}` })
  assert.equal(ok.ok, true); assert.equal(ok.ext, 'png')
  assert.equal(decodeImageBody({ content_type: 'image/png', data_base64: jpg.toString('base64') }).ok, false, 'declared png, bytes jpeg')
  assert.equal(decodeImageBody({ content_type: 'image/gif', data_base64: png.toString('base64') }).ok, false, 'gif is not in the map')
  assert.equal(decodeImageBody({ content_type: 'image/png', data_base64: png.toString('base64') }, { maxBytes: 4 }).status, 413)
  assert.equal(decodeImageBody({ content_type: 'image/png' }).field, 'data_base64')
})

// ── The endpoints ───────────────────────────────────────────────────────────

const PNG64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9]).toString('base64')

function makeRes() {
  const res = { statusCode: 0, body: null, headers: {} }
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v }
  res.status = (code) => { res.statusCode = code; return res }
  res.json = (payload) => { res.body = payload; return res }
  res.end = () => res
  return res
}

function makeDb({ contactExists = true } = {}) {
  const log = { uploads: [], updates: [], inserts: [] }
  const db = {
    from(table) {
      const q = {
        select() { return q }, eq() { return q },
        async maybeSingle() { return { data: contactExists ? { id: 'x' } : null, error: null } },
        update(payload) { log.updates.push({ table, payload }); return { eq: async () => ({ error: null }) } },
        async insert(payload) { log.inserts.push({ table, payload }); return { error: null } },
      }
      return q
    },
    storage: {
      from(bucket) {
        return {
          async upload(path, buf, opts) { log.uploads.push({ bucket, path, size: buf.length, opts }); return { error: null } },
          getPublicUrl(path) { return { data: { publicUrl: `${ORIGIN}/storage/v1/object/public/${bucket}/${path}` } } },
        }
      },
    },
  }
  return { db, log }
}

const staffProfile = { id: 'p1', role: 'admin', is_owner: false, full_name: 'Staff', email: 's@x.org' }
const portalProfile = { id: 'p2', role: 'portal', is_owner: false, full_name: 'Portal', email: 'u@x.org' }

test('/api/my-avatar: a staff member uploads through the server to a path derived from their identity', async () => {
  const { db, log } = makeDb()
  const handler = createMyAvatarHandler({
    verifyCaller: async () => ({ authenticated: true, authUserId: 'auth-1', profile: staffProfile }),
    getDb: () => db, now: () => 42,
  })
  const res = makeRes()
  await handler({ method: 'POST', headers: {}, body: { content_type: 'image/png', data_base64: PNG64, user_id: 'someone-else' } }, res)
  assert.equal(res.statusCode, 200)
  assert.deepEqual(log.uploads.map((u) => [u.bucket, u.path]), [['avatars', 'auth-1/avatar.png']])
  assert.equal(log.updates[0].table, 'user_profiles')
  assert.equal(log.updates[0].payload.avatar_url, `${ORIGIN}/storage/v1/object/public/avatars/auth-1/avatar.png?v=42`)
  assert.equal(isOwnAvatarStorageUrl(log.updates[0].payload.avatar_url, { origin: ORIGIN }), true, 'what it writes passes its own rule')
})

test('/api/my-avatar: a portal profile is refused, a type mismatch is refused, remove clears', async () => {
  const { db, log } = makeDb()
  const portal = createMyAvatarHandler({ verifyCaller: async () => ({ authenticated: true, authUserId: 'auth-2', profile: portalProfile }), getDb: () => db })
  const r1 = makeRes(); await portal({ method: 'POST', headers: {}, body: { content_type: 'image/png', data_base64: PNG64 } }, r1)
  assert.equal(r1.statusCode, 403)
  const staff = createMyAvatarHandler({ verifyCaller: async () => ({ authenticated: true, authUserId: 'auth-1', profile: staffProfile }), getDb: () => db })
  const r2 = makeRes(); await staff({ method: 'POST', headers: {}, body: { content_type: 'image/jpeg', data_base64: PNG64 } }, r2)
  assert.equal(r2.statusCode, 400); assert.equal(r2.body.field, 'content_type')
  const r3 = makeRes(); await staff({ method: 'POST', headers: {}, body: { action: 'remove' } }, r3)
  assert.equal(r3.statusCode, 200); assert.deepEqual(log.updates.at(-1).payload, { avatar_url: '' })
  assert.equal(log.uploads.length, 0)
  const anon = createMyAvatarHandler({ verifyCaller: async () => ({ authenticated: false, status: 401 }), getDb: () => db })
  const r4 = makeRes(); await anon({ method: 'POST', headers: {}, body: {} }, r4)
  assert.equal(r4.statusCode, 401)
})

test('/api/contact-avatar-upload: Owner/Admin only; persists for an existing contact, returns the URL for a new one', async () => {
  const { db, log } = makeDb()
  const denied = createContactAvatarUploadHandler({ verifyCaller: async () => ({ ok: false, status: 403 }), getDb: () => db })
  const r0 = makeRes(); await denied({ method: 'POST', headers: {}, body: { content_type: 'image/png', data_base64: PNG64 } }, r0)
  assert.equal(r0.statusCode, 403); assert.equal(log.uploads.length, 0)

  const handler = createContactAvatarUploadHandler({ verifyCaller: async () => ({ ok: true }), getDb: () => db, now: () => 7 })
  const id = '22222222-2222-4222-8222-222222222222'
  const r1 = makeRes(); await handler({ method: 'POST', headers: {}, body: { contact_id: id, content_type: 'image/png', data_base64: PNG64 } }, r1)
  assert.equal(r1.statusCode, 200)
  assert.equal(log.uploads[0].bucket, 'contact-avatars'); assert.equal(log.uploads[0].path, `${id}-7.png`)
  assert.deepEqual(log.updates, [{ table: 'contacts', payload: { avatar_url: `${ORIGIN}/storage/v1/object/public/contact-avatars/${id}-7.png` } }])

  const r2 = makeRes(); await handler({ method: 'POST', headers: {}, body: { content_type: 'image/png', data_base64: PNG64 } }, r2)
  assert.equal(r2.statusCode, 200); assert.match(r2.body.avatar_url, /contact-avatars\/new-[0-9a-f-]{36}-7\.png$/)
  assert.equal(log.updates.length, 1, 'no contact row: nothing persisted')

  const r3 = makeRes(); await handler({ method: 'POST', headers: {}, body: { contact_id: 'not-a-uuid', content_type: 'image/png', data_base64: PNG64 } }, r3)
  assert.equal(r3.statusCode, 400)
  const missing = createContactAvatarUploadHandler({ verifyCaller: async () => ({ ok: true }), getDb: () => makeDb({ contactExists: false }).db })
  const r4 = makeRes(); await missing({ method: 'POST', headers: {}, body: { contact_id: id, content_type: 'image/png', data_base64: PNG64 } }, r4)
  assert.equal(r4.statusCode, 404)
})

// ── The writers and the clients, in text ────────────────────────────────────

test('every server writer of avatar_url validates the value with the one rule', () => {
  for (const [file, importPath] of [
    ['api/contacts-upsert.js', "./lib/avatarImage.js"],
    ['api/portal/academics-contacts.js', "../lib/avatarImage.js"],
    ['api/admin-users.js', "./lib/avatarImage.js"],
  ]) {
    const src = read(file)
    assert.match(src, new RegExp(`import \\{ validateAvatarUrlChange \\} from '${importPath.replace(/\./g, '\\.')}'`), `${file} imports the rule`)
    assert.match(src, /validateAvatarUrlChange\(/, `${file} calls the rule`)
  }
  assert.match(read('api/contacts-upsert.js'), /organization, avatar_url'\)/, 'the existing row is read with its avatar_url so an unchanged value can pass')
  assert.match(read('api/portal/academics-contacts.js'), /organization, avatar_url'\)/)
  assert.doesNotMatch(stripComments(read('api/portal/academics-contacts.js')), /\^https\?:\\\/\\\//, 'the old any-http(s) rule is gone')
})

test('the upload clients post bytes to the server and the paste field is gone', () => {
  const menu = stripComments(read('src/components/UserMenu.jsx'))
  assert.match(menu, /fetch\('\/api\/my-avatar'/)
  assert.match(menu, /action: 'remove'/)
  assert.doesNotMatch(menu, /safeWrite|update_my_avatar|storage/)
  const client = stripComments(read('src/lib/contactAvatarUpload.js'))
  assert.match(client, /fetch\('\/api\/contact-avatar-upload'/)
  assert.match(client, /export async function uploadContactAvatar\(supabase, file, idHint\)/, 'signature unchanged for its two callers')
  assert.doesNotMatch(client, /storage/)
  const contacts = read('src/components/connect/ContactsView.jsx')
  assert.doesNotMatch(contacts, /paste directly|showAdvanced/)
  assert.doesNotMatch(contacts, /onChange=\{e => set\('avatar_url', e\.target\.value\)\}/)
})

// ── The migration, on real Postgres ─────────────────────────────────────────

const PRELUDE = `
  DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
  CREATE SCHEMA storage;
  CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text, owner uuid);
  ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
  CREATE TABLE public.user_profiles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), auth_user_id uuid, role text, is_active boolean DEFAULT true,
    avatar_url text, onboarding_tour_completed boolean, onboarding_tour_completed_at timestamptz,
    onboarding_tour_version text, onboarding_tour_dismissed boolean, last_login_at timestamptz);
  CREATE TABLE public.contacts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), avatar_url text);
  -- Wave E (20260712000004): the self-service column grant
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.user_profiles FROM authenticated;
  GRANT UPDATE (avatar_url, onboarding_tour_completed, onboarding_tour_completed_at, onboarding_tour_version,
                onboarding_tour_dismissed, last_login_at) ON public.user_profiles TO authenticated;
  -- The dashboard-created RPC, as the Wave F-1 allowlist left it
  CREATE FUNCTION public.update_my_avatar(p_url text) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
    UPDATE public.user_profiles SET avatar_url = p_url WHERE auth_user_id = auth.uid() $$;
  REVOKE ALL ON FUNCTION public.update_my_avatar(text) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION public.update_my_avatar(text) TO authenticated, service_role;
  -- 20260601000001: the contact-avatars policies
  CREATE POLICY "contact-avatars-public-read" ON storage.objects FOR SELECT TO anon, authenticated USING (bucket_id = 'contact-avatars');
  CREATE POLICY "contact-avatars-owner-admin-insert" ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'contact-avatars' AND EXISTS (SELECT 1 FROM public.user_profiles WHERE auth_user_id = auth.uid() AND role IN ('owner', 'admin')));
  CREATE POLICY "contact-avatars-owner-admin-update" ON storage.objects FOR UPDATE TO authenticated
    USING (bucket_id = 'contact-avatars' AND EXISTS (SELECT 1 FROM public.user_profiles WHERE auth_user_id = auth.uid() AND role IN ('owner', 'admin')));
  -- What the dashboard is assumed to hold for the avatars bucket: a public read and two writes
  CREATE POLICY "Avatar images are publicly accessible" ON storage.objects FOR SELECT USING (bucket_id = 'avatars');
  CREATE POLICY "Anyone can upload an avatar" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'avatars');
  CREATE POLICY "Users can update own avatar" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'avatars' AND owner = auth.uid());
  -- An unrelated bucket's write policy must survive
  CREATE POLICY "student files staff insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'student-files');
  INSERT INTO public.user_profiles (avatar_url) VALUES ('${OWN_AVATAR}'), ('https://legacy.example/p.jpg'), (NULL);
  INSERT INTO public.contacts (avatar_url) VALUES ('${OWN_CONTACT}'), ('');
`

const sections = () => audit.split(/\n(?=-- ── (?:PRE|POST) \d+:)/).slice(1)
const sectionSql = (label) => {
  const s = sections().find((x) => x.startsWith(`-- ── ${label}:`))
  assert.ok(s, `${label} present`)
  return s.replace(/^\s*--.*$/gm, '')
}

test('the migration applies as one block, twice, and takes only what it names', async () => {
  const db = new PGlite()
  await db.exec(PRELUDE)
  const pre1 = (await db.query(sectionSql('PRE 1'))).rows.map((r) => r.column_name)
  assert.deepEqual(pre1, ['avatar_url', 'last_login_at', 'onboarding_tour_completed', 'onboarding_tour_completed_at', 'onboarding_tour_dismissed', 'onboarding_tour_version'])
  const pre2 = (await db.query(sectionSql('PRE 2'))).rows
  assert.equal(pre2[0].authenticated, true)
  const pre3 = (await db.query(sectionSql('PRE 3'))).rows.map((r) => r.policyname)
  assert.equal(pre3.length, 6)
  const pre4 = (await db.query(sectionSql('PRE 4'))).rows

  await db.exec(migration)
  await db.exec(migration) // idempotent

  const post1 = (await db.query(sectionSql('POST 1'))).rows.map((r) => r.column_name)
  assert.deepEqual(post1, ['last_login_at', 'onboarding_tour_completed', 'onboarding_tour_completed_at', 'onboarding_tour_dismissed', 'onboarding_tour_version'])
  const post2 = (await db.query(sectionSql('POST 2'))).rows
  assert.equal(post2[0].authenticated, false); assert.equal(post2[0].anon, false); assert.equal(post2[0].service_role, true)
  const post3 = (await db.query(sectionSql('POST 3'))).rows
  assert.deepEqual(post3.map((r) => [r.policyname, r.cmd]), [
    ['Avatar images are publicly accessible', 'SELECT'],
    ['contact-avatars-public-read', 'SELECT'],
  ])
  const survivors = (await db.query(`SELECT policyname FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' ORDER BY 1`)).rows.map((r) => r.policyname)
  assert.ok(survivors.includes('student files staff insert'), 'another bucket is untouched')
  const post4 = (await db.query(sectionSql('POST 4'))).rows
  assert.deepEqual(post4, pre4)
  assert.deepEqual(post4.map((r) => [r.t, Number(r.with_avatar), Number(r.outside_own_storage)]), [['contacts', 1, 0], ['user_profiles', 2, 1]])
})

test('the audit file is read-only and PII-free, with PRE 1 to 4 and POST 1 to 4', () => {
  assert.equal(sections().length, 8)
  const code = audit.replace(/^\s*--.*$/gm, '')
  assert.doesNotMatch(code, /^\s*(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|GRANT|REVOKE)\b/im, 'no statement other than SELECT/WITH')
  assert.doesNotMatch(code, /full_name|first_name|last_name|email|SELECT\s+avatar_url/i)
})

test('the register and the SQL gate were updated with the migration, without an em dash', () => {
  const register = read('docs/security/FINDINGS_REGISTER.md')
  const s16 = register.slice(register.indexOf('## S-16.'), register.indexOf('## S-17.'))
  assert.match(s16, /Closed \(code\); SQL unconfirmed/)
  assert.match(s16, /20261001000000_s16_avatar_writes_server_only\.sql/)
  assert.match(s16, /s16_avatar_writes_server_only_checks\.sql/)
  const gate = read('docs/security/OWNER_SQL_GATE.md')
  assert.match(gate, /^\| 20261001000000_s16_avatar_writes_server_only\.sql \|.*UNKNOWN/m)
  const dash = new RegExp(String.fromCharCode(8212))
  for (const text of [migration, audit, s16, read('api/lib/avatarImage.js'), read('api/my-avatar.js'), read('api/contact-avatar-upload.js')]) {
    assert.doesNotMatch(text, dash, 'no em dash')
    assert.doesNotMatch(text, /ASPIRE Program/)
  }
})
