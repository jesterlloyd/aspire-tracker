import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

process.env.VITE_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.VITE_SUPABASE_ANON_KEY ||= 'anon-key'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'service-key'

const here = dirname(fileURLToPath(import.meta.url))
const read = (path) => readFileSync(join(here, '..', path), 'utf8')
const { createCommunityBenefitReportHandler } = await import('../api/community-benefit-report.js')
const { createCommunityBenefitExportHandler } = await import('../api/community-benefit-export.js')

function makeRes() {
  const res = {
    headers: {}, statusCode: null, body: null,
    setHeader(key, value) { res.headers[key.toLowerCase()] = value },
    status(code) { res.statusCode = code; return res },
    json(body) { res.body = body; return res },
    send(body) { res.body = body; return res },
    end() { return res },
  }
  return res
}

const inputs = {
  students: [{
    id: 's1', first_name: 'Ann', last_name: 'Lee', school: 'UCLA', status: 'Completed',
    cohort_id: 'c1', cohort_school_rotation_id: 'r1', program_type: 'MECN', course_type: null,
    hours_required: 60, approved_hours: 60, matched_preceptor: '',
  }],
  rotations: [{ id: 'r1', cohort_id: 'c1', school_name: 'UCLA', rotation_start_date: '2026-08-01', rotation_end_date: '2026-11-15' }],
  cohorts: [{ id: 'c1', name: 'Fall 2026' }],
  cohortNamesById: new Map([['c1', 'Fall 2026']]),
  shiftHoursById: new Map([['s1', { approved: 60, pending: 0, rejected: 0, voided: 0, inProgress: 0 }]]),
  preceptorNameById: new Map([['s1', { name: 'Pat Preceptor', source: 'assignment' }]]),
  rateRows: [{ fiscal_year: 2027, category: 'rn_preceptor', hourly_rate: 65, superseded_at: null }],
  capstoneRows: [],
}

const admin = { authenticated: true, profile: { id: 'a1', role: 'admin', is_owner: false } }
const owner = { authenticated: true, profile: { id: 'o1', role: 'admin', is_owner: true } }
const interviewer = { authenticated: true, profile: { id: 'i1', role: 'interviewer', is_owner: false } }

test('Settings report uses the staff capability boundary and exposes the owner edit hint only to the Owner', async () => {
  for (const [caller, canManage] of [[admin, false], [owner, true]]) {
    const handler = createCommunityBenefitReportHandler({
      verifyCaller: async () => caller,
      makeDb: () => ({}),
      fetchInputs: async () => inputs,
    })
    const res = makeRes()
    await handler({ method: 'GET', query: { fiscal_year: '2027' } }, res)
    assert.equal(res.statusCode, 200)
    assert.equal(res.body.totals.standard_benefit, 3900)
    assert.equal(res.body.can_manage_reporting_inputs, canManage)
  }

  const denied = createCommunityBenefitReportHandler({
    verifyCaller: async () => interviewer,
    makeDb: () => ({}),
    fetchInputs: async () => { throw new Error('must not read report data') },
  })
  const res = makeRes()
  await denied({ method: 'GET', query: {} }, res)
  assert.equal(res.statusCode, 403)
})

test('Settings CSV stays aggregate-only and refuses staff without community benefit view access', async () => {
  const handler = createCommunityBenefitExportHandler({
    verifyCaller: async () => admin,
    makeDb: () => ({}),
    fetchInputs: async () => inputs,
  })
  const res = makeRes()
  await handler({ method: 'GET', query: { fiscal_year: '2027' } }, res)
  assert.equal(res.statusCode, 200)
  assert.match(res.headers['content-type'], /text\/csv/)
  assert.ok(res.body.startsWith('Fiscal Year,School,Program,Course Type'))
  assert.ok(!res.body.includes('Ann'))
  assert.ok(!res.body.includes('Pat Preceptor'))

  const denied = createCommunityBenefitExportHandler({ verifyCaller: async () => interviewer })
  const forbidden = makeRes()
  await denied({ method: 'GET', query: {} }, forbidden)
  assert.equal(forbidden.statusCode, 403)
})

test('Settings Community Benefit presents modal actions, compact inputs, the full report, and history in the approved order', () => {
  const panel = read('src/components/settings/CommunityBenefitPanel.jsx')
  const inputsIndex = panel.indexOf('Reporting Inputs')
  const reportIndex = panel.indexOf('<CommunityBenefitView')
  const historyIndex = panel.indexOf('Reporting history')
  assert.ok(inputsIndex > 0 && inputsIndex < reportIndex)
  assert.ok(reportIndex < historyIndex)
  assert.match(panel, /Set hourly rate/)
  assert.match(panel, /Add non-clinical hours/)
  assert.match(panel, /Download CSV/)
  assert.match(panel, /showToolbar=\{false\}/)
  assert.match(panel, /reportPortalFailures=\{false\}/)
})

test('Administration rail is alphabetical for Accounts, Community Benefit, and Keith', () => {
  const sections = read('src/components/settings/settingsSections.js')
  const accounts = sections.indexOf("key: 'accounts'")
  const communityBenefit = sections.indexOf("key: 'communityBenefit'")
  const keith = sections.indexOf("key: 'keith'")
  assert.ok(accounts < communityBenefit && communityBenefit < keith)
})
