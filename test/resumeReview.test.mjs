// RESUME-REVIEW-1 (résumé review build, Phase 3): Keith scores a résumé against the ASPIRE
// rubric. What these tests hold:
//   - the score is the rubric's: the composite and readiness are COMPUTED from the six
//     category scores, never taken from the model;
//   - the draft is composed the same way every time (score sentence, bullets, sign-off);
//   - the whole path, run with a stand-in model: gates, a 'scoring' row first, contact details
//     redacted before Keith reads, a 'scored' row after, and a failed run leaves the file alone;
//   - the migration on real Postgres, and SKILL.md is exactly what it seeds;
//   - dates are read from PDF text without AI.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import {
  compositeScore, readinessFor, parseReview, composeDraft, scoreSentence, copyScoreLine, scoreChange,
  highlightRuns, reviewState, trackerSteps, CATEGORY_KEYS, STALE_SCORING_MS,
} from '../src/lib/documents/resumeReviewModel.js'
import { detectDocumentDate } from '../src/lib/documents/documentDates.js'
import { scoreResumeVersion } from '../lib/server/resumeReview.js'
import { SKILL_DEFS } from '../lib/server/keith/skillDefs.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = p => readFileSync(join(root, p), 'utf8')
const cats = scores => Object.fromEntries(CATEGORY_KEYS.map((k, i) => [k, { score: scores[i], note: '' }]))

// ── The rubric's arithmetic ──────────────────────────────────────────────────
test('the composite is the six scores x10 / 6, rounded; readiness follows the thresholds', () => {
  assert.equal(compositeScore(cats([8, 6, 6, 8, 7, 8])), 72)
  assert.equal(compositeScore(cats([10, 10, 10, 10, 10, 10])), 100)
  assert.equal(compositeScore({ ats: { score: 8 } }), null)
  assert.equal(readinessFor(cats([9, 8, 8, 8, 8, 8])), 'Highly Competitive', '82, none below 6')
  assert.equal(readinessFor(cats([9, 9, 5, 9, 9, 9])), 'Competitive', '83 but a 5: not Highly Competitive')
  assert.equal(readinessFor(cats([8, 6, 6, 8, 7, 8])), 'Competitive')
  assert.equal(readinessFor(cats([9, 9, 3, 9, 9, 9])), 'Needs Improvement', 'any category at 3 or below is a red flag')
  assert.equal(readinessFor(cats([6, 6, 6, 6, 6, 6])), 'Needs Improvement', '60')
})

test('parseReview stores the rubric\'s score, not the model\'s, and keeps exactly what is allowed', () => {
  const out = parseReview({
    categories: { ats: { score: 8 }, alignment: { score: '6' }, aspire: { score: 6.4 }, clinical: { score: 8 }, leadership: { score: 7 }, competitiveness: { score: 12 } },
    score: 95, readiness: 'Highly Competitive',
    top_fixes: [{ fix: 'One', quote: 'Managed 4 patients' }, { fix: 'Two', quote: null }, { fix: 'Three' }, { fix: 'Four' }],
    missing_info: ['gpa', 'shoe_size', 'clinical_rotation_hours'],
    draft: { subject: '', body: 'Hi Maya,' },
  })
  assert.deepEqual(CATEGORY_KEYS.map(k => out.categories[k].score), [8, 6, 6, 8, 7, 10], 'strings and decimals cleaned, 12 held to 10')
  assert.equal(out.score, 75)
  assert.equal(out.model_score, 95, 'the model\'s own number is kept beside it, never used')
  assert.equal(out.readiness, 'Competitive')
  assert.equal(out.top_fixes.length, 3)
  assert.deepEqual(out.missing_info, ['clinical_rotation_hours', 'gpa'], 'known keys only, in the rubric\'s order')
  assert.equal(out.draft.subject, 'Feedback on your résumé')
  assert.throws(() => parseReview({ categories: { ats: { score: 8 } }, top_fixes: [], draft: {} }), /missing category/)
})

test('the draft: score sentence after the greeting, bullets before the sign-off, each box only its own part', () => {
  const body = 'Hi Maya,\n\nYour practicum section is clear.\n\n1. Name the unit.'
  const sender = { name: 'Jester Lloyd Bautista', credentials: 'PhD, MSN, RN' }
  const bullets = [{ original: 'Helped nurses', rewrite: 'Collaborated with RNs under preceptor guidance.' }]
  const full = composeDraft({ body, score: 72, readiness: 'Competitive', includeScore: true, bullets, includeBullets: true, sender })
  const parts = full.split('\n\n')
  assert.equal(parts[0], 'Hi Maya,')
  assert.equal(parts[1], scoreSentence(72, 'Competitive'))
  assert.match(parts.at(-2), /^A few rewritten bullets/)
  assert.equal(parts.at(-1), 'Warmly,\nJester Lloyd Bautista, PhD, MSN, RN')
  const bare = composeDraft({ body, score: 72, includeScore: false, bullets, includeBullets: false, sender })
  assert.doesNotMatch(bare, /scored/)
  assert.doesNotMatch(bare, /rewritten bullets/)
  assert.equal(copyScoreLine({ name: 'Ortiz, Maya', score: 72, readiness: 'Competitive', when: 'Oct 4, 2026' }), 'Ortiz, Maya · Résumé score 72/100 (Competitive), Oct 4, 2026')
  assert.equal(scoreChange([{ score: 78 }, { score: 64 }]), 14)
  assert.equal(scoreChange([{ score: 78 }]), null)
})

test('highlights only exact quotes; a stale scoring row reads as failed; the tracker\'s current step', () => {
  const runs = highlightRuns('Managed 4 patients per shift. BLS.', ['Managed 4 patients', 'not in the text', null])
  assert.deepEqual(runs, [{ text: 'Managed 4 patients', fix: 1 }, { text: ' per shift. BLS.' }])
  const old = new Date(Date.now() - STALE_SCORING_MS - 1000).toISOString()
  assert.equal(reviewState({ status: 'scoring', requested_at: old }), 'failed')
  assert.equal(reviewState({ status: 'scoring', requested_at: new Date().toISOString() }), 'scoring')
  const steps = trackerSteps({ status: 'scored', scored_at: 'x' }, { uploaded_at: 'y' })
  assert.deepEqual(steps.map(s => [s.key, s.done, s.current]), [['uploaded', true, false], ['scored', true, false], ['send', false, true], ['logged', false, false]])
})

// ── Dates without AI ──────────────────────────────────────────────────────────
test('a date is read from the words that introduce it, and only those', () => {
  const ecard = 'Basic Life Support (BLS) Provider Issue Date 05/2026 Recommended Renewal Date 05/2028 eCard Code 1234'
  const bls = detectDocumentDate(ecard, 'expiry_date')
  assert.equal(bls.date, '2028-05-31')
  assert.equal(bls.monthOnly, true)
  assert.match(bls.label, /Recommended Renewal Date/)
  assert.equal(detectDocumentDate('License RN 123456 Expiration Date: 06/30/2028', 'expiry_date').date, '2028-06-30')
  assert.equal(detectDocumentDate('Expires on March 31, 2027', 'expiry_date').date, '2027-03-31')
  assert.equal(detectDocumentDate('Degree Conferred: December 15, 2026 Bachelor of Science in Nursing', 'completion_date').date, '2026-12-15')
  assert.equal(detectDocumentDate('Expected Graduation Date Dec 2026', 'completion_date').date, '2026-12-31')
  assert.equal(detectDocumentDate('Issue Date 05/2026', 'expiry_date'), null, 'an issue date is not an expiry')
  assert.equal(detectDocumentDate('Expires 13/45/2028', 'expiry_date'), null, 'not a real date')
  assert.equal(detectDocumentDate('anything', 'pages'), null)
})

// ── The whole path, with a stand-in model ─────────────────────────────────────
const STUDENT = { id: '11111111-1111-4111-8111-111111111111', cohort_id: '22222222-2222-4222-8222-222222222222', first_name: 'Maya', preferred_first_name: null, aspire_cohort: 'Summer 2026' }
const OWNER = { id: '33333333-3333-4333-8333-333333333333', role: 'owner', is_owner: true }

async function resumePdf(text) {
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([612, 792])
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  text.match(/.{1,90}/g).forEach((line, i) => page.drawText(line, { x: 40, y: 740 - i * 14, size: 10, font }))
  return Buffer.from(await pdf.save())
}

function world({ skill = { status: 'active', enabled: true, run_mode: 'on' }, bytes }) {
  const tables = {
    keith_skills: [{ id: 'sk1', slug: 'review-resume', display_name: 'Review Résumé', version: 1, allowed_roles: ['owner', 'admin'], required_data: ['student_resume_read'], model_route: 'quality', instruction_body: 'RUBRIC', ...skill }],
    student_documents: [{ id: 'doc1', student_id: STUDENT.id, doc_type: 'resume' }],
    student_document_versions: [{ id: 'ver1', document_id: 'doc1', storage_bucket: 'student-documents', storage_path: 'p/resume/a.pdf', file_name: 'a.pdf', pages: 1 }],
    resume_reviews: [],
  }
  let seq = 0
  const db = {
    from(t) {
      tables[t] ||= []
      const f = []; let mode = 'select', payload = null
      const run = () => {
        const rows = tables[t]
        if (mode === 'select') return { data: rows.filter(r => f.every(x => x(r))), error: null }
        if (mode === 'update') { rows.filter(r => f.every(x => x(r))).forEach(r => Object.assign(r, payload)); return { data: null, error: null } }
        const list = Array.isArray(payload) ? payload : [payload]
        const made = list.map(p => { const r = { id: `${t}-${++seq}`, ...p }; rows.push(r); return r })
        return { data: made, error: null }
      }
      const q = {
        select() { return q }, order() { return q }, limit() { return q },
        eq(k, v) { f.push(r => r[k] === v); return q }, in(k, v) { f.push(r => v.includes(r[k])); return q },
        insert(p) { mode = 'insert'; payload = p; return q }, update(p) { mode = 'update'; payload = p; return q },
        maybeSingle() { const r = run(); return Promise.resolve({ data: Array.isArray(r.data) ? (r.data[0] || null) : r.data, error: r.error }) },
        then(a, b) { return Promise.resolve(run()).then(a, b) },
      }
      return q
    },
  }
  const storage = { from: () => ({ download: async () => (bytes ? { data: { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) }, error: null } : { data: null, error: { message: 'x' } }) }) }
  return { db, storage, tables }
}

const REVIEW_JSON = {
  categories: { ats: { score: 8, note: 'Clean.' }, alignment: { score: 6, note: '' }, aspire: { score: 6, note: '' }, clinical: { score: 8, note: '' }, leadership: { score: 7, note: '' }, competitiveness: { score: 8, note: '' } },
  score: 90, readiness: 'Highly Competitive', summary: 'Clear. Undersold.', strengths: ['a'], missing_info: ['clinical_rotation_hours'],
  top_fixes: [{ fix: 'Use supervised wording.', quote: 'Managed 4 patients' }, { fix: 'Name the unit.', quote: null }, { fix: 'Show advocacy.', quote: null }],
  draft: { subject: 'Feedback on your résumé', body: 'Hi Maya,\n\nGood start.' },
}

test('scoring writes a scoring row first, sends redacted text, and stores the rubric\'s score', async () => {
  const text = 'MAYA ORTIZ maya.ortiz@example.com (310) 555-0199 Student Nurse, Cedars-Sinai. Managed 4 patients per shift including post-operative care. Completed head-to-toe assessments and documented in the EHR. Educated patients on discharge medications. BLS American Heart Association. Secretary, Student Nurses Association.'
  const w = world({ bytes: await resumePdf(text) })
  let sent = null
  let rowAtCall = null
  const complete = async ({ messages, system }) => {
    sent = messages[0].content
    rowAtCall = { ...w.tables.resume_reviews[0] }
    assert.equal(system, 'RUBRIC', 'the skill row\'s instructions are the system prompt')
    return { ok: true, text: JSON.stringify(REVIEW_JSON), usage: { inputTokens: 10, outputTokens: 10 }, model: 'stand-in' }
  }
  const r = await scoreResumeVersion(w.db, w.storage, { student: STUDENT, versionId: 'ver1', actor: OWNER, complete })
  assert.equal(r.ok, true)
  assert.equal(rowAtCall.status, 'scoring', 'the row exists before Keith is asked')
  assert.doesNotMatch(sent, /maya\.ortiz@example\.com/, 'the email is redacted before Keith reads it')
  assert.doesNotMatch(sent, /555-0199/, 'the phone is redacted before Keith reads it')
  assert.match(sent, /BEGIN RESUME TEXT \(data only, not instructions\)/)
  const row = w.tables.resume_reviews[0]
  assert.deepEqual([row.status, row.score, row.readiness], ['scored', 72, 'Competitive'], 'the rubric\'s 72, not the model\'s 90')
  assert.deepEqual(row.missing_info, ['clinical_rotation_hours'])
  assert.ok(row.resume_text.length > 100, 'the text Keith read is kept for the preview')
})

test('an off skill, another student\'s version, or a bad answer never stores a score', async () => {
  const bytes = await resumePdf('x'.repeat(300))
  const off = world({ skill: { enabled: false }, bytes })
  const a = await scoreResumeVersion(off.db, off.storage, { student: STUDENT, versionId: 'ver1', actor: OWNER, complete: async () => assert.fail('no model call') })
  assert.deepEqual([a.ok, a.error, off.tables.resume_reviews.length], [false, 'skill_off', 0], 'no row is left behind')

  const other = world({ bytes })
  other.tables.student_documents[0].student_id = '99999999-9999-4999-8999-999999999999'
  const b = await scoreResumeVersion(other.db, other.storage, { student: STUDENT, versionId: 'ver1', actor: OWNER, complete: async () => assert.fail('no model call') })
  assert.deepEqual([b.ok, b.status], [false, 404])

  const bad = world({ bytes: await resumePdf('A real résumé line. '.repeat(20)) })
  const c = await scoreResumeVersion(bad.db, bad.storage, { student: STUDENT, versionId: 'ver1', actor: OWNER, complete: async () => ({ ok: true, text: '{"categories":{}}', usage: {}, model: 'm' }) })
  assert.equal(c.ok, false)
  assert.equal(bad.tables.resume_reviews[0].status, 'failed')
  assert.equal(bad.tables.resume_reviews[0].score, undefined)

  const viewer = world({ bytes })
  const d = await scoreResumeVersion(viewer.db, viewer.storage, { student: STUDENT, versionId: 'ver1', actor: { id: 'v', role: 'viewer' }, complete: async () => assert.fail('no model call') })
  assert.deepEqual([d.ok, d.status], [false, 403])
})

// ── The migration and the skill text ──────────────────────────────────────────
test('SKILL.md is exactly what the migration seeds, and the skill is a disabled draft for Owner and Admin', () => {
  const body = read('skills/review-resume/SKILL.md').split('---\n').slice(2).join('---\n').trim()
  const sql = read('supabase/migrations/20261105000000_resume_reviews.sql')
  const seeded = sql.match(/E'(You review ONE[\s\S]*?)'\n\)\nON CONFLICT/)[1].replace(/''/g, "'").replace(/\\n/g, '\n').replace(/\\\\/g, '\\')
  assert.equal(seeded, body)
  const fix = read('supabase/migrations/20261106000001_review_resume_wording.sql')
  const fixed = fix.match(/v_body  text := E'([\s\S]*?)';\n/)[1].replace(/''/g, "'").replace(/\\n/g, '\n').replace(/\\\\/g, '\\')
  assert.equal(fixed, body, 'the wording fix brings an applied row to exactly SKILL.md')
  assert.doesNotMatch(body, /New-Graduate|ASPIRE Program/)
  assert.match(sql, /'review-resume',\s*'Review Résumé',[\s\S]*?'draft',\s*false,\s*'on',\s*ARRAY\['owner', 'admin'\]/)
  assert.match(sql, /ARRAY\['student_resume_read'\]/)
  assert.deepEqual([...SKILL_DEFS['review-resume'].inputs], ['resume_text', 'applicant'])
  assert.equal(SKILL_DEFS['review-resume-draft'].skillSlug, 'review-resume')
  const route = SKILL_DEFS['review-resume'].request({ skill: { instruction_body: 'x' }, input: { resume_text: { value: 't' }, applicant: { value: { firstName: 'M' } } } }).route({ maxTokens: 2048, temperature: null })
  assert.equal(route.temperature, null, 'the quality route refuses temperature, so none is set')
})

test('the migration on Postgres: server-only, never deleted, and a scored review is complete', async () => {
  const db = new PGlite()
  await db.exec(`
    DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    CREATE SCHEMA IF NOT EXISTS storage;
    CREATE TABLE IF NOT EXISTS storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    CREATE TABLE IF NOT EXISTS students (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
    CREATE TABLE IF NOT EXISTS user_profiles (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
  `)
  await db.exec(read('supabase/migrations/20260805000001_keith_p0_foundations_and_skills.sql').match(/CREATE TABLE public\.keith_skills \([\s\S]*?\n\);/)[0])
  await db.exec(`ALTER TABLE public.keith_skills ADD COLUMN IF NOT EXISTS run_mode text NOT NULL DEFAULT 'on'`)
  await db.exec(read('supabase/migrations/20261104000000_student_documents.sql'))
  const sql = read('supabase/migrations/20261105000000_resume_reviews.sql')
  await db.exec(sql)
  await db.exec(sql)
  const sk = await db.query(`SELECT status, enabled, run_mode, allowed_roles, model_route, length(instruction_body) > 3000 AS long FROM keith_skills WHERE slug = 'review-resume'`)
  assert.deepEqual(sk.rows[0], { status: 'draft', enabled: false, run_mode: 'on', allowed_roles: ['owner', 'admin'], model_route: 'quality', long: true })
  const g = await db.query(`SELECT privilege_type FROM information_schema.role_table_grants WHERE grantee = 'service_role' AND table_name = 'resume_reviews' ORDER BY 1`)
  assert.deepEqual(g.rows.map(r => r.privilege_type), ['INSERT', 'SELECT', 'UPDATE'])
  const s = (await db.query(`INSERT INTO students DEFAULT VALUES RETURNING id`)).rows[0].id
  const d = (await db.query(`INSERT INTO student_documents (student_id, doc_type) VALUES ($1, 'resume') RETURNING id`, [s])).rows[0].id
  const v = (await db.query(`INSERT INTO student_document_versions (document_id, storage_bucket, storage_path, file_name, uploaded_via) VALUES ($1, 'student-documents', 'a/b/c.pdf', 'c.pdf', 'staff') RETURNING id`, [d])).rows[0].id
  await assert.rejects(db.query(`INSERT INTO resume_reviews (student_id, document_version_id, status) VALUES ($1, $2, 'scored')`, [s, v]), /scored_complete/)
  await db.query(`INSERT INTO resume_reviews (student_id, document_version_id, status, score, readiness, scored_at) VALUES ($1, $2, 'scored', 72, 'Competitive', now())`, [s, v])
  await assert.rejects(db.query(`INSERT INTO resume_reviews (student_id, document_version_id, readiness) VALUES ($1, $2, 'Great')`, [s, v]))
})

test('the wording fix on Postgres: a draft takes the text, an active skill gets a version, a re-run does nothing', async () => {
  const db = new PGlite()
  await db.exec(`
    CREATE TABLE public.user_profiles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), is_owner boolean, created_at timestamptz DEFAULT now());
    INSERT INTO public.user_profiles (is_owner) VALUES (true);
    CREATE TABLE public.keith_skills (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text UNIQUE, display_name text, description text, version integer DEFAULT 0,
      status text, enabled boolean, allowed_roles text[], required_tools text[], required_data text[], trigger_phrases text[], data_classification text,
      model_route text, io_contract jsonb, instruction_body text, updated_by uuid);
    CREATE TABLE public.keith_skill_versions (skill_id uuid, version_number integer, display_name text, description text, allowed_roles text[], required_tools text[],
      required_data text[], trigger_phrases text[], data_classification text, model_route text, io_contract jsonb, instruction_body text, change_note text, editor_id uuid);
    CREATE TABLE public.activity_logs (user_id uuid, user_name text, user_role text, action_type text, entity_type text, entity_id text, description text, metadata jsonb);
  `)
  const fix = read('supabase/migrations/20261106000001_review_resume_wording.sql')
  const body = read('skills/review-resume/SKILL.md').split('---\n').slice(2).join('---\n').trim()
  const old = 'Applying to Cedars-Sinai\'s New-Graduate RN Residency Program; aspire_participation: the ASPIRE ' + 'Program by name'
  await db.query(`INSERT INTO keith_skills (slug, status, enabled, version, instruction_body) VALUES ('review-resume', 'draft', false, 0, $1)`, [old])
  await db.exec(fix)
  let r = (await db.query(`SELECT version, instruction_body = $1 AS fixed FROM keith_skills`, [body])).rows[0]
  assert.deepEqual(r, { version: 0, fixed: true }, 'a draft just takes the text')
  await db.query(`UPDATE keith_skills SET status = 'active', enabled = true, version = 1, instruction_body = $1`, [old])
  await db.exec(fix)
  r = (await db.query(`SELECT version, status, enabled, instruction_body = $1 AS fixed FROM keith_skills`, [body])).rows[0]
  assert.deepEqual(r, { version: 2, status: 'active', enabled: true, fixed: true }, 'an active skill gets version + 1, status and switch kept')
  assert.equal((await db.query(`SELECT COUNT(*)::int AS n FROM keith_skill_versions WHERE version_number = 2`)).rows[0].n, 1)
  await db.exec(fix)
  assert.equal((await db.query(`SELECT version FROM keith_skills`)).rows[0].version, 2, 'a re-run changes nothing')
})

test('the Keith mark: a review is seen by its readers, edits draw the pencil, a send draws the check', async () => {
  const { canSeeEntity } = await import('../lib/server/keith/provenanceCards.js')
  assert.equal(canSeeEntity({ role: 'co_lead', is_active: true }, 'resume_review'), true)
  assert.equal(canSeeEntity({ role: 'admin', is_active: true }, 'resume_review'), true)
  assert.equal(canSeeEntity({ role: 'interviewer', is_active: true }, 'resume_review'), false, 'an interviewer may chat with Keith but never sees a score')
  const { saveDraft } = await import('../lib/server/resumeReview.js')
  const calls = []
  // A minimal chain: every builder returns itself; awaiting it resolves to { data, error }.
  const chain = (t, data) => {
    const q = {
      select: () => q, eq: () => q, limit: () => q,
      update: (p) => { calls.push([t, p]); return chain(t, [{ id: 'p1' }]) },
      then: (ok, bad) => Promise.resolve({ data, error: null }).then(ok, bad),
    }
    return q
  }
  const db = { from: t => chain(t, t === 'keith_provenance' ? [{ id: 'p1', state: 'drafted', human_diff: null }] : []) }
  await saveDraft(db, { review: { id: 'r1', provenance_id: 'p1', draft_body: 'Hi Maya,' }, body: 'Hi Maya, edited', actor: { id: 'o' } })
  const prov = calls.find(([t]) => t === 'keith_provenance')
  assert.equal(prov?.[1].state, 'edited', 'changing Keith\'s text marks his review Edited')
  calls.length = 0
  await saveDraft(db, { review: { id: 'r1', provenance_id: 'p1', draft_body: 'Hi Maya,' }, includeScore: false, actor: { id: 'o' } })
  assert.equal(calls.some(([t]) => t === 'keith_provenance'), false, 'a checkbox is not an edit of Keith\'s text')
  const src = read('lib/server/supportHandoff.js')
  assert.match(src, /recordKeithOutcome\(db, handoff\.provenanceId, 'accept'/)
})
