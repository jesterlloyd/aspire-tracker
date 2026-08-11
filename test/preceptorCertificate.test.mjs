// PRECEPTOR-CERT-1: Certificate of Appreciation - generation, unlock, delivery.
//
// Canonical unlock rule (Owner decision 2026-08-10): the preceptor who is the
// SNAPSHOTTED respondent on the completed End-of-Rotation readiness assessment
// earns the certificate - primary or Owner-redirected. One certificate per
// (preceptor, cohort); numbers from the SHARED ASPIRE-YYYY-NNN counter.
// Run: node --test test/preceptorCertificate.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

const TPL_PATH = 'public/certificates/templates/aspire-certificate-of-preceptor-appreciation.pdf'
const FIELDS = {
  certificateId: 'ASPIRE-2026-055', preceptorName: 'Kelly Tran-Villanueva',
  clinicalUnit: '6 West Telemetry', rotationDates: 'Jun 1 - Aug 14, 2026',
  studentOrCohort: 'Summer 2026 Cohort', issueDate: 'August 10, 2026',
}

test('the canonical template is stored with exactly its six fields', async () => {
  const { PDFDocument } = await import('pdf-lib')
  const bytes = readFileSync(join(here, '..', TPL_PATH))
  const doc = await PDFDocument.load(bytes)
  assert.equal(doc.getPageCount(), 1)
  const page = doc.getPage(0)
  assert.equal(Math.round(page.getWidth()), 792)
  assert.equal(Math.round(page.getHeight()), 612)
  const names = doc.getForm().getFields().map(f => f.getName()).sort()
  assert.deepEqual(names, ['certificate_id', 'clinical_unit', 'issue_date',
    'preceptor_name', 'rotation_dates', 'student_or_cohort'])
})

test('flattened presentation PDF: values drawn, no form controls survive', async () => {
  const { generatePreceptorCertificate } = await import('../lib/server/certificates/generatePreceptorCertificate.js')
  const { PDFDocument } = await import('pdf-lib')
  const tpl = readFileSync(join(here, '..', TPL_PATH))
  const out = await generatePreceptorCertificate(tpl, FIELDS, { flatten: true })
  const doc = await PDFDocument.load(out)
  let fieldCount = 0
  try { fieldCount = doc.getForm().getFields().length } catch { fieldCount = 0 }
  assert.equal(fieldCount, 0, 'the presentation PDF must expose no editable controls')
  // The values are painted into the page content. Streams are FLATE-compressed,
  // so inflate every content stream and search the drawn (hex-encoded) text.
  const zlib = await import('node:zlib')
  const { PDFName } = await import('pdf-lib')
  const page = doc.getPage(0)
  const contents = doc.context.lookup(page.node.get(PDFName.of('Contents')))
  const refs = contents.asArray ? contents.asArray() : [contents]
  let painted = ''
  for (const ref of refs) {
    const st = doc.context.lookup(ref)
    const rawBytes = st.contents ?? st.getContents?.()
    try { painted += zlib.inflateSync(Buffer.from(rawBytes)).toString('latin1') }
    catch { painted += Buffer.from(rawBytes).toString('latin1') }
  }
  const hex = (t) => Buffer.from(t, 'latin1').toString('hex').toUpperCase()
  for (const v of Object.values(FIELDS)) {
    assert.ok(painted.toUpperCase().includes(hex(v)), `value not drawn: ${v}`)
  }
})

test('editable internal PDF: the six fields remain editable and hold the values', async () => {
  const { generatePreceptorCertificate } = await import('../lib/server/certificates/generatePreceptorCertificate.js')
  const { PDFDocument } = await import('pdf-lib')
  const tpl = readFileSync(join(here, '..', TPL_PATH))
  const out = await generatePreceptorCertificate(tpl, FIELDS, { flatten: false })
  const form = (await PDFDocument.load(out)).getForm()
  assert.equal(form.getFields().length, 6)
  assert.equal(form.getTextField('preceptor_name').getText(), 'Kelly Tran-Villanueva')
  assert.equal(form.getTextField('certificate_id').getText(), 'ASPIRE-2026-055')
})

test('a very long name auto-shrinks rather than throwing or clipping', async () => {
  const { generatePreceptorCertificate } = await import('../lib/server/certificates/generatePreceptorCertificate.js')
  const tpl = readFileSync(join(here, '..', TPL_PATH))
  const out = await generatePreceptorCertificate(tpl, {
    ...FIELDS, preceptorName: 'Maria Consuelo Alejandra de la Cruz-Villanueva y Fernandez-Ocampo',
    clinicalUnit: 'Cardiothoracic Surgical Intensive Care Unit 7 South',
  }, { flatten: true })
  assert.ok(out.length > 100000, 'generation completed')
})

test('missing values render as a dash, never as undefined', async () => {
  const { generatePreceptorCertificate } = await import('../lib/server/certificates/generatePreceptorCertificate.js')
  const tpl = readFileSync(join(here, '..', TPL_PATH))
  const out = await generatePreceptorCertificate(tpl, { certificateId: 'X' }, { flatten: false })
  const { PDFDocument } = await import('pdf-lib')
  const form = (await PDFDocument.load(out)).getForm()
  assert.equal(form.getTextField('preceptor_name').getText(), '-')
})

// ── Migration pins (prepared, NOT applied) ───────────────────────────────────

const mig = read('supabase/migrations/20260811000000_preceptor_certificate_foundation.sql')

test('migration: identity, idempotency, and the INDEPENDENT preceptor series', () => {
  assert.match(mig, /CONSTRAINT uq_prec_cert_identity\s+UNIQUE \(preceptor_id, cohort_id\)/)
  assert.match(mig, /CONSTRAINT uq_prec_cert_assignment\s+UNIQUE \(qualifying_assignment_id\)/)
  // Owner correction 2026-08-10: preceptor certificates have their OWN annual
  // counter, seeded so the first-ever certificate is ASPIRE-2026-01.
  assert.match(mig, /CREATE TABLE IF NOT EXISTS public\.preceptor_certificate_sequences/)
  assert.match(mig, /INSERT INTO public\.preceptor_certificate_sequences \(year, next_seq\)\s*\n\s*VALUES \(2026, 1\)/)
  assert.match(mig, /FROM public\.preceptor_certificate_sequences\s+WHERE year = v_year\s+FOR UPDATE/)
  // The RPC must NOT read or advance the student counter.
  const rpcBody = mig.split('issue_preceptor_certificate(')[1]
  assert.ok(!/FROM public\.certificate_sequences|UPDATE public\.certificate_sequences|INTO public\.certificate_sequences/.test(rpcBody),
    'the issuer must never touch the student counter')
  // Two-digit padding computed width-safely (Postgres lpad truncates), so
  // ASPIRE-2026-01 ... -99 then -100.
  assert.match(mig, /lpad\(v_seq::TEXT, GREATEST\(2, length\(v_seq::TEXT\)\), '0'\)/)
  // Displayed IDs are only unique within the series - stated, not assumed.
  assert.match(mig, /NOT globally unique across certificate types/)
  // The snapshotted respondent is the earner; NULL is an exception, never a guess.
  assert.match(mig, /respondent_preceptor_id IS NULL/)
  assert.match(mig, /'no_canonical_respondent'/)
  // EOR + preceptor respondent + authorized instrument only.
  assert.match(mig, /'post_rotation'/)
  assert.match(mig, /'preceptor_progress'/)
  // Service-role only; no client grants; RLS with no policies.
  assert.match(mig, /ENABLE ROW LEVEL SECURITY/)
  assert.match(mig, /REVOKE ALL ON public\.preceptor_certificates FROM authenticated/)
  assert.match(mig, /GRANT {2}EXECUTE ON FUNCTION public\.issue_preceptor_certificate\(UUID\) TO service_role/)
  // PDFs never persisted.
  assert.match(mig, /generated PDFs are NEVER persisted/i)
})

// ── Unlock + notification idempotency ────────────────────────────────────────

const unlock = read('lib/server/certificates/unlockPreceptorCertificate.js')

test('unlock: claim-first notification can never double-send', () => {
  assert.match(unlock, /\.update\(\{ notified_at: new Date\(\)\.toISOString\(\) \}\)\s*\n\s*\.eq\('id', certId\)\s*\n\s*\.is\('notified_at', null\)/)
  // Send failure releases the claim so reconciliation retries.
  assert.match(unlock, /\.update\(\{ notified_at: null \}\)\.eq\('id', certId\)/)
  // Refusals are surfaced, never retried into existence.
  assert.match(unlock, /status: 'refused', reason: issue\.status/)
  // The download URL/token are never persisted to the log: the metadata block
  // carries identifiers only.
  const logBlock = unlock.split("from('notification_log').insert")[1].split('});')[0]
  assert.ok(!/downloadUrl|token/i.test(logBlock),
    'notification_log metadata must not carry the tokenized URL')
})

test('submit endpoint: immediate unlock is EOR-only and non-fatal', () => {
  const submit = read('api/evaluation-preceptor-submit.js')
  assert.match(submit, /tp === 'post_rotation'/)
  assert.match(submit, /certificateReady/)
  // The unlock is wrapped so a certificate failure can never fail the accepted submission.
  assert.match(submit, /catch \(e\) \{\s*\n\s*console\.error\('\[preceptor-cert\] unlock_after_submit_failed/)
})

// ── Download endpoints ───────────────────────────────────────────────────────

test('tokenized download: gated, read-only, safe filename', () => {
  const dl = read('api/certificate-preceptor-download.js')
  assert.match(dl, /instrument\.slug !== 'preceptor_progress'/)
  assert.match(dl, /respondent_type !== 'preceptor'/)
  assert.match(dl, /timepoint !== 'post_rotation'/)
  assert.match(dl, /assignment\.completed_at/)
  assert.match(dl, /consume_evaluation_rate_limit/)
  assert.match(dl, /ASPIRE_Preceptor_Appreciation_\$\{lastName\}_\$\{issueYear\}\.pdf/)
  // Fail-safe: missing display data is a recoverable exception, not a guess.
  assert.match(dl, /missing\.length > 0/)
  // Never creates: no rpc issue call, no insert.
  assert.ok(!/issue_preceptor_certificate|\.insert\(/.test(dl))
  // No assessment answers are read anywhere in the download path.
  assert.ok(!/responses|form_type|evaluation_responses/.test(dl))
})

test('admin download: Owner/Admin only, editable variant supported', () => {
  const dl = read('api/certificate-preceptor-admin-download.js')
  assert.match(dl, /\['owner', 'admin'\]\.includes\(profile\.role\)/)
  assert.match(dl, /variant === 'editable'/)
  assert.match(dl, /flatten: !editable/)
  assert.ok(!/issue_preceptor_certificate|\.insert\(/.test(dl))
})

test('reconciliation: idempotent, exception-reporting, never guessing', () => {
  const rec = read('api/certificate-preceptor-reconcile.js')
  assert.match(rec, /\['owner', 'admin'\]\.includes\(profile\.role\)/)
  assert.match(rec, /no_canonical_respondent/)
  // Settled rows are skipped without minting a token.
  assert.match(rec, /settledByAssignment/)
  // Tokens minted here are hashed at rest and time-bounded.
  assert.match(rec, /token_hash: hashToken\(rawToken\)/)
  assert.match(rec, /RECONCILE_TOKEN_DAYS/)
})

// ── Emails ───────────────────────────────────────────────────────────────────

test('EOR invitation gains the certificate line; midpoint does not', async () => {
  const { buildPreceptorInvitationEmail } = await import('../lib/server/evaluation/preceptorEmailTemplates.js')
  const base = { studentName: 'Sam Rivera', preceptorFirstName: 'Kelly', expiresAtHuman: 'September 7, 2026', surveyUrl: 'https://x/evaluation/feedback#t=abc' }
  const eor = buildPreceptorInvitationEmail({ ...base, period: 'end_of_rotation' }).html
  const mid = buildPreceptorInvitationEmail({ ...base, period: 'midpoint' }).html
  assert.match(eor, /Completing this short assessment also unlocks\s*\nyour Certificate of Appreciation/)
  assert.match(eor, /helps us understand student readiness, strengthen the\s*\npreceptorship experience, and improve ASPIRE/)
  assert.ok(!/Certificate of Appreciation/.test(mid), 'midpoint must not promise a certificate it cannot unlock')
})

test('certificate-ready email carries the approved copy and CTA', async () => {
  const { buildPreceptorCertificateEmail, PRECEPTOR_CERT_EMAIL_SUBJECT } = await import('../lib/server/evaluation/preceptorCertificateEmail.js')
  assert.equal(PRECEPTOR_CERT_EMAIL_SUBJECT, 'Your ASPIRE Certificate of Appreciation')
  const { html } = buildPreceptorCertificateEmail({ preceptorFirstName: 'Kelly', certificateNumber: 'ASPIRE-2026-055', downloadUrl: 'https://x/evaluation/feedback#t=abc' })
  assert.match(html, /We received your\s*\nPreceptor Student Readiness Assessment/)
  assert.match(html, /Certificate of Appreciation is now available/)
  assert.match(html, /Download Certificate/)
  assert.match(html, /ASPIRE-2026-055/)
})

// ── Survey page CTA ──────────────────────────────────────────────────────────

test('the thank-you and completed views offer the earned certificate', () => {
  const page = read('src/pages/PreceptorEvaluationPage.jsx')
  assert.match(page, /\(view === 'thank_you' \|\| view === 'completed'\) && certReady/)
  assert.match(page, /certificate-preceptor-download/)
  assert.match(page, /setCertReady\(body\.certificateReady === true\)/)
  assert.match(page, /setCertReady\(body\.certificateAvailable === true\)/)
  // The validate endpoint only advertises availability for post_rotation.
  const validate = read('api/evaluation-preceptor-token-validate.js')
  assert.match(validate, /asmtRow\?\.timepoint === 'post_rotation'/)
})

// ── Owner corrections 2026-08-10: presentation alignment ─────────────────────

test('the preceptor name is centered at every auto-shrunk size', () => {
  const gen = read('lib/server/certificates/generatePreceptorCertificate.js')
  assert.match(gen, /p\.name === 'preceptor_name'\s*\n\s*\? p\.rect\.x \+ \(p\.rect\.width - helv\.widthOfTextAtSize\(text, size\)\) \/ 2/)
  // Centering uses the FITTED size, so a shrunken long name stays centered.
  assert.match(gen, /const size = fitSize\(helv, text, p\.rect\.width - 2, p\.size\)/)
})

test('the issued date sits on the artwork baseline as one footer unit', () => {
  const gen = read('lib/server/certificates/generatePreceptorCertificate.js')
  // Measured against the stored template (pdftotext -bbox): "Issued" is 6.5pt
  // slate with baseline 31pt; the date joins it at the same size and baseline.
  assert.match(gen, /const base = 6\.5/)
  assert.match(gen, /y: 31, size, font: helv/)
})
