// FIT-RULES-2 (Owner, 2026-11-02): unit fit knows which units are hiring this cohort, a related
// unit earns credit when theirs is not hiring, and a score on fewer than four factors is
// provisional and ranks below every complete one. The Fit reaches the Excel and a KPI card.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  unitFitFactor, candidateScore, scoreSortValue, familiesOf, UNIT_FIT_NOT_HIRING, UNIT_FIT_RELATED,
} from '../src/lib/ngrp/candidateScoreModel.js'
import { transitionWorkbookRows } from '../lib/server/ngrpResidencyExport.js'
import { KPI_DEFS } from '../src/lib/ngrp/ngrpStates.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = p => readFileSync(join(root, p), 'utf8')
const HIRING = ['PICU', 'NICU', '6 NE', '5 SCCT', 'Postpartum']

test('unit fit: a ranked rotation unit scores as before', () => {
  assert.equal(unitFitFactor(['5 SCCT', '3 SCCT'], ['5 SCCT'], HIRING).points, 20)
  assert.equal(unitFitFactor(['3 SCCT', '5 SCCT'], ['5 SCCT'], HIRING).points, 15)
})

test('unit fit: Alison Curd, Pediatrics not hiring, ranked PICU first', () => {
  const f = unitFitFactor(['PICU', 'NICU', 'Postpartum'], ['Pediatrics'], HIRING)
  assert.equal(f.points, UNIT_FIT_RELATED)
  assert.match(f.detail, /Pediatrics is not hiring this cohort; they ranked PICU, a related unit, 1st/)
})

test('unit fit: not hiring and nothing related is neutral; hiring and passed over is 0', () => {
  const neutral = unitFitFactor(['8 SCCT', '4 South'], ['Pediatrics'], HIRING)
  assert.equal(neutral.points, UNIT_FIT_NOT_HIRING)
  assert.match(neutral.detail, /not hiring this cohort, so it counts as neutral/)
  const passed = unitFitFactor(['PICU'], ['Pediatrics'], [...HIRING, 'Pediatrics'])
  assert.equal(passed.points, 0, 'Pediatrics is hiring and she chose PICU instead')
  assert.match(passed.detail, /which is hiring and they did not rank/)
  // Unknown hiring list: the rule before FIT-RULES-2.
  assert.equal(unitFitFactor(['PICU'], ['Pediatrics'], null).points, 0)
  // Several rotation units: any hiring one passed over decides.
  assert.equal(unitFitFactor(['8 SCCT'], ['Pediatrics', '6 NE'], HIRING).points, 0)
})

test('unit families are named, not guessed', () => {
  assert.deepEqual(familiesOf('Pediatrics'), ['pediatrics'])
  assert.deepEqual(familiesOf('PICU'), ['pediatrics'])
  assert.deepEqual(familiesOf('NICU').sort(), ['maternal', 'pediatrics'])
  assert.deepEqual(familiesOf('Labor & Delivery'), ['maternal'])
  assert.deepEqual(familiesOf('5 SCCT'), [])
})

test('a score on fewer than four factors is provisional and ranks below every complete one', () => {
  const two = candidateScore({ preferences: ['3 SCCT'], rotated: ['3 SCCT'], ratings: [4, 4, 4, 4, 4, 4], hiring: HIRING })
  const four = candidateScore({
    preferences: ['3 SCCT'], rotated: ['5 SCCT'], ratings: [4, 4, 4, 4, 4, 4], resumeComposite: 60,
    statementRatings: { specificity: 6, connection: 6, reflection: 6 }, hiring: [...HIRING, '3 SCCT'],
  })
  assert.equal(two.provisional, true)
  assert.equal(four.provisional, false)
  assert.ok(two.score > four.score, 'the arithmetic is unchanged')
  assert.ok(scoreSortValue(four) > scoreSortValue(two), 'but the complete score ranks first')
  assert.equal(scoreSortValue({ score: 90, ineligible: true }), null)
})

test('the Excel carries the Fit after the form\'s own columns', () => {
  const score = candidateScore({ preferences: ['PICU'], rotated: ['Pediatrics'], ratings: [5, 5, 5, 5, 5, 5], resumeComposite: 50, hiring: HIRING })
  const { header, rows } = transitionWorkbookRows({
    students: [{ id: 's1', first_name: 'Alison', last_name: 'Curd', status: 'Completed' }],
    candidates: [{ id: 'k1', student_id: 's1', assignment_id: 'a1', form_revision_count: 1, form_submitted_at: '2026-10-30T00:00:00Z', candidate_score: score }],
    revisionsByAssignment: new Map([['a1', {}]]),
  })
  const at = h => rows[0][header.indexOf(h)]
  assert.ok(header.indexOf('Fit Score') > header.indexOf('Third Choice Unit'))
  assert.deepEqual(at('Fit Score'), { n: score.score })
  assert.equal(at('Fit'), `${score.label} (provisional)`)
  assert.equal(at('Fit Based On'), '3 of 4 factors, provisional')
  assert.deepEqual(at('Fit: Unit Fit (of 20)'), { n: 15 })
  assert.equal(at('Fit: Statement (of 25)'), 'Not counted')
})

test('Strong Fit is a KPI card, the server passes the hiring list, and the screens say provisional', () => {
  const card = KPI_DEFS.find(k => k.key === 'strong_fit')
  assert.equal(card.match({ candidate_score: { band: 'strong' } }), true)
  assert.equal(card.match({ candidate_score: { band: 'strong', ineligible: true } }), false)
  assert.equal(card.match({ candidate_score: { band: 'good' } }), false)
  assert.match(read('src/components/ngrp/ngrp.css'), /grid-template-columns: repeat\(7, 1fr\)/)
  assert.match(read('lib/server/ngrpApplicants.js'), /hiring: await hiringUnitsFor\(db, cycleId\)/)
  const cs = read('lib/server/ngrpCandidateScores.js')
  assert.match(cs, /from\('ngrp_cycle_units'\)\.select\('unit_name, is_active'\)\.eq\('cycle_id', cycleId\)/)
  assert.match(cs, /p: input\.preferences, u: input\.rotated, f:/, 'the hiring list is not in Keith\'s fingerprint')
  assert.match(read('src/components/ngrp/ProfilesTab.jsx'), /candidate_score\.provisional \? ' · provisional' : ''/)
})
