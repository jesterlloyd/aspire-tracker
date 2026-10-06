// RESIDENCY-NEEDS-1 (Owner, 2026-10-05): Residency's At a Glance opens on what needs you, for the
// ASPIRE team and Talent Acquisition alike, in the staff home's own Needs you.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { interviewsGroup, offersGroup, flaggedGroup } from '../src/lib/ngrp/residencyNeedsModel.js'
import { residencyDocsGroup, orderGroups } from '../src/lib/home/needsYouModel.js'

const NOW = Date.parse('2026-10-05T17:00:00Z')
const st = (id, first, last) => ({ id, first_name: first, last_name: last, school: 'Cal State LA', aspire_cohort: 'Summer 2026' })

test('interviews: this week and results due; nothing else', () => {
  const rows = [
    { id: 'a', student: st('a', 'Emi', 'Bayaraa'), interview_status: 'scheduled', interview_at: '2026-10-07T17:00:00Z', assigned_unit: '6 NE' },
    { id: 'b', student: st('b', 'Ivan', 'Cruz'), interview_status: 'scheduled', interview_at: '2026-10-03T17:00:00Z' },
    { id: 'c', student: st('c', 'Far', 'Away'), interview_status: 'scheduled', interview_at: '2026-10-20T17:00:00Z' },
    { id: 'd', student: st('d', 'Done', 'Already'), interview_status: 'completed', interview_at: '2026-10-04T17:00:00Z' },
  ]
  const g = interviewsGroup(rows, { now: NOW, base: '/residency' })
  assert.equal(g.total, 2)
  assert.deepEqual(g.allRows.map(r => r.pill.text).sort(), ['Result due', 'This week'])
  assert.ok(g.allRows.every(r => r.to.startsWith('/residency/profiles?student=')), 'rows stay in the app they were clicked in')
  assert.equal(interviewsGroup([], { now: NOW }), null, 'an empty group is hidden')
})

test('offers: extended with no answer, follow up after a week', () => {
  const rows = [
    { id: 'a', student: st('a', 'Emi', 'Bayaraa'), outcome: { offer_extended_at: '2026-09-25T17:00:00Z' } },
    { id: 'b', student: st('b', 'Ivan', 'Cruz'), outcome: { offer_extended_at: '2026-10-04T17:00:00Z' } },
    { id: 'c', student: st('c', 'Yes', 'Said'), outcome: { offer_extended_at: '2026-09-20T17:00:00Z', offer_accepted_at: '2026-09-22T17:00:00Z' } },
    { id: 'd', student: st('d', 'No', 'Said'), outcome: { offer_extended_at: '2026-09-20T17:00:00Z', offer_declined_at: '2026-09-22T17:00:00Z' } },
  ]
  const g = offersGroup(rows, { now: NOW })
  assert.equal(g.total, 2)
  assert.deepEqual(g.allRows.map(r => r.pill.text).sort(), ['Follow up', 'Waiting'])
})

test('flagged reads the shared residency flag; documents keep the surface base', () => {
  const g = flaggedGroup([{ id: 'a', student: st('a', 'Emi', 'Bayaraa'), flagged_for_followup: true }, { id: 'b', student: st('b', 'x', 'y') }], { base: '/ngrp' })
  assert.equal(g.total, 1)
  assert.equal(g.rows[0].to, '/ngrp/profiles?student=a')
  const d = residencyDocsGroup({ uploads: [{ version_id: 'v', student_id: 's1', first_name: 'Emi', last_name: 'B', uploaded_at: '2026-10-05T10:00:00Z' }], now: NOW, base: '/residency' })
  assert.equal(d.rows[0].to, '/residency/profiles?student=s1&docs=1')
  assert.equal(d.open.to, '/residency/support/before')
  assert.equal(residencyDocsGroup({ uploads: [{ version_id: 'v', student_id: 's1', uploaded_at: '2026-10-05T10:00:00Z' }], now: NOW }).rows[0].to, '/ngrp/profiles?student=s1&docs=1', 'the staff home is unchanged')
  assert.deepEqual(orderGroups([{ key: 'residencyDocs' }, { key: 'residencyFlagged' }, { key: 'residencyInterviews' }]).map(x => x.key), ['residencyInterviews', 'residencyFlagged', 'residencyDocs'])
})

test('At a Glance shows it first, in the home\'s component, without the home\'s loaders', () => {
  const tab = readFileSync(new URL('../src/components/ngrp/AtAGlanceTab.jsx', import.meta.url), 'utf8')
  assert.match(tab, /import NeedsYou from '\.\.\/home\/NeedsYou'/)
  assert.doesNotMatch(tab, /homeLoaders/, 'the portal never downloads the staff home\'s loaders')
  assert.ok(tab.indexOf('<NeedsYou') < tab.indexOf('<ResidencySnapshot'), 'Needs you comes before the snapshot')
})
