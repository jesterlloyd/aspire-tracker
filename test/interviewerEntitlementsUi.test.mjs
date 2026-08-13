// INTERVIEWER-ENTITLEMENTS-UI-1: the management surface, verified on both halves.
//
//   1. The ENDPOINT (api/interviewer-entitlements.js) is EXECUTED with only its
//      supabase client and caller verification substituted, so grant, revoke,
//      idempotency, multi-cohort, and the Owner/Admin gate all run for real.
//   2. The CLIENT derivation (src/lib/interviewerEntitlements.js) is executed
//      against raw ledger shapes, because `list` returns every row for every
//      interviewer INCLUDING revoked history and has no interviewer filter -
//      so "what does this person actually hold" is real client logic.
//   3. The component is checked for the things a behavioral test cannot reach:
//      that it only writes through the endpoint, and only renders for an
//      interviewer.
//
// No database is touched and no production entitlement is created or revoked.
//
// Run: node --test test/interviewerEntitlementsUi.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import { activeCohortIds, activeEntitlements, grantableCohorts } from '../src/lib/interviewerEntitlements.js';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');

const SUMMER = 'c0000001-0000-4000-8000-000000000001';
const FALL   = 'c0000002-0000-4000-8000-000000000002';
const SPRING = 'c0000003-0000-4000-8000-000000000003';
const RINKA  = 'a0000003-0000-4000-8000-000000000003';
const JEN    = 'a0000001-0000-4000-8000-000000000001';
const ADMIN  = 'b0000001-0000-4000-8000-000000000001';

const COHORTS = [{ id: SUMMER, name: 'Summer 2026' }, { id: FALL, name: 'Fall 2026' }, { id: SPRING, name: 'Spring 2027' }];

// ── 1. The endpoint, executed ───────────────────────────────────────────────

/** In-memory ledger honouring the filters the endpoint actually uses. */
function makeDb(state) {
  const match = (row, f) =>
    (f.interviewer_profile_id === undefined || row.interviewer_profile_id === f.interviewer_profile_id)
    && (f.cohort_id === undefined || row.cohort_id === f.cohort_id)
    && (f.revoked_at !== null || row.revoked_at === null)
    && (f.id === undefined || row.id === f.id);

  return {
    from(table) {
      const f = {};
      let pending = null;
      const b = {
        select() { return b; },
        eq(c, v) { f[c] = v; return b; },
        is(c, v) { f[c] = v; return b; },
        order() { return b; },
        insert(row) { pending = { kind: 'insert', row }; return b; },
        update(patch) { pending = { kind: 'update', patch }; return b; },
        single() { return b.maybeSingle(); },
        async maybeSingle() {
          const r = await b.then(x => x);
          if (r.error) return r;
          if (pending?.kind === 'insert') return { data: r.data[0] || null, error: null };
          return { data: (r.data || [])[0] || null, error: null };
        },
        then(resolve) {
          if (table === 'user_profiles') {
            return resolve({ data: state.profiles.filter(p => p.id === f.id), error: null });
          }
          if (table === 'cohorts') {
            return resolve({ data: COHORTS.filter(c => c.id === f.id), error: null });
          }
          if (pending?.kind === 'insert') {
            const row = {
              id: `e${state.rows.length + 1}`, revoked_at: null, revoked_by_profile_id: null,
              granted_at: `2026-08-1${state.rows.length}T00:00:00Z`, ...pending.row,
            };
            // uq_ice_active: at most one ACTIVE row per (interviewer, cohort).
            if (state.rows.some(r => r.interviewer_profile_id === row.interviewer_profile_id
              && r.cohort_id === row.cohort_id && r.revoked_at === null)) {
              return resolve({ data: null, error: { code: '23505' } });
            }
            state.rows.push(row);
            return resolve({ data: [row], error: null });
          }
          if (pending?.kind === 'update') {
            const hit = state.rows.filter(r => match(r, f));
            hit.forEach(r => Object.assign(r, pending.patch));
            return resolve({ data: hit, error: null });
          }
          return resolve({ data: state.rows.filter(r => match(r, f)), error: null });
        },
      };
      return b;
    },
  };
}

const src = readFileSync(join(repo, 'api/interviewer-entitlements.js'), 'utf8');
const dir = mkdtempSync(join(tmpdir(), 'ice-'));
writeFileSync(join(dir, 'fake.mjs'), `
  export let db = null, caller = null;
  export function __set(d, c) { db = d; caller = c; }
  export function getServiceDb() { return db; }
  export async function verifyStaffCaller() { return caller; }
`);
writeFileSync(join(dir, 'handler.mjs'), src
  .replace(/from '\.\/lib\/portalAuth\.js'/, `from ${JSON.stringify(pathToFileURL(join(dir, 'fake.mjs')).href)}`)
  .replace(/from '\.\/lib\/messagesAuth\.js'/, `from ${JSON.stringify(pathToFileURL(join(dir, 'fake.mjs')).href)}`));
const mod = await import(pathToFileURL(join(dir, 'handler.mjs')).href);
const fake = await import(pathToFileURL(join(dir, 'fake.mjs')).href);
rmSync(dir, { recursive: true, force: true });

const OWNER_CALLER = { ok: true, profile: { id: ADMIN, role: 'owner', is_active: true } };
const INTERVIEWER_DENIED = { ok: false, status: 403, reason: 'staff_role_required' };

async function call(body, { caller = OWNER_CALLER, state } = {}) {
  fake.__set(makeDb(state), caller);
  let payload = null, code = 0;
  const res = { setHeader() {}, status(c) { code = c; return res; }, json(j) { payload = j; return res; } };
  await mod.default({ method: 'POST', body }, res);
  return { code, payload };
}

const freshState = () => ({
  rows: [],
  profiles: [
    { id: RINKA, role: 'interviewer', is_active: true },
    { id: JEN, role: 'interviewer', is_active: true },
    { id: ADMIN, role: 'owner', is_active: true },
  ],
});

test('GRANT: an Owner grants a cohort to an interviewer', async () => {
  const state = freshState();
  const r = await call({ action: 'grant', interviewer_profile_id: RINKA, cohort_id: SUMMER }, { state });
  assert.equal(r.code, 200);
  assert.equal(r.payload.idempotent, false);
  assert.equal(state.rows.length, 1);
  assert.equal(state.rows[0].granted_by_profile_id, ADMIN, 'the actor is the verified caller');
});

test('GRANT is idempotent: a second grant creates no second active row', async () => {
  const state = freshState();
  await call({ action: 'grant', interviewer_profile_id: RINKA, cohort_id: SUMMER }, { state });
  const again = await call({ action: 'grant', interviewer_profile_id: RINKA, cohort_id: SUMMER }, { state });
  assert.equal(again.payload.idempotent, true);
  assert.equal(state.rows.length, 1);
});

test('MULTI-COHORT: one interviewer holds several cohorts at once', async () => {
  const state = freshState();
  await call({ action: 'grant', interviewer_profile_id: JEN, cohort_id: SUMMER }, { state });
  await call({ action: 'grant', interviewer_profile_id: JEN, cohort_id: FALL }, { state });
  const live = state.rows.filter(r => r.interviewer_profile_id === JEN && r.revoked_at === null);
  assert.equal(live.length, 2, 'multi-cohort entitlement must be preserved');
  assert.deepEqual(live.map(r => r.cohort_id).sort(), [SUMMER, FALL].sort());
});

test('REVOKE: removes one cohort and leaves the others intact', async () => {
  const state = freshState();
  await call({ action: 'grant', interviewer_profile_id: JEN, cohort_id: SUMMER }, { state });
  await call({ action: 'grant', interviewer_profile_id: JEN, cohort_id: FALL }, { state });
  const r = await call({ action: 'revoke', interviewer_profile_id: JEN, cohort_id: SUMMER }, { state });
  assert.equal(r.payload.revoked, true);
  const live = state.rows.filter(x => x.revoked_at === null);
  assert.deepEqual(live.map(x => x.cohort_id), [FALL], 'only the named cohort is revoked');
  const revoked = state.rows.find(x => x.cohort_id === SUMMER);
  assert.equal(revoked.revoked_by_profile_id, ADMIN, 'revocation is attributed');
});

test('REVOKE is idempotent when nothing is active', async () => {
  const state = freshState();
  const r = await call({ action: 'revoke', interviewer_profile_id: RINKA, cohort_id: SUMMER }, { state });
  assert.equal(r.code, 200);
  assert.equal(r.payload.revoked, false);
  assert.equal(r.payload.idempotent, true);
});

test('re-grant after revoke inserts a NEW row and keeps the revoked history', async () => {
  const state = freshState();
  await call({ action: 'grant', interviewer_profile_id: RINKA, cohort_id: SUMMER }, { state });
  await call({ action: 'revoke', interviewer_profile_id: RINKA, cohort_id: SUMMER }, { state });
  await call({ action: 'grant', interviewer_profile_id: RINKA, cohort_id: SUMMER }, { state });
  assert.equal(state.rows.length, 2, 'history is immutable; a re-grant is a new row');
  assert.equal(state.rows.filter(r => r.revoked_at === null).length, 1);
  assert.ok(state.rows[0].revoked_at, 'the original revoked row is never un-revoked');
});

test('AUTHORIZATION: an Interviewer is denied every action', async () => {
  for (const action of ['list', 'grant', 'revoke']) {
    const r = await call(
      { action, interviewer_profile_id: JEN, cohort_id: SUMMER },
      { caller: INTERVIEWER_DENIED, state: freshState() },
    );
    assert.equal(r.code, 403, `${action} must be denied`);
    assert.equal(r.payload.error, 'staff_role_required');
  }
});

test('AUTHORIZATION: the target must be an active interviewer', async () => {
  const state = freshState();
  const r = await call({ action: 'grant', interviewer_profile_id: ADMIN, cohort_id: SUMMER }, { state });
  assert.equal(r.code, 409);
  assert.equal(r.payload.error, 'target_not_interviewer');
  assert.equal(state.rows.length, 0, 'nothing is written on a rejected target');
});

// ── 2. The client derivation ────────────────────────────────────────────────

test('CLIENT: revoked rows are never shown as access', () => {
  const rows = [
    { id: 'e1', interviewer_profile_id: RINKA, cohort_id: SUMMER, revoked_at: '2026-08-01T00:00:00Z', granted_at: '2026-07-01T00:00:00Z' },
  ];
  assert.deepEqual(activeCohortIds(rows, RINKA), [], 'a revoked grant is not access');
  assert.deepEqual(activeEntitlements(rows, RINKA, COHORTS), []);
});

test('CLIENT: another interviewer\'s rows never leak into this account', () => {
  const rows = [
    { id: 'e1', interviewer_profile_id: JEN, cohort_id: FALL, revoked_at: null, granted_at: '2026-08-01T00:00:00Z' },
  ];
  // `list` returns the WHOLE ledger, so this filter is load-bearing.
  assert.deepEqual(activeCohortIds(rows, RINKA), []);
  assert.deepEqual(activeCohortIds(rows, JEN), [FALL]);
});

test('CLIENT: multi-cohort renders both, newest first, with names', () => {
  const rows = [
    { id: 'e1', interviewer_profile_id: JEN, cohort_id: SUMMER, revoked_at: null, granted_at: '2026-07-01T00:00:00Z' },
    { id: 'e2', interviewer_profile_id: JEN, cohort_id: FALL, revoked_at: null, granted_at: '2026-08-01T00:00:00Z' },
  ];
  assert.deepEqual(activeEntitlements(rows, JEN, COHORTS).map(e => e.cohortName), ['Fall 2026', 'Summer 2026']);
});

test('CLIENT: the no-entitlement state is an empty list, not an error', () => {
  assert.deepEqual(activeCohortIds([], RINKA), []);
  assert.deepEqual(activeEntitlements([], RINKA, COHORTS), []);
  // ...and every cohort is offered for granting.
  assert.equal(grantableCohorts(COHORTS, []).length, 3);
});

test('CLIENT: already-held cohorts are not offered again', () => {
  assert.deepEqual(grantableCohorts(COHORTS, [SUMMER, FALL]).map(c => c.id), [SPRING]);
  assert.deepEqual(grantableCohorts(COHORTS, [SUMMER, FALL, SPRING]), []);
});

test('CLIENT: a grant for an unknown cohort is still shown, never hidden', () => {
  const rows = [{ id: 'e1', interviewer_profile_id: JEN, cohort_id: 'gone', revoked_at: null, granted_at: '2026-08-01T00:00:00Z' }];
  assert.deepEqual(activeEntitlements(rows, JEN, COHORTS).map(e => e.cohortName), ['Unknown cohort']);
});

// ── 3. Component guards ─────────────────────────────────────────────────────

const section = readFileSync(join(repo, 'src/components/settings/InterviewerEntitlementsSection.jsx'), 'utf8');
const modal = readFileSync(join(repo, 'src/components/settings/AccountProfileModal.jsx'), 'utf8');
const hook = readFileSync(join(repo, 'src/lib/useInterviewerEntitlements.js'), 'utf8');
const drawer = readFileSync(join(repo, 'src/components/settings/AccountDetailsDrawer.jsx'), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('the client writes ONLY through the entitlements endpoint', () => {
  // The fetcher lives in the shared hook (both the drawer and the modal read
  // one query), so the guarantee spans both files and is asserted across both.
  const codes = { section: strip(section), hook: strip(hook) };
  assert.match(codes.hook, /fetch\('\/api\/interviewer-entitlements'/,
    'the one writer is the endpoint');
  for (const [name, code] of Object.entries(codes)) {
    // No direct table access from the browser: RLS grants it none, and the
    // endpoint is the only audited writer.
    assert.doesNotMatch(code, /from\('interviewer_cohort_entitlements'\)/, name);
    assert.doesNotMatch(code, /\.insert\(|\.update\(|\.delete\(/, name);
  }
  // The section reaches the server only through the shared fetcher.
  assert.match(codes.section, /postEntitlements\(/);
  // \b matters: `refetch(` contains `fetch(` and is legitimate here.
  assert.doesNotMatch(codes.section, /\bfetch\(/, 'the section does not fetch directly');
});

test('the read-only drawer row never mutates', () => {
  const code = strip(drawer);
  assert.match(code, /useInterviewerEntitlements\(/, 'the drawer reads the same query');
  assert.doesNotMatch(code, /postEntitlements\(/, 'the drawer must not write');
  assert.doesNotMatch(code, /action: 'grant'|action: 'revoke'/);
});

test('the section renders only for a persisted interviewer account', () => {
  const code = strip(modal);
  const at = code.indexOf('<InterviewerEntitlementsSection');
  assert.ok(at > -1, 'the section must be mounted');
  // The guard immediately preceding the mount. Scoped to this block on purpose:
  // `draft.role === 'interviewer'` legitimately appears elsewhere in the modal
  // (section B's interviewer-access controls), so a file-wide negative would be
  // asserting something untrue about unrelated code.
  const guard = code.slice(Math.max(0, at - 200), at);
  assert.match(guard, /\(user\.role \|\| ''\) === 'interviewer'/,
    'gated on the SAVED role: an unsaved draft role would fail target_not_interviewer server-side');
  assert.match(guard, /!isOwner/, 'the Owner is never entitlement-scoped');
  assert.doesNotMatch(guard, /draft\.role/, 'the mount must not depend on the unsaved draft');
});

test('nothing auto-grants on role assignment', () => {
  // The only writes are the two the operator triggers explicitly.
  const code = strip(section);
  const grants = code.match(/action: 'grant'|'grant'\)/g) || [];
  assert.ok(grants.length > 0, 'grant is reachable');
  assert.doesNotMatch(code, /useEffect\([^)]*grant/, 'no grant fires from an effect');
});
