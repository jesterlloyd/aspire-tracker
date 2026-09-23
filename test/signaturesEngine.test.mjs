// test/signaturesEngine.test.mjs
//
// SIGNATURES-PHASE2: the whole engine, end to end, on real Postgres (PGlite) with the real
// migration, a fake storage bucket and mailer, and a local RFC 3161 authority. No network.
//
// Scenario: a student (email link + code) signs first, a staff member (password) signs
// second, in order. Then: seal, file to the student's record, copies to every party, and
// an independent check of the seal, its timestamps, the certificate page and the chain.
// Plus: decline, void, excluded types, bulk sends, and the rules that block Finish.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { extractText } from 'unpdf'
import { pgliteRest, fakeMailer } from './helpers/pgliteRest.mjs'
import { fakeTsa, makeTestSealP12 } from './helpers/fakeTsa.mjs'

process.env.SIG_TOKEN_SECRET = 'test-secret-for-signatures-phase2-0123456789abcdef'

const E = await import('../lib/server/signatures/engine.js')
const { linkTokenFor } = await import('../lib/server/signatures/tokens.js')
const { verifySealedPdf } = await import('../lib/server/signatures/verifySeal.js')

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const migration = readFileSync(join(root, 'supabase/migrations/20260927000000_signatures_phase2.sql'), 'utf8')
const PRELUDE = `
  DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  CREATE SCHEMA IF NOT EXISTS auth; CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
  CREATE SCHEMA IF NOT EXISTS storage;
  CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  CREATE TABLE user_profiles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), auth_user_id uuid, role text, is_owner boolean DEFAULT false, is_active boolean DEFAULT true, email text, full_name text, connect_signature jsonb);
  CREATE TABLE students (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), first_name text, last_name text, school text, phone text, is_demo boolean DEFAULT false);
  CREATE TABLE contacts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), full_name text, email text, phone text, title text, role text, school_name text, organization text);
  CREATE TABLE catalog_resources (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE record_documents (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), subject_type text, student_id uuid, school_name text, title text, file_name text, storage_path text, content_type text, size_bytes bigint, source text, source_ref uuid, is_demo boolean, created_by uuid, created_at timestamptz DEFAULT now());
  CREATE OR REPLACE FUNCTION public.is_staff() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
  CREATE OR REPLACE FUNCTION public.is_active_owner_or_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
`

async function world() {
  const pg = new PGlite()
  await pg.exec(PRELUDE); await pg.exec(migration)
  const db = pgliteRest(pg)
  const tsa = fakeTsa()
  const seal = makeTestSealP12()
  const env = { SIG_SEAL_P12_BASE64: seal.p12Base64, SIG_SEAL_P12_PASSPHRASE: seal.passphrase }
  const settings = await E.loadSettings(db)
  const mailer = fakeMailer()
  const { rows: [staff] } = await pg.query(`INSERT INTO user_profiles (role, is_owner, email, full_name) VALUES ('owner', true, 'lead@cshs.org', 'Jester Lead') RETURNING *`)
  const { rows: [student] } = await pg.query(`INSERT INTO students (first_name, last_name, school, phone) VALUES ('Ava', 'Nguyen', 'UCLA', '(310) 555-0142') RETURNING *`)
  // A two-page PDF in the documents bucket.
  const doc = await PDFDocument.create(); const f = await doc.embedFont(StandardFonts.Helvetica)
  for (const t of ['Clinical Affiliation Attestation', 'Attachment A']) doc.addPage([612, 792]).drawText(t, { x: 72, y: 700, size: 16, font: f })
  const bytes = Buffer.from(await doc.save())
  const path = `uploads/${randomUUID()}.pdf`
  await db.storage.from('signature-documents').upload(path, bytes)
  return { pg, db, tsa, env, settings, mailer, staff, student, path, sha: createHash('sha256').update(bytes).digest('hex') }
}

const FIELDS = [
  { id: 'f1', type: 'check', role: 'r1', page: 2, x: 9, y: 61, w: 4, h: 3.2, group: 'Attachments', groupRule: 'at_least_1' },
  { id: 'f2', type: 'check', role: 'r1', page: 2, x: 9, y: 66, w: 4, h: 3.2, group: 'Attachments', groupRule: 'at_least_1' },
  { id: 'f3', type: 'sig', role: 'r1', page: 1, x: 9, y: 40, w: 24, h: 6, required: true },
  { id: 'f4', type: 'name', role: 'r1', page: 1, x: 9, y: 50, w: 26, h: 4, required: true },
  { id: 'f5', type: 'date', role: 'r1', page: 1, x: 9, y: 61, w: 18, h: 4, required: true },
  { id: 'f6', type: 'phone', role: 'r1', page: 2, x: 44, y: 52, w: 20, h: 4, required: true, rule: 'us_phone' },
  { id: 'f7', type: 'sig', role: 'r2', page: 1, x: 53, y: 40, w: 24, h: 6, required: true },
  { id: 'f8', type: 'date', role: 'r2', page: 1, x: 53, y: 61, w: 18, h: 4, required: true },
  { id: 'f9', type: 'text', role: 'sender', page: 1, x: 67, y: 26, w: 22, h: 3.2, required: true },
]
const ROLES = [{ key: 'r1', type: 'signer', label: 'Student' }, { key: 'r2', type: 'signer', label: 'Cedars-Sinai countersigner' }]

async function send(w, over = {}) {
  return E.createAndSend(w.db, {
    title: 'Clinical Affiliation Attestation', documentType: 'attestation', documentPath: w.path, originalSha256: w.sha,
    pageSizes: [{ w: 612, h: 792 }, { w: 612, h: 792 }], fields: FIELDS, roles: ROLES,
    people: [{ name: 'Ava Nguyen', email: 'ava@ucla.edu', studentId: w.student.id, roleKey: 'r1' }],
    fixed: [{ name: 'Jester Lead', email: 'lead@cshs.org', roleKey: 'r2' }],
    senderValues: { f9: 'Fall 2026 Internship' }, subject: 'Please sign', message: 'Hi {first name}, please sign.',
    ...over,
  }, { appUrl: 'https://aspire.test', mailer: w.mailer, sender: w.staff, ctx: { ip: '10.1.1.1', userAgent: 'Mozilla/5.0 (Macintosh; Mac OS X) Chrome/128' } })
}

const ctx = { ip: '172.58.0.9', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18) Safari/605' }
const codeFrom = (mail) => /letter-spacing:8px[^>]*>(\d{6})</.exec(mail.html)[1]

test('in-order signing: code, consent, rules, sign, route, staff password, seal, file, return', async () => {
  const w = await world()
  const { requestIds: [id] } = await send(w)
  let b = await E.loadBundle(w.db, id)
  assert.equal(b.request.status, 'sent')
  const [s1, s2] = b.signers.sort((a, c) => a.order_index - c.order_index)
  assert.ok(s1.notified_at && !s2.notified_at, 'only the first signer is told first')
  assert.equal(w.mailer.sent.length, 1)
  assert.match(w.mailer.sent[0].html, /This link is only for ava@ucla\.edu/)
  assert.match(w.mailer.sent[0].from, /^Jester Lead via ASPIRE Intelligence/)
  assert.match(w.mailer.sent[0].html, /Hi Ava, please sign\./, '{first name} merges')

  // The link resolves; the staff signer's cannot be used by link.
  const token = linkTokenFor(s1.id, 1)
  const { signer, request } = await E.resolveLink(w.db, token)
  await assert.rejects(E.resolveLink(w.db, linkTokenFor(s2.id, 1)), /inside ASPIRE/)

  // Code: wrong, then right.
  await E.sendCode(w.db, { signer, request, settings: w.settings, mailer: w.mailer, ctx })
  const code = codeFrom(w.mailer.sent.at(-1))
  let fresh = (await E.resolveLink(w.db, token)).signer
  await assert.rejects(E.verifyCode(w.db, { signer: fresh, request, code: code === '000000' ? '111111' : '000000', settings: w.settings, ctx }), /4 tries left/)
  fresh = (await E.resolveLink(w.db, token)).signer
  const { session } = await E.verifyCode(w.db, { signer: fresh, request, code, settings: w.settings, ctx })
  fresh = (await E.resolveLink(w.db, token)).signer
  assert.doesNotThrow(() => E.requireSession(fresh, session))
  assert.throws(() => E.requireSession(fresh, 'forged'), /code first/)

  // Nothing signs before consent; consent needs the sample opened first.
  const adopted = { kind: 'type', text: 'Ava Nguyen' }
  const good = { f1: '✓', f4: 'Ava Nguyen', f6: '(310) 555-0142' }
  await assert.rejects(E.finishSigning(w.db, { signer: fresh, request, values: good, adopted, ctx, appUrl: 'https://aspire.test', mailer: w.mailer, settings: w.settings }), /consent/i)
  await assert.rejects(E.recordConsent(w.db, { signer: fresh, request, settings: w.settings, openedSample: true, agreed: true, ctx }), /sample PDF/)
  await E.recordSampleOpened(w.db, { signer: fresh, request, ctx })
  fresh = (await E.resolveLink(w.db, token)).signer
  await E.recordConsent(w.db, { signer: fresh, request, settings: w.settings, openedSample: true, agreed: true, ctx })
  fresh = (await E.resolveLink(w.db, token)).signer
  assert.equal(fresh.consent_version, '1.0')

  // Rules block Finish, with the sentence the signer sees.
  const opts = { signer: fresh, request, adopted, ctx, appUrl: 'https://aspire.test', mailer: w.mailer, settings: w.settings }
  await assert.rejects(E.finishSigning(w.db, { ...opts, values: { f4: 'Ava Nguyen', f6: '(310) 555-0142' } }), /Attachments: check at least one\./)
  await assert.rejects(E.finishSigning(w.db, { ...opts, values: { ...good, f6: '555' } }), /US phone number/)
  // A value for someone else's field is ignored, not stored.
  await E.finishSigning(w.db, { ...opts, values: { ...good, f7: 'Forged', f9: 'Changed' } })
  b = await E.loadBundle(w.db, id)
  assert.equal(b.request.status, 'progress')
  assert.equal(b.values.f7, undefined)
  assert.equal(b.values.f9, 'Fall 2026 Internship', 'the sender\'s field is locked')
  assert.equal(b.values.f3, 'Ava Nguyen')
  assert.match(b.values.f5, /^\d{2}\/\d{2}\/\d{4}$/, 'Date signed is the server\'s date')
  const s2now = b.signers.find(s => s.role_key === 'r2')
  assert.ok(s2now.notified_at, 'routed to signer 2')
  assert.match(w.mailer.sent.at(-1).subject, /^Your signature:/)

  // Staff signer: password, then the seal.
  const out = await E.staffSign(w.db, { requestId: id, profile: w.staff, passwordVerified: true, values: {}, typedName: 'Jester Lead', agree: true,
    ctx: { ip: '10.1.1.1', userAgent: 'Mozilla/5.0 (Macintosh; Mac OS X) Chrome/128' }, appUrl: 'https://aspire.test', mailer: w.mailer, settings: w.settings,
    sealOptions: { fetchImpl: w.tsa.fetchImpl, env: w.env } })
  assert.equal(out.completed, true)
  b = await E.loadBundle(w.db, id)
  assert.equal(b.request.status, 'completed')
  assert.ok(b.request.sealed_path && b.request.sealed_sha256)
  assert.ok(b.request.seal_timestamp.content.gen_time, 'content timestamp recorded')
  assert.ok(b.request.seal_timestamp.seal.gen_time, 'seal timestamp recorded')
  assert.equal(w.tsa.calls.length, 2, 'two RFC 3161 timestamps: content and seal')

  // The sealed file verifies on its own, timestamps and all.
  const sealedBlob = (await w.db.storage.from('signature-documents').download(b.request.sealed_path)).data
  const sealed = Buffer.from(await sealedBlob.arrayBuffer())
  assert.equal(createHash('sha256').update(sealed).digest('hex'), b.request.sealed_sha256)
  const v = verifySealedPdf(sealed)
  assert.equal(v.valid, true, v.reason)
  assert.equal(v.timestamp.covers_signature, true)
  const tampered = Buffer.from(sealed); tampered[400] ^= 1
  assert.equal(verifySealedPdf(tampered).valid, false)

  // The certificate and event log are the last pages, in words.
  const { text } = await extractText(new Uint8Array(sealed), { mergePages: true })
  for (const want of ['CERTIFICATE OF COMPLETION', b.request.envelope_code, 'Trusted timestamp', 'RFC 3161', 'disclosure v1.0',
    'ASPIRE account, password re-entered', 'EVENT LOG', 'One-time code verified', 'Consent to electronic records accepted', b.request.original_sha256]) {
    assert.ok(text.includes(want), `certificate mentions ${want}`)
  }

  // Filed to the student's record; copies to both signers and the sender.
  const docs = (await w.pg.query(`SELECT * FROM record_documents`)).rows
  assert.equal(docs.length, 1)
  assert.equal(docs[0].student_id, w.student.id)
  assert.equal(docs[0].source, 'signature')
  const copies = w.mailer.sent.filter(m => /^Completed:/.test(m.subject))
  assert.deepEqual(copies.map(m => m.to[0]).sort(), ['ava@ucla.edu', 'lead@cshs.org'])
  assert.ok(copies.every(m => m.attachments?.length === 1))

  // The chain is unbroken and the key events are there, in order.
  const types = b.events.map(e => e.type)
  for (const t of ['created', 'sent', 'delivered', 'code_sent', 'code_failed', 'code_verified', 'sample_pdf_opened', 'consent_accepted', 'signature_adopted', 'signed', 'routed', 'password_verified', 'content_timestamped', 'sealed', 'filed_to_record', 'copies_sent']) {
    assert.ok(types.includes(t), `event ${t}`)
  }
  for (let i = 1; i < b.events.length; i++) assert.equal(b.events[i].prev_hash, b.events[i - 1].hash)

  // The copies event records each recipient's outcome, so the trail never overclaims.
  const copiesEv = b.events.find(e => e.type === 'copies_sent')
  assert.equal(copiesEv.details.recipients, 2)
  assert.equal(copiesEv.details.accepted, 2)
  assert.equal(copiesEv.details.sender_included, true)
  assert.ok(copiesEv.details.results.every(r => r.ok && /•/.test(r.to)), 'masked, accepted')
  assert.ok(copiesEv.details.results.some(r => r.role === 'signer and sender'), 'the staff signer is also the sender')
  const { describeEvent } = await import('../src/lib/signatures/sigModel.js')
  assert.match(describeEvent(copiesEv), /2 of 2 accepted by the mail service/)
  assert.match(describeEvent({ type: 'copies_sent', details: { recipients: 2, accepted: 1, results: [
    { to: 'a•••@x.org', role: 'signer', ok: true }, { to: 'j•••@cshs.org', role: 'sender', ok: false, error: 'domain not verified' }] } }),
    /1 of 2 accepted.*j•••@cshs\.org \(sender\), not accepted: domain not verified/)
  assert.ok(b.events.find(e => e.type === 'signed' && e.ip === '172.58.0.9' && /iPhone/.test(e.user_agent)), 'IP and device on the signing event')

  // The link is dead after completion.
  const after = await E.resolveLink(w.db, token)
  assert.equal(E.linkIsLive(after.request).live, false)
})

test('decline and void close the request, notify, and are in the audit trail', async () => {
  const w = await world()
  const { requestIds: [a] } = await send(w)
  const b = await E.loadBundle(w.db, a)
  const s1 = b.signers.find(s => s.role_key === 'r1')
  await assert.rejects(E.declineSigning(w.db, { signer: s1, request: b.request, reason: '', ctx, mailer: w.mailer, appUrl: 'x' }), /why/)
  await E.declineSigning(w.db, { signer: s1, request: b.request, reason: 'Our dean must sign this.', ctx, mailer: w.mailer, appUrl: 'x' })
  const d = await E.loadBundle(w.db, a)
  assert.equal(d.request.status, 'declined')
  assert.ok(d.events.find(e => e.type === 'declined' && e.details.reason === 'Our dean must sign this.'))
  assert.match(w.mailer.sent.at(-1).subject, /declined to sign/)

  const { requestIds: [c] } = await send(w)
  await assert.rejects(E.voidRequest(w.db, { requestId: c, reason: ' ', actor: 'Lead', ctx, mailer: w.mailer }), /reason/)
  await E.voidRequest(w.db, { requestId: c, reason: 'Sent to the wrong signer', actor: 'Lead', ctx, mailer: w.mailer })
  const v = await E.loadBundle(w.db, c)
  assert.equal(v.request.status, 'voided')
  assert.match(w.mailer.sent.at(-1).subject, /^Cancelled:/)
  assert.equal(E.linkIsLive(v.request).live, false)
})

test('excluded document types need an admin\'s confirmation; bulk sends make one request per person', async () => {
  const w = await world()
  await assert.rejects(send(w, { documentType: 'court' }), /excluded/)
  const ok = await send(w, { documentType: 'court', excludedConfirmed: true })
  assert.equal(ok.requestIds.length, 1)

  const people = ['a', 'b', 'c'].map(x => ({ name: `Student ${x}`, email: `${x}@school.edu` }))
  const bulk = await send(w, { mode: 'each', people, fixed: [], roles: [ROLES[0]], fields: FIELDS.filter(f => f.role !== 'r2'), audienceLabel: 'Fall 2026 cohort' })
  assert.equal(bulk.requestIds.length, 3)
  assert.ok(bulk.bulkId)
  const { rows } = await w.pg.query(`SELECT count(*)::int AS n FROM sig_requests WHERE parent_bulk_id = $1`, [bulk.bulkId])
  assert.equal(rows[0].n, 3)
})

test('delegation waits for the sender, then the new signer takes the same role', async () => {
  const w = await world()
  const { requestIds: [id] } = await send(w)
  let b = await E.loadBundle(w.db, id)
  const s1 = b.signers.find(s => s.role_key === 'r1')
  await E.requestDelegation(w.db, { signer: s1, request: b.request, name: 'Dr. Grace Park', email: 'g.park@ucla.edu', reason: 'The dean signs.', ctx, mailer: w.mailer, appUrl: 'x' })
  b = await E.loadBundle(w.db, id)
  assert.equal(b.signers.find(s => s.id === s1.id).delegation.status, 'pending')
  await E.decideDelegation(w.db, { requestId: id, signerId: s1.id, approve: true, actor: 'Lead', ctx, appUrl: 'https://aspire.test', mailer: w.mailer })
  b = await E.loadBundle(w.db, id)
  const replaced = b.signers.find(s => s.id === s1.id)
  const successor = b.signers.find(s => s.email === 'g.park@ucla.edu')
  assert.equal(replaced.status, 'replaced')
  assert.equal(successor.role_key, 'r1')
  assert.ok(successor.notified_at)
  await assert.rejects(E.resolveLink(w.db, linkTokenFor(s1.id, 1)), /not valid/)
})
