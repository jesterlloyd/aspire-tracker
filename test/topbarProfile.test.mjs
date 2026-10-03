// test/topbarProfile.test.mjs
//
// TOPBAR-PROFILE-1 (2026-10-02): the profile menu, the Profile page, Users & Access.
//
//   * Settings registry: General is Profile, Appearance, Tours & Help, About; the Email
//     Signature page is gone and its paths land on Profile's #signature; Accounts & Access
//     is Users & Access, and its old path redirects.
//   * the menu: identity row (opens Profile), Settings with its shortcut, Preview as (the
//     existing portal links, Owner/Admin only), Public site and Sign out, in that order;
//     no photo controls; the keyboard contract.
//   * the Profile page: the photo handlers moved unchanged, every field labelled, the
//     signature section anchored, the name saved through update_my_profile with a fallback.
//   * the migration on real Postgres (PGlite): own row only, active only, a name required,
//     no anon, full_name still not raw-writable, and every audit section executable.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import {
  SETTINGS_SECTIONS, LEGACY_SETTINGS_REDIRECTS, childSections, visibleSections,
} from '../src/components/settings/settingsSections.js'
import { STAFF_PROFILE_PATH, PORTAL_LINKS } from '../src/lib/portalLinks.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (/ \d\.(jsx?|mjs)$/.test(name)) continue // the untracked " 2." duplicates
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (['.js', '.jsx'].includes(extname(name))) out.push(p)
  }
  return out
}

// ── Settings registry ─────────────────────────────────────────────────────────

test('General lists Profile, Appearance, Tours & Help, About, in that order, with the brief\'s lines', () => {
  const rows = childSections('general', { isOwner: true, isAdmin: true })
  assert.deepEqual(rows.map(r => r.label), ['Profile', 'Appearance', 'Tours & Help', 'About'])
  assert.deepEqual(rows.map(r => r.sub), [
    'Photo, name, title and your Connect signature',
    'Style and color mode',
    'Replay the welcome tour and find help',
    'Version, build and deployment details',
  ])
  assert.equal(rows[0].path, STAFF_PROFILE_PATH)
  assert.equal(SETTINGS_SECTIONS.some(s => s.key === 'signature' || s.label === 'Email Signature'), false)
})

test('every role reaches Profile; the rail carries the rename (and NAV-POLISH-1\'s groups)', () => {
  for (const flags of [{ isOwner: true, isAdmin: true }, { isOwner: false, isAdmin: true }, { isOwner: false, isAdmin: false }]) {
    assert.ok(childSections('general', flags).some(r => r.key === 'profile'))
  }
  assert.deepEqual(visibleSections({ isOwner: true, isAdmin: true }).map(s => s.label),
    ['General', 'Users & Access', 'Organization', 'Keith AI', 'Community Benefit', 'Budget Tracker', 'Demo Mode', 'Preceptor Parity'])
})

test('old paths land where things live now', () => {
  assert.equal(LEGACY_SETTINGS_REDIRECTS['/settings/general/signature'], '/settings/general/profile#signature')
  assert.equal(LEGACY_SETTINGS_REDIRECTS['/settings/signature'], '/settings/general/profile#signature')
  assert.equal(LEGACY_SETTINGS_REDIRECTS['/settings/accounts'], '/settings/users')
  const accounts = SETTINGS_SECTIONS.find(s => s.key === 'accounts')
  assert.equal(accounts.label, 'Users & Access')
  assert.equal(accounts.path, '/settings/users')
})

test('the shell renders Profile and no Signature page; its exits ask before leaving unsaved edits', () => {
  const shell = read('src/components/settings/SettingsShell.jsx')
  assert.match(shell, /currentKey === 'profile'\s+&& <ProfilePanel \/>/)
  assert.doesNotMatch(shell, /SignaturePanel/)
  assert.match(shell, /if \(opts\?\.replace \|\| await confirmLeave\(\)\) routerNavigate\(to, opts\)/)
  assert.match(shell, /<WorkspaceBackLink [^>]*guard=\{confirmLeave\}/)
})

test('"Accounts & Access" is gone from everything a person reads', () => {
  const offenders = []
  for (const file of [...walk(join(root, 'src')), ...walk(join(root, 'api'))]) {
    const code = stripComments(readFileSync(file, 'utf8'))
    if (/Accounts (&|&amp;|and) Access/.test(code)) offenders.push(file.slice(root.length + 1))
  }
  assert.deepEqual(offenders, [])
})

// ── The menu ──────────────────────────────────────────────────────────────────

const menu = read('src/components/UserMenu.jsx')
const menuCode = stripComments(menu)

test('the menu reads identity, Settings, Preview as, Public site, Sign out, in that order', () => {
  const order = [
    'className="um-id"', '>Settings</span>', '>Preview as</div>', '>Public site</span>', '>Sign out</span>',
  ].map(s => menuCode.indexOf(s))
  assert.ok(order.every(i => i > 0), `all present: ${order}`)
  assert.deepEqual([...order].sort((a, b) => a - b), order)
})

test('the identity row opens Profile and names itself; the menu holds no photo controls', () => {
  assert.match(menuCode, /aria-label=\{`Profile, \$\{fullName\}, \$\{roleLabel\}`\}/)
  assert.match(menuCode, /onClick=\{\(\) => go\(STAFF_PROFILE_PATH\)\}/)
  assert.doesNotMatch(menuCode, /Change Photo|Upload Photo|Remove photo|my-avatar|type="file"/)
})

test('Preview as is the existing portal list, gated to an active Owner or Admin', () => {
  assert.match(menuCode, /const canPreview = \['owner', 'admin'\]\.includes\(userProfile\.role\) && userProfile\.is_active !== false/)
  assert.match(menuCode, /\{canPreview && \(/)
  assert.match(menuCode, /PORTAL_LINKS\.map\(/)
  assert.equal(PORTAL_LINKS.length, 5)
})

test('the button and the keyboard: haspopup, expanded, controls, arrows, Home, End, Escape back to the button', () => {
  assert.match(menuCode, /aria-haspopup="true"/)
  assert.match(menuCode, /aria-expanded=\{isOpen\}/)
  assert.match(menuCode, /aria-controls=\{MENU_ID\}/)
  assert.match(menuCode, /\['ArrowDown', 'ArrowUp', 'Home', 'End'\]/)
  assert.match(menuCode, /if \(e\.key === 'Escape'\) \{ e\.preventDefault\(\); close\(true\); \}/)
  assert.match(menuCode, /if \(returnFocus\) buttonRef\.current\?\.focus\(\)/)
  // Opened from the keyboard, focus goes to the identity row.
  assert.match(menuCode, /setFocusFirst\(next && e\.detail === 0\)/)
})

test('Cmd+, / Ctrl+, opens Settings from anywhere, menu open or closed', () => {
  assert.match(menuCode, /e\.key === ',' && \(e\.metaKey \|\| e\.ctrlKey\) && !e\.altKey && !e\.shiftKey/)
  assert.match(menuCode, /document\.addEventListener\('keydown', onKey\)/)
  assert.match(menuCode, /go\(STAFF_SETTINGS_PATH\)/)
})

test('Public site opens in a new tab and says so', () => {
  assert.match(menuCode, /target="_blank" rel="noopener noreferrer"/)
  assert.match(menuCode, /aria-label="Public site \(opens in a new tab\)"/)
})

test('the top bar: tooltips are Connect, Catalog, Action Center, Light or dark; nothing in it hides below 560px but the button text', () => {
  const actions = read('src/components/Header/HeaderActions.jsx')
  for (const label of ['Connect', 'Catalog', 'Action Center']) assert.match(actions, new RegExp(`<Tooltip label="${label}" placement="bottom">`))
  assert.match(read('src/components/Header/ColorModeButton.jsx'), /<Tooltip label="Light or dark"/)
  const tokens = read('src/styles/chartTokens.css')
  assert.doesNotMatch(tokens, /\.chart-color-mode \{ display: none; \}/)
  assert.match(tokens, /@media \(max-width: 1100px\) \{\s*\.chart-brand-divider,\s*\.chart-brand-title \{ display: none; \}/)
  const css = read('src/components/userMenu.css')
  assert.match(css, /@media \(max-width: 560px\) \{[^}]*\.um-trigger \{ padding: 4px; \}\s*\.um-trigger-text, \.um-trigger-caret \{ display: none; \}/)
})

// ── The Profile page ──────────────────────────────────────────────────────────

const panel = read('src/components/settings/ProfilePanel.jsx')
const panelCode = stripComments(panel)

test('the photo handlers moved unchanged: the same server writer, checks and reload', () => {
  const hook = read('src/hooks/useMyAvatar.js')
  assert.match(hook, /fetch\('\/api\/my-avatar'/)
  assert.match(hook, /const validTypes = \['image\/jpeg', 'image\/png', 'image\/webp'\]/)
  assert.match(hook, /file\.size > 2 \* 1024 \* 1024/)
  assert.match(hook, /postMyAvatar\(\{ action: 'remove' \}\)/)
  assert.equal((hook.match(/window\.location\.reload\(\)/g) || []).length, 2)
  assert.match(panelCode, /useMyAvatar\(\)/)
  assert.match(panelCode, /Change photo/)
  assert.match(panelCode, /Remove photo/)
})

test('every field has a visible label tied to its input; Email is read-only', () => {
  for (const id of ['pf-name', 'pf-cred', 'pf-title', 'pf-dept', 'pf-email', 'pf-phone']) {
    assert.match(panelCode, new RegExp(`<Field id="${id}"`), id)
    assert.match(panelCode, new RegExp(`<input id="${id}"`), id)
  }
  assert.match(panelCode, /<label htmlFor=\{id\} className="pf-label">/)
  assert.match(panelCode, /<input id="pf-email" className="pf-input" value=\{email\} readOnly/)
})

test('the signature section is #signature, and the page scrolls to it on arrival', () => {
  assert.match(panelCode, /<h3 className="pf-h" id="signature">Connect Signature<\/h3>/)
  assert.match(panelCode, /location\.hash === '#signature'/)
  assert.match(panelCode, /Include my signature on emails I write in Connect/)
})

test('one Save writes the name and signature through update_my_profile, falling back before the migration', () => {
  assert.match(panelCode, /supabase\.rpc\('update_my_profile', \{ p_full_name: name, p_signature \}\)/)
  assert.match(panelCode, /error\?\.code === 'PGRST202' \|\| error\?\.code === '42883'/)
  assert.match(panelCode, /supabase\.rpc\('update_my_connect_signature', \{ p_signature \}\)/)
  assert.equal((panelCode.match(/className="pf-save"/g) || []).length, 1)
  assert.match(panelCode, /dirty \? 'Unsaved changes' : 'All changes saved'/)
  assert.match(panelCode, /window\.addEventListener\('beforeunload', onBeforeUnload\)/)
  // A differing signature name is kept until the person edits the field.
  assert.match(panelCode, /const signatureDisplayName = namesDiffer && !nameTouched \? signatureName : name/)
  // refetch after the write, so the header and menu show the new name
  assert.match(panelCode, /await refreshUserProfile\?\.\(\)/)
})

test('Users & Access is linked only for those who can open it', () => {
  assert.match(panelCode, /\{isAdmin\s*\? <button type="button" className="pf-link" onClick=\{openUsersAccess\}>Managed in Users &amp; Access<\/button>/)
})

// ── The migration, on real Postgres ───────────────────────────────────────────

const MIGRATION = read('supabase/migrations/20261103000000_my_profile_name.sql')
const CHECKS = read('db/audit/my_profile_name_checks.sql')
const CONFLICTS = read('db/audit/my_profile_name_conflicts.sql')

const PRELUDE = `
  DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
    $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
  GRANT USAGE ON SCHEMA auth TO authenticated, anon;
  GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;
  CREATE TABLE public.user_profiles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_user_id uuid UNIQUE,
    email text, role text, full_name text,
    is_active boolean DEFAULT true,
    connect_signature jsonb,
    avatar_url text
  );
  GRANT SELECT ON public.user_profiles TO authenticated;
  GRANT UPDATE (avatar_url) ON public.user_profiles TO authenticated;
  INSERT INTO public.user_profiles (auth_user_id, email, role, full_name, is_active, connect_signature) VALUES
    ('11111111-1111-1111-1111-111111111111', 'me@example.org',    'owner',       'Old Name',   true,  '{"display_name":"Sig Name","phone":"1"}'),
    ('22222222-2222-2222-2222-222222222222', 'other@example.org', 'admin',       'Other',      true,  null),
    ('33333333-3333-3333-3333-333333333333', 'gone@example.org',  'interviewer', 'Gone',       false, null);
`

async function freshDb() {
  const db = new PGlite()
  await db.exec(PRELUDE)
  return db
}

async function asUser(db, uid, sql, params) {
  await db.exec(`SET ROLE authenticated; SELECT set_config('test.uid', '${uid}', false);`)
  try { return await db.query(sql, params) } finally { await db.exec('RESET ROLE;') }
}

const ME = '11111111-1111-1111-1111-111111111111'
const SIG = JSON.stringify({ display_name: 'New Name', credentials: 'RN', title: 'Lead', department: '', phone: '310', signature_enabled: false, email: 'x@evil.example', extra: 'dropped' })

test('MIGRATION: the caller renames their own row, and only theirs; the signature keeps the whitelist', async () => {
  const db = await freshDb()
  await db.exec(MIGRATION)
  await db.exec(MIGRATION) // re-run is safe
  const r = await asUser(db, ME, `SELECT public.update_my_profile($1, $2::jsonb) AS out`, ['  New\tName  ', SIG])
  assert.equal(r.rows[0].out.full_name, 'NewName')
  const rows = (await db.query(`SELECT email, full_name, connect_signature FROM public.user_profiles ORDER BY email`)).rows
  const me = rows.find(x => x.email === 'me@example.org')
  assert.equal(me.full_name, 'NewName')
  assert.equal(me.connect_signature.display_name, 'New Name')
  assert.equal(me.connect_signature.signature_enabled, false)
  assert.equal('email' in me.connect_signature, false)
  assert.equal('extra' in me.connect_signature, false)
  assert.equal(rows.find(x => x.email === 'other@example.org').full_name, 'Other')
})

test('MIGRATION: refused without a session, without a name, or for a deactivated account', async () => {
  const db = await freshDb()
  await db.exec(MIGRATION)
  await assert.rejects(asUser(db, '', `SELECT public.update_my_profile('A', '{}'::jsonb)`), /Not authenticated/)
  await assert.rejects(asUser(db, ME, `SELECT public.update_my_profile('   ', '{}'::jsonb)`), /Display name is required/)
  await assert.rejects(asUser(db, ME, `SELECT public.update_my_profile('A', '[]'::jsonb)`), /Signature must be an object/)
  await assert.rejects(asUser(db, '33333333-3333-3333-3333-333333333333', `SELECT public.update_my_profile('A', '{}'::jsonb)`), /No active profile/)
  assert.equal((await db.query(`SELECT full_name FROM public.user_profiles WHERE email = 'gone@example.org'`)).rows[0].full_name, 'Gone')
})

test('MIGRATION: anon cannot call it, and full_name is still not writable by a raw update', async () => {
  const db = await freshDb()
  await db.exec(MIGRATION)
  await db.exec(`SET ROLE anon;`)
  await assert.rejects(db.query(`SELECT public.update_my_profile('A', '{}'::jsonb)`), /permission denied/)
  await db.exec('RESET ROLE;')
  await assert.rejects(asUser(db, ME, `UPDATE public.user_profiles SET full_name = 'X' WHERE auth_user_id = auth.uid()`), /permission denied/)
})

test('AUDIT: PRE 1 says false before and true after; POST 1 to 3 report what the file promises; the conflicts query runs', async () => {
  const db = await freshDb()
  const sections = CHECKS.split(/^-- ── /m).slice(1).map(s => s.replace(/^[^\n]*\n/, ''))
  assert.equal(sections.length, 4)
  assert.equal((await db.query(sections[0])).rows[0].applied, false)
  await db.exec(MIGRATION)
  assert.equal((await db.query(sections[0])).rows[0].applied, true)
  const post1 = (await db.query(sections[1])).rows
  assert.equal(post1.length, 1)
  assert.equal(post1[0].security_definer, true)
  assert.ok(post1[0].config.some(c => c === 'search_path=public'))
  assert.deepEqual((await db.query(sections[2])).rows[0], { authenticated: true, anon: false, public: false })
  assert.equal((await db.query(sections[3])).rows[0].raw_client_can_write_full_name, false)
  const conflicts = (await db.query(CONFLICTS)).rows
  assert.deepEqual(conflicts.map(c => [c.email, c.account_name, c.signature_name, c.difference]),
    [['me@example.org', 'Old Name', 'Sig Name', 'different name']])
})
