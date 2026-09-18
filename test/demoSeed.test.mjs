// test/demoSeed.test.mjs
//
// DEMO-MODE-1: what can be proven about the seed without a database.
//
// There is no PostgreSQL in this repository's toolchain, so db/demo/demo_seed.sql has
// NOT been executed anywhere. That is worth saying plainly rather than implying
// coverage this file does not have. What follows checks the properties that would
// actually hurt, each of which is a real failure that has an obvious cause and a
// non-obvious symptom:
//
//   A student status with a typo renders with no pill and drops out of the legend,
//   and you find out in front of an audience.
//
//   A fabricated person with a real-looking email address is a person a cron will try
//   to email. This is the single most dangerous line that could appear in the seed,
//   and it is one careless edit away at all times.
//
//   An invented unit name renders a blank division and an empty description, because
//   the app resolves both from src/lib/unitCatalog.js by name.
//
//   A table the seed writes but the boundary does not filter produces rows that are
//   invisible in demo mode and VISIBLE in real mode, which is the exact inverse of
//   what anyone wants.
//
//   A teardown predicate that is not is_demo deletes somebody real.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { DEMO_SCOPED_TABLES } from '../src/lib/demoScope.js'
import { DEMO_EMAIL_DOMAIN } from '../shared/demoIdentity.js'
import { ASPIRE_STATUS_CONFIG } from '../src/lib/constants.js'
import { UNIT_CATALOG } from '../src/lib/unitCatalog.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const seed = readFileSync(join(root, 'db/demo/demo_seed.sql'), 'utf8')
const teardown = readFileSync(join(root, 'db/demo/demo_teardown.sql'), 'utf8')

// Strip SQL line comments so prose about emails or tables is never mistaken for code.
const code = (sql) => sql.replace(/(?<!:)--[^\n]*/g, '')

// ─────────────────────────────────────────────────────────────────────
// 1. The rule the mail guard depends on
// ─────────────────────────────────────────────────────────────────────
test('every address in the seed is at the reserved demo domain', () => {
  const addresses = [...code(seed).matchAll(/'([^']*@[^']*)'/g)].map(m => m[1])
  assert.ok(addresses.length > 20, 'expected the seed to contain addresses')

  const escaped = addresses.filter(a => !a.toLowerCase().endsWith(`@${DEMO_EMAIL_DOMAIN}`))
  assert.deepEqual(escaped, [],
    `These fabricated people have addresses a mail provider would accept. ` +
    `lib/server/email/mailer.js only holds messages to @${DEMO_EMAIL_DOMAIN}, so a cron ` +
    `would really try to deliver to these.`)
})

test('the teardown deletes on is_demo and nothing else', () => {
  const deletes = [...code(teardown).matchAll(/DELETE FROM\s+(\w+)\s+([^;]*);/gi)]
  assert.ok(deletes.length >= 15, 'expected the teardown to clear every seeded table')

  // One alternative form is allowed, for the four residency tables that a live demo can
  // write but that carry no is_demo of their own (a Transition Form delivery, a support
  // entry, a reflection run or submission). Each holds an ON DELETE RESTRICT key, so
  // leaving it behind half-finishes the teardown. The subquery names a demo PARENT, so
  // the safety property is unchanged: it can only ever match a fabricated row.
  const VIA_DEMO_PARENT = /^WHERE\s+\w+ IN \(SELECT id FROM (\w+) WHERE is_demo\)$/i

  for (const [, table, predicate] of deletes) {
    const p = predicate.trim()
    if (/^WHERE\s+is_demo$/i.test(p)) continue
    const via = p.match(VIA_DEMO_PARENT)
    assert.ok(via,
      `DELETE FROM ${table} is predicated on "${p}". The ONLY safe predicates are ` +
      `WHERE is_demo, or a subquery selecting a demo parent: a name or id-prefix ` +
      `predicate deletes real rows, and misses rows the app itself created during a live demo.`)
    assert.ok(DEMO_SCOPED_TABLES.includes(via[1]),
      `DELETE FROM ${table} scopes itself through ${via[1]}, which the boundary does not ` +
      `filter, so "WHERE is_demo" on it means nothing.`)
  }
})

test('the seed clears a table before it fills it, so it can be re-run', () => {
  const inserted = new Set([...code(seed).matchAll(/INSERT INTO\s+(\w+)/gi)].map(m => m[1]))
  const deleted = new Set([...code(seed).matchAll(/DELETE FROM\s+(\w+)\s+WHERE is_demo/gi)].map(m => m[1]))

  const notCleared = [...inserted].filter(t => !deleted.has(t)).sort()
  assert.deepEqual(notCleared, [],
    'Running the seed twice would duplicate these tables, or fail on their fixed ids. ' +
    'Every table the seed inserts into must be cleared at the top of the same file.')
})

// ─────────────────────────────────────────────────────────────────────
// 2. The seed only writes where the boundary can see
// ─────────────────────────────────────────────────────────────────────
test('every table the seed writes is inside the demo boundary', () => {
  const inserted = [...new Set([...code(seed).matchAll(/INSERT INTO\s+(\w+)/gi)].map(m => m[1]))]
  const outside = inserted.filter(t => !DEMO_SCOPED_TABLES.includes(t)).sort()

  assert.deepEqual(outside, [],
    'The seed writes these, but src/lib/demoScope.js does not filter them. Their rows ' +
    'would be hidden in demo mode and visible during real work, which is backwards. ' +
    'Add them to DEMO_SCOPED_TABLES and to the migration, or stop seeding them.')
})

// ─────────────────────────────────────────────────────────────────────
// 3. The cast renders
// ─────────────────────────────────────────────────────────────────────
test('every student status is a canonical ASPIRE status', () => {
  const known = Object.keys(ASPIRE_STATUS_CONFIG)
  // The status literal sits between program_type and the hours in each student tuple.
  const used = [...new Set(
    [...code(seed).matchAll(/'(BSN Semester|BSN Trimester|BSN Quarter|Accelerated BSN|LVN to BSN)','([^']+)'/g)]
      .map(m => m[2]),
  )]

  assert.ok(used.length >= 8, `expected most stages to be represented, found ${used.length}`)
  const unknown = used.filter(s => !known.includes(s)).sort()
  assert.deepEqual(unknown, [],
    'A status outside ASPIRE_STATUS_CONFIG renders with no pill and vanishes from the ' +
    `status legend. Known statuses: ${known.join(', ')}`)
})

test('the cast covers the stages a demo is meant to walk through', () => {
  for (const stage of ['Interview Scheduled', 'Interviewed', 'Placed', 'Active Rotation', 'Completed']) {
    assert.ok(code(seed).includes(`'${stage}'`), `no student is in the ${stage} stage`)
  }
  // Friction, which the Owner asked for explicitly: the app should be shown catching
  // something, not just having a good day.
  assert.ok(/support_needed[\s\S]*?true/.test(code(seed)) || code(seed).includes(",true,\n"),
    'no student has raised support needed, so nothing demonstrates what the app catches')
  assert.ok(code(seed).includes("'Declined'"), 'nobody declined')
})

test('every unit the seed uses exists in the unit catalog', () => {
  const catalog = new Set(UNIT_CATALOG.map(u => u.name))
  // The unit_name column in the units INSERT, which is the row the app resolves from.
  const block = code(seed).slice(code(seed).indexOf('INSERT INTO units'))
  const used = [...new Set([...block.matchAll(/'((?:\d+ |ACU|Float|PACU|Operating|Emergency|Transfer)[^']*)'/g)].map(m => m[1]))]
    .filter(n => catalog.has(n) || /^\d/.test(n))

  const unknown = used.filter(n => !catalog.has(n)).sort()
  assert.deepEqual(unknown, [],
    'The app resolves a unit division, description and eligibility from ' +
    'src/lib/unitCatalog.js BY NAME. A unit that is not in the catalog renders a blank ' +
    'division and an empty description on the screens a demo exists to show.')
})

test('On Campus Now will have somebody on it', () => {
  // src/lib/onCampusNow.js treats lifecycle_state 'in_progress' as authoritative. With
  // no such row the strip is empty, and "who is on campus right now" was one of the
  // things this feature was built to demonstrate.
  const inProgress = [...code(seed).matchAll(/'in_progress'/g)].length
  assert.ok(inProgress >= 2,
    `found ${inProgress} in_progress shift logs; On Campus Now needs at least one, and ` +
    'two makes the strip look like a strip.')
})

// ─────────────────────────────────────────────────────────────────────
// 4. Arity, the most likely bug in a hand-written seed
// ─────────────────────────────────────────────────────────────────────
function splitTopLevel(s) {
  const out = []
  let depth = 0, inStr = false, cur = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (inStr) {
      cur += ch
      if (ch === "'") inStr = (s[i + 1] === "'")
      continue
    }
    if (ch === "'") { inStr = true; cur += ch; continue }
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue }
    cur += ch
  }
  if (cur.trim()) out.push(cur)
  return out
}

test('every VALUES tuple matches its column list', () => {
  // INSERT INTO <t> (cols) VALUES (tuple), (tuple);
  const re = /INSERT INTO\s+(\w+)\s*\(([^)]*(?:\([^)]*\)[^)]*)*)\)\s*VALUES\s*([\s\S]*?);/gi
  let m, checked = 0

  while ((m = re.exec(code(seed))) !== null) {
    const [, table, colBlock, valuesBlock] = m
    const cols = splitTopLevel(colBlock).map(c => c.trim()).filter(Boolean)

    // Split the VALUES block into top-level tuples.
    const tuples = []
    let depth = 0, inStr = false, cur = ''
    for (let i = 0; i < valuesBlock.length; i++) {
      const ch = valuesBlock[i]
      if (inStr) { cur += ch; if (ch === "'") inStr = (valuesBlock[i + 1] === "'"); continue }
      if (ch === "'") { inStr = true; cur += ch; continue }
      if (ch === '(') { depth++; if (depth === 1) { cur = ''; continue } }
      if (ch === ')') { depth--; if (depth === 0) { tuples.push(cur); continue } }
      if (depth >= 1) cur += ch
    }

    for (const [idx, tuple] of tuples.entries()) {
      const values = splitTopLevel(tuple)
      assert.equal(values.length, cols.length,
        `INSERT INTO ${table}: tuple ${idx + 1} has ${values.length} values but the column ` +
        `list has ${cols.length}. First value: ${values[0]?.trim().slice(0, 40)}`)
      checked++
    }
  }

  assert.ok(checked >= 30, `expected to check many tuples, checked ${checked}`)
})

test('the seed and teardown are transactional and balanced', () => {
  for (const [name, sql] of [['seed', seed], ['teardown', teardown]]) {
    const begins = (code(sql).match(/\bBEGIN;/g) || []).length
    const commits = (code(sql).match(/\bCOMMIT;/g) || []).length
    assert.equal(begins, 1, `${name} must open exactly one transaction`)
    assert.equal(commits, 1, `${name} must close exactly one transaction`)
    assert.ok(code(sql).indexOf('BEGIN;') < code(sql).indexOf('COMMIT;'),
      `${name}: COMMIT must follow BEGIN`)
  }
})

test('the seed refuses to run before the foundation migration', () => {
  assert.match(seed, /20260921000000_demo_mode_foundation\.sql/,
    'the seed must name the migration it depends on')
  assert.match(seed, /RAISE EXCEPTION/,
    'the seed must ABORT when is_demo is missing, not insert rows nothing can tell apart ' +
    'from real ones')
})

// ─────────────────────────────────────────────────────────────────────
// 5. The date/text trap
// ─────────────────────────────────────────────────────────────────────
test('values bound for TEXT date columns are cast to text', () => {
  // PostgreSQL will not implicitly cast date to text on INSERT. Four columns in this
  // schema are TEXT holding 'YYYY-MM-DD' rather than real DATEs, and an uncast
  // CURRENT_DATE in any of them aborts the entire seed with
  // "column is of type text but expression is of type date". This was a real bug in the
  // first draft of the seed, caught by reading the review RPC signatures.
  //
  // The rule pinned here: inside the INSERT blocks for students and student_shift_logs,
  // every CURRENT_DATE expression is wrapped and cast, or is part of a timestamptz.
  const blocks = []
  for (const marker of ['INSERT INTO students', 'INSERT INTO student_shift_logs']) {
    let from = 0
    for (;;) {
      const start = code(seed).indexOf(marker, from)
      if (start === -1) break
      const end = code(seed).indexOf(';', start)
      blocks.push(code(seed).slice(start, end))
      from = end
    }
  }
  assert.ok(blocks.length >= 3, 'expected the students and shift-log inserts')

  const bare = []
  for (const block of blocks) {
    for (const m of block.matchAll(/CURRENT_DATE[^,\n)]*/g)) {
      const expr = m[0]
      // The window has to be wide enough to see the whole tail of the expression:
      // `(CURRENT_DATE - (g * 3) + TIME '19:30')::timestamptz` only reveals itself as a
      // timestamp about 30 characters in, and a window of 12 reported it as a bare date.
      const after = block.slice(m.index + expr.length, m.index + expr.length + 40)
      const tail = expr + after
      const cast = tail.includes('::text') || tail.includes('TIME') || tail.includes('::timestamptz')
      if (!cast) bare.push(expr.trim())
    }
  }

  assert.deepEqual(bare, [],
    'These CURRENT_DATE expressions land in a TEXT column without ::text and would abort ' +
    'the seed. students.interview_scheduled_date and student_shift_logs.shift_date are ' +
    'both TEXT; see the type table at the top of db/demo/demo_seed.sql.')
})

// ─────────────────────────────────────────────────────────────────────
// 6. The demo cohort must never be the live intake router
// ─────────────────────────────────────────────────────────────────────
test('the demo cohort does not accept public submissions', () => {
  // cohorts.accepting_submissions is the ROUTER for every public form:
  // api/student-intake-submit.js, api/school-form-submit.js,
  // api/school-form-existing-request.js and api/unit-form-submit.js all resolve their
  // destination cohort from it. A demo cohort holding that flag would take a real
  // student's intake form and file it against fabricated records, where the boundary
  // would then hide it from everyone doing real work.
  //
  // The partial unique index cohorts_one_accepting_submissions refused an earlier draft
  // of this seed, which is the only reason it was caught. This test means the database
  // does not have to be the last line of defence a second time.
  const block = code(seed).slice(
    code(seed).indexOf('INSERT INTO cohorts'),
    code(seed).indexOf(';', code(seed).indexOf('INSERT INTO cohorts')),
  )
  assert.ok(block.includes('accepting_submissions'),
    'the cohort insert should set accepting_submissions explicitly rather than relying on a default')
  assert.match(block, /false,\s*true\)/,
    'the demo cohort must be inserted with accepting_submissions = false. It is the ' +
    'router for public intake, school placement requests and unit capacity submissions.')
  assert.doesNotMatch(block, /true,\s*true\)/,
    'accepting_submissions = true would make the demo cohort the live intake destination')
})

test('the seed respects the partial unique indexes on the tables it writes', () => {
  const c = code(seed)

  // uq_shift_logs_one_open_per_student: ON student_shift_logs(student_id)
  //   WHERE lifecycle_state = 'in_progress'. At most ONE open shift per student.
  const openStudents = [...c.matchAll(/'(0de05000-[0-9a-f-]+)'[^;]*?'in_progress'/g)].map(m => m[1])
  assert.equal(new Set(openStudents).size, openStudents.length,
    'two in_progress shift logs for the same student violate uq_shift_logs_one_open_per_student')

  // preceptors_email_lower_unique_idx: ON preceptors (lower(trim(email))).
  const block = c.slice(c.indexOf('INSERT INTO preceptors'), c.indexOf('INSERT INTO preceptor_cohort_participation'))
  const emails = [...block.matchAll(/'([a-z.]+@demo\.aspire\.invalid)'/g)].map(m => m[1].toLowerCase())
  assert.ok(emails.length >= 6, `expected the preceptor emails, found ${emails.length}`)
  assert.equal(new Set(emails).size, emails.length,
    'duplicate preceptor emails violate preceptors_email_lower_unique_idx')
})

test('the seed does not write assignment rows the database makes itself', () => {
  // trg_sync_primary_preceptor_mirror (AFTER INSERT OR UPDATE OF preceptor_id ON
  // students) already creates exactly one active PRIMARY row per student with a
  // preceptor. An explicit INSERT here collides with
  // uq_spa_one_active_primary_per_student_cohort, which is how this was found.
  //
  // The DELETE stays: a previous run's rows, trigger-made or not, still have to go.
  assert.doesNotMatch(code(seed), /INSERT INTO student_preceptor_assignments/,
    'student_preceptor_assignments is populated by trg_sync_primary_preceptor_mirror. ' +
    'Do not insert into it here; the trigger owns that invariant.')
  assert.match(code(seed), /DELETE FROM student_preceptor_assignments\s+WHERE is_demo/,
    'the teardown-before-insert must still clear it, or a re-run leaves stale rows')
})

// ─────────────────────────────────────────────────────────────────────
// 7. Required columns, which is a different question from existing ones
// ─────────────────────────────────────────────────────────────────────
test('the seed supplies every NOT NULL column that has no default', () => {
  // The miss this pins: student_shift_logs.school_email is NOT NULL with no default and
  // is read by NO select anywhere in the app, so deriving the column list from select
  // strings could never surface it. Confirmed against information_schema in production
  // on 2026-09-18; these four are the complete set for the tables the seed writes.
  const REQUIRED = {
    students: ['cohort_id'],
    units: ['cohort_id'],
    student_shift_logs: ['school_email', 'shift_date'],
  }

  for (const [table, columns] of Object.entries(REQUIRED)) {
    const re = new RegExp(`INSERT INTO ${table}\\s*\\(([^)]*)\\)`, 'g')
    const inserts = [...code(seed).matchAll(re)]
    assert.ok(inserts.length > 0, `expected at least one INSERT INTO ${table}`)
    for (const [, colBlock] of inserts) {
      for (const col of columns) {
        assert.ok(new RegExp(`\\b${col}\\b`).test(colBlock),
          `INSERT INTO ${table} omits ${col}, which is NOT NULL with no default. ` +
          `The insert will fail with 23502.`)
      }
    }
  }
})

// ─────────────────────────────────────────────────────────────────────
// The residency funnel (sections 9 and 10)
// ─────────────────────────────────────────────────────────────────────
// Every constraint checked here is one the database enforces, and every one of them
// would abort the WHOLE file at 3am the night before a talk rather than fail a row.
// That is the argument for checking them statically: the seed is run by hand, once,
// under time pressure, and a CHECK violation in section 10 rolls back sections 1-8 too.

/** Split an INSERT's VALUES into row tuples, respecting quotes and nested parens. */
function valueRows(sql, table) {
  const start = sql.indexOf(`INSERT INTO ${table}`)
  if (start < 0) return []
  const stmt = sql.slice(start, sql.indexOf(';', start))
  const body = stmt.slice(stmt.indexOf('VALUES') + 6)
  const rows = []
  let depth = 0, cur = '', quoted = false
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (ch === "'") quoted = !quoted
    if (!quoted && ch === '(') { depth++; if (depth === 1) { cur = ''; continue } }
    if (!quoted && ch === ')') { depth--; if (depth === 0) { rows.push(cur); continue } }
    if (depth >= 1) cur += ch
  }
  return rows
}

/** The column list of an INSERT, lowercased. */
function columnsOf(sql, table) {
  const start = sql.indexOf(`INSERT INTO ${table}`)
  if (start < 0) return []
  const open = sql.indexOf('(', start)
  return sql.slice(open + 1, sql.indexOf(')', open)).split(',').map(s => s.trim().toLowerCase())
}

/** Row tuples as {column: rawValue} objects. */
function rowObjects(sql, table) {
  const cols = columnsOf(sql, table)
  return valueRows(sql, table).map((row) => {
    const parts = []
    let depth = 0, cur = '', quoted = false
    for (const ch of row) {
      if (ch === "'") quoted = !quoted
      if (!quoted && ch === '(') depth++
      if (!quoted && ch === ')') depth--
      if (!quoted && depth === 0 && ch === ',') { parts.push(cur.trim()); cur = ''; continue }
      cur += ch
    }
    parts.push(cur.trim())
    return Object.fromEntries(cols.map((c, i) => [c, (parts[i] ?? '').replace(/\s+/g, ' ')]))
  })
}

const isNull = (v) => v === undefined || v === '' || v.toUpperCase() === 'NULL'

test('the demo residency cycle is not the workspace default', () => {
  // ngrp_cycles_one_active is a partial unique index ON (is_active) WHERE is_active,
  // the same shape as cohorts_one_accepting_submissions, which this seed has already
  // been caught by once. is_active means "the default cycle for the workspace", a real
  // operational role. A demo cycle taking it either aborts this file on the index or
  // silently takes the default away from Talent Acquisition.
  const rows = rowObjects(code(seed), 'ngrp_cycles')
  assert.equal(rows.length, 1, 'expected exactly one demo residency cycle')
  assert.match(rows[0].is_active, /^false$/i,
    'the demo cycle must not be is_active. In demo mode it is the only cycle the ' +
    'boundary returns, so the picker selects it anyway.')
  assert.match(rows[0].status, /^'(Planning|Active|Completed|Archived)'$/,
    "20260905000000 collapsed the cycle statuses to four. 'Residency Active' is no longer legal.")
})

test('every candidate state carries the timestamps its CHECK constraint demands', () => {
  // ngrp_application_state_times, and ngrp_not_proceeding_requires_reason_time.
  const rows = rowObjects(code(seed), 'ngrp_candidates')
  assert.ok(rows.length >= 8, `expected a full funnel, found ${rows.length} candidates`)

  for (const r of rows) {
    const status = r.application_status
    if (status === "'confirmed'") {
      assert.ok(!isNull(r.application_confirmed_at),
        'a confirmed candidate needs application_confirmed_at (ngrp_application_state_times)')
    }
    if (status === "'not_confirmed'") {
      assert.ok(isNull(r.application_confirmed_at),
        'a not_confirmed candidate must have NO application_confirmed_at')
    }
    if (status === "'not_proceeding'") {
      assert.ok(!isNull(r.not_proceeding_at) && !isNull(r.not_proceeding_reason),
        'not_proceeding needs both a reason and a moment (ngrp_not_proceeding_requires_reason_time)')
      assert.notEqual(r.not_proceeding_reason, "'other'",
        "reason 'other' additionally requires a note (ngrp_not_proceeding_other_needs_note)")
    }
  }

  // The funnel is worth demonstrating only if it has more than one state in it.
  const states = new Set(rows.map(r => r.application_status))
  assert.ok(states.size >= 3, `the demo funnel has only ${states.size} application states`)
  const eligibility = new Set(rows.map(r => r.eligibility_calculated))
  assert.ok(eligibility.size >= 3, 'the Eligibility cards need more than one answer to show')
})

test('every transition form state carries the timestamps its CHECK constraint demands', () => {
  // ngrp_assignment_state_times: each status names exactly which timestamps must be
  // present, and 'submitted' additionally requires revision_count >= 1.
  const c = code(seed)
  const rows = rowObjects(c, 'ngrp_transition_assignments')
  assert.ok(rows.length >= 4, 'expected several transition assignments')

  const revisions = rowObjects(c, 'ngrp_transition_revisions')
  const revisionFor = new Set(revisions.map(r => r.assignment_id))

  for (const r of rows) {
    const status = r.status
    if (status === "'pending'") assert.ok(isNull(r.sent_at), 'pending must have no sent_at')
    else assert.ok(!isNull(r.sent_at), `${status} requires sent_at`)

    if (status === "'opened'" || status === "'in_progress'") {
      assert.ok(!isNull(r.opened_at), `${status} requires opened_at`)
    }
    if (status === "'submitted'") {
      assert.ok(!isNull(r.submitted_at), 'submitted requires submitted_at')
      assert.ok(Number(r.revision_count) >= 1,
        'submitted requires revision_count >= 1, which the CHECK enforces')
      assert.ok(revisionFor.has(r.id),
        `assignment ${r.id} claims a submission but no ngrp_transition_revisions row exists for it, ` +
        'so the roster would show a submitted form with nothing in it')
    }
  }
})

test('a hire record agrees with its candidate about whose attempt it was', () => {
  // ngrp_outcomes_candidate_identity is a composite FK to
  // ngrp_candidates (id, student_id, cycle_id): the database makes a mismatch
  // unrepresentable, so getting it wrong aborts the file rather than drifting.
  const c = code(seed)
  const candidates = new Map(rowObjects(c, 'ngrp_candidates').map(r => [r.id, r]))
  const outcomes = rowObjects(c, 'ngrp_residency_outcomes')
  assert.ok(outcomes.length >= 3, 'expected several outcomes')

  for (const o of outcomes) {
    const cand = candidates.get(o.candidate_id)
    assert.ok(cand, `outcome ${o.id} references a candidate the seed never creates`)
    assert.equal(o.student_id, cand.student_id, 'outcome and candidate disagree about the student')
    assert.equal(o.cycle_id, cand.cycle_id, 'outcome and candidate disagree about the cycle')

    // ngrp_outcomes_accept_requires_offer / ngrp_outcomes_separation_requires_hire.
    if (!isNull(o.offer_accepted_at)) assert.ok(!isNull(o.offer_extended_at),
      'an accepted offer requires an extended one')
    if (!isNull(o.separated_at)) assert.ok(!isNull(o.hired_at),
      'a separation requires a hire')
  }

  // The retention card needs somebody who left, or the rate is always 100%.
  const hired = outcomes.filter(o => !isNull(o.hired_at))
  assert.ok(hired.length >= 2, 'the Residents tab needs more than one resident')
  assert.ok(hired.some(o => !isNull(o.separated_at)),
    'without a separation the retention tracker reads 100% and demonstrates nothing')
})

test('the residency child rows let the triggers stamp them', () => {
  // Same argument as the preceptor assignments: a row the seed marks itself proves
  // nothing about aspire_demo_inherit. Only ngrp_cycles is a root and says is_demo.
  const c = code(seed)
  for (const table of ['ngrp_candidates', 'ngrp_cycle_source_cohorts', 'ngrp_residency_outcomes',
    'ngrp_transition_assignments', 'ngrp_transition_revisions']) {
    assert.ok(!columnsOf(c, table).includes('is_demo'),
      `${table} is a child; aspire_demo_inherit sets its is_demo. Passing it here would ` +
      'test the seed instead of the trigger.')
  }
  assert.ok(columnsOf(c, 'ngrp_cycles').includes('is_demo'),
    'ngrp_cycles is a root and owns its own value')
})

test('the seed and the teardown both clear the residency rows, children first', () => {
  // ngrp_cycle_source_cohorts.cohort_id and ngrp_residency_outcomes.student_id are
  // ON DELETE RESTRICT: either one left behind blocks deleting the demo cohort and the
  // demo student, and the teardown half-finishes.
  for (const [name, sql] of [['seed', seed], ['teardown', teardown]]) {
    const order = [...code(sql).matchAll(/DELETE FROM\s+(\w+)\s+WHERE is_demo/g)].map(m => m[1])
    for (const t of ['ngrp_transition_revisions', 'ngrp_transition_assignments',
      'ngrp_residency_outcomes', 'ngrp_candidates', 'ngrp_cycle_source_cohorts', 'ngrp_cycles']) {
      assert.ok(order.includes(t), `${name} never clears ${t}`)
    }
    const at = (t) => order.indexOf(t)
    assert.ok(at('ngrp_transition_revisions') < at('ngrp_transition_assignments'), `${name}: revisions before assignments`)
    assert.ok(at('ngrp_residency_outcomes') < at('ngrp_candidates'), `${name}: outcomes before candidates`)
    assert.ok(at('ngrp_candidates') < at('ngrp_cycles'), `${name}: candidates before cycles`)
    assert.ok(at('ngrp_cycle_source_cohorts') < at('ngrp_cycles'), `${name}: mappings before cycles`)
    assert.ok(at('ngrp_residency_outcomes') < at('students'), `${name}: outcomes before students (RESTRICT)`)
    assert.ok(at('ngrp_cycle_source_cohorts') < at('cohorts'), `${name}: mappings before cohorts (RESTRICT)`)
  }
})
