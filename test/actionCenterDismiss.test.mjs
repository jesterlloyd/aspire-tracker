// AC-DISMISS-1 (Owner, 2026-10-07): the Action Center can dismiss notifications and actions,
// not only snooze them; a blocked Review & Release slip counts as the team's work only when the
// team can act on it; a Unit Leader response that can never be released can be marked
// "won't release" and put back.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { applySnoozes, dismissKey, normalizeHomeQueue, normalizeSupportQueue, DISMISS_SEP } from '../src/lib/actionCenter/queueModel.js'
import { blockerOwner, needsStaff } from '../src/lib/evaluation/reviewQueueShape.js'
import { reviewReleaseGroup } from '../src/lib/home/needsYouModel.js'
import { adaptUnitLeaderRelease } from '../src/lib/evaluation/reviewQueueAdapters.js'

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const NOW = Date.parse('2026-10-07T18:00:00Z')
const LATER = '2027-01-01T00:00:00Z'

test('a dismissed item stays hidden until its state signature changes', () => {
  const item = { key: 'hrs:s1', sig: '12 h', urgent: false }
  const snoozes = [{ item_key: dismissKey(item), snoozed_until: LATER }]
  assert.equal(dismissKey(item), `hrs:s1${DISMISS_SEP}12 h`)
  assert.deepEqual(applySnoozes([item], snoozes, NOW), [])
  assert.equal(applySnoozes([{ ...item, sig: '20 h' }], snoozes, NOW).length, 1, 'more hours logged brings it back')
  assert.equal(applySnoozes([item], [{ item_key: dismissKey(item), snoozed_until: '2026-10-01T00:00:00Z' }], NOW).length, 1, 'a lapsed dismissal shows it again')
  assert.equal(applySnoozes([{ ...item, urgent: true }], snoozes, NOW).length, 1, 'an urgent item is never dismissed')
  assert.equal(applySnoozes([item], [{ item_key: 'hrs:s1', snoozed_until: LATER }], NOW).length, 0, 'a plain snooze still works')
})

test('every non-urgent queue item can be snoozed, and its signature ignores daily countdowns', () => {
  const groups = [
    { key: 'placement', rows: [{ id: 'hrs:s1', title: 'Ratty Waggoner · PICU', meta: '12 of 90 h · about 10 h behind pace', pill: { text: 'Behind' }, sig: '12 h', ageMs: 0, to: '/students' }] },
    { key: 'reviewRelease', rows: [{ id: 'rr:w1', title: 'Casey-Fink', meta: '2 students to fix before release', pill: { text: 'To fix' }, ageMs: 0, to: '/evaluation' }] },
    { key: 'interviews', rows: [{ id: 'iv:x', title: 'Ana · 9:00', meta: 'Today 9:00', pill: { text: 'Today' }, ageMs: 0, to: '/interviews' }] },
  ]
  const items = normalizeHomeQueue({ groups, now: NOW })
  for (const it of items) assert.ok(it.actions.some(a => a.key === 'snooze'), `${it.key} offers Snooze`)
  assert.equal(items.find(i => i.key === 'hrs:s1').sig, '12 h')
  assert.equal(items.find(i => i.key === 'rr:w1').sig, 'To fix|2 students to fix before release')
  const needsYou = read('src/lib/home/needsYouModel.js')
  assert.match(needsYou, /sig: `renews \$\{r\.date\}`/)
  assert.match(needsYou, /sig: `\$\{Math\.round\(n\(s\.approved_hours\)\)\} h`/)
  assert.match(needsYou, /sig: `\$\{c\.last_message_at \|\| ''\}/)
})

test('a support reply comes back when a new reply arrives (its latest event is its signature)', () => {
  const { open } = normalizeSupportQueue({
    logs: [{ id: 'l1', student_id: 's1', shift_date: '2026-10-01', unit_name: '7 SCCT', support_needed: 'No so far' }],
    events: [{ id: 'e9', shift_log_id: 'l1', classification: 'needs_look', status: 'open', rule_key: 'r', created_at: '2026-10-01T10:00:00Z' }],
    students: [{ id: 's1', first_name: 'Steven', last_name: 'Li' }], now: NOW,
  })
  assert.equal(open[0].sig, 'e9')
  assert.ok(open[0].actions.some(a => a.key === 'snooze'))
})

test('only a blocked slip the team can act on counts in Needs you and the Action Center', () => {
  const waiting = { state: 'blocked', blocker: { action: 'remind' } }
  const behind = { state: 'blocked', blocker: { action: 'jump' } }
  const fix = { state: 'blocked', blocker: { action: 'fix' } }
  const moderate = { state: 'blocked', blocker: { action: 'moderate' } }
  const neverOff = { state: 'blocked', blocker: { action: 'fix', neverReleasable: true, withhold: false } }
  const neverOn = { state: 'blocked', blocker: { action: 'fix', neverReleasable: true, withhold: true } }
  assert.equal(blockerOwner(waiting), 'student')
  assert.equal(blockerOwner(behind), 'elsewhere')
  assert.equal(blockerOwner(neverOn), 'never')
  assert.deepEqual([waiting, behind, fix, moderate, neverOff, neverOn].map(needsStaff), [false, false, true, true, false, true])
  const g = reviewReleaseGroup({ now: NOW, workflows: [{ key: 'ul', label: 'Release to Unit Leaders' }, { key: 'cf', label: 'Casey-Fink' }], queues: {
    ul: { items: [waiting, waiting, behind, neverOff] },
    cf: { items: [moderate, waiting] },
  } })
  assert.deepEqual(g.rows.map(r => r.id), ['rr:cf'], 'a workflow with nothing for the team to do is not listed')
  assert.equal(g.rows[0].meta, '1 student to fix before release')
  assert.equal(g.count, 1)
})

const ulRow = over => ({
  response_id: 'r1', student_name: 'Ana Ruiz', unit_key: '6 NE', evaluated_preceptor: 'Pat', rotation_end: '2026-09-01',
  eligible_at: '2026-09-08', snapshot_source: 'submission_trigger', moderation_state: 'pending', release_state: 'pending', ...over,
})

test('a response that can never be released offers "won\'t release" once it is switched on, and a marked one moves to the tape', () => {
  const legacy = ulRow({ snapshot_source: 'backfill_unverified' })
  const off = adaptUnitLeaderRelease({ rows: [legacy], nowMs: NOW })
  assert.equal(off.items[0].blocker.neverReleasable, true)
  assert.equal(off.items[0].blocker.withhold, false)
  assert.equal(needsStaff(off.items[0]), false, 'before the migration it is not counted as work')
  const on = adaptUnitLeaderRelease({ rows: [legacy], nowMs: NOW, withholdsEnabled: true })
  assert.equal(on.items[0].blocker.withhold, true)
  assert.equal(needsStaff(on.items[0]), true)
  const marked = adaptUnitLeaderRelease({ rows: [{ ...legacy, withheld_at: '2026-10-07T17:00:00Z' }], nowMs: NOW, withholdsEnabled: true })
  assert.equal(marked.items.length, 0)
  assert.equal(marked.sent[0].withheld, true)
  assert.equal(marked.sent[0].recipient, "won't release")
  const releasable = adaptUnitLeaderRelease({ rows: [ulRow({ withheld_at: '2026-10-07T17:00:00Z' })], nowMs: NOW, withholdsEnabled: true })
  assert.equal(releasable.sent.length, 0, 'a withhold never hides a response that can be released')
})

test('the migration: notification dismissal through RPCs, a won\'t-release record that is never deleted', () => {
  const sql = read('supabase/migrations/20261112000000_action_center_dismiss.sql')
  assert.match(sql, /APPLY MANUALLY/)
  assert.match(sql, /ADD COLUMN IF NOT EXISTS dismissed_at timestamptz/)
  assert.match(sql, /FUNCTION public\.dismiss_staff_notifications\(p_ids uuid\[\]\)[\s\S]*recipient_profile_id = v_me/)
  assert.match(sql, /WHEN p_ids IS NULL THEN in_app_read_at IS NOT NULL/, 'Clear read never clears an unread notification')
  assert.match(sql, /FUNCTION public\.restore_staff_notifications/)
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.evaluation_release_withholds/)
  assert.match(sql, /WHERE undone_at IS NULL/)
  assert.match(sql, /'releasable'/)
  assert.doesNotMatch(sql, /GRANT[^;]*(INSERT|UPDATE|DELETE)[^;]*evaluation_release_withholds TO authenticated/)
  assert.doesNotMatch(sql, /evaluation_response_unit_release\s+(SET|ADD|DROP)|ALTER TABLE public\.evaluation_response_unit_release\b/, 'the guarded release table is untouched')
  assert.match(sql, /^BEGIN;[\s\S]*COMMIT;\s*$/m)
})

test('the screens: Dismiss on actions, a sibling x and Clear read on notifications, no delivered notice', () => {
  const panel = read('src/components/ActionCenterV2.jsx')
  assert.match(panel, /'Dismiss'/)
  assert.match(panel, /In a week/)
  assert.match(panel, /removeSnooze\(key\)/, 'Undo removes exactly the dismissal row')
  assert.match(panel, /Clear read/)
  const list = read('src/components/StaffNotificationsPanel.jsx')
  assert.match(list, /className="ac2-notif-dismiss"/)
  const rowButtonEnd = list.indexOf('{/* AC-DISMISS-1: a sibling')
  assert.ok(rowButtonEnd > list.indexOf("role={behavior.interactive ? 'button'"), 'the x sits after the row button closes')
  const hook = read('src/hooks/useStaffNotifications.js')
  assert.match(hook, /'42703'/)
  assert.match(hook, /is\('dismissed_at', null\)/)
  assert.doesNotMatch(read('api/webhooks/resend.js'), /staff_notifications|emitOutreachDelivered/)
  const board = read('src/components/evaluation/ReviewReleaseQueue.jsx')
  assert.match(board, /Mark as won't release/)
  assert.match(board, /Put back/)
})

test('the migration runs on Postgres and its RPCs keep to the caller and to unreleasable rows', async () => {
  const { PGlite } = await import('@electric-sql/pglite')
  const pg = new PGlite()
  await pg.exec(`
    DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    CREATE TABLE public.user_profiles (id uuid PRIMARY KEY);
    CREATE FUNCTION public.portal_profile_id() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT nullif(current_setting('app.me', true), '')::uuid $f$;
    CREATE FUNCTION public.is_active_owner_or_admin() RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT coalesce(current_setting('app.admin', true), '') = 'yes' $f$;
    CREATE TABLE public.staff_notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), recipient_profile_id uuid, in_app_read_at timestamptz, updated_at timestamptz, created_at timestamptz DEFAULT now());
    CREATE TABLE public.evaluation_responses (id uuid PRIMARY KEY);
    CREATE TABLE public.evaluation_response_unit_release (response_id uuid PRIMARY KEY, snapshot_source text, release_state text, hist_preceptor_label text, unit_leader_eligible_at timestamptz);
    INSERT INTO user_profiles VALUES ('00000000-0000-4000-8000-00000000000a'), ('00000000-0000-4000-8000-00000000000b');
    INSERT INTO staff_notifications (id, recipient_profile_id, in_app_read_at) VALUES
      ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', now()),
      ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-00000000000a', NULL),
      ('10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-00000000000b', now());
    INSERT INTO evaluation_responses VALUES ('20000000-0000-4000-8000-000000000001'), ('20000000-0000-4000-8000-000000000002');
    INSERT INTO evaluation_response_unit_release VALUES
      ('20000000-0000-4000-8000-000000000001', 'backfill_unverified', 'pending', 'Pat', now()),
      ('20000000-0000-4000-8000-000000000002', 'submission_trigger', 'pending', 'Pat', now());`)
  await pg.exec(read('supabase/migrations/20261112000000_action_center_dismiss.sql'))
  await pg.exec(`SET app.me = '00000000-0000-4000-8000-00000000000a'`)
  const one = async q => (await pg.query(q)).rows[0]
  assert.equal((await one(`SELECT dismiss_staff_notifications(NULL) AS n`)).n, 1, 'Clear read takes my one read notification only')
  assert.equal((await one(`SELECT count(*)::int AS n FROM staff_notifications WHERE dismissed_at IS NOT NULL`)).n, 1)
  assert.equal((await one(`SELECT dismiss_staff_notifications(ARRAY['10000000-0000-4000-8000-000000000003']::uuid[]) AS n`)).n, 0, "never another person's")
  assert.equal((await one(`SELECT dismiss_staff_notifications(ARRAY['10000000-0000-4000-8000-000000000002']::uuid[]) AS n`)).n, 1)
  assert.ok((await one(`SELECT in_app_read_at FROM staff_notifications WHERE id = '10000000-0000-4000-8000-000000000002'`)).in_app_read_at, 'a dismissed one is read too')
  assert.equal((await one(`SELECT restore_staff_notifications(ARRAY['10000000-0000-4000-8000-000000000002']::uuid[]) AS n`)).n, 1)

  assert.equal((await one(`SELECT ul_eval_withhold_response('20000000-0000-4000-8000-000000000001') AS r`)).r.status, 'not_authorized')
  await pg.exec(`SET app.admin = 'yes'`)
  assert.equal((await one(`SELECT ul_eval_withhold_response('20000000-0000-4000-8000-000000000002') AS r`)).r.status, 'releasable')
  assert.equal((await one(`SELECT ul_eval_withhold_response('20000000-0000-4000-8000-000000000001') AS r`)).r.status, 'success')
  assert.equal((await one(`SELECT ul_eval_withhold_response('20000000-0000-4000-8000-000000000001') AS r`)).r.status, 'no_change')
  assert.equal((await one(`SELECT ul_eval_unwithhold_response('20000000-0000-4000-8000-000000000001') AS r`)).r.status, 'success')
  assert.equal((await one(`SELECT ul_eval_withhold_response('20000000-0000-4000-8000-000000000001') AS r`)).r.status, 'success', 'it can be marked again')
  assert.equal((await one(`SELECT count(*)::int AS n FROM evaluation_release_withholds`)).n, 2, 'the undone record stays')
  await pg.close()
})
