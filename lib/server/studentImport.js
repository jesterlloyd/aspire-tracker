// lib/server/studentImport.js
//
// STUDENT-IMPORT-KEITH-1 (Owner, 2026-11-03): Keith's spreadsheet import, server half.
//
//   analyzeImport  read the file, show Keith its columns (importModel.profileColumns: never a row),
//                  return his mapping and the questions the popup asks.
//   planImport     re-read the file, apply the confirmed mapping to every row, and plan each row
//                  against the students already in the app (create, update, add, skip, or ask).
//   commitImport   plan again (so nothing the popup was shown can go stale or be forged), apply the
//                  person's answers, and write.
//
// The file is re-sent with each step rather than stored: nothing of it is kept on the server. Every
// read goes through the caller's population (a demo session sees and writes demo rows only), and
// every insert made in a demo session is stamped is_demo. Writes are the students table and, for
// Residency, the roster's hand-added list (audited as alumnus_added, as Add Alumnus does).

import { Buffer } from 'node:buffer'
import { readSheet, SheetReadError } from './sheet/readSheet.js'
import { readAll } from './sheet/readAll.js'
import { runKeithSkill } from './keith/runKeithSkill.js'
import { loadApplicantsPayload } from './ngrpApplicants.js'
import { addToRoster, ensurePastCohort } from './ngrpAddedAlumni.js'
import { recordNgrpAudit } from './ngrpAudit.js'
import { UNIT_CATALOG } from '../../src/lib/unitCatalog.js'
import {
  IMPORT_FIELDS, IMPORT_TARGETS, MAX_FILE_BYTES, FIELD_BY_KEY,
  profileColumns, sanitizeMapping, guessMapping, questionsFor, applyAnswers, planRows, decide, planCounts,
} from '../../src/lib/studentImport/importModel.js'

const POOL_COLUMNS = [
  'id', 'cohort_id', 'status', 'name', 'first_name', 'last_name', 'preferred_first_name', 'personal_email', 'school_email',
  'phone', 'date_of_birth', 'ssn_last4', 'gender', 'school', 'program_type', 'estimated_graduation_date', 'cumulative_gpa',
  'cs_affiliation', 'cs_department', 'cs_role', 'unit_preference_1', 'unit_preference_2', 'unit_preference_3',
  'interest_statement', 'prior_healthcare_experience', 'shift_availability', 'preferred_days',
].join(', ')

// Shown back to the person as a field name only, never its value.
const QUIET_FIELDS = new Set(['ssn_last4', 'date_of_birth'])

export class ImportError extends Error {
  constructor(status, error, message) { super(message); this.status = status; this.error = error }
}

function fileFrom(body) {
  const b64 = typeof body.file_base64 === 'string' ? body.file_base64 : ''
  const name = typeof body.file_name === 'string' ? body.file_name.slice(0, 200) : ''
  if (!b64) throw new ImportError(422, 'no_file', 'Choose a file to import.')
  const buf = Buffer.from(b64, 'base64')
  if (!buf.length) throw new ImportError(422, 'no_file', 'That file is empty.')
  if (buf.length > MAX_FILE_BYTES) throw new ImportError(413, 'too_large', 'That file is over 3 MB. Save a smaller copy (fewer columns or rows) and try again.')
  try {
    const sheet = readSheet(buf, name)
    if (!sheet.headers.length || !sheet.rows.length) throw new ImportError(422, 'empty_sheet', 'That file has no rows to import.')
    return sheet
  } catch (e) {
    if (e instanceof ImportError) throw e
    if (e instanceof SheetReadError) throw new ImportError(422, e.reason, e.message)
    throw new ImportError(422, 'unreadable', 'That file could not be read.')
  }
}

async function cohortList(db) {
  const r = await db.from('cohorts').select('id, name, status').order('created_at', { ascending: true })
  if (r.error) throw new ImportError(500, 'internal_error', 'Cohorts could not be read.')
  return r.data || []
}

/** The target and where it imports to, checked: Internship a cohort, Residency a residency cohort. */
async function destination(db, body, cohorts) {
  const target = IMPORT_TARGETS.includes(body.target) ? body.target : null
  if (!target) throw new ImportError(422, 'invalid_target', 'Choose where to import.')
  if (target === 'internship') {
    const cohort = cohorts.find(c => c.id === body.cohort_id)
    if (!cohort) throw new ImportError(422, 'invalid_cohort', 'Choose the cohort to import into.')
    return { target, cohort }
  }
  const cycleId = typeof body.cycle_id === 'string' ? body.cycle_id : ''
  const payload = await loadApplicantsPayload(db, cycleId)
  if (payload.state === 'cycle_not_found') throw new ImportError(404, 'cycle_not_found', 'That residency cohort was not found.')
  if (payload.state !== 'ok') throw new ImportError(payload.state === 'unprovisioned' ? 409 : 500, payload.state, 'The residency roster could not be read.')
  return { target, cycleId, onRosterIds: (payload.students || []).map(s => s.id) }
}

/** What Keith is told about the fields: the closed vocabularies he maps values into. */
function fieldsForKeith(cohortNames) {
  return IMPORT_FIELDS.map(f => {
    const out = { key: f.key, label: f.label, kind: f.kind }
    if (f.key === 'aspire_cohort') out.choices = cohortNames
    else if (f.key === 'unit_preferences') out.choices = UNIT_CATALOG.map(u => ({ name: u.name, description: u.description }))
    else if (f.choices) out.choices = f.choices
    return out
  })
}

export async function analyzeImport(db, body, { actor }) {
  const sheet = fileFrom(body)
  const cohorts = await cohortList(db)
  const dest = await destination(db, body, cohorts)
  const cohortNames = cohorts.map(c => c.name)
  const columns = profileColumns(sheet.headers, sheet.rows)

  let mapping = null
  const keith = { used: false, model: null, provenanceId: null, reason: null }
  try {
    const run = await runKeithSkill(db, 'import-students', {
      sheet: { value: { target: dest.target, rowCount: sheet.rows.length, columns } },
      fields: { value: fieldsForKeith(cohortNames) },
    }, { actor, entity: { id: null }, invocationMode: 'import', dataSources: { columns: columns.length, rows: sheet.rows.length } })
    if (run.ok) {
      mapping = sanitizeMapping(run.output, sheet.headers, { cohortNames })
      Object.assign(keith, { used: true, model: run.model, provenanceId: run.provenanceId })
    } else keith.reason = run.reason
  } catch (e) {
    console.error('[student-import] keith failed', e?.reason || e?.message || e)
    keith.reason = 'error'
  }
  if (!mapping) mapping = guessMapping(sheet.headers)

  return {
    file: { headers: sheet.headers, rowCount: sheet.rows.length, truncated: sheet.truncated },
    // What Keith was shown, so the popup can say so: a column's kind of evidence, never its values.
    shown: columns.map(c => ({ index: c.index, as: c.withheld ? 'withheld' : c.values ? 'values' : c.items ? 'items' : 'samples' })),
    mapping, keith,
    questions: questionsFor(mapping, sheet.headers, sheet.rows, { target: dest.target, cohortNames }),
    cohortNames,
  }
}

async function loadPool(db, cohorts) {
  const r = await readAll(() => db.from('students').select(POOL_COLUMNS).order('id', { ascending: true }))
  if (r.error) throw new ImportError(500, 'internal_error', 'Students could not be read.')
  const nameOf = new Map(cohorts.map(c => [c.id, c.name]))
  return (r.data || []).map(s => ({ ...s, cohort_name: nameOf.get(s.cohort_id) || null }))
}

function confirmedMapping(body, headers, cohortNames) {
  const base = sanitizeMapping(body.mapping, headers, { cohortNames })
  const answers = body.answers && typeof body.answers === 'object' && !Array.isArray(body.answers) ? body.answers : {}
  const m = applyAnswers(base, answers)
  // A past cohort the person agreed to create (both targets: an Internship row files into its own cohort).
  m.newCohorts = (m.newCohorts || []).filter(n => n.length >= 3 && n.length <= 80)
  return m
}

async function plan(db, body) {
  const sheet = fileFrom(body)
  const cohorts = await cohortList(db)
  const dest = await destination(db, body, cohorts)
  const cohortNames = cohorts.map(c => c.name)
  const mapping = confirmedMapping(body, sheet.headers, cohortNames)
  const pool = await loadPool(db, cohorts)
  const rows = planRows(sheet.rows, mapping, pool, {
    target: dest.target, cohortId: dest.cohort?.id || null, cohorts, cohortNames, onRosterIds: dest.onRosterIds || [], newCohorts: mapping.newCohorts,
  })
  return { sheet, cohorts, dest, mapping, rows }
}

/** A plan row as the popup sees it: names and field labels, no sensitive value. */
function shownRow(p) {
  const conflicts = p.conflicts.map(c => (QUIET_FIELDS.has(c.field)
    ? { field: c.field, label: labelOf(c.field) }
    : { field: c.field, label: labelOf(c.field), from: c.from, to: c.to }))
  return {
    row: p.row, name: p.name, action: p.action, reason: p.reason, options: p.options || null,
    match: p.match || null, matches: p.matches || null, cohort: p.cohort || null, repeatOf: p.repeatOf || null,
    fill: p.fill.map(labelOf), conflicts, problems: p.problems,
    upgrades: (p.upgrades || []).map(u => ({ field: u.field, label: labelOf(u.field), from: u.from, to: u.to })),
  }
}
const UNIT_COLS = { unit_preference_1: 'Unit preference 1', unit_preference_2: 'Unit preference 2', unit_preference_3: 'Unit preference 3' }
const labelOf = k => FIELD_BY_KEY[k]?.label || UNIT_COLS[k] || k

export async function planImport(db, body) {
  const { rows, mapping, sheet, dest, cohorts } = await plan(db, body)
  // A column the person re-pointed may hold values Keith never mapped: ask for those too.
  const answered = body.answers && typeof body.answers === 'object' ? body.answers : {}
  const questions = questionsFor(mapping, sheet.headers, sheet.rows, { target: dest.target, cohortNames: cohorts.map(c => c.name) })
    .filter(q => q.kind === 'value' && answered[q.id] === undefined)
  return { rows: rows.map(shownRow), counts: planCounts(rows), status: mapping.status, questions }
}

const pick = (obj, keys) => Object.fromEntries(keys.filter(k => obj[k] !== undefined).map(k => [k, obj[k]]))

export async function commitImport(db, body, { actorId, isDemo }) {
  const { rows, dest, cohorts, mapping } = await plan(db, body)
  const decisions = body.decisions && typeof body.decisions === 'object' ? body.decisions : {}
  const decided = decide(rows, decisions)
  const result = { created: 0, updated: 0, added: 0, skipped: 0, failed: [] }
  const fail = (p, why) => { result.failed.push({ row: p.row, name: p.name, why }) }

  // The cohort each new student is filed under, creating a past cohort only when asked.
  const cohortIdByName = new Map(cohorts.map(c => [c.name.toLowerCase(), c.id]))
  const cohortFor = async (name) => {
    const key = String(name || '').toLowerCase()
    if (cohortIdByName.has(key)) return cohortIdByName.get(key)
    if (!mapping.newCohorts.some(n => n.toLowerCase() === key)) return null
    const c = await ensurePastCohort(db, { name, isDemo })
    if (c.error || c.invalid) return null
    cohortIdByName.set(key, c.cohort.id)
    return c.cohort.id
  }

  for (const p of decided) {
    try {
      if (p.action === 'skip') { result.skipped++; continue }
      if (p.action === 'create') {
        const row = { ...p.cols }
        if (dest.target === 'internship') {
          const named = p.cohort && p.cohort.toLowerCase() !== dest.cohort.name.toLowerCase() ? p.cohort : null
          const cohortId = named ? await cohortFor(named) : dest.cohort.id
          if (!cohortId) { fail(p, `Their cohort, ${named}, could not be found or created.`); continue }
          Object.assign(row, { cohort_id: cohortId, aspire_cohort: named || dest.cohort.name, status: mapping.status || 'Form Received' })
        } else {
          const cohortId = await cohortFor(p.cohort)
          if (!cohortId) { fail(p, 'Their ASPIRE cohort could not be found or created.'); continue }
          Object.assign(row, { cohort_id: cohortId, aspire_cohort: p.cohort, status: 'Completed' })
        }
        if (isDemo) row.is_demo = true
        const ins = await db.from('students').insert(row).select('id').single()
        if (ins.error) { fail(p, 'The record could not be created.'); continue }
        result.created++
        if (dest.target === 'residency') {
          const a = await addToRoster(db, { cycleId: dest.cycleId, studentId: ins.data.id, actorId })
          if (a.error) { fail(p, 'Created, but not added to the roster.'); continue }
          await recordNgrpAudit(db, { eventType: 'alumnus_added', cycleId: dest.cycleId, studentId: ins.data.id, actorProfileId: actorId, metadata: { via: 'import' } })
        }
        continue
      }
      // update, replace, add: a record already here. "update" and "add" fill only empty fields.
      const id = p.match?.id
      if (!id) { result.skipped++; continue }
      const keys = p.action === 'replace' ? [...p.fill, ...p.conflicts.map(c => c.field)] : p.fill
      const patch = pick(p.cols, keys)
      if (Object.keys(patch).length) {
        if (patch.first_name || patch.last_name) {
          const first = patch.first_name ?? p.cols.first_name
          const last = patch.last_name ?? p.cols.last_name
          patch.name = [first, last].filter(Boolean).join(' ')
        }
        const upd = await db.from('students').update(patch).eq('id', id)
        if (upd.error) { fail(p, 'The record could not be updated.'); continue }
        result.updated++
      }
      if (dest.target === 'residency' && (p.action === 'add' || (p.add && p.action !== 'skip'))) {
        const a = await addToRoster(db, { cycleId: dest.cycleId, studentId: id, actorId })
        if (a.error) { fail(p, 'Not added to the roster.'); continue }
        if (!a.already) {
          result.added++
          await recordNgrpAudit(db, { eventType: 'alumnus_added', cycleId: dest.cycleId, studentId: id, actorProfileId: actorId, metadata: { via: 'import' } })
        }
      } else if (!Object.keys(patch).length) result.skipped++
    } catch (e) {
      console.error('[student-import] row failed', p.row, e?.message || e)
      fail(p, 'Something went wrong with this row.')
    }
  }
  return result
}
