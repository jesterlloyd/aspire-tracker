import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const migration = readFileSync(new URL('../supabase/migrations/20261020000000_evaluation_reminder_token_activation.sql', import.meta.url), 'utf8')
const assignmentId = '00000000-0000-0000-0000-000000000001'
const deliveryId = '00000000-0000-0000-0000-000000000002'
const oldHash = 'a'.repeat(64)
const newHash = 'b'.repeat(64)

async function setup(t) {
  const pg = new PGlite()
  t.after(() => pg.close())
  await pg.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE evaluation_assignments (
      id uuid PRIMARY KEY, completed_at timestamptz, revoked_at timestamptz,
      status text DEFAULT 'sent', expires_at timestamptz DEFAULT now() + interval '21 days'
    );
    CREATE TABLE evaluation_reminder_deliveries (
      id uuid PRIMARY KEY, assignment_id uuid REFERENCES evaluation_assignments,
      status text DEFAULT 'claimed', sent_at timestamptz
    );
    CREATE TABLE evaluation_assignment_tokens (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), assignment_id uuid NOT NULL REFERENCES evaluation_assignments,
      token_hash text NOT NULL UNIQUE, token_hash_prefix text, issued_at timestamptz DEFAULT now(),
      expires_at timestamptz NOT NULL, revoked_at timestamptz, used_at timestamptz
    );
    CREATE UNIQUE INDEX uq_eval_tokens_one_active ON evaluation_assignment_tokens (assignment_id)
      WHERE revoked_at IS NULL AND used_at IS NULL;
    INSERT INTO evaluation_assignments(id) VALUES ('${assignmentId}');
    INSERT INTO evaluation_reminder_deliveries(id, assignment_id) VALUES ('${deliveryId}', '${assignmentId}');
    INSERT INTO evaluation_assignment_tokens(assignment_id, token_hash, expires_at)
      VALUES ('${assignmentId}', '${oldHash}', now() + interval '23 days');
  `)
  await pg.exec(migration)
  return pg
}
const prepare = async pg => (await pg.query(
  `SELECT prepare_evaluation_reminder_token($1, $2, now() + interval '23 days') AS result`, [deliveryId, newHash])).rows[0].result
const activate = async pg => (await pg.query(
  'SELECT activate_evaluation_reminder_token($1, $2) AS result', [deliveryId, newHash])).rows[0].result
const accepted = pg => pg.exec("UPDATE evaluation_reminder_deliveries SET sent_at = now(), status = 'cleanup_pending'")
const active = async pg => (await pg.query('SELECT token_hash FROM evaluation_assignment_tokens WHERE revoked_at IS NULL AND used_at IS NULL')).rows.map(r => r.token_hash)

test('reproduces production 23505, then stages and atomically activates under the same unique index', async t => {
  const pg = await setup(t)
  await assert.rejects(pg.query(`INSERT INTO evaluation_assignment_tokens(assignment_id, token_hash, expires_at)
    VALUES ($1, $2, now() + interval '23 days')`, [assignmentId, newHash]), e => e.code === '23505')
  const staged = await prepare(pg)
  assert.equal(staged.created, true)
  assert.deepEqual(await active(pg), [oldHash])
  assert.deepEqual(await prepare(pg), { id: staged.id, created: false })
  assert.equal(await activate(pg), false, 'cannot activate before recorded provider acceptance')
  await accepted(pg)
  assert.equal(await activate(pg), true)
  assert.deepEqual(await active(pg), [newHash])
  assert.equal(await activate(pg), true, 'activation recovery is idempotent')
})

test('activation transaction rolls back old-link retirement if activating the new link fails', async t => {
  const pg = await setup(t)
  await prepare(pg)
  await accepted(pg)
  await pg.exec(`CREATE FUNCTION reject_activation() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.token_hash = '${newHash}' AND NEW.revoked_at IS NULL THEN RAISE EXCEPTION 'simulated outage'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_activation BEFORE UPDATE ON evaluation_assignment_tokens FOR EACH ROW EXECUTE FUNCTION reject_activation();`)
  await assert.rejects(activate(pg), /simulated outage/)
  assert.deepEqual(await active(pg), [oldHash])
  await pg.exec('DROP TRIGGER reject_activation ON evaluation_assignment_tokens')
  assert.equal(await activate(pg), true)
  assert.deepEqual(await active(pg), [newHash])
})

test('a manual token rotation after staging is preserved', async t => {
  const pg = await setup(t)
  await prepare(pg)
  await pg.query('UPDATE evaluation_assignment_tokens SET token_hash = $1 WHERE token_hash = $2', ['c'.repeat(64), oldHash])
  await accepted(pg)
  assert.equal(await activate(pg), false)
  assert.deepEqual(await active(pg), ['c'.repeat(64)])
})

test('completed assignments and consumed or subsequently revoked tokens are never reactivated', async t => {
  const pg = await setup(t)
  await prepare(pg)
  await accepted(pg)
  await pg.exec("UPDATE evaluation_assignments SET completed_at = now(), status = 'completed'")
  assert.equal(await activate(pg), true)
  assert.deepEqual(await active(pg), [oldHash])
  await pg.exec("UPDATE evaluation_assignments SET completed_at = NULL, status = 'sent'")
  assert.equal(await activate(pg), true)
  await pg.query('UPDATE evaluation_assignment_tokens SET used_at = now() WHERE token_hash = $1', [newHash])
  assert.equal(await activate(pg), true)
  assert.deepEqual(await active(pg), [])
  await pg.query('UPDATE evaluation_assignment_tokens SET used_at = NULL, revoked_at = now() WHERE token_hash = $1', [newHash])
  assert.equal(await activate(pg), false)
  assert.deepEqual(await active(pg), [])
})

test('only service_role can prepare and activate tokens', async t => {
  const pg = await setup(t)
  for (const role of ['anon', 'authenticated']) {
    await pg.exec(`SET ROLE ${role}`)
    await assert.rejects(prepare(pg), e => e.code === '42501')
    await assert.rejects(activate(pg), e => e.code === '42501')
    await pg.exec('RESET ROLE')
  }
  await pg.exec('SET ROLE service_role')
  assert.equal((await prepare(pg)).created, true)
})
