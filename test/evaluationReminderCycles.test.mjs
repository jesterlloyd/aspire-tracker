import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const migration = name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8')
const cycles = migration('20261021000000_evaluation_reminder_invitation_cycles.sql')
const A = '00000000-0000-0000-0000-000000000001'
const B = '00000000-0000-0000-0000-000000000002'
const C = '00000000-0000-0000-0000-000000000003'
const hash = 'f'.repeat(64)

async function setup(t, beforeMigration) {
  const pg = new PGlite()
  t.after(() => pg.close())
  await pg.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE evaluation_assignments (id uuid PRIMARY KEY, sent_at timestamptz NOT NULL,
      expires_at timestamptz DEFAULT now() + interval '20 days', status text DEFAULT 'sent',
      completed_at timestamptz, revoked_at timestamptz);
    CREATE TABLE notification_log(id uuid PRIMARY KEY);
    CREATE TABLE evaluation_assignment_tokens (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), assignment_id uuid REFERENCES evaluation_assignments,
      token_hash text NOT NULL UNIQUE, token_hash_prefix text, issued_at timestamptz DEFAULT now(),
      expires_at timestamptz NOT NULL, revoked_at timestamptz, used_at timestamptz);
    CREATE UNIQUE INDEX uq_eval_tokens_one_active ON evaluation_assignment_tokens(assignment_id)
      WHERE revoked_at IS NULL AND used_at IS NULL;
    INSERT INTO evaluation_assignments(id, sent_at) VALUES
      ('${A}', now() - interval '21 days'), ('${B}', now() - interval '9 days'), ('${C}', now() - interval '9 days');
    INSERT INTO evaluation_assignment_tokens(assignment_id, token_hash, expires_at)
      VALUES ('${A}', repeat('a', 64), now() + interval '22 days');
  `)
  await pg.exec(migration('20260815000000_evaluation_reminder_deliveries.sql'))
  await pg.exec(migration('20261020000000_evaluation_reminder_token_activation.sql'))
  await pg.exec(`
    INSERT INTO evaluation_reminder_deliveries
      (assignment_id, reminder_number, status, sent_at, first_attempted_at, payload_fingerprint, created_at)
    VALUES
      ('${A}', 3, 'sent', now() - interval '28 days', now() - interval '28 days', repeat('a',64), now() - interval '28 days'),
      ('${B}', 1, 'sent', now() - interval '1 hour', now() - interval '1 hour', repeat('b',64), now() - interval '30 days'),
      ('${B}', 3, 'sent', now() - interval '25 days', now() - interval '25 days', repeat('c',64), now() - interval '25 days'),
      ('${C}', 1, 'sent', now() - interval '30 days', now() - interval '30 days', repeat('d',64), now() - interval '30 days');
  `)
  if (beforeMigration) await beforeMigration(pg)
  await pg.exec(cycles)
  return pg
}

const claim = async (pg, candidates, extra = '') => (await pg.query(
  `SELECT * FROM claim_evaluation_reminders('test', $1::jsonb${extra})`, [JSON.stringify(candidates)])).rows
const candidates = [{ assignment_id: A, reminder_number: 3 }, { assignment_id: B, reminder_number: 1 }, { assignment_id: C, reminder_number: 1 }]

test('old sent rounds block reissues before migration; new cycles claim only the two unsent invitations', async t => {
  let history
  const pg = await setup(t, async pg => {
    assert.equal((await claim(pg, candidates)).length, 0, 'reproduces the stale sent-record suppression')
    history = (await pg.query('SELECT id, status, sent_at, resend_email_id, payload_fingerprint FROM evaluation_reminder_deliveries ORDER BY id')).rows
  })
  const claimed = await claim(pg, candidates)
  assert.deepEqual(claimed.map(r => r.assignment_id).sort(), [A, C])
  assert.ok(claimed.every(r => r.token_version === 2 && r.invitation_sent_at))
  assert.equal((await claim(pg, candidates)).length, 0, 'overlapping run cannot claim the same cycles')
  const preserved = (await pg.query('SELECT id, status, sent_at, resend_email_id, payload_fingerprint FROM evaluation_reminder_deliveries WHERE id = ANY($1::uuid[]) ORDER BY id', [history.map(r => r.id)])).rows
  assert.deepEqual(preserved, history, 'all old audit evidence and current successful sends are untouched')
  const currentSuccess = (await pg.query('SELECT * FROM evaluation_reminder_deliveries WHERE assignment_id = $1 AND reminder_number = 1', [B])).rows[0]
  assert.equal(currentSuccess.token_version, 1)
  assert.ok(currentSuccess.invitation_sent_at, 'legacy current-cycle send is bound and not duplicated')
})

test('new-cycle sender must identify its token version; successful activation keeps one active token', async t => {
  const pg = await setup(t)
  const [d] = await claim(pg, [candidates[0]])
  await assert.rejects(pg.query('SELECT prepare_evaluation_reminder_token($1, $2, now() + interval \'22 days\')', [d.id, hash]), /upgrade required/)
  const params = [d.id, hash]
  const prepared = await pg.query('SELECT prepare_evaluation_reminder_token($1, $2, now() + interval \'22 days\', 2::smallint) AS result', params)
  assert.ok(prepared.rows[0].result.id)
  await pg.query("UPDATE evaluation_reminder_deliveries SET sent_at = now(), status = 'cleanup_pending', reason = 'token_cleanup_failed' WHERE id = $1", [d.id])
  assert.equal((await pg.query('SELECT activate_evaluation_reminder_token($1,$2) AS ok', params)).rows[0].ok, true)
  assert.equal((await pg.query('SELECT count(*)::int AS n FROM evaluation_assignment_tokens WHERE assignment_id = $1 AND revoked_at IS NULL AND used_at IS NULL', [A])).rows[0].n, 1)
})

test('reissue after claim blocks token staging and reissue after acceptance blocks activation', async t => {
  const pg = await setup(t)
  const [d] = await claim(pg, [candidates[0]])
  await pg.query('SELECT prepare_evaluation_reminder_token($1,$2,now() + interval \'22 days\',2::smallint)', [d.id, hash])
  await pg.query("UPDATE evaluation_reminder_deliveries SET sent_at = now(), status = 'cleanup_pending', first_attempted_at = now(), payload_fingerprint = repeat('a',64) WHERE id = $1", [d.id])
  await pg.query('UPDATE evaluation_assignments SET sent_at = now() WHERE id = $1', [A])
  await assert.rejects(pg.query('SELECT prepare_evaluation_reminder_token($1,$2,now() + interval \'22 days\',2::smallint)', [d.id, hash]), /invitation changed/)
  assert.equal((await pg.query('SELECT activate_evaluation_reminder_token($1,$2) AS ok', [d.id, hash])).rows[0].ok, false)
  await claim(pg, [], ', p_recover_only => true')
  const row = (await pg.query('SELECT status, reason, sent_at FROM evaluation_reminder_deliveries WHERE id=$1', [d.id])).rows[0]
  assert.equal(row.status, 'needs_reconciliation')
  assert.equal(row.reason, 'invitation_reissued')
  assert.ok(row.sent_at, 'provider acceptance evidence survives')
})

test('stale candidate snapshot cannot claim the new invitation', async t => {
  const pg = await setup(t)
  const result = await claim(pg, [{ ...candidates[0], invitation_sent_at: '2000-01-01T00:00:00Z' }])
  assert.equal(result.length, 0)
})

test('legacy in-flight work preserves its token version and exact recovery evidence', async t => {
  const pg = await setup(t, pg => pg.exec(`
    INSERT INTO evaluation_reminder_deliveries (assignment_id, reminder_number, status, claimed_at, claimed_by,
      first_attempted_at, payload_fingerprint, created_at, attempts, delivery_epoch)
    VALUES ('${B}', 2, 'sending', now() - interval '20 minutes', 'old-worker',
      now() - interval '20 minutes', repeat('e',64), now() - interval '20 minutes', 1, 4);
  `))
  const [row] = await claim(pg, [], ', p_recover_only => true')
  assert.equal(row.assignment_id, B)
  assert.equal(row.token_version, 1)
  assert.equal(row.delivery_epoch, 4)
  assert.equal(row.payload_fingerprint, 'e'.repeat(64))
})

test('recovery never materializes new candidates and never resends an expired provider attempt', async t => {
  const pg = await setup(t)
  assert.equal((await claim(pg, candidates, ', p_recover_only => true')).length, 0)
  assert.equal((await pg.query('SELECT count(*)::int AS n FROM evaluation_reminder_deliveries')).rows[0].n, 4)
  const [row] = await claim(pg, [candidates[0]])
  await pg.query(`UPDATE evaluation_reminder_deliveries SET status='sending',
    first_attempted_at=now()-interval '25 hours', payload_fingerprint=repeat('a',64),
    claimed_at=now()-interval '25 hours' WHERE id=$1`, [row.id])
  assert.equal((await claim(pg, [], ', p_recover_only => true')).length, 0)
  assert.equal((await pg.query('SELECT reason FROM evaluation_reminder_deliveries WHERE id=$1', [row.id])).rows[0].reason, 'provider_window_elapsed')
})

test('accepted activation recovery remains claimable after the provider deduplication window', async t => {
  const pg = await setup(t)
  const [row] = await claim(pg, [candidates[0]])
  await pg.query(`UPDATE evaluation_reminder_deliveries SET status='claimed',
    sent_at=now()-interval '25 hours', first_attempted_at=now()-interval '25 hours',
    payload_fingerprint=repeat('a',64), claimed_at=now()-interval '25 hours' WHERE id=$1`, [row.id])
  const [recovered] = await claim(pg, [], ', p_recover_only => true')
  assert.equal(recovered.id, row.id)
  assert.ok(recovered.sent_at, 'sender takes activation-only path')
})

test('public roles cannot call guarded or internal token functions', async t => {
  const pg = await setup(t)
  for (const role of ['anon', 'authenticated', 'service_role']) {
    await pg.exec(`SET ROLE ${role}`)
    await assert.rejects(pg.query('SELECT prepare_evaluation_reminder_token_internal($1,$2,now())', [A, hash]), e => e.code === '42501')
    if (role !== 'service_role') {
      await assert.rejects(pg.query('SELECT prepare_evaluation_reminder_token($1,$2,now(),2::smallint)', [A, hash]), e => e.code === '42501')
      await assert.rejects(claim(pg, candidates), e => e.code === '42501')
    }
    await pg.exec('RESET ROLE')
  }
})
