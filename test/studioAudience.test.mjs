// STUDIO-2 (Owner, 2026-11-05): Studio's audience rules, the frozen list, program news and replies.
//
// Run: node --test test/studioAudience.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  sanitizeRule, ruleProblem, describeRule, RULE_STATUSES, replyToFor, defaultReplyRoute, cleanReplyRoute,
  RESIDENCY_REPLY_TO, reasonWords, MAX_AUDIENCE,
} from '../src/lib/studio/audienceCatalog.js'
import { shapeStudents, shapeAlumni, shapeContacts, finishAudience, resolveAudience } from '../lib/server/studio/resolveAudience.js'
import { validateBulkRecipients } from '../api/lib/bulkRecipientAllowlist.js'
import { newsToken, parseNewsToken, verifyNewsToken, maskEmail, newsSecret } from '../lib/server/studio/newsToken.js'
import { renderStudioEmail, withUnsubscribe, UNSUB_MARKER } from '../src/lib/studio/renderEmail.js'
import { LAYOUTS } from '../src/lib/studio/studioLayouts.js'
import { unsubscribeFor, studioReplyTo } from '../lib/server/studio/studioSend.js'
import { resolveNewsToken } from '../lib/server/studio/programNews.js'

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const C1 = '11111111-1111-4111-8111-111111111111'
const C2 = '22222222-2222-4222-8222-222222222222'
const SEND = '33333333-3333-4333-8333-333333333333'
const SECRET = 'a-test-secret-that-is-long-enough'

// ── The rule ────────────────────────────────────────────────────────────────────────────────────

test('a rule keeps only known values and can never ask for Not Proceeding', () => {
  assert.ok(!RULE_STATUSES.includes('Not Proceeding'))
  const r = sanitizeRule({ population: 'students', cohortIds: [C1, 'nope', C1], statuses: ['Placed', 'Not Proceeding', 'Bogus'], emailRoute: 'weird' })
  assert.deepEqual(r.cohortIds, [C1])
  assert.deepEqual(r.statuses, ['Placed'])
  assert.equal(r.emailRoute, 'automatic')
  assert.equal(sanitizeRule({ population: 'martians' }).population, 'students')
  assert.deepEqual(sanitizeRule({ population: 'contacts', categories: ['Preceptor', 'Spies'] }).categories, ['Preceptor'])
  const a = sanitizeRule({ population: 'alumni', cycleId: C2, form: 'submitted', license: ['active', 'x'], hired: 'maybe' })
  assert.deepEqual(a, { population: 'alumni', cycleId: C2, form: 'submitted', license: ['active'], hired: 'any' })
})

test('a rule says what it still needs, and reads as one line', () => {
  assert.match(ruleProblem({ population: 'students' }), /ASPIRE cohort/)
  assert.match(ruleProblem({ population: 'alumni' }), /residency cohort/)
  assert.equal(ruleProblem({ population: 'contacts' }), '')
  assert.equal(describeRule({ population: 'students', cohortIds: [C1], statuses: ['Placed', 'Active Rotation'] }, { [C1]: 'Winter 2027' }),
    'Winter 2027 students · Placed or Active Rotation · their usual address')
  assert.equal(describeRule({ population: 'alumni', cycleId: C2, form: 'submitted', license: ['pending'] }, { [C2]: 'Winter 2027' }),
    'Winter 2027 residency applicants · submitted the transition form · NCLEX ahead')
  assert.equal(describeRule({ population: 'contacts' }), 'Every active contact')
})

test('replies: residency goes to ngrp@ and aspire@, everything else to the sender', () => {
  assert.deepEqual(RESIDENCY_REPLY_TO, ['ngrp@cshs.org', 'aspire@cshs.org'])
  assert.deepEqual(replyToFor('residency', 'me@cshs.org', 'fb@cshs.org'), ['ngrp@cshs.org', 'aspire@cshs.org'])
  assert.equal(replyToFor('sender', 'me@cshs.org', 'fb@cshs.org'), 'me@cshs.org')
  assert.equal(replyToFor('bogus', null, 'fb@cshs.org'), 'fb@cshs.org')
  assert.equal(defaultReplyRoute({ population: 'alumni' }), 'residency')
  assert.equal(defaultReplyRoute({ population: 'students' }), 'sender')
  assert.equal(cleanReplyRoute('anything'), 'sender')
  assert.deepEqual(studioReplyTo({ replyRoute: 'residency' }, 'me@cshs.org', 'x'), RESIDENCY_REPLY_TO)
})

test('every reason a person is left out reads as words', () => {
  for (const code of ['opted_out', 'not_proceeding', 'no_email', 'changed_since_review', 'not_in_reviewed_list', 'duplicate', 'removed']) {
    assert.ok(!/_/.test(reasonWords(code)), code)
  }
})

// ── Resolving ───────────────────────────────────────────────────────────────────────────────────

const stu = (over) => ({ id: over.id, first_name: 'Ann', last_name: 'Lee', school: 'CSUN', status: 'Placed', school_email: `${over.id}@school.edu`, personal_email: `${over.id}@home.com`, ...over })

test('students: Not Proceeding never passes a rule, filters apply, a missing address is reported', () => {
  const rows = [
    stu({ id: 's1' }),
    stu({ id: 's2', status: 'Not Proceeding' }),
    stu({ id: 's3', status: 'Form Sent' }),
    stu({ id: 's4', school: 'UCLA' }),
    stu({ id: 's5', school_email: null }),
  ]
  const all = shapeStudents(rows, { population: 'students', cohortIds: [C1], emailRoute: 'school' })
  assert.deepEqual(all.people.map(p => p.studentId), ['s1', 's3', 's4'])
  assert.deepEqual(all.excluded.map(x => x.reason), ['not_proceeding', 'no_email'])
  assert.equal(all.people[0].emailType, 'school')
  const placed = shapeStudents(rows, { population: 'students', cohortIds: [C1], statuses: ['Placed'], schools: ['csun'], emailRoute: 'personal' })
  assert.deepEqual(placed.people.map(p => p.studentId), ['s1', 's5'], 's5 lacks a school email, not a personal one')
  assert.equal(placed.people[0].email, 's1@home.com')
  assert.equal(placed.excluded.length, 0, 'a Not Proceeding student outside the status filter is not counted as left out')
  const auto = shapeStudents([stu({ id: 's1' })], { population: 'students', cohortIds: [C1] })
  assert.equal(auto.people[0].automaticEmail, true)
})

test('alumni: the residency address, never the school one, filtered by form, licensure and hire', () => {
  const payload = {
    students: [{ id: 'a1', first_name: 'Ann', last_name: 'One' }, { id: 'a2', first_name: 'Bo', last_name: 'Two' }, { id: 'a3', first_name: 'Cy', last_name: 'Three' }],
    candidates: [
      { student_id: 'a1', form_status: 'submitted', assignment_id: 'as1', form_rn_status: 'active', outcome: null },
      { student_id: 'a2', form_status: 'sent', assignment_id: 'as2', form_rn_status: 'pending', outcome: { hired_at: '2026-10-01', separated_at: null, cs_email: 'bo.two@cshs.org' } },
      { student_id: 'a3', form_status: 'not_sent', outcome: null },
    ],
  }
  const emails = new Map([['a1', { personal_email: 'ann@home.com' }], ['a2', { personal_email: 'bo@home.com' }], ['a3', { personal_email: null }]])
  const preferred = new Map([['as1', 'ann.pref@mail.com']])
  const all = shapeAlumni(payload, { population: 'alumni', cycleId: C2 }, { emails, preferred })
  assert.deepEqual(all.people.map(p => [p.studentId, p.email, p.emailType, p.route]), [
    ['a1', 'ann.pref@mail.com', 'residency', 'residency'],
    ['a2', 'bo.two@cshs.org', 'residency', 'residency'],
  ])
  assert.deepEqual(all.excluded.map(x => x.reason), ['no_email'])
  const submitted = shapeAlumni(payload, { population: 'alumni', cycleId: C2, form: 'submitted' }, { emails, preferred })
  assert.deepEqual(submitted.people.map(p => p.studentId), ['a1'])
  const hired = shapeAlumni(payload, { population: 'alumni', cycleId: C2, hired: 'yes' }, { emails, preferred })
  assert.deepEqual(hired.people.map(p => p.studentId), ['a2'])
  const notYet = shapeAlumni(payload, { population: 'alumni', cycleId: C2, license: ['none'] }, { emails, preferred })
  assert.deepEqual(notYet.people.map(p => p.studentId), [])
  assert.deepEqual(notYet.excluded.map(x => x.name), ['Cy Three'])
})

test('contacts: active only, by category', () => {
  const rows = [
    { id: 'c1', full_name: 'Pat Doe', email: 'pat@x.org', category: 'Preceptor', is_active: true },
    { id: 'c2', full_name: 'Old One', email: 'old@x.org', category: 'Preceptor', is_active: false },
    { id: 'c3', full_name: 'Uma Lead', email: 'uma@x.org', category: 'Unit Leadership', is_active: true },
    { id: 'c4', full_name: 'No Mail', email: '', category: 'Preceptor', is_active: true },
  ]
  assert.deepEqual(shapeContacts(rows, { population: 'contacts' }).people.map(p => p.contactId), ['c1', 'c3'])
  const leaders = shapeContacts(rows, { population: 'contacts', categories: ['Unit Leader'] })
  assert.deepEqual(leaders.people.map(p => p.contactId), ['c3'], 'a legacy category reads as its canonical one')
  assert.equal(shapeContacts(rows, { population: 'contacts', categories: ['Preceptor'] }).excluded[0].reason, 'no_email')
})

test('the last pass: one person per address, opted-out addresses out, the ceiling held', () => {
  const people = [
    { email: 'A@x.org', name: 'A' }, { email: 'a@x.org', name: 'A again' }, { email: 'b@x.org', name: 'B' }, { email: 'c@x.org', name: 'C' },
  ]
  const done = finishAudience({ people }, { optedOut: new Set(['b@x.org']), max: 1 })
  assert.deepEqual(done.recipients.map(r => r.normEmail), ['a@x.org'])
  assert.deepEqual(done.excluded.map(x => x.reason), ['duplicate', 'opted_out', 'over_limit'])
  assert.equal(MAX_AUDIENCE, 2000)
})

test('resolveAudience reads the population it is handed and skips opted-out addresses', async () => {
  const calls = []
  const db = {
    from(table) {
      const q = { table, f: [] }
      const api = {
        select() { return api }, eq(a, b) { q.f.push([a, b]); return api }, order() { return api },
        in(a, b) { q.f.push([a, b]); return api },
        then(ok, bad) {
          calls.push(q)
          if (table === 'contacts') return Promise.resolve({ data: [
            { id: 'c1', full_name: 'Pat', email: 'pat@x.org', category: 'Preceptor', is_active: true },
            { id: 'c2', full_name: 'Quin', email: 'quin@x.org', category: 'Preceptor', is_active: true },
          ], error: null }).then(ok, bad)
          if (table === 'program_news_optouts') return Promise.resolve({ data: [{ email_norm: 'quin@x.org' }], error: null }).then(ok, bad)
          return Promise.resolve({ data: [], error: null }).then(ok, bad)
        },
      }
      return api
    },
  }
  const r = await resolveAudience(db, { population: 'contacts' })
  assert.deepEqual(r.recipients.map(p => p.normEmail), ['pat@x.org'])
  assert.equal(r.excluded[0].reason, 'opted_out')
  assert.ok(calls.some(c => c.table === 'program_news_optouts' && c.f.some(([k, v]) => k === 'opted_out' && v === true)))
  await assert.rejects(() => resolveAudience(db, { population: 'students' }), /ASPIRE cohort/)
})

// ── The frozen list in the allowlist ────────────────────────────────────────────────────────────

const S1 = 'aaaaaaaa-0000-4000-8000-000000000001'
function fakeDb(students) {
  return {
    from(table) {
      const q = { f: [] }
      const api = {
        select() { return api }, eq(a, b) { q.f.push([a, b]); return api }, filter() { return api },
        limit() { return Promise.resolve({ data: [], error: null }) },
        single() {
          const id = (q.f.find(([k]) => k === 'id') || [])[1]
          const row = table === 'students' ? students[id] : null
          return Promise.resolve(row ? { data: row, error: null } : { data: null, error: { message: 'nf' } })
        },
      }
      return api
    },
  }
}
const ROWS = { [S1]: { id: S1, first_name: 'Ann', last_name: 'One', school_email: 'ann@school.edu', personal_email: 'ann@home.com', status: 'Completed' } }
const BATCH = '44444444-4444-4444-8444-444444444444'

test('the residency route is refused without a frozen list that holds it', async () => {
  const entry = { source: 'student', studentId: S1, email: 'ann.pref@mail.com', emailType: 'residency', name: 'Ann One' }
  const bare = await validateBulkRecipients({ db: fakeDb(ROWS), recipients: [entry], batchId: BATCH })
  assert.equal(bare.rejected[0].reason, 'residency_route_not_reviewed')
  const frozen = new Map([['ann.pref@mail.com', { source: 'student', studentId: S1, route: 'residency' }]])
  const ok = await validateBulkRecipients({ db: fakeDb(ROWS), recipients: [entry], batchId: BATCH, frozen })
  assert.equal(ok.cleared.length, 1)
  assert.equal(ok.cleared[0].emailSource, 'residency')
  const wrongRoute = new Map([['ann.pref@mail.com', { source: 'student', studentId: S1, route: 'school' }]])
  const no = await validateBulkRecipients({ db: fakeDb(ROWS), recipients: [entry], batchId: BATCH, frozen: wrongRoute })
  assert.equal(no.rejected[0].reason, 'residency_route_not_reviewed')
})

test('with a frozen list, anyone off it, or under another id, is not sent to', async () => {
  const frozen = new Map([['ann@school.edu', { source: 'student', studentId: S1, route: 'school' }]])
  const r = await validateBulkRecipients({
    db: fakeDb(ROWS), batchId: BATCH, frozen,
    recipients: [
      { source: 'manual', email: 'stranger@x.org' },
      { source: 'student', studentId: 'aaaaaaaa-0000-4000-8000-000000000009', email: 'ann@school.edu', emailType: 'school' },
    ],
  })
  assert.deepEqual(r.rejected.map(x => x.reason), ['not_in_reviewed_list', 'not_in_reviewed_list'])
  assert.equal(r.cleared.length, 0)
  const ok = await validateBulkRecipients({ db: fakeDb(ROWS), batchId: BATCH, frozen, recipients: [{ source: 'student', studentId: S1, email: 'ann@school.edu', emailType: 'school' }] })
  assert.equal(ok.cleared.length, 1)
})

test('a frozen residency entry still obeys the Not Proceeding rule', async () => {
  const np = { [S1]: { ...ROWS[S1], status: 'Not Proceeding' } }
  const frozen = new Map([['ann.pref@mail.com', { source: 'student', studentId: S1, route: 'residency' }]])
  const r = await validateBulkRecipients({ db: fakeDb(np), batchId: BATCH, frozen, recipients: [{ source: 'student', studentId: S1, email: 'ann.pref@mail.com', emailType: 'residency' }] })
  assert.equal(r.rejected[0].reason, 'not_proceeding_not_acknowledged')
})

// ── Program news ────────────────────────────────────────────────────────────────────────────────

test('an Unsubscribe token names a place on a list, never an address, and cannot be edited', () => {
  const t = newsToken(SECRET, SEND, 4, 'ann@home.com')
  assert.ok(!t.includes('ann'))
  const p = parseNewsToken(t)
  assert.deepEqual([p.sendId, p.index], [SEND, 4])
  assert.equal(verifyNewsToken(SECRET, p, 'ann@home.com'), true)
  assert.equal(verifyNewsToken(SECRET, p, 'bo@home.com'), false)
  assert.equal(verifyNewsToken(SECRET, { ...p, index: 5 }, 'ann@home.com'), false)
  assert.equal(verifyNewsToken('another-secret-entirely-long', p, 'ann@home.com'), false)
  assert.equal(newsToken('', SEND, 4, 'ann@home.com'), '')
  assert.equal(newsSecret({ SIG_TOKEN_SECRET: 'short' }), '')
  assert.equal(newsSecret({ SIG_TOKEN_SECRET: SECRET }), SECRET)
  assert.equal(maskEmail('jester@cshs.org'), 'j•••@cshs.org')
})

test('the email ends with the program-news line only when it has a link to give', () => {
  const design = LAYOUTS[0].build()
  const { html, text } = renderStudioEmail(design, { unsubscribe: 'marker' })
  assert.ok(html.includes(UNSUB_MARKER) && text.includes(UNSUB_MARKER))
  const url = 'https://aspireintelligence.app/news#t=x&y'
  const filled = withUnsubscribe(html, url)
  assert.ok(filled.includes('https://aspireintelligence.app/news#t=x&amp;y'), 'the link is escaped')
  assert.ok(!filled.includes(UNSUB_MARKER) && !filled.includes('st-unsub'))
  assert.ok(withUnsubscribe(text, url).includes('Unsubscribe from program news: https://'))
  for (const out of [withUnsubscribe(html, null), withUnsubscribe(html, 'javascript:alert(1)'), withUnsubscribe(text, null)]) {
    assert.ok(!/Unsubscribe/.test(out) && !out.includes(UNSUB_MARKER))
  }
  assert.ok(!renderStudioEmail(design).html.includes('Unsubscribe'), 'the editor canvas draws no line unless asked')
  assert.ok(renderStudioEmail(design, { unsubscribe: 'preview' }).html.includes('Unsubscribe'))
})

test('each recipient gets their own link and the one-click headers', () => {
  const send = { id: SEND, indexOf: new Map([['ann@home.com', 2]]) }
  const u = unsubscribeFor(send, 'ann@home.com', { STUDIO_TOKEN_SECRET: SECRET })
  assert.match(u.url, /\/news#t=33333333-3333-4333-8333-333333333333\.2\./)
  assert.match(u.headers['List-Unsubscribe'], /^<https?:\/\/.+\/api\/program-news\?t=/)
  assert.equal(u.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click')
  assert.equal(unsubscribeFor(send, 'nobody@x.org', { STUDIO_TOKEN_SECRET: SECRET }), null)
  assert.equal(unsubscribeFor(send, 'ann@home.com', {}), null)
})

test('the unsubscribe page finds the address from the frozen list and refuses anything else', async () => {
  const token = newsToken(SECRET, SEND, 1, 'bo@home.com')
  const db = (entry) => ({
    from() {
      const api = { select(cols) { api.cols = cols; return api }, eq() { return api }, maybeSingle() { return Promise.resolve({ data: entry === undefined ? null : { id: SEND, is_demo: false, entry }, error: null }) } }
      return api
    },
  })
  const link = await resolveNewsToken(db({ normEmail: 'bo@home.com', email: 'Bo@Home.com' }), token, SECRET)
  assert.deepEqual([link.sendId, link.normEmail, link.isDemo], [SEND, 'bo@home.com', false])
  await assert.rejects(() => resolveNewsToken(db({ normEmail: 'someone@else.org' }), token, SECRET), /does not work/)
  await assert.rejects(() => resolveNewsToken(db(undefined), token, SECRET), /does not work/)
  await assert.rejects(() => resolveNewsToken(db({ normEmail: 'bo@home.com' }), 'garbage', SECRET), /does not work/)
})

// ── Where it is wired ───────────────────────────────────────────────────────────────────────────

test('the bulk endpoint sends a Studio email only to its frozen list, without opted-out addresses', () => {
  const src = read('api/connect-send-bulk-message.js')
  assert.match(src, /loadStudioSend\(supabaseAdmin/)
  assert.match(src, /frozen: studioSend\?\.frozen \|\| null/)
  assert.match(src, /dropOptedOut\(supabaseAdmin, cleared\)/)
  assert.match(src, /headers: unsub\.headers/)
  const send = read('lib/server/studio/studioSend.js')
  assert.match(send, /code: 'review_required'/, 'once the table exists a Studio send without a frozen list is refused')
  assert.match(send, /data\.created_by !== profileId \|\| data\.is_demo !== isDemo/)
})

test('the public endpoint answers with a masked address and is rate-limited', () => {
  const src = read('api/program-news.js')
  assert.match(src, /consumePublicRateLimit/)
  assert.match(src, /email: maskEmail\(link\.email\)/)
  assert.ok(!/normEmail[^\n]*res\.status\(200\)\.json/.test(src))
})

test('the migration: two server-only tables, nothing for the browser', () => {
  const sql = read('supabase/migrations/20261130000000_studio_audiences.sql')
  for (const t of ['studio_sends', 'program_news_optouts']) {
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${t}\\s+ENABLE ROW LEVEL SECURITY`))
    assert.match(sql, new RegExp(`GRANT SELECT, INSERT, UPDATE ON TABLE public\\.${t}\\s+TO service_role;`))
  }
  assert.ok(!/GRANT[^;]*\b(anon|authenticated)\b/.test(sql))
  assert.ok(!/DELETE/.test(sql.split('-- ── Rollback')[0].replace(/ON DELETE SET NULL/g, '')))
})

test('the migration runs on Postgres and holds its shape', async () => {
  const { PGlite } = await import('@electric-sql/pglite')
  const pg = new PGlite()
  await pg.exec(`
    DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    CREATE TABLE public.user_profiles (id uuid PRIMARY KEY);
    CREATE TABLE public.studio_designs (id uuid PRIMARY KEY DEFAULT gen_random_uuid());`)
  await pg.exec(read('supabase/migrations/20261130000000_studio_audiences.sql'))
  await pg.exec(read('supabase/migrations/20261130000000_studio_audiences.sql'))   // safe to re-run
  await pg.exec(`INSERT INTO studio_sends (mode, recipients) VALUES ('rule', '[{"normEmail":"a@x.org"}]')`)
  await assert.rejects(() => pg.exec(`INSERT INTO studio_sends (mode) VALUES ('magic')`))
  await assert.rejects(() => pg.exec(`INSERT INTO studio_sends (mode, reply_route) VALUES ('hand', 'everyone')`))
  await pg.exec(`INSERT INTO program_news_optouts (email_norm) VALUES ('a@x.org')`)
  await assert.rejects(() => pg.exec(`INSERT INTO program_news_optouts (email_norm) VALUES ('Mixed@X.org')`))
  const { rows } = await pg.query(`SELECT grantee, privilege_type FROM information_schema.role_table_grants WHERE table_name IN ('studio_sends','program_news_optouts') AND grantee IN ('anon','authenticated')`)
  assert.equal(rows.length, 0)
})

test('the hand list is the recipients array, not the dedupe result object', () => {
  // Studio Phase 1 shipped `const recipients = useMemo(() => buildCombinedRecipients(...))`, an object,
  // so opening Review & send threw "(recipients || []).filter is not a function" and blanked the page.
  const src = read('src/components/studio/StudioSendDrawer.jsx')
  assert.match(src, /buildCombinedRecipients\(\{[^}]*\}\)\.recipients/, 'read .recipients off the dedupe result')
})

test('STUDIO-LOGO-1: headers open on the Cedars-Sinai logo and the institute full name, in an email-safe format', async () => {
  const { BLOCKS } = await import('../src/lib/studio/studioBlocks.js')
  const { emailLogoUrl, renderStudioEmail } = await import('../src/lib/studio/renderEmail.js')
  const { LAYOUTS } = await import('../src/lib/studio/studioLayouts.js')
  assert.equal(BLOCKS.header.props.showLogo, true)
  assert.equal(BLOCKS.header.props.tagline, 'Geri & Richard Brawerman Nursing Institute')
  assert.equal(emailLogoUrl('https://x.supabase.co/logo.svg', 'https://app.test'), 'https://app.test/Cedars-Sinai.png', 'SVG is not drawn by Gmail or Outlook')
  assert.equal(emailLogoUrl('https://x.supabase.co/logo.png', 'https://app.test'), 'https://x.supabase.co/logo.png')
  assert.equal(emailLogoUrl('', ''), '/Cedars-Sinai.png')
  for (const l of LAYOUTS) {
    const html = renderStudioEmail(l.build(), { brand: { logoUrl: 'https://app.test/Cedars-Sinai.png', alt: 'Cedars-Sinai' } }).html
    assert.match(html, /<img src="https:\/\/app\.test\/Cedars-Sinai\.png" alt="Cedars-Sinai"/, l.key)
    assert.match(html, /Geri &amp; Richard Brawerman Nursing Institute/, l.key)
  }
})

test('STUDIO-DRAFTS-1 and FLICKER-1: an opened layout is not a draft, and its first save does not remount the editor', () => {
  const ed = read('src/components/studio/StudioEditor.jsx')
  assert.match(ed, /useState\(initialDesign \? 'pristine' : 'saved'\)/, 'a new design waits for its first edit')
  assert.match(ed, /createdHere\.current === designId\) return/, 'the design this editor created is not reloaded')
  const ws = read('src/components/studio/StudioWorkspace.jsx')
  assert.match(ws, /key=\{keyFor\[param\] \|\| param\}/, 'the editor keeps the key it opened with')
})
