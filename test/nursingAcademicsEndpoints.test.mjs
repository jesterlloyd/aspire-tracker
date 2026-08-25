// NURSING-ACADEMICS-1: the portal endpoints and the Owner-gated admin endpoint.
// Pure unit tests over the DI handler factories plus source assertions on the
// authorization guard. No network, no live database, no email.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

process.env.VITE_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.VITE_SUPABASE_ANON_KEY ||= 'anon-key'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'service-key'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

const { createAcademicsCommunityBenefitHandler } = await import('../api/portal/academics-community-benefit.js')
const { createAcademicsBenefitExportHandler } = await import('../api/portal/academics-benefit-export.js')
const { createAcademicsCalendarHandler } = await import('../api/portal/academics-calendar.js')
const { createAcademicsContactsHandler } = await import('../api/portal/academics-contacts.js')
const { createCommunityBenefitAdminHandler } = await import('../api/community-benefit-admin.js')
const { fetchAllRows } = await import('../api/lib/fetchAllRows.js')

function makeRes() {
  const res = {
    headers: {}, statusCode: null, body: null, ended: false,
    setHeader(k, v) { res.headers[k.toLowerCase()] = v },
    status(c) { res.statusCode = c; return res },
    json(b) { res.body = b; return res },
    send(b) { res.body = b; return res },
    end() { res.ended = true; return res },
  }
  return res
}

const okAuth = { ok: true, db: {}, profile: { id: 'p1', full_name: 'Arturo Academic' } }
const deniedAuth = { ok: false, status: 403, reason: 'nursing_academic_role_required' }

const INPUTS = {
  students: [{
    id: 's1', first_name: 'Ann', last_name: 'Lee', school: 'UCLA', status: 'Completed',
    cohort_id: 'c1', cohort_school_rotation_id: 'r1', program_type: 'MECN',
    course_type: null, hours_required: 144, approved_hours: 60, matched_preceptor: '',
  }],
  rotations: [{ id: 'r1', cohort_id: 'c1', school_name: 'UCLA', rotation_start_date: '2026-08-01', rotation_end_date: '2026-11-15' }],
  cohorts: [{ id: 'c1', name: 'Fall 2026' }],
  cohortNamesById: new Map([['c1', 'Fall 2026']]),
  shiftHoursById: new Map([['s1', { approved: 60, pending: 0, rejected: 0, voided: 0, inProgress: 0 }]]),
  preceptorNameById: new Map([['s1', { name: 'Pat Preceptor, RN', source: 'assignment' }]]),
  rateRows: [{ fiscal_year: 2027, category: 'rn_preceptor', hourly_rate: 65, superseded_at: null }],
  capstoneRows: [],
}

// ── The authorization guard (source assertions: no scope rows, fail closed) ──

test('verifyPortalNursingAcademicCaller checks the nursing_academic grant and nothing widens it', () => {
  const src = read('api/lib/nursingAcademicScope.js')
  assert.match(src, /hasActiveRoleGrant\(db, caller\.profile\.id, 'nursing_academic'\)/)
  assert.match(src, /nursing_academic_role_required/)
  // Organization-wide by design: no scope resolution exists in this module.
  assert.doesNotMatch(src, /user_unit_scopes|user_school_scopes|user_student_links/)
  // The refusal reason is classified client-side as access ended.
  assert.match(read('src/lib/portalAccessState.js'), /'nursing_academic_role_required'/)
})

test('all four portal endpoints authorize through the dedicated guard and never reuse staff endpoints', () => {
  for (const p of ['api/portal/academics-community-benefit.js', 'api/portal/academics-benefit-export.js', 'api/portal/academics-calendar.js', 'api/portal/academics-contacts.js']) {
    const src = read(p)
    assert.match(src, /verifyPortalNursingAcademicCaller/, `${p} uses the guard`)
    assert.match(src, /no-store, private/, `${p} is never shared-cached`)
  }
})

// ── Community-benefit report endpoint ────────────────────────────────────────

test('an unauthorized caller receives the refusal and NO data', async () => {
  const handler = createAcademicsCommunityBenefitHandler({
    verifyCaller: async () => deniedAuth,
    fetchInputs: async () => { throw new Error('must not be called') },
  })
  const res = makeRes()
  await handler({ method: 'GET', query: {} }, res)
  assert.equal(res.statusCode, 403)
  assert.deepEqual(res.body, { error: 'nursing_academic_role_required' })
})

test('an authorized caller gets the organization-wide report with no scope narrowing', async () => {
  const handler = createAcademicsCommunityBenefitHandler({
    verifyCaller: async () => okAuth,
    fetchInputs: async () => INPUTS,
  })
  const res = makeRes()
  await handler({ method: 'GET', query: { fiscal_year: '2027' } }, res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.fiscal_year, 2027)
  assert.equal(res.body.totals.students, 1)
  assert.equal(res.body.totals.students_served, 1)
  assert.equal(res.body.totals.standard_benefit, 3900)
  assert.equal(res.body.can_manage_reporting_inputs, false)
})

test('only the Owner receives the reporting-input shortcut flag', async () => {
  const handler = createAcademicsCommunityBenefitHandler({
    verifyCaller: async () => ({ ...okAuth, profile: { ...okAuth.profile, is_owner: true } }),
    fetchInputs: async () => INPUTS,
  })
  const res = makeRes()
  await handler({ method: 'GET', query: { fiscal_year: '2027' } }, res)
  assert.equal(res.body.can_manage_reporting_inputs, true)
})

test('an invalid fiscal year is a 400; a missing one defaults to the current fiscal year', async () => {
  const handler = createAcademicsCommunityBenefitHandler({
    verifyCaller: async () => okAuth,
    fetchInputs: async () => INPUTS,
    now: () => new Date('2026-12-01T20:00:00Z'), // FY 2027
  })
  const bad = makeRes()
  await handler({ method: 'GET', query: { fiscal_year: 'DROP TABLE' } }, bad)
  assert.equal(bad.statusCode, 400)
  const def = makeRes()
  await handler({ method: 'GET', query: {} }, def)
  assert.equal(def.body.fiscal_year, 2027)
})

test('method gate: POST is refused', async () => {
  const handler = createAcademicsCommunityBenefitHandler({ verifyCaller: async () => okAuth })
  const res = makeRes()
  await handler({ method: 'POST', query: {} }, res)
  assert.equal(res.statusCode, 405)
})

// ── Aggregate CSV export endpoint ────────────────────────────────────────────

test('the export is server-aggregated text/csv with no names, emails, or ids', async () => {
  const handler = createAcademicsBenefitExportHandler({
    verifyCaller: async () => okAuth,
    fetchInputs: async () => INPUTS,
  })
  const res = makeRes()
  await handler({ method: 'GET', query: { fiscal_year: '2027' } }, res)
  assert.equal(res.statusCode, 200)
  assert.match(res.headers['content-type'], /text\/csv/)
  assert.match(res.headers['content-disposition'], /aspire-community-benefit-fy2027\.csv/)
  assert.ok(res.body.startsWith('Fiscal Year,School,Program,Course Type'))
  assert.ok(!res.body.includes('Ann'))
  assert.ok(!res.body.includes('Lee'))
  assert.ok(!res.body.includes('Pat Preceptor')) // preceptor name absent; only the RN category remains
  assert.ok(!res.body.includes('@'))
  assert.doesNotMatch(res.body, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
})

test('the export refuses an unauthorized caller before touching any data', async () => {
  const handler = createAcademicsBenefitExportHandler({
    verifyCaller: async () => deniedAuth,
    fetchInputs: async () => { throw new Error('must not be called') },
  })
  const res = makeRes()
  await handler({ method: 'GET', query: {} }, res)
  assert.equal(res.statusCode, 403)
})

// ── Read-only Contacts endpoint ──────────────────────────────────────────────

test('Contacts refuses an unauthorized caller before reading data', async () => {
  const handler = createAcademicsContactsHandler({
    verifyCaller: async () => deniedAuth,
    fetchContacts: async () => { throw new Error('must not be called') },
  })
  const res = makeRes()
  await handler({ method: 'GET' }, res)
  assert.equal(res.statusCode, 403)
  assert.deepEqual(res.body, { error: 'nursing_academic_role_required' })
})

test('Contacts returns only its allowlisted read-only fields', async () => {
  const handler = createAcademicsContactsHandler({
    verifyCaller: async () => okAuth,
    fetchContacts: async () => [{
      id: 'contact-1', full_name: 'Arturo Academic', preferred_name: 'Arturo',
      email: 'arturo@example.org', phone: '310-555-0100', role: 'Nursing leader',
      category: 'BNI Team', organization: 'Cedars-Sinai', school_name: null,
      unit_name: 'Nursing Education', preferred_contact_method: 'email',
      avatar_url: 'https://example.org/arturo.jpg',
      notes: 'private note', notification_history: ['private'], is_active: true,
    }],
  })
  const res = makeRes()
  await handler({ method: 'GET' }, res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.contacts.length, 1)
  assert.equal(res.body.contacts[0].full_name, 'Arturo Academic')
  assert.equal(res.body.contacts[0].email, 'arturo@example.org')
  assert.equal(res.body.contacts[0].phone, '310-555-0100')
  assert.equal(res.body.contacts[0].avatar_url, 'https://example.org/arturo.jpg')
  assert.ok(!('notes' in res.body.contacts[0]))
  assert.ok(!('notification_history' in res.body.contacts[0]))
  assert.ok(!('is_active' in res.body.contacts[0]))
})

test('Contacts is GET-only', async () => {
  const handler = createAcademicsContactsHandler({ verifyCaller: async () => okAuth })
  const res = makeRes()
  await handler({ method: 'POST' }, res)
  assert.equal(res.statusCode, 405)
  assert.equal(res.headers.allow, 'GET')
})

// ── Calendar endpoint ────────────────────────────────────────────────────────

function calendarDb({ rotations, cohorts, students }) {
  return {
    from(table) {
      const rows = table === 'cohort_school_rotations' ? rotations : table === 'cohorts' ? cohorts : students
      const builder = {
        select() { return builder },
        in() { return builder },
        order() { return builder },
        range() { return builder },
        then(resolve) { resolve({ data: rows, error: null }) },
      }
      return builder
    },
  }
}

test('report queries page until every row has been read', async () => {
  const rows = Array.from({ length: 5 }, (_, id) => ({ id }))
  const ranges = []
  const result = await fetchAllRows(() => ({
    range(from, to) {
      ranges.push([from, to])
      return Promise.resolve({ data: rows.slice(from, to + 1), error: null })
    },
  }), 'lookup_failed', 2)
  assert.deepEqual(result, rows)
  assert.deepEqual(ranges, [[0, 1], [2, 3], [4, 5]])
})

test('sentinel and missing dates arrive as has_dates=false, present in the payload, never omitted', async () => {
  const db = calendarDb({
    rotations: [
      { id: 'r1', cohort_id: 'c1', school_name: 'UCLA', rotation_start_date: '2026-08-01', rotation_end_date: '2026-11-15' },
      { id: 'r2', cohort_id: 'c1', school_name: 'Cal State LA', rotation_start_date: '1900-01-01', rotation_end_date: '1900-01-01' },
    ],
    cohorts: [{ id: 'c1', name: 'Fall 2026' }],
    students: [],
  })
  const handler = createAcademicsCalendarHandler({ verifyCaller: async () => ({ ...okAuth, db }) })
  const res = makeRes()
  await handler({ method: 'GET', query: {} }, res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.rotations.length, 2)
  const dated = res.body.rotations.find(r => r.id === 'r1')
  const sentinel = res.body.rotations.find(r => r.id === 'r2')
  assert.equal(dated.has_dates, true)
  assert.equal(dated.fiscal_year, 2027)
  assert.equal(sentinel.has_dates, false)
  assert.equal(sentinel.rotation_start, null)
  assert.equal(sentinel.fiscal_year, null)
})

test('calendar counts students via the triple match only', async () => {
  const db = calendarDb({
    rotations: [{ id: 'r1', cohort_id: 'c1', school_name: 'UCLA', rotation_start_date: '2026-08-01', rotation_end_date: '2026-11-15' }],
    cohorts: [{ id: 'c1', name: 'Fall 2026' }],
    students: [
      { id: 's1', cohort_id: 'c1', cohort_school_rotation_id: 'r1', school: 'UCLA', program_type: 'MECN', status: 'Placed' },
      // FK set but school drifted: must NOT count.
      { id: 's2', cohort_id: 'c1', cohort_school_rotation_id: 'r1', school: 'Cal State LA', program_type: 'MECN', status: 'Placed' },
    ],
  })
  const handler = createAcademicsCalendarHandler({ verifyCaller: async () => ({ ...okAuth, db }) })
  const res = makeRes()
  await handler({ method: 'GET', query: {} }, res)
  assert.equal(res.body.rotations[0].student_count, 1)
  assert.deepEqual(res.body.rotations[0].programs, ['MECN'])
})

test('the calendar never reads students.term_dates anywhere in the academics surface', () => {
  // Comments may NAME the rule ("term_dates is never read"); code may not touch it.
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  for (const p of [
    'api/portal/academics-calendar.js',
    'api/lib/communityBenefitData.js',
    'lib/server/communityBenefit/compute.js',
    'src/portal/na/AcademicsCalendarView.jsx',
    'src/portal/na/CommunityBenefitView.jsx',
  ]) {
    assert.ok(!stripComments(read(p)).includes('term_dates'), `${p} must not touch term_dates`)
  }
})

// ── Owner-gated admin endpoint ───────────────────────────────────────────────

function adminDb() {
  const calls = []
  return {
    _calls: calls,
    rpc(name, payload) {
      calls.push({ op: 'rpc', name, payload })
      return Promise.resolve({
        data: {
          id: 'new1', fiscal_year: payload.p_fiscal_year, category: payload.p_category,
          hourly_rate: payload.p_hourly_rate, note: payload.p_note, created_at: 'now',
        },
        error: null,
      })
    },
    from(table) {
      const state = { table, op: 'select', payload: null, filters: [] }
      const builder = {
        select() { return builder },
        order() { return builder },
        range() { return builder },
        eq(f, v) { state.filters.push([f, v]); return builder },
        is(f, v) { state.filters.push([f, v]); return builder },
        insert(p) { state.op = 'insert'; state.payload = p; return builder },
        update(p) { state.op = 'update'; state.payload = p; return builder },
        single() { return builder },
        maybeSingle() { state.maybe = true; return builder },
        then(resolve) {
          calls.push(state)
          if (state.op === 'insert') return resolve({ data: { id: 'new1', ...state.payload }, error: null })
          if (state.op === 'update' && state.maybe) return resolve({ data: { id: state.filters[0]?.[1] || 'x', voided_at: 'now' }, error: null })
          if (state.op === 'update') return resolve({ data: null, error: null })
          return resolve({ data: [], error: null })
        },
      }
      return builder
    },
  }
}

const ownerCaller = { authenticated: true, profile: { id: 'own1', role: 'owner', is_owner: true } }
const adminCaller = { authenticated: true, profile: { id: 'adm1', role: 'admin', is_owner: false } }

test('an Admin may LIST but every write is Owner-only (capability, not role string)', async () => {
  const db = adminDb()
  const handler = createCommunityBenefitAdminHandler({ verifyCaller: async () => adminCaller, makeDb: () => db })

  const list = makeRes()
  await handler({ method: 'POST', body: { action: 'list' } }, list)
  assert.equal(list.statusCode, 200)
  assert.equal(list.body.can_edit, false)

  const write = makeRes()
  await handler({ method: 'POST', body: { action: 'set_rate', fiscal_year: 2027, category: 'rn_preceptor', hourly_rate: 65 } }, write)
  assert.equal(write.statusCode, 403)
  assert.match(write.body.message, /Only the Owner/)
})

test('the Owner sets a rate through one atomic database function', async () => {
  const db = adminDb()
  const handler = createCommunityBenefitAdminHandler({ verifyCaller: async () => ownerCaller, makeDb: () => db })
  const res = makeRes()
  await handler({ method: 'POST', body: { action: 'set_rate', fiscal_year: 2027, category: 'rn_preceptor', hourly_rate: 65, note: 'FY27 RN rate' } }, res)
  assert.equal(res.statusCode, 200)
  const writes = db._calls.filter(c => c.op !== 'select')
  assert.equal(writes.length, 1)
  assert.equal(writes[0].op, 'rpc')
  assert.equal(writes[0].name, 'set_community_benefit_rate')
  assert.equal(writes[0].payload.p_hourly_rate, 65)
  assert.equal(writes[0].payload.p_entered_by, 'own1')
})

test('negative rates and hours are refused server-side', async () => {
  const handler = createCommunityBenefitAdminHandler({ verifyCaller: async () => ownerCaller, makeDb: adminDb })
  const rate = makeRes()
  await handler({ method: 'POST', body: { action: 'set_rate', fiscal_year: 2027, category: 'rn_preceptor', hourly_rate: -5 } }, rate)
  assert.equal(rate.statusCode, 400)
  assert.equal(rate.body.field, 'hourly_rate')
  const cap = makeRes()
  await handler({ method: 'POST', body: { action: 'add_capstone', fiscal_year: 2027, school_name: 'UCLA', hours: -1 } }, cap)
  assert.equal(cap.statusCode, 400)
  assert.equal(cap.body.field, 'hours')
})

test('capstone school names are stored under the canonical ASPIRE identity', async () => {
  const db = adminDb()
  const handler = createCommunityBenefitAdminHandler({ verifyCaller: async () => ownerCaller, makeDb: () => db })
  const res = makeRes()
  await handler({ method: 'POST', body: {
    action: 'add_capstone', fiscal_year: 2027,
    school_name: 'University of California, Los Angeles', hours: 10,
  } }, res)
  assert.equal(res.statusCode, 200)
  const insert = db._calls.find(c => c.op === 'insert')
  assert.equal(insert.payload.school_name, 'UCLA')

  const unknown = makeRes()
  await handler({ method: 'POST', body: {
    action: 'add_capstone', fiscal_year: 2027, school_name: 'Unknown School', hours: 10,
  } }, unknown)
  assert.equal(unknown.statusCode, 400)
  assert.equal(unknown.body.field, 'school_name')
})

test('unexpected body keys are a 400 and identity never comes from the request', async () => {
  const handler = createCommunityBenefitAdminHandler({ verifyCaller: async () => ownerCaller, makeDb: adminDb })
  const res = makeRes()
  await handler({ method: 'POST', body: { action: 'set_rate', fiscal_year: 2027, category: 'rn_preceptor', hourly_rate: 65, entered_by: 'attacker' } }, res)
  assert.equal(res.statusCode, 400)
  assert.equal(res.body.field, 'entered_by')
})

test('capstone entries are voided, never deleted', async () => {
  const db = adminDb()
  const handler = createCommunityBenefitAdminHandler({ verifyCaller: async () => ownerCaller, makeDb: () => db })
  const res = makeRes()
  await handler({ method: 'POST', body: { action: 'void_capstone', id: 'cap1' } }, res)
  assert.equal(res.statusCode, 200)
  const writes = db._calls.filter(c => c.op !== 'select')
  assert.equal(writes[0].op, 'update')
  assert.ok(writes[0].payload.voided_at)
  assert.equal(writes[0].payload.voided_by, 'own1')
  const src = read('api/community-benefit-admin.js')
  assert.doesNotMatch(src, /\.delete\(/)
})

test('the capability is registered Owner-only (empty allowlist) in the canonical table', async () => {
  const { can } = await import('../lib/server/access.js')
  assert.equal(can({ role: 'owner', is_owner: false }, 'community_benefit_admin'), false, 'the owner ROLE STRING must not grant it')
  assert.equal(can({ role: 'admin', is_owner: false }, 'community_benefit_admin'), false)
  assert.equal(can({ role: 'viewer', is_owner: true }, 'community_benefit_admin'), true, 'only the is_owner capability grants it')
  assert.equal(can({ role: 'admin', is_owner: false }, 'community_benefit_view'), true)
})
