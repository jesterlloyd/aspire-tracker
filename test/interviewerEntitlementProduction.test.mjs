// INTERVIEWER-ENTITLEMENT-AUDIT: the three REAL production entitlement states,
// executed against the real authorization code on both surfaces.
//
// Production query, 2026-08-11:
//   Jennifer Gidaya  -> Summer 2026 + Fall 2026   (multi-cohort)
//   Keith Hoshal     -> Summer 2026               (single cohort)
//   Rinka Shiraishi  -> no active entitlement     (none)
//
// WHY THIS FILE EXISTS
// Every student-file endpoint test in the repo is a SOURCE GUARD, so the
// authorization branch that decides an interviewer's access had never actually
// executed in a test. That is the same gap that let the certificate reconcile
// bug ship. This file EXECUTES it: api/student-file-access.js runs verbatim with
// only its supabase client and caller verification substituted, and the skill's
// gate 4 runs directly. activeEntitledCohortIds is deliberately NOT faked - the
// entitlement lookup is the thing under test.
//
// No database is touched, no signed URL is minted against real storage, and no
// entitlement is granted or revoked. Rinka is never given anything.
//
// Run: node --test test/interviewerEntitlementProduction.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import { authorizeStudentResumeAccess, DENY } from '../lib/server/keith/skillAuthorization.js';
import { activeEntitledCohortIds } from '../lib/server/interviewerEntitlements.js';
import { resolveStudentByName, runResumeInterviewQuestions } from '../lib/server/keith/resumeInterviewQuestions.js';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');

// ── The production shape, as ids ────────────────────────────────────────────
const SUMMER_2026 = 'c0000001-0000-4000-8000-000000000001';
const FALL_2026   = 'c0000002-0000-4000-8000-000000000002';
const SPRING_2027 = 'c0000003-0000-4000-8000-000000000003'; // nobody is entitled

const JENNIFER = { profileId: 'a0000001-0000-4000-8000-000000000001', name: 'Jennifer Gidaya',  cohorts: [SUMMER_2026, FALL_2026] };
const KEITH    = { profileId: 'a0000002-0000-4000-8000-000000000002', name: 'Keith Hoshal',     cohorts: [SUMMER_2026] };
const RINKA    = { profileId: 'a0000003-0000-4000-8000-000000000003', name: 'Rinka Shiraishi',  cohorts: [] };

// Stored refs use the canonical `<cohortId>/<studentId>/<file>` shape that
// studentFiles.parseStoredFileRef accepts; anything else is 'unknown'.
const mk = (id, cohort_id, first_name, last_name) => ({
  id, cohort_id, first_name, last_name,
  resume_url: `${cohort_id}/${id}/resume.pdf`,
  headshot_url: `${cohort_id}/${id}/headshot.jpg`,
});
const STUDENTS = [
  mk('d0000001-0000-4000-8000-000000000001', SUMMER_2026, 'Ana', 'Reyes'),
  mk('d0000002-0000-4000-8000-000000000002', FALL_2026, 'Beth', 'Okafor'),
  mk('d0000003-0000-4000-8000-000000000003', SPRING_2027, 'Cara', 'Lin'),
];
const inSummer = STUDENTS[0], inFall = STUDENTS[1], inSpring = STUDENTS[2];

/**
 * A PostgREST-shaped fake holding the entitlement ledger exactly as production
 * reports it. Every builder method returns `this`; awaiting resolves per table.
 * The entitlement table honors the real query's filters, including
 * `.is('revoked_at', null)`, so a revoked row would not count.
 */
function makeDb(ledger) {
  const rows = [];
  for (const [profileId, cohorts] of Object.entries(ledger)) {
    for (const cohort_id of cohorts) rows.push({ interviewer_profile_id: profileId, cohort_id, revoked_at: null });
  }
  return {
    signedPaths: [],
    from(table) {
      const q = { table, filters: {}, inIds: null };
      const builder = {
        select() { return builder; },
        eq(col, val) { q.filters[col] = val; return builder; },
        is(col, val) { q.filters[col] = val; return builder; },
        in(col, vals) { q.inIds = vals; return builder; },
        then(resolve) { resolve(run()); },
      };
      const run = () => {
        if (q.table === 'interviewer_cohort_entitlements') {
          const data = rows
            .filter(r => r.interviewer_profile_id === q.filters.interviewer_profile_id)
            .filter(r => (q.filters.revoked_at === null ? r.revoked_at === null : true))
            .map(r => ({ cohort_id: r.cohort_id }));
          return { data, error: null };
        }
        if (q.table === 'students') {
          const ids = q.inIds || [];
          return { data: STUDENTS.filter(s => ids.includes(s.id)), error: null };
        }
        return { data: [], error: null };
      };
      return builder;
    },
    storage: {
      from() {
        return {
          createSignedUrls: async (paths) => ({
            data: paths.map(p => ({ signedUrl: `https://signed.example/${p}`, error: null })),
            error: null,
          }),
        };
      },
    },
  };
}

// ── Load api/student-file-access.js with only its deps substituted ──────────
let loadHandler;
{
  const src = readFileSync(join(repo, 'api/student-file-access.js'), 'utf8');
  const dir = mkdtempSync(join(tmpdir(), 'sfa-'));

  writeFileSync(join(dir, 'fake-admin.mjs'), `
    export let db = null;
    export function __setDb(d) { db = d; }
    export default new Proxy({}, {
      get(_t, prop) { return db[prop] !== undefined ? (typeof db[prop] === 'function' ? db[prop].bind(db) : db[prop]) : undefined; },
    });
  `);
  writeFileSync(join(dir, 'fake-auth.mjs'), `
    export let caller = null;
    export function __setCaller(c) { caller = c; }
    export async function verifyPortalCaller() { return caller; }
  `);

  const rewritten = src
    .replace(/from '\.\.\/lib\/server\/evaluation\/supabase_admin\.js'/, `from ${JSON.stringify(pathToFileURL(join(dir, 'fake-admin.mjs')).href)}`)
    .replace(/from '\.\/lib\/portalAuth\.js'/, `from ${JSON.stringify(pathToFileURL(join(dir, 'fake-auth.mjs')).href)}`)
    .replace(/from '\.\.\/lib\/server\/interviewerEntitlements\.js'/, `from ${JSON.stringify(pathToFileURL(join(repo, 'lib/server/interviewerEntitlements.js')).href)}`)
    .replace(/from '\.\.\/lib\/server\/studentFiles\.js'/, `from ${JSON.stringify(pathToFileURL(join(repo, 'lib/server/studentFiles.js')).href)}`)
    .replace(/from '\.\.\/src\/lib\/permissions\.js'/, `from ${JSON.stringify(pathToFileURL(join(repo, 'src/lib/permissions.js')).href)}`);

  const modPath = join(dir, 'handler.mjs');
  writeFileSync(modPath, rewritten);

  const [mod, admin, auth] = await Promise.all([
    import(pathToFileURL(modPath).href),
    import(pathToFileURL(join(dir, 'fake-admin.mjs')).href),
    import(pathToFileURL(join(dir, 'fake-auth.mjs')).href),
  ]);
  rmSync(dir, { recursive: true, force: true });

  /** Run the real endpoint as `who` asking for `kind` on `student`. */
  loadHandler = async ({ who, student, kind, ledger }) => {
    admin.__setDb(makeDb(ledger));
    auth.__setCaller({
      authenticated: true,
      profile: { id: who.profileId, role: 'interviewer', is_active: true },
    });
    let payload = null, code = 0;
    const res = {
      setHeader() {},
      status(c) { code = c; return res; },
      json(j) { payload = j; return res; },
    };
    await mod.default({ method: 'POST', body: { student_id: student.id, kind } }, res);
    return { code, payload };
  };
}

const LEDGER = {
  [JENNIFER.profileId]: JENNIFER.cohorts,
  [KEITH.profileId]: KEITH.cohorts,
  [RINKA.profileId]: RINKA.cohorts,
};

/** Did the file endpoint hand back a usable URL? */
async function fileAccess(who, student, kind, ledger = LEDGER) {
  const { code, payload } = await loadHandler({ who, student, kind, ledger });
  assert.equal(code, 200, 'an unentitled read is a null url, never an error');
  return payload.signed_url !== null;
}

/** Did the Keith skill's gate 4 authorize the resume? */
async function skillResume(who, student, ledger = LEDGER) {
  const r = await authorizeStudentResumeAccess({
    db: makeDb(ledger),
    caller: { profileId: who.profileId, role: 'interviewer' },
    student,
  });
  return r;
}

// ── Jennifer: two cohorts, both must work ───────────────────────────────────

test('Jennifer holds BOTH cohorts and the ledger returns both', async () => {
  const set = await activeEntitledCohortIds(makeDb(LEDGER), JENNIFER.profileId);
  assert.equal(set.size, 2, 'multi-cohort entitlement must be preserved');
  assert.ok(set.has(SUMMER_2026) && set.has(FALL_2026));
});

test('Jennifer: resume + headshot work in Summer 2026', async () => {
  assert.equal(await fileAccess(JENNIFER, inSummer, 'resume'), true);
  assert.equal(await fileAccess(JENNIFER, inSummer, 'headshot'), true);
  assert.equal((await skillResume(JENNIFER, inSummer)).ok, true);
});

test('Jennifer: resume + headshot work in Fall 2026 too (second entitlement)', async () => {
  assert.equal(await fileAccess(JENNIFER, inFall, 'resume'), true);
  assert.equal(await fileAccess(JENNIFER, inFall, 'headshot'), true);
  assert.equal((await skillResume(JENNIFER, inFall)).ok, true);
});

test('Jennifer: denied outside her entitled cohorts', async () => {
  assert.equal(await fileAccess(JENNIFER, inSpring, 'resume'), false);
  assert.equal(await fileAccess(JENNIFER, inSpring, 'headshot'), false);
  const gate = await skillResume(JENNIFER, inSpring);
  assert.equal(gate.ok, false);
  assert.equal(gate.reason, DENY.NOT_ENTITLED);
});

// ── Keith Hoshal: one cohort ────────────────────────────────────────────────

test('Keith: resume + headshot work in Summer 2026', async () => {
  assert.equal(await fileAccess(KEITH, inSummer, 'resume'), true);
  assert.equal(await fileAccess(KEITH, inSummer, 'headshot'), true);
  assert.equal((await skillResume(KEITH, inSummer)).ok, true);
});

test('Keith: denied in Fall 2026, where Jennifer succeeds', async () => {
  assert.equal(await fileAccess(KEITH, inFall, 'resume'), false);
  assert.equal(await fileAccess(KEITH, inFall, 'headshot'), false);
  assert.equal((await skillResume(KEITH, inFall)).reason, DENY.NOT_ENTITLED);
  // The same student, same moment, different interviewer: entitlement is the
  // ONLY difference between these two outcomes.
  assert.equal(await fileAccess(JENNIFER, inFall, 'resume'), true);
});

test('Keith: denied outside Summer entirely', async () => {
  assert.equal(await fileAccess(KEITH, inSpring, 'resume'), false);
  assert.equal(await fileAccess(KEITH, inSpring, 'headshot'), false);
});

// ── Rinka: the absence of a row is the whole cause ──────────────────────────

test('Rinka: every surface denies her, on every student', async () => {
  for (const s of STUDENTS) {
    assert.equal(await fileAccess(RINKA, s, 'headshot'), false, `headshot ${s.first_name}`);
    assert.equal(await fileAccess(RINKA, s, 'resume'), false, `resume ${s.first_name}`);
    assert.equal((await skillResume(RINKA, s)).reason, DENY.NOT_ENTITLED, `skill ${s.first_name}`);
  }
});

test('Rinka: the ONLY missing variable is the entitlement row', async () => {
  // Same account, same role, same students, same code. Add one row to the
  // ledger and every surface opens. Nothing else changed, so nothing else is
  // the cause. (This is a fixture, not a grant: production is untouched.)
  const withRow = { ...LEDGER, [RINKA.profileId]: [SUMMER_2026] };
  assert.equal(await fileAccess(RINKA, inSummer, 'headshot', withRow), true);
  assert.equal(await fileAccess(RINKA, inSummer, 'resume', withRow), true);
  assert.equal((await skillResume(RINKA, inSummer, withRow)).ok, true);
  // ...and she is still correctly denied outside that one cohort.
  assert.equal(await fileAccess(RINKA, inFall, 'resume', withRow), false);
});

test('a revoked row does not count as entitlement', async () => {
  const db = makeDb({ [RINKA.profileId]: [] });
  const set = await activeEntitledCohortIds(db, RINKA.profileId);
  assert.equal(set.size, 0);
});

// ── The two /resume-interview-questions runtime defects ─────────────────────

/** A roster-shaped db whose students table honours eq/in on cohort_id + limit. */
function makeRosterDb(roster, ledger = LEDGER) {
  const base = makeDb(ledger);
  return {
    ...base,
    from(table) {
      if (table !== 'students') return base.from(table);
      const q = { eqCohort: null, inCohorts: null, limit: Infinity };
      const b = {
        select() { return b; },
        limit(n) { q.limit = n; return b; },
        eq(col, v) { if (col === 'cohort_id') q.eqCohort = v; return b; },
        in(col, v) { if (col === 'cohort_id') q.inCohorts = v; return b; },
        then(resolve) {
          let rows = roster;
          if (q.eqCohort) rows = rows.filter(s => s.cohort_id === q.eqCohort);
          if (q.inCohorts) rows = rows.filter(s => q.inCohorts.includes(s.cohort_id));
          resolve({ data: rows.slice(0, q.limit), error: null });
        },
      };
      return b;
    },
  };
}

test('DEFECT 1: a cohort larger than 25 no longer hides students', async () => {
  // 60 students in one cohort; the one we ask about is deliberately last, so a
  // 25-row ceiling could never see her.
  const big = Array.from({ length: 60 }, (_, i) => ({
    id: `d00000${String(i).padStart(2, '0')}-0000-4000-8000-00000000000${i % 10}`,
    first_name: `Student${i}`, last_name: `Sur${i}`, school: 'CSUN',
    cohort_id: SUMMER_2026, resume_url: '',
  }));
  big[59].first_name = 'Marisol'; big[59].last_name = 'Vega';

  const r = await resolveStudentByName(makeRosterDb(big), {
    name: 'What can I ask Marisol Vega in her interview?',
    cohortId: SUMMER_2026,
  });
  assert.equal(r.ok, true, 'the 60th student must be resolvable');
  assert.equal(r.student.last_name, 'Vega');
});

// Defect 2 is driven through the REAL runner, so the module-private resolution
// scope executes rather than being mirrored by the test. Every fixture student
// has an empty resume_url, so a resolved student stops at "no resume on file":
// that proves WHICH student was resolved without needing real PDF bytes, and
// without the skill ever calling a model.
const SKILL = Object.freeze({
  id: 'skill-1', slug: 'resume-interview-questions', version: 1,
  status: 'active', enabled: true, allowed_roles: ['interviewer'],
  required_data: ['student_resume_read'], model_route: null,
});
const FALL_ROSTER = [
  { id: 'd0000001-0000-4000-8000-000000000001', first_name: 'Ana', last_name: 'Reyes', school: 'APU', cohort_id: SUMMER_2026, resume_url: '' },
  { id: 'd0000002-0000-4000-8000-000000000002', first_name: 'Beth', last_name: 'Okafor', school: 'CSUN', cohort_id: FALL_2026, resume_url: '' },
];

const runFor = (who, roster = FALL_ROSTER) => runResumeInterviewQuestions({
  db: makeRosterDb(roster),
  skill: SKILL,
  instructionBody: 'fixture instructions',
  caller: { profileId: who.profileId, role: 'interviewer' },
  studentName: 'What can I ask Beth Okafor?',
  cohortId: SUMMER_2026,          // her ACTIVE cohort, not Beth's
  requestId: 'req-1',
  invocationMode: 'slash_slug',
  complete: async () => { throw new Error('the model must never be reached in this test'); },
});

test('DEFECT 2: Jennifer resolves a Fall student while Summer is active', async () => {
  const r = await runFor(JENNIFER);
  assert.equal(r.audit.studentId, FALL_ROSTER[1].id, 'her second entitled cohort must be searchable');
  assert.equal(r.audit.denialReason, 'no_resume_on_file', 'resolved and authorized, just no file');
  assert.match(r.text, /Beth Okafor/);
});

test('DEFECT 2: Keith still cannot reach Fall, where he holds no entitlement', async () => {
  const r = await runFor(KEITH);
  assert.equal(r.audit.studentId, null, 'a cohort he is not entitled to stays out of scope');
  assert.equal(r.audit.denialReason, DENY.STUDENT_NOT_FOUND);
});

test('DEFECT 2: Rinka, with no entitlement, falls back to the active cohort only', async () => {
  const r = await runFor(RINKA);
  // She can still RESOLVE within the active cohort (resolution is not
  // authorization), but any student she resolves is then denied by gate 4.
  const inScope = await runResumeInterviewQuestions({
    db: makeRosterDb(FALL_ROSTER), skill: SKILL, instructionBody: 'x',
    caller: { profileId: RINKA.profileId, role: 'interviewer' },
    studentName: 'What can I ask Ana Reyes?', cohortId: SUMMER_2026,
    requestId: 'req-2', invocationMode: 'slash_slug',
    complete: async () => { throw new Error('unreachable'); },
  });
  assert.equal(inScope.audit.denialReason, DENY.NOT_ENTITLED, 'gate 4 denies her');
  assert.equal(r.audit.studentId, null, 'and Fall was never in her search scope');
});

test('widening SEARCH grants nothing: gate 4 still decides', async () => {
  const gate = await skillResume(JENNIFER, inSpring);
  assert.equal(gate.ok, false);
  assert.equal(gate.reason, DENY.NOT_ENTITLED);
});
