// RESUME-WORKSPACE-1 (Owner, 2026-10-05): By Alumnus says where each résumé stands in one
// clickable cell, the name opens the applicant, a filter makes it a work queue, Support opens
// a résumé-only screen, and a scored résumé can be scored again.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  resumeStatus, resumeStatusMap, matchesResumeFilter, resumeSortValue, RESUME_FILTERS,
} from '../src/lib/documents/resumeStatusModel.js'
import { loadResumeStatuses } from '../lib/server/resumeStatus.js'

const NOW = Date.parse('2026-10-05T20:00:00Z')
const rv = (over = {}) => ({ id: 'r1', student_id: 's1', document_version_id: 'v1', status: 'scored', score: 58, readiness: 'Needs Improvement', requested_at: '2026-10-05T17:00:00Z', provenance_id: 'p1', sent_at: null, ...over })

test('the status is the CURRENT résumé\'s, in words', () => {
  assert.equal(resumeStatus({}, NOW).key, 'none')
  assert.equal(resumeStatus({ onRecord: true }, NOW).key, 'unscored', 'a résumé on the record is on file, not scored')
  assert.equal(resumeStatus({ currentVersionId: 'v1' }, NOW).label, 'Not scored')
  const scored = resumeStatus({ currentVersionId: 'v1', reviews: [rv()] }, NOW)
  assert.deepEqual([scored.key, scored.score, scored.readiness, scored.provenanceId], ['scored', 58, 'Needs Improvement', 'p1'])
  assert.equal(resumeStatus({ currentVersionId: 'v1', reviews: [rv({ status: 'sent', sent_at: '2026-10-05T19:00:00Z' })] }, NOW).key, 'sent')
  // A newer upload Keith has not read is Not scored, even though the earlier version was.
  assert.equal(resumeStatus({ currentVersionId: 'v2', reviews: [rv()] }, NOW).key, 'unscored')
  // Scored again: the newest review of the version wins.
  const again = resumeStatus({ currentVersionId: 'v1', reviews: [rv(), rv({ id: 'r2', score: 71, readiness: 'Competitive', requested_at: '2026-10-05T19:30:00Z' })] }, NOW)
  assert.deepEqual([again.reviewId, again.score], ['r2', 71])
  // A run stuck in scoring past the stale window reads as failed (Not scored), never Scoring forever.
  assert.equal(resumeStatus({ currentVersionId: 'v1', reviews: [rv({ status: 'scoring', score: null, requested_at: '2026-10-05T10:00:00Z' })] }, NOW).key, 'failed')
  assert.equal(resumeStatus({ currentVersionId: 'v1', reviews: [rv({ status: 'scoring', score: null, requested_at: '2026-10-05T19:59:00Z' })] }, NOW).key, 'scoring')
})

test('the filter is a work queue and every alumnus lands in exactly one non-All bucket', () => {
  const map = resumeStatusMap({
    studentIds: ['a', 'b', 'c', 'd', 'e'],
    onRecordIds: ['b'],
    currentVersionByStudent: { c: 'vc', d: 'vd', e: 've' },
    reviews: [
      rv({ id: 'x', student_id: 'd', document_version_id: 'vd' }),
      rv({ id: 'y', student_id: 'e', document_version_id: 've', status: 'sent', sent_at: '2026-10-05T19:00:00Z' }),
    ],
  }, NOW)
  assert.deepEqual(Object.fromEntries(Object.entries(map).map(([k, v]) => [k, v.key])), { a: 'none', b: 'unscored', c: 'unscored', d: 'scored', e: 'sent' })
  for (const st of Object.values(map)) {
    const hits = RESUME_FILTERS.filter(f => f.key !== 'all' && matchesResumeFilter(st, f.key))
    assert.equal(hits.length, 1, `${st.key} matches exactly one filter`)
    assert.ok(matchesResumeFilter(st, 'all'))
  }
  assert.ok(resumeSortValue(map.a) < resumeSortValue(map.b) && resumeSortValue(map.d) < resumeSortValue(map.e))
})

function fakeDb(tables, fail = {}) {
  return {
    from(name) {
      const q = { rows: tables[name] || [], filters: [] }
      const api = {
        select: () => api,
        in: (col, vals) => { q.filters.push(r => vals.includes(r[col])); return api },
        eq: (col, val) => { q.filters.push(r => r[col] === val); return api },
        then: (ok, bad) => Promise.resolve(fail[name]
          ? { data: null, error: fail[name] }
          : { data: q.rows.filter(r => q.filters.every(f => f(r))), error: null }).then(ok, bad),
      }
      return api
    },
  }
}

test('the server reads three tables inside the roster it was given', async () => {
  const db = fakeDb({
    students: [{ id: 's1', resume_url: 'x' }, { id: 's2', resume_url: null }, { id: 'other', resume_url: 'y' }],
    student_documents: [{ student_id: 's1', doc_type: 'resume', current_version_id: 'v1' }, { student_id: 's1', doc_type: 'bls', current_version_id: 'vb' }],
    resume_reviews: [rv({ student_id: 's1' }), rv({ id: 'z', student_id: 'other', document_version_id: 'vo' })],
  })
  const map = await loadResumeStatuses(db, ['s1', 's2'], NOW)
  assert.deepEqual(Object.keys(map).sort(), ['s1', 's2'], 'no student outside the roster')
  assert.equal(map.s1.key, 'scored')
  assert.equal(map.s2.key, 'none')
})

test('before the documents or review tables exist the column still works; any other failure shows a dash', async () => {
  const absent = { code: '42P01', message: 'relation does not exist' }
  const db = fakeDb({ students: [{ id: 's1', resume_url: 'x' }] }, { student_documents: absent, resume_reviews: absent })
  assert.equal((await loadResumeStatuses(db, ['s1'], NOW)).s1.key, 'unscored')
  const broken = fakeDb({ students: [{ id: 's1', resume_url: 'x' }] }, { resume_reviews: { code: '57014', message: 'timeout' } })
  assert.equal(await loadResumeStatuses(broken, ['s1'], NOW), null)
  assert.deepEqual(await loadResumeStatuses(fakeDb({}), [], NOW), {})
})

test('the summary sends one résumé status map, never to Talent Acquisition', () => {
  const api = readFileSync(new URL('../api/ngrp-support.js', import.meta.url), 'utf8')
  assert.match(api, /const resumes = isTA \? \{\} : await loadResumeStatuses\(db, studentIds\)/)
  assert.doesNotMatch(api, /scores\[r\.student_id\]/, 'the old score-only map is gone')
})

test('By Alumnus: one Résumé cell that opens the résumé, a name that opens the applicant, a filter', () => {
  const src = readFileSync(new URL('../src/components/ngrp/SupportTab.jsx', import.meta.url), 'utf8')
  assert.match(src, /<StudentDocumentsDrawer only="resume"/)
  assert.match(src, /navigate\(`\/ngrp\/profiles\?student=\$\{encodeURIComponent/)
  assert.match(src, /onClick=\{\(\) => setResumeFor\(t\.row\)\}/)
  assert.match(src, /RESUME_FILTERS\.map/)
  assert.doesNotMatch(src, /scoreColumn|support\.scores|aria-label=\{`Upload a résumé for/, 'no separate Score column, no misleading Upload')
})

test('the résumé screen hides the checklist, and a scored résumé can be scored again after a confirm', () => {
  const src = readFileSync(new URL('../src/components/documents/StudentDocumentsDrawer.jsx', import.meta.url), 'utf8')
  assert.match(src, /\{!resumeOnly && <section className="sd-card sd-pad" aria-labelledby="sd-check-title">/)
  assert.match(src, /confirmDialog\(`Score \$\{firstName\(student\)\}'s résumé again\?/)
  assert.match(src, /\{scored && canScore && \(/)
  assert.doesNotMatch(src, /window\.confirm/)
})
