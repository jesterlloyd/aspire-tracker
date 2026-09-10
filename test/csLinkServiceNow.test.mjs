// CSLINK-SERVICENOW-1: ServiceNow links on the CS-Link steps, a tick fills today's date,
// employees go through Step 2 like everyone else, and the old status strip is retired in
// favour of the KPI cards.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  SERVICENOW_LINKS, STAGE1_REQUESTS, stage1RequestsFor, tickedStage1Request,
  isLegacyNotApplicable, stage1ResetFor, todayIsoLocal, tickPatch,
} from '../src/lib/csLinkServiceNow.js'
import { getCsLinkStatus } from '../src/lib/utils.js'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('the ServiceNow items are the Owner-supplied URLs', () => {
  assert.equal(SERVICENOW_LINKS.addNonEmployee, 'https://csmc.service-now.com/cssp?id=sc_cat_item&sys_id=de4e4ac81bcff91081329938b04bcb8b')
  assert.equal(SERVICENOW_LINKS.updateNonEmployee, 'https://csmc.service-now.com/cssp?id=sc_cat_item&sys_id=6fd298331b36791081329938b04bcb62')
  assert.equal(SERVICENOW_LINKS.reactivateNonEmployee, SERVICENOW_LINKS.updateNonEmployee)
  assert.equal(SERVICENOW_LINKS.csLinkRequest, 'https://csmc.service-now.com/cssp?id=sc_cart')
})

test('Step 2 offers Add to New, and Update and Reactivate to Former and Employee', () => {
  assert.deepEqual(stage1RequestsFor('new'), ['add_non_employee'])
  assert.deepEqual(stage1RequestsFor('former'), ['update_non_employee', 'reactivate'])
  assert.deepEqual(stage1RequestsFor('employee'), ['update_non_employee', 'reactivate'])
  assert.deepEqual(stage1RequestsFor(''), [])
  assert.deepEqual(Object.values(STAGE1_REQUESTS).map(r => r.label),
    ['Add Non-Employee', 'Update Non-Employee', 'Reactivate Non-Employee'])
})

test('the ticked request is the stored action while Submitted; legacy update types read as Update', () => {
  assert.equal(tickedStage1Request({ cs_stage1_submitted: false, cs_stage1_action: 'reactivate' }), null)
  assert.equal(tickedStage1Request({ cs_stage1_submitted: true, cs_stage1_action: 'reactivate' }), 'reactivate')
  assert.equal(tickedStage1Request({ cs_stage1_submitted: true, cs_stage1_action: 'assignment_change' }), 'update_non_employee')
  assert.equal(tickedStage1Request({ cs_stage1_submitted: true, cs_stage1_action: 'extend_end_date' }), 'update_non_employee')
  assert.equal(tickedStage1Request({ cs_stage1_submitted: true, cs_stage1_action: 'not_applicable' }), null)
  assert.equal(isLegacyNotApplicable({ cs_stage1_action: 'not_applicable' }), true)
})

test('every status, employees included, starts at Step 2 unticked', () => {
  assert.deepEqual(stage1ResetFor('new'), { cs_stage1_action: 'add_non_employee', cs_stage1_submitted: false, cs_stage1_complete: false })
  for (const s of ['former', 'employee', '']) {
    assert.deepEqual(stage1ResetFor(s), { cs_stage1_action: '', cs_stage1_submitted: false, cs_stage1_complete: false })
  }
})

test('a tick fills today in local time, keeps a date already there, and an untick clears nothing', () => {
  const lateEvening = new Date(2026, 8, 9, 23, 30) // 9 Sep, 11:30 pm local: already the 10th in UTC
  assert.equal(todayIsoLocal(lateEvening), '2026-09-09')
  assert.deepEqual(tickPatch({}, 'cs_link_requested', true, lateEvening),
    { cs_link_requested: true, cs_link_requested_date: '2026-09-09' })
  assert.deepEqual(tickPatch({ cs_link_complete_date: '2026-08-01' }, 'cs_link_complete', true, lateEvening),
    { cs_link_complete: true })
  assert.deepEqual(tickPatch({ cs_stage1_complete_date: 'Aug 1' }, 'cs_stage1_complete', true, lateEvening),
    { cs_stage1_complete: true }, 'a legacy free-text date is never replaced')
  assert.deepEqual(tickPatch({}, 'cs_stage1_submitted', false, lateEvening), { cs_stage1_submitted: false })
})

test('an employee is Account Active only once Step 3 is ticked', () => {
  assert.equal(getCsLinkStatus({ cs_cedars_status: 'employee' }), 'not_started')
  assert.equal(getCsLinkStatus({ cs_cedars_status: 'employee', cs_stage1_submitted: true }), 'stage1_pending')
  // An employee auto-completed before this change keeps its ticks, so it stays Account Active.
  assert.equal(getCsLinkStatus({ cs_cedars_status: 'employee', cs_stage1_action: 'not_applicable',
    cs_stage1_submitted: true, cs_stage1_complete: true }), 'account_active')
})

test('intake and the Student Portal set a status but never auto-complete Steps 2 and 3', () => {
  for (const p of ['api/student-intake-submit.js', 'api/portal/my-profile.js']) {
    const src = read(p)
    assert.match(src, /stage1ResetFor\(/, `${p} uses the shared reset`)
    assert.doesNotMatch(src, /cs_stage1_complete\s*=\s*true/, `${p} must not auto-complete Step 3`)
    assert.doesNotMatch(src, /cs_stage1_action\s*=\s*'not_applicable'/, `${p} must not mark Step 2 not applicable`)
  }
  assert.match(read('api/student-update.js'), /const STAGE1_ACTIONS\s*=\s*\[[^\]]*'update_non_employee'/)
})

test('the table and the side panel read the shared rules and links', () => {
  const access = read('src/components/AccessTab.jsx')
  const panel = read('src/components/StudentSidePanel.jsx')
  for (const [name, src] of [['AccessTab', access], ['StudentSidePanel', panel]]) {
    assert.match(src, /from '\.\.\/lib\/csLinkServiceNow'/, `${name} imports the shared module`)
    assert.match(src, /import ServiceNowLink from '\.\/shared\/ServiceNowLink'/, `${name} uses the one link component`)
    assert.doesNotMatch(src, /csmc\.service-now\.com/, `${name} restates no ServiceNow URL`)
    assert.doesNotMatch(src, /cs_stage1_action:'not_applicable', cs_stage1_submitted:true/, `${name} no longer auto-completes employees`)
    assert.doesNotMatch(src, /cs_cedars_status === 'employee'\)? &&/, `${name} skips no step for employees`)
  }
  assert.ok(!access.includes('am-compact-stats'), 'the status strip is retired')
  assert.match(access, /<ServiceNowLink href=\{SERVICENOW_LINKS\.csLinkRequest\}>Request<\/ServiceNowLink>/)
  // Side panel: a tick saves box and date in one update, and a conflict force-save carries both.
  assert.match(panel, /const doSave = useCallback\(async \(field, value, extra\) =>/)
  assert.match(panel, /onUpdate\(student\.id, \{ \[field\]: value, \.\.\.extra \}, loadedUpdatedAt\)/)
  assert.match(panel, /\{ \[conflict\.field\]: conflict\.value, \.\.\.conflict\.extra \}/)
})

test('ServiceNowLink opens a new tab safely and never ticks anything', () => {
  const link = read('src/components/shared/ServiceNowLink.jsx')
  assert.match(link, /target="_blank" rel="noopener noreferrer"/)
  assert.doesNotMatch(link, /onClick|checked/)
  // Measured 2026-09-10: without a positioned link, the absolutely positioned .sr-only hint
  // escaped the table's scroller and widened the whole page to 925px on a 500px phone.
  assert.match(read('src/index.css'), /\.sn-link \{ position: relative;/)
})

test('Keith no longer says employees skip Stage 1', () => {
  for (const p of ['src/lib/keithKnowledge.js', 'api/keith.js']) {
    assert.doesNotMatch(read(p), /employees skip Stage 1/)
  }
})
