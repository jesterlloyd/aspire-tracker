// lib/server/hireImport.js
//
// HIRE-HISTORY-1 (Owner, 2026-11-04): Record past hires, the one-time step that turns the team's
// spreadsheet of hired alumni into hire records on residency cohorts that ran before the app
// held them. Two actions behind api/student-import.js (Owner and Admin):
//   hires_analyze  the file's columns with a header guess, every row planned against the
//                  students here, the distinct cohort values and the residency cohorts that exist
//   hires_commit   the person's column mapping, cohort choices and row decisions; creates each
//                  missing residency cohort (Completed, dated by the person) and records each hire
//                  through backfillHire, one audit line each. Nothing is deleted or overwritten.
// Nothing of the file is stored: the browser sends it again for each step.
import { Buffer } from 'node:buffer'
import { readSheet, SheetReadError } from './sheet/readSheet.js'
import { readAll } from './sheet/readAll.js'
import { ImportError } from './studentImport.js'
import { MAX_FILE_BYTES } from '../../src/lib/studentImport/importModel.js'
import {
  guessHireMapping, sanitizeHireMapping, planHires, cohortValues, suggestCycle,
} from '../../src/lib/ngrp/hireImportModel.js'
import { validateBackfillHire } from '../../src/lib/ngrp/ngrpResidents.js'
import { validateCyclePayload } from './ngrpPlanning.js'
import { isMissingNgrpTable, isMissingNgrpSchema } from './ngrpApplicants.js'
import { backfillHire } from './ngrpHireHistory.js'
import { recordNgrpAudit } from './ngrpAudit.js'

const POOL = 'id, first_name, last_name, preferred_first_name, personal_email, school_email, status, cohorts ( name )'
const fold = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '')

function fileFrom(body) {
  const b64 = typeof body.file_base64 === 'string' ? body.file_base64 : ''
  const name = typeof body.file_name === 'string' ? body.file_name.slice(0, 200) : ''
  if (!b64) throw new ImportError(422, 'no_file', 'Choose a file.')
  const buf = Buffer.from(b64, 'base64')
  if (!buf.length) throw new ImportError(422, 'no_file', 'That file is empty.')
  if (buf.length > MAX_FILE_BYTES) throw new ImportError(413, 'too_large', 'That file is over 3 MB. Save a smaller copy and try again.')
  try {
    const sheet = readSheet(buf, name)
    if (!sheet.headers.length || !sheet.rows.length) throw new ImportError(422, 'empty_sheet', 'That file has no rows.')
    return sheet
  } catch (e) {
    if (e instanceof ImportError) throw e
    if (e instanceof SheetReadError) throw new ImportError(422, e.reason, e.message)
    throw new ImportError(422, 'unreadable', 'That file could not be read.')
  }
}

async function cycles(db) {
  const r = await db.from('ngrp_cycles').select('id, name, status, application_open_date, residency_start_date').order('created_at', { ascending: true })
  if (r.error) {
    if (isMissingNgrpTable(r.error)) throw new ImportError(409, 'not_enabled', 'Residency is not set up yet.')
    throw r.error
  }
  return r.data || []
}

async function pool(db) {
  const r = await readAll(() => db.from('students').select(POOL).order('id', { ascending: true }))
  if (r.error) throw r.error
  return (r.data || []).map(s => ({ ...s, cohort_name: s.cohorts?.name || '' }))
}

// "studentId|folded cohort name" for every recorded hire, so a second run skips what is there.
async function onRecord(db, cycleList) {
  const r = await db.from('ngrp_residency_outcomes').select('student_id, cycle_id').not('hired_at', 'is', null)
  if (r.error) {
    if (isMissingNgrpTable(r.error)) return []
    throw r.error
  }
  const nameOf = new Map(cycleList.map(c => [c.id, fold(c.name)]))
  return (r.data || []).map(o => `${o.student_id}|${nameOf.get(o.cycle_id) || ''}`)
}

function plan(sheet, body, cycleList, students, recorded) {
  const mapping = body.mapping ? sanitizeHireMapping(body.mapping, sheet.headers) : guessHireMapping(sheet.headers)
  // The person's cohort choices: file value -> { cycle_id } | { create: { name, ... } }. A file
  // value keys "already recorded" by the cohort it will land in, not by the file's wording.
  const choices = body.cohorts && typeof body.cohorts === 'object' ? body.cohorts : {}
  const cohortKeyOf = (value) => {
    const choice = choices[value]
    if (choice?.cycle_id) return fold(cycleList.find(c => c.id === choice.cycle_id)?.name || value)
    if (choice?.create?.name) return fold(choice.create.name)
    return fold(suggestCycle(value, cycleList)?.name || value)
  }
  const rows = planHires(sheet.rows, mapping, students, { onRecord: recorded, cohortKeyOf })
  return { mapping, rows }
}

const shown = p => ({
  row: p.row, name: p.name, action: p.action, reason: p.reason, cohort: p.cohort, repeatOf: p.repeatOf || null,
  match: p.match, matches: p.matches || null, problems: p.problems,
  hired_on: p.values.hired_on || null, hired_unit: p.values.hired_unit || null, hired_as: p.values.hired_as || null,
  hired_as_other: p.values.hired_as_other || null, current_title: p.values.current_title || null,
  separated_on: p.values.separated_on || null, hired_note: p.values.hired_note || null,
})

export async function analyzeHires(db, body) {
  const sheet = fileFrom(body)
  const cycleList = await cycles(db)
  const students = await pool(db)
  const recorded = await onRecord(db, cycleList)
  const { mapping, rows } = plan(sheet, body, cycleList, students, recorded)
  const values = cohortValues(rows).map(v => ({ ...v, suggestion: suggestCycle(v.value, cycleList)?.id || null }))
  return {
    file: { headers: sheet.headers, rowCount: sheet.rows.length, truncated: sheet.truncated },
    mapping,
    cycles: cycleList.map(c => ({ id: c.id, name: c.name, status: c.status })),
    cohortValues: values,
    rows: rows.map(shown),
    counts: { record: rows.filter(r => r.action === 'record').length, ask: rows.filter(r => r.action === 'ask').length, skip: rows.filter(r => r.action === 'skip').length },
  }
}

// A Completed residency cohort for a file value the person chose to create, dated by them so
// it sorts before the cohorts that came after it (the chronology key reads the open date first).
async function createCompletedCycle(db, { name, application_open_date, residency_start_date, actorId }) {
  const v = validateCyclePayload({ name, status: 'Completed', application_open_date, residency_start_date })
  if (!v.ok) return { errors: v.errors }
  if (!v.cycle.application_open_date) return { errors: [{ field: 'application_open_date', message: `Enter when applications opened for ${name}.` }] }
  const created = await db.rpc('ngrp_cycle_create_tx', { p_cycle: v.cycle, p_source_cohort_ids: [], p_actor: actorId })
  if (created.error) {
    if (isMissingNgrpSchema(created.error)) return { errors: [{ field: 'cycle', message: 'Residency is not set up yet.' }] }
    if (created.error.code === '23505') {
      const again = await db.from('ngrp_cycles').select('id, name').ilike('name', name).limit(1)
      if (again.data?.[0]) return { cycle: again.data[0], existed: true }
    }
    return { errors: [{ field: 'cycle', message: `${name} could not be created.` }] }
  }
  return { cycle: created.data }
}

export async function commitHires(db, body, { actorId }) {
  const sheet = fileFrom(body)
  const cycleList = await cycles(db)
  const students = await pool(db)
  const recorded = await onRecord(db, cycleList)
  const { rows } = plan(sheet, body, cycleList, students, recorded)
  const choices = body.cohorts && typeof body.cohorts === 'object' ? body.cohorts : {}
  const decisions = body.decisions && typeof body.decisions === 'object' ? body.decisions : {}
  const dates = body.dates && typeof body.dates === 'object' ? body.dates : {} // row -> hire date typed for an "ask" row
  const result = { recorded: 0, skipped: 0, created_cohorts: [], failed: [] }
  const fail = (p, why) => result.failed.push({ row: p.row, name: p.name, why })

  const cycleFor = new Map() // file value -> { id, name } | null
  const resolveCycle = async (value) => {
    if (cycleFor.has(value)) return cycleFor.get(value)
    const choice = choices[value]
    let out = null
    if (choice?.cycle_id) {
      const c = cycleList.find(x => x.id === choice.cycle_id)
      out = c ? { id: c.id, name: c.name } : null
    } else if (choice?.create?.name) {
      const made = await createCompletedCycle(db, { ...choice.create, actorId })
      if (made.cycle) {
        out = { id: made.cycle.id, name: made.cycle.name }
        if (!made.existed) {
          result.created_cohorts.push(made.cycle.name)
          await recordNgrpAudit(db, { eventType: 'cycle_created', cycleId: made.cycle.id, actorProfileId: actorId, metadata: { cycle_name: made.cycle.name, status: 'Completed' } })
        }
      } else out = { errors: made.errors }
    }
    cycleFor.set(value, out)
    return out
  }

  for (const p of rows) {
    const decision = decisions[p.row]
    const wanted = p.action === 'record' ? decision !== 'skip' : p.action === 'ask' ? decision === 'record' : false
    if (!wanted) { result.skipped++; continue }
    const hiredOn = p.values.hired_on || (typeof dates[p.row] === 'string' ? dates[p.row] : '')
    const cyc = await resolveCycle(p.cohort)
    if (!cyc || cyc.errors) { fail(p, cyc?.errors?.[0]?.message || `No residency cohort chosen for "${p.cohort}".`); continue }
    const v = validateBackfillHire({
      hired_on: hiredOn, hired_unit: p.values.hired_unit, hired_as: p.values.hired_as, hired_as_other: p.values.hired_as_other,
      position_title: p.values.current_title, license_issued_on: p.values.license_issued_on, interim_permit_issued: p.values.interim_permit_issued,
      separated_on: p.values.separated_on, separation_reason: p.values.separation_reason,
    })
    if (!v.ok) { fail(p, v.errors.map(e => e.message).join(' ')); continue }
    const r = await backfillHire(db, { cycleId: cyc.id, cycleName: cyc.name, studentId: p.match.id, actorId, hire: v.hire })
    if (r.provisioned === false) throw new ImportError(409, 'not_enabled', 'Residency is not set up yet.')
    if (!r.ok) { fail(p, r.error === 'already_hired' ? 'Already recorded as hired in that cohort.' : r.message || r.error); continue }
    result.recorded++
  }
  return result
}
