import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import test from 'node:test'

test('targeted Auth cleanup preserves profiles and stops on active access or owned files', async () => {
  const sql = readFileSync(new URL('../db/audit/rinka_interviewer_access_cleanup_20261002.sql', import.meta.url), 'utf8')
  const pairs = [...sql.matchAll(/\('([a-f0-9-]{36})', '([a-f0-9-]{36})'\)/g)].map(m => [m[1], m[2]])
  assert.equal(pairs.length, 1)
  const db = new PGlite()
  try {
    await db.exec(`
      CREATE SCHEMA auth; CREATE SCHEMA storage;
      CREATE TABLE auth.users(id uuid PRIMARY KEY);
      CREATE TABLE public.user_profiles(id uuid PRIMARY KEY, auth_user_id uuid, role text, is_owner boolean,
        login_enabled boolean, is_active boolean, full_name text, email text, can_conduct_interviews boolean DEFAULT true, created_at timestamptz DEFAULT now());
      CREATE FUNCTION public.is_owner_or_admin() RETURNS boolean LANGUAGE sql AS 'SELECT true';
      CREATE TABLE public.contacts(id int PRIMARY KEY, name text);
      INSERT INTO public.contacts VALUES (1,'Rinka Shiraishi');
      CREATE TABLE public.interviews(profile_id uuid REFERENCES public.user_profiles(id));
      CREATE TABLE public.user_role_grants(user_profile_id uuid, revoked_at timestamptz);
      CREATE TABLE public.user_student_links(user_profile_id uuid, revoked_at timestamptz);
      CREATE TABLE public.user_unit_scopes(user_profile_id uuid, revoked_at timestamptz);
      CREATE TABLE public.user_school_scopes(user_profile_id uuid, revoked_at timestamptz);
      CREATE TABLE storage.objects(owner_id text);
    `)
    for (const [p, a] of pairs) {
      await db.query('INSERT INTO auth.users VALUES ($1)', [a])
      await db.query("INSERT INTO public.user_profiles(id,auth_user_id,role,is_owner,login_enabled,is_active,full_name,email) VALUES ($1,$2,'interviewer',false,true,false,'Rinka Shiraishi','rinka.shiraishi@cshs.org')", [p,a])
      await db.query('INSERT INTO user_role_grants VALUES ($1,now())', [p])
      await db.query('INSERT INTO public.interviews VALUES ($1)', [p])
    }
    await db.query('INSERT INTO storage.objects VALUES ($1)', [pairs[0][1]])
    await assert.rejects(db.exec(sql), /owns uploaded files/)
    await db.exec('ROLLBACK')
    assert.equal((await db.query('SELECT count(*)::int AS n FROM auth.users')).rows[0].n, 1)
    await db.exec('DELETE FROM storage.objects; UPDATE user_role_grants SET revoked_at=NULL')
    await assert.rejects(db.exec(sql), /unrevoked access/)
    await db.exec('ROLLBACK')
    await db.exec('UPDATE user_role_grants SET revoked_at=now()')
    await db.exec('CREATE TABLE public.attribution(actor uuid REFERENCES auth.users(id) ON DELETE SET NULL)')
    await db.query('INSERT INTO public.attribution VALUES ($1)', [pairs[0][1]])
    await assert.rejects(db.exec(sql), /still references a target/)
    await db.exec('ROLLBACK')
    assert.equal((await db.query('SELECT count(*)::int AS n FROM user_profiles WHERE auth_user_id IS NOT NULL')).rows[0].n, 1)
    await db.exec('DELETE FROM public.attribution')
    await db.exec(sql)
    assert.equal((await db.query('SELECT count(*)::int AS n FROM auth.users')).rows[0].n, 0)
    assert.equal((await db.query('SELECT count(*)::int AS n FROM user_profiles WHERE auth_user_id IS NULL AND NOT login_enabled AND NOT is_active')).rows[0].n, 1)
    assert.equal((await db.query('SELECT count(*)::int AS n FROM user_role_grants')).rows[0].n, 1)
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.contacts')).rows[0].n, 1)
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.interviews')).rows[0].n, 1)
    assert.equal((await db.query('SELECT can_conduct_interviews FROM public.user_profiles')).rows[0].can_conduct_interviews, false)
    assert.equal((await db.query('SELECT * FROM public.get_all_user_profiles()')).rows.length, 0)
    await db.exec("INSERT INTO public.user_profiles(id,role,is_owner,login_enabled,is_active) VALUES ('00000000-0000-0000-0000-000000000001','interviewer',false,true,false)")
    assert.equal((await db.query('SELECT * FROM public.get_all_user_profiles()')).rows.length, 1)
    await db.exec("CREATE OR REPLACE FUNCTION public.is_owner_or_admin() RETURNS boolean LANGUAGE sql AS 'SELECT false'")
    await assert.rejects(db.query('SELECT * FROM public.get_all_user_profiles()'), /Insufficient permissions/)
  } finally { await db.close() }
})

