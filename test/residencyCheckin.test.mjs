// RESIDENCY-SUPPORT-1: the Weekly Email Check-in. Owner, 2026-09-11: sent from
// ASPIRE Connect one resident at a time (Send to One), counted from what Connect
// records, addressed by the residency rule (Cedars-Sinai first, never school).
// Run: node --test test/residencyCheckin.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { LAUNCH_KINDS } from '../src/lib/connect/launchContext.js'
import { buildResidentWeeklyCheckinDraft } from '../src/lib/outreachTemplates.js'
import { RESIDENT_CHECKIN_TEMPLATE_KEY as SERVER_KEY, fetchResidentCheckins } from '../lib/server/ngrpSupportCheckins.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = p => readFileSync(join(here, '..', p), 'utf8')

test('one template key, shared by the launch, the registry, and the server', () => {
  assert.equal(SERVER_KEY, 'resident_weekly_checkin')
  assert.equal(LAUNCH_KINDS.RESIDENT_CHECKIN, SERVER_KEY)
  // The registry imports a neighbour without a .js extension, so it is pinned
  // from source rather than imported here.
  const registry = read('src/lib/connect/templateRegistry.js')
  assert.match(registry, /export const RESIDENT_CHECKIN_TEMPLATE_KEY = 'resident_weekly_checkin'/)
  assert.match(registry, /key: RESIDENT_CHECKIN_TEMPLATE_KEY, label: 'Residency Weekly Check-in', active: true, kind: 'hydrate',\s+surface: 'one', templateKind: 'manual', builderKey: RESIDENT_CHECKIN_TEMPLATE_KEY, audiences: \[AUDIENCES\.STUDENT\],/)
  // Scoped by RESIDENCY cohort, like the Transition Form launch.
  const ctx = read('src/lib/connect/launchContext.js')
  assert.match(ctx, /const RESIDENCY_SCOPED = new Set\(\[LAUNCH_KINDS\.NGRP_TRANSITION_FORM, LAUNCH_KINDS\.RESIDENT_CHECKIN\]\)/)
  assert.match(ctx, /const scopeId = RESIDENCY_SCOPED\.has\(ctx\?\.kind\) \? ctx\?\.cycleId : ctx\?\.cohortId/)
})

test('the check-in asks its three questions and makes replying easy', () => {
  const d = buildResidentWeeklyCheckinDraft({ firstName: 'Tomas' })
  assert.equal(d.subject, 'ASPIRE: Your weekly check-in')
  assert.match(d.body, /^Hi Tomas,/)
  for (const q of ['What went well this week?', 'What felt hard', 'Anything you need from me or from your mentor?']) {
    assert.ok(d.body.includes(q), q)
    assert.ok(d.richBody.includes(q), `rich: ${q}`)
  }
  assert.ok(d.body.includes('send me a couple of times that work'))
  assert.equal(buildResidentWeeklyCheckinDraft({}).body.startsWith('Hi there,'), true)
  assert.doesNotMatch(d.body + d.richBody, /—/, 'no em dash')
})

test('Support launches it for one resident, staff only, and returns there', () => {
  const tab = read('src/components/ngrp/SupportTab.jsx')
  assert.match(tab, /kind: LAUNCH_KINDS\.RESIDENT_CHECKIN/)
  assert.match(tab, /RESIDENT_CHECKIN_TEMPLATE_KEY/)
  assert.match(tab, /cycleId: cycle\.id/)
  assert.match(tab, /cohortId: r\.row\.student\?\.cohort_id \|\| null/, "the resident's own ASPIRE cohort travels along")
  assert.match(tab, /returnPath: ngrpPath\('support', 'during', base\)/)
  assert.match(tab, /recipient: \{ studentId \}/)
  assert.match(tab, /\/connect\/outreach\?launch=1&mode=message&recipientType=student&recipientId=\$\{studentId\}/)
  assert.match(tab, /\{staffApp && \(\s*<button type="button" className="ngrp-linkbtn"[^>]*onClick=\{\(\) => sendCheckin\(r\)\}/)
})

test('the composer opens on that resident, applies the template once, and stamps the send', () => {
  const view = read('src/components/connect/OutreachView.jsx')
  assert.match(view, /const checkinLaunch = \(launchCtx && launchCtx\.kind === LAUNCH_KINDS\.RESIDENT_CHECKIN\) \? launchCtx : null/)
  assert.match(view, /String\(checkinLaunch\.recipient\?\.studentId \|\| ''\) === String\(studentId\)/)
  assert.doesNotMatch(view.slice(view.indexOf('const checkinLaunch'), view.indexOf('const activeCheckin') + 400), /cohortId ===/,
    'never gated on the selected ASPIRE cohort')
  assert.match(view, /if \(launchCtx\?\.kind === LAUNCH_KINDS\.RESIDENT_CHECKIN\) return 'single'/)
  assert.match(view, /if \(launchCtx\?\.kind === LAUNCH_KINDS\.RESIDENT_CHECKIN\) return 'message'/)
  assert.match(view, /case RESIDENT_CHECKIN_TEMPLATE_KEY:\s+return buildResidentWeeklyCheckinDraft\(\{ firstName \}\)/)
  assert.match(view, /RESIDENT_CHECKIN_TEMPLATE_KEY,\n\} from '\.\.\/\.\.\/lib\/connect\/templateRegistry'/)
  assert.match(view, /if \(!activeCheckin \|\| checkinAppliedRef\.current\) return/, 'applied once')
  assert.match(view, /\.\.\.\(activeCheckin \? \{ template_key: RESIDENT_CHECKIN_TEMPLATE_KEY \} : \{\}\)/)
  const success = view.slice(view.indexOf("toast?.success('Email sent'"))
  assert.match(success.slice(0, 400), /clearLaunchContext\(\)\s*\n\s*navigate\(back\)/, 'returns to Support and clears the launch')
})

test('the endpoint allowlists the marker, records it, and uses the residency address rule', () => {
  const api = read('api/connect-send-direct-email.js')
  assert.match(api, /const TEMPLATE_KEYS = new Set\(\[RESIDENT_CHECKIN_TEMPLATE_KEY\]\);/)
  assert.match(api, /if \(templateKeyRaw && !TEMPLATE_KEYS\.has\(templateKeyRaw\)\) \{[\s\S]{0,120}Unknown template_key/)
  assert.match(api, /\.\.\.\(templateKey \? \{ template_key: templateKey \} : \{\}\),/)
  const student = api.slice(api.indexOf('resolveStudentCorrespondenceRecipient(student, null, {})'))
  assert.match(student.slice(0, 1600), /if \(templateKey === RESIDENT_CHECKIN_TEMPLATE_KEY\)/)
  assert.match(student.slice(0, 1600), /residencyRecipient\(\{ outcome, student \}\)/)
  // Everything else still uses the school-first student resolver.
  assert.match(api, /let resolved = resolveStudentCorrespondenceRecipient\(student, null, \{\}\);/)
})

test('check-ins are counted from the sends Connect recorded, never written twice', async () => {
  const calls = []
  const db = {
    from: table => {
      const chain = {
        select: cols => { calls.push({ table, cols }); return chain },
        eq: (col, val) => { calls.push({ eq: [col, val] }); return chain },
        in: (col, ids) => { calls.push({ in: [col, ids] }); return chain },
        order: () => Promise.resolve({ data: [{ student_id: 's1', sent_at: '2027-01-20T16:00:00Z' }, { student_id: null, sent_at: null }], error: null }),
      }
      return chain
    },
  }
  const { rows } = await fetchResidentCheckins(db, ['s1', 's1', 's2'])
  assert.deepEqual(rows, [{ student_id: 's1', sent_at: '2027-01-20T16:00:00Z' }], 'incomplete rows are dropped')
  assert.deepEqual(calls[0], { table: 'notification_log', cols: 'student_id, sent_at' })
  assert.deepEqual(calls.filter(c => c.eq), [
    { eq: ['notification_type', 'direct_message_sent'] },
    { eq: ['status', 'sent'] },
    { eq: ['metadata->>template_key', 'resident_weekly_checkin'] },
  ])
  assert.deepEqual(calls.find(c => c.in).in, ['student_id', ['s1', 's2']])
  assert.deepEqual(await fetchResidentCheckins(db, []), { rows: [] })
  // The Support endpoint reads them; it never inserts a check-in.
  const support = read('api/ngrp-support.js')
  assert.match(support, /fetchResidentCheckins\(db, studentIds\)/)
  assert.doesNotMatch(support, /notification_log/)
})
