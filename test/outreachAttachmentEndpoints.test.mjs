// test/outreachAttachmentEndpoints.test.mjs
//
// OUTREACH-ATTACHMENTS-1 - endpoint-level behavioral proof.
//
// Both REAL send handlers are executed with substituted storage, database and
// Resend clients. Nothing here re-implements handler logic: the shipped source
// is loaded with only its imports swapped, so if the endpoints stop doing what
// these tests claim, these tests fail.
//
// What is proven, end to end through the handler:
//   - the exact validated bytes reach Resend;
//   - Direct sends the reviewed attachments exactly once;
//   - Bulk sends the IDENTICAL reviewed set to every reviewed recipient;
//   - an invalid / inactive / missing / oversized / mismatched / unavailable
//     file produces ZERO provider calls and ZERO notification or archive
//     writes;
//   - notification metadata carries metadata only - no bytes, paths or URLs;
//   - attachment-free behavior is completely unchanged.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..')
const read = (p) => readFileSync(join(repo, p), 'utf8')
const abs = (p) => JSON.stringify(pathToFileURL(join(repo, p)).href)

process.env.SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-key-not-a-secret'
process.env.RESEND_API_KEY ||= 'test-key-not-a-secret'

const dir = mkdtempSync(join(tmpdir(), 'outreach-attach-'))
test.after(() => rmSync(dir, { recursive: true, force: true }))

// ── The substituted world ───────────────────────────────────────────────────
// A real PDF prefix + EOF, and a real minimal DOCX built as an actual ZIP so
// the container validator has something genuine to parse.
writeFileSync(join(dir, 'fake.mjs'), `
  import { deflateRawSync, crc32 } from 'node:zlib';

  export let sends = [], logInserts = [], archives = [], downloads = [];
  export function __reset() { sends = []; logInserts = []; archives = []; downloads = []; }

  export class Resend {
    constructor() {
      this.emails = { send: async (p) => { sends.push(p); return { data: { id: 're_' + sends.length }, error: null }; } };
    }
  }
  export function createClient() {
    return { auth: { getUser: async () => ({ data: { user: { id: 'auth-user-1' } }, error: null }) } };
  }

  // ---- Build a REAL zip so the OOXML check is exercised, not bypassed. ----
  function zip(entries) {
    const files = [], central = [];
    let offset = 0;
    for (const [name, content] of entries) {
      const nameBuf = Buffer.from(name, 'utf8');
      const data = Buffer.from(content, 'utf8');
      const crc = crc32(data) >>> 0;
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(0, 8);
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
      local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
      files.push(local, nameBuf, data);

      const cd = Buffer.alloc(46);
      cd.writeUInt32LE(0x02014b50, 0);
      cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6);
      cd.writeUInt32LE(crc, 16);
      cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(data.length, 24);
      cd.writeUInt16LE(nameBuf.length, 28);
      cd.writeUInt32LE(offset, 42);
      central.push(cd, nameBuf);
      offset += local.length + nameBuf.length + data.length;
    }
    const cdBuf = Buffer.concat(central);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(cdBuf.length, 12); eocd.writeUInt32LE(offset, 16);
    return Buffer.concat([Buffer.concat(files), cdBuf, eocd]);
  }

  export const PDF_BYTES = Buffer.concat([
    Buffer.from('%PDF-1.7\\n', 'latin1'), Buffer.alloc(200, 0x41), Buffer.from('\\n%%EOF', 'latin1'),
  ]);
  export const DOCX_BYTES = zip([
    ['[Content_Types].xml', '<Types/>'],
    ['word/document.xml', '<document/>'],
  ]);
  const MACRO_DOCX = zip([
    ['[Content_Types].xml', '<Types/>'],
    ['word/document.xml', '<document/>'],
    ['word/vbaProject.bin', 'MACRO'],
  ]);
  const NOT_A_PDF = Buffer.from('<html>definitely not a pdf</html>', 'latin1');
  const BIG_PDF = Buffer.concat([
    Buffer.from('%PDF-1.7\\n', 'latin1'), Buffer.alloc(11 * 1024 * 1024, 0x41), Buffer.from('\\n%%EOF', 'latin1'),
  ]);

  const OBJECTS = {
    'orientation/brochure.pdf':      PDF_BYTES,
    'policies/guidelines.docx':      DOCX_BYTES,
    'policies/macro.docx':           MACRO_DOCX,
    'policies/liar.pdf':             NOT_A_PDF,
    'policies/huge.pdf':             BIG_PDF,
    // 'policies/ghost.pdf' deliberately absent -> download failure
  };

  export const CATALOG = [
    { slug: 'brochure',   title: 'ASPIRE Brochure',   storage_path: 'orientation/brochure.pdf', resource_type: 'internal_file', is_active: true },
    { slug: 'guidelines', title: 'Student Guidelines',storage_path: 'policies/guidelines.docx', resource_type: 'internal_file', is_active: true },
    { slug: 'macro',      title: 'Macro Doc',         storage_path: 'policies/macro.docx',      resource_type: 'internal_file', is_active: true },
    { slug: 'liar',       title: 'Fake PDF',          storage_path: 'policies/liar.pdf',        resource_type: 'internal_file', is_active: true },
    { slug: 'huge',       title: 'Huge PDF',          storage_path: 'policies/huge.pdf',        resource_type: 'internal_file', is_active: true },
    { slug: 'ghost',      title: 'Missing Object',    storage_path: 'policies/ghost.pdf',       resource_type: 'internal_file', is_active: true },
    { slug: 'retired',    title: 'Retired Doc',       storage_path: 'policies/guidelines.docx', resource_type: 'internal_file', is_active: false },
    { slug: 'legacy-doc', title: 'Legacy Word',       storage_path: 'policies/old.doc',         resource_type: 'internal_file', is_active: true },
  ];

  const STUDENTS = {
    'aaaaaaaa-0000-4000-8000-000000000001': { id: 'aaaaaaaa-0000-4000-8000-000000000001', first_name: 'One', last_name: 'Student', school_email: 's1@student.example.edu', personal_email: null, status: 'Placed' },
    'aaaaaaaa-0000-4000-8000-000000000002': { id: 'aaaaaaaa-0000-4000-8000-000000000002', first_name: 'Two', last_name: 'Student', school_email: 's2@student.example.edu', personal_email: null, status: 'Placed' },
    'aaaaaaaa-0000-4000-8000-000000000003': { id: 'aaaaaaaa-0000-4000-8000-000000000003', first_name: 'Three', last_name: 'Student', school_email: 's3@student.example.edu', personal_email: null, status: 'Active Rotation' },
  };
  const CONTACTS = {
    'bbbbbbbb-0000-4000-8000-000000000001': { id: 'bbbbbbbb-0000-4000-8000-000000000001', full_name: 'Coordinator One', email: 'coordinator1@example.org', is_active: true },
  };
  const PROFILE = { id: 'staff-1', role: 'owner', email: 'owner@example.org', full_name: 'Test Owner', connect_signature: null, is_owner: true };

  // PLACEMENT-COMMUNICATION-HANDOFF-1A: a real placement world, so the send
  // endpoint's placement guard runs against rows rather than being skipped.
  export const PLACEMENT = {
    cohort:    'cccccccc-0000-4000-8000-00000000000c',
    otherCohort:'cccccccc-0000-4000-8000-00000000000d',
    student:   'aaaaaaaa-0000-4000-8000-000000000001',
    unit:      'dddddddd-0000-4000-8000-000000000001',
    otherUnit: 'dddddddd-0000-4000-8000-000000000002',
    preceptor: 'eeeeeeee-0000-4000-8000-000000000001',
    other:     'eeeeeeee-0000-4000-8000-000000000002',
    match:     'ffffffff-0000-4000-8000-000000000001',
  };
  const MATCHES = {
    [PLACEMENT.match]: {
      id: PLACEMENT.match, student_id: PLACEMENT.student, unit_id: PLACEMENT.unit,
      cohort_id: PLACEMENT.cohort, preceptor_id: PLACEMENT.preceptor, preceptor_assigned: 'Placement Preceptor',
    },
  };
  const UNITS = {
    [PLACEMENT.unit]:      { id: PLACEMENT.unit, cohort_id: PLACEMENT.cohort, unit_name: 'QC Unit' },
    [PLACEMENT.otherUnit]: { id: PLACEMENT.otherUnit, cohort_id: PLACEMENT.cohort, unit_name: 'QC Unit Two' },
  };
  const PRECEPTORS = {
    [PLACEMENT.preceptor]: { id: PLACEMENT.preceptor, full_name: 'Placement Preceptor', email: 'coordinator1@example.org', shift_type: 'Day', is_active: true },
    [PLACEMENT.other]:     { id: PLACEMENT.other, full_name: 'Other Preceptor', email: 'other@example.org', shift_type: 'Day', is_active: true },
  };
  // The student row the guard reads carries the placement's cohort.
  STUDENTS[PLACEMENT.student].cohort_id = PLACEMENT.cohort;
  STUDENTS[PLACEMENT.student].preceptor_id = PLACEMENT.preceptor;

  const admin = {
    from(table) {
      const q = { table, filters: [] };
      const api = {
        select() { return api },
        eq(f, v) { q.filters.push([f, v]); return api },
        filter(f, _op, v) { q.filters.push([f, v]); return api },
        in(col, vals) {
          if (q.table === 'catalog_resources') {
            return Promise.resolve({ data: CATALOG.filter(r => vals.includes(r.slug)), error: null });
          }
          if (q.table === 'preceptors') {
            return Promise.resolve({ data: vals.map(v => PRECEPTORS[v]).filter(Boolean), error: null });
          }
          if (q.table === 'notification_log') {
            // The confirm endpoint chains .in().eq().eq().eq() then awaits.
            q.inFilter = [col, vals];
            return api;
          }
          return Promise.resolve({ data: [], error: null });
        },
        // Awaiting the builder returns ROWS, the way supabase-js does - the guard
        // reads a student's sibling placements this way.
        then(resolve, reject) {
          let rows = [];
          const readField = (row, key) => {
            const j = /^metadata->>(.+)$/.exec(key);
            return j ? row?.metadata?.[j[1]] : row?.[key];
          };
          if (q.table === 'matches') {
            rows = Object.values(MATCHES).filter(m =>
              q.filters.every(([f, v]) => String(m[f] ?? '') === String(v)));
          } else if (q.table === 'notification_log') {
            // Serve existing evidence FROM the rows this run has inserted, so
            // idempotency is exercised against real writes, not a canned answer.
            rows = logInserts.filter(r =>
              (!q.inFilter || q.inFilter[1].includes(readField(r, q.inFilter[0])))
              && q.filters.every(([f, v]) => String(readField(r, f) ?? '') === String(v)));
          }
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        },
        limit() { return Promise.resolve({ data: [], error: null }) },
        insert(row) {
          if (q.table === 'notification_log') logInserts.push(row);
          return { select: () => ({ single: async () => ({ data: { id: 'log-' + logInserts.length }, error: null }) }) };
        },
        upsert: async (row) => { archives.push(row); return { error: null }; },
        update() { return { eq: async () => ({ data: null, error: null }) } },
        single() {
          if (q.table === 'user_profiles') return Promise.resolve({ data: PROFILE, error: null });
          const id = (q.filters.find(([f]) => f === 'id') || [])[1];
          const row = q.table === 'students' ? STUDENTS[id] : q.table === 'contacts' ? CONTACTS[id] : null;
          return Promise.resolve(row ? { data: row, error: null } : { data: null, error: { message: 'not found' } });
        },
        maybeSingle() {
          if (q.table === 'user_profiles') return Promise.resolve({ data: PROFILE, error: null });
          const id = (q.filters.find(([f]) => f === 'id') || [])[1];
          const row = q.table === 'matches'  ? MATCHES[id]
            : q.table === 'units'    ? UNITS[id]
            : q.table === 'students' ? STUDENTS[id]
            : null;
          return Promise.resolve({ data: row || null, error: null });
        },
      };
      return api;
    },
    storage: {
      from() {
        return {
          download(p) {
            downloads.push(p);
            const b = OBJECTS[p];
            if (!b) return Promise.resolve({ data: null, error: { message: 'not found' } });
            return Promise.resolve({ data: { arrayBuffer: async () => b }, error: null });
          },
        };
      },
    },
  };
  export default admin;
`)

const FAKE = JSON.stringify(pathToFileURL(join(dir, 'fake.mjs')).href)

function swap(src) {
  return src
    .replace(/from '@supabase\/supabase-js'/, `from ${FAKE}`)
    .replace(/from 'resend'/, `from ${FAKE}`)
    .replace(/from '\.\.\/lib\/server\/evaluation\/supabase_admin\.js'/, `from ${FAKE}`)
    .replace(/from '\.\.\/lib\/server\/connect\/emailTemplates\.js'/, `from ${abs('lib/server/connect/emailTemplates.js')}`)
    .replace(/from '\.\.\/src\/lib\/notifications\/studentRecipient\.js'/, `from ${abs('src/lib/notifications/studentRecipient.js')}`)
    .replace(/from '\.\.\/src\/lib\/emailUtils\.js'/, `from ${abs('src/lib/emailUtils.js')}`)
    // PLACEMENT-COMMUNICATION-HANDOFF-1A: the placement metadata builder and the
    // authorization guard that decides whether a placement send may proceed. The
    // guard is loaded REAL, so these tests exercise the shipped verification.
    .replace(/from '\.\.\/src\/lib\/placementPreceptorSent\.js'/, `from ${abs('src/lib/placementPreceptorSent.js')}`)
    .replace(/from '\.\/lib\/placementSendGuard\.js'/, `from ${abs('api/lib/placementSendGuard.js')}`)
    .replace(/from '\.\.\/src\/lib\/recipientParse\.js'/, `from ${abs('src/lib/recipientParse.js')}`)
    .replace(/from '\.\.\/src\/lib\/htmlEscape\.js'/, `from ${abs('src/lib/htmlEscape.js')}`)
    .replace(/from '\.\.\/src\/lib\/notifications\/templates\/signatures\.js'/, `from ${abs('src/lib/notifications/templates/signatures.js')}`)
    .replace(/from '\.\/lib\/messageArchive\.js'/, `from ${abs('api/lib/messageArchive.js')}`)
    .replace(/from '\.\/lib\/outreachAttachments\.js'/, `from ${abs('api/lib/outreachAttachments.js')}`)
    .replace(/from '\.\/lib\/bulkRecipientAllowlist\.js'/, `from ${abs('api/lib/bulkRecipientAllowlist.js')}`)
    .replace(/const SEND_DELAY_MS\s*=\s*300;/, 'const SEND_DELAY_MS = 0;')
}

writeFileSync(join(dir, 'direct.mjs'), swap(read('api/connect-send-direct-email.js')))
writeFileSync(join(dir, 'bulk.mjs'), swap(read('api/connect-send-bulk-message.js')))

const fakes = await import(pathToFileURL(join(dir, 'fake.mjs')).href)
writeFileSync(join(dir, 'confirm.mjs'), swap(read('api/placement-preceptor-confirm.js')))
const directHandler = (await import(pathToFileURL(join(dir, 'direct.mjs')).href)).default
const confirmHandler = (await import(pathToFileURL(join(dir, 'confirm.mjs')).href)).default
const bulkHandler = (await import(pathToFileURL(join(dir, 'bulk.mjs')).href)).default

function makeRes() {
  const res = {
    statusCode: null, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; return this },
    status(c) { this.statusCode = c; return this },
    json(b) { this.body = b; return this },
  }
  return res
}

const REQ_HEADERS = { authorization: 'Bearer test-token' }

async function runDirect(body) {
  fakes.__reset()
  const res = makeRes()
  await directHandler({ method: 'POST', headers: REQ_HEADERS, body }, res)
  return res
}
async function runBulk(body) {
  fakes.__reset()
  const res = makeRes()
  await bulkHandler({ method: 'POST', headers: REQ_HEADERS, body }, res)
  return res
}

const DIRECT_BASE = {
  recipient_type: 'student',
  recipient_id: 'aaaaaaaa-0000-4000-8000-000000000001',
  subject: 'QC subject',
  body: 'QC body',
  body_format: 'text',
}
const BULK_BASE = {
  template_key: 'manual',
  subject: 'QC subject',
  body: 'QC body',
  body_format: 'text',
  batch_id: '11111111-2222-4333-8444-555555555555',
  confirmation: 'SEND MESSAGES',   // server-enforced typed confirmation
}
const BULK_RECIPIENTS = [
  { source: 'student', studentId: 'aaaaaaaa-0000-4000-8000-000000000001', email: 's1@student.example.edu', name: 'One Student' },
  { source: 'student', studentId: 'aaaaaaaa-0000-4000-8000-000000000002', email: 's2@student.example.edu', name: 'Two Student' },
  { source: 'student', studentId: 'aaaaaaaa-0000-4000-8000-000000000003', email: 's3@student.example.edu', name: 'Three Student' },
]

// ── Direct: the reviewed bytes, once ────────────────────────────────────────

test('DIRECT sends the exact validated bytes, exactly once', async () => {
  const res = await runDirect({ ...DIRECT_BASE, attachment_slugs: ['brochure', 'guidelines'] })
  assert.equal(res.statusCode, 200, JSON.stringify(res.body))

  assert.equal(fakes.sends.length, 1, 'one recipient, one send')
  const sent = fakes.sends[0]
  assert.equal(sent.attachments.length, 2)
  assert.deepEqual(sent.attachments.map(a => a.filename), ['brochure.pdf', 'guidelines.docx'])
  // THE BYTES: what Resend received decodes back to exactly what storage held.
  assert.ok(Buffer.from(sent.attachments[0].content, 'base64').equals(fakes.PDF_BYTES))
  assert.ok(Buffer.from(sent.attachments[1].content, 'base64').equals(fakes.DOCX_BYTES))
  assert.equal(sent.attachments[0].contentType, 'application/pdf')
})

test('DIRECT notification metadata carries metadata ONLY', async () => {
  await runDirect({ ...DIRECT_BASE, attachment_slugs: ['brochure'] })
  assert.equal(fakes.logInserts.length, 1)
  const meta = fakes.logInserts[0].metadata
  assert.equal(meta.attachment_count, 1)
  assert.deepEqual(Object.keys(meta.attachments[0]).sort(),
    ['content_type', 'filename', 'size_bytes', 'size_label', 'slug', 'source', 'title'].sort())
  const text = JSON.stringify(fakes.logInserts)
  assert.doesNotMatch(text, /orientation\/|policies\//, 'no storage path in the audit record')
  assert.doesNotMatch(text, /JVBER/, 'no Base64 payload in the audit record')
  // The archive never learns about attachments at all.
  assert.doesNotMatch(JSON.stringify(fakes.archives), /attachment/i)
})

// ── Bulk: the identical set to every reviewed recipient ─────────────────────

test('BULK sends the IDENTICAL reviewed attachment set to every recipient', async () => {
  const res = await runBulk({ ...BULK_BASE, recipients: BULK_RECIPIENTS, attachment_slugs: ['brochure', 'guidelines'] })
  assert.equal(res.statusCode, 200, JSON.stringify(res.body))
  assert.equal(fakes.sends.length, 3, 'one email per reviewed recipient')

  const first = JSON.stringify(fakes.sends[0].attachments)
  for (const s of fakes.sends) {
    assert.equal(s.attachments.length, 2)
    assert.equal(JSON.stringify(s.attachments), first, 'byte-identical for every recipient')
  }
  // Resolved ONCE: two objects downloaded despite three recipients.
  assert.deepEqual(fakes.downloads, ['orientation/brochure.pdf', 'policies/guidelines.docx'])
  // Every recipient's audit row records the same attachment metadata.
  assert.equal(fakes.logInserts.length, 3)
  for (const row of fakes.logInserts) assert.equal(row.metadata.attachment_count, 2)
})

// ── Every rejection path: no provider call, no writes ───────────────────────

for (const [label, slug] of [
  ['an inactive resource', 'retired'],
  ['an unknown slug', 'no-such-slug'],
  ['a missing storage object', 'ghost'],
  ['an oversized file', 'huge'],
  ['bytes that contradict the extension', 'liar'],
  ['a macro-enabled Office file', 'macro'],
  ['a legacy .doc that can no longer be verified', 'legacy-doc'],
  ['a client-supplied storage path', 'orientation/brochure.pdf'],
]) {
  test(`DIRECT refuses ${label}: zero provider calls, zero writes`, async () => {
    const res = await runDirect({ ...DIRECT_BASE, attachment_slugs: [slug] })
    assert.ok(res.statusCode >= 400, `expected a refusal, got ${res.statusCode}`)
    assert.equal(fakes.sends.length, 0, 'Resend was never called')
    assert.equal(fakes.logInserts.length, 0, 'nothing was logged')
    assert.equal(fakes.archives.length, 0, 'nothing was archived')
  })

  test(`BULK refuses ${label}: zero provider calls, zero writes`, async () => {
    const res = await runBulk({ ...BULK_BASE, recipients: BULK_RECIPIENTS, attachment_slugs: [slug] })
    assert.ok(res.statusCode >= 400, `expected a refusal, got ${res.statusCode}`)
    assert.equal(fakes.sends.length, 0, 'not one recipient was emailed')
    assert.equal(fakes.logInserts.length, 0)
    assert.equal(fakes.archives.length, 0)
  })
}

test('one bad attachment aborts the whole batch - no partial send', async () => {
  const res = await runBulk({
    ...BULK_BASE, recipients: BULK_RECIPIENTS,
    attachment_slugs: ['brochure', 'liar'],   // first is fine, second is not
  })
  assert.ok(res.statusCode >= 400)
  assert.equal(fakes.sends.length, 0,
    'a later invalid file must not leave earlier recipients already emailed')
})

// ── Attachment-free behavior is untouched ──────────────────────────────────

test('DIRECT without attachments is unchanged', async () => {
  const res = await runDirect({ ...DIRECT_BASE })
  assert.equal(res.statusCode, 200)
  assert.equal(fakes.sends.length, 1)
  assert.equal('attachments' in fakes.sends[0], false, 'no empty attachments key is sent')
  assert.equal(fakes.downloads.length, 0, 'storage is never touched')
  assert.equal(fakes.logInserts[0].metadata.attachment_count, 0)
})

test('BULK without attachments is unchanged', async () => {
  const res = await runBulk({ ...BULK_BASE, recipients: BULK_RECIPIENTS })
  assert.equal(res.statusCode, 200)
  assert.equal(fakes.sends.length, 3)
  for (const s of fakes.sends) assert.equal('attachments' in s, false)
  assert.equal(fakes.downloads.length, 0)
})

test('an empty attachment list behaves exactly like no attachments', async () => {
  const res = await runDirect({ ...DIRECT_BASE, attachment_slugs: [] })
  assert.equal(res.statusCode, 200)
  assert.equal('attachments' in fakes.sends[0], false)
  assert.equal(fakes.downloads.length, 0)
})

// ── Preview writes nothing ─────────────────────────────────────────────────

test('PREVIEW resolves the list but sends nothing and writes nothing', async () => {
  const res = await runDirect({ ...DIRECT_BASE, preview: true, attachment_slugs: ['brochure'] })
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.attachments.length, 1)
  assert.equal(res.body.attachments[0].filename, 'brochure.pdf')
  assert.ok(res.body.attachments[0].size_bytes > 0)
  assert.equal('content' in res.body.attachments[0], false, 'preview never returns bytes')
  assert.equal(fakes.sends.length, 0)
  assert.equal(fakes.logInserts.length, 0)
  assert.equal(fakes.archives.length, 0)
})

test('a bad attachment fails the PREVIEW too, so review can never show a lie', async () => {
  const res = await runDirect({ ...DIRECT_BASE, preview: true, attachment_slugs: ['macro'] })
  assert.ok(res.statusCode >= 400)
  assert.equal(fakes.sends.length, 0)
})

// ── PLACEMENT-COMMUNICATION-HANDOFF-1A: placement identity, end to end ───────
//
// These run the REAL send endpoint with the REAL placement guard. What they
// prove is not that the guard has rules, but that the endpoint applies them
// before Resend is reached and stamps the log from verified rows.

const P = fakes.PLACEMENT
const CONTACT_ID = 'bbbbbbbb-0000-4000-8000-000000000001'   // email: coordinator1@example.org
const PLACEMENT_BASE = {
  recipient_type: 'contact',
  recipient_id: CONTACT_ID,
  subject: 'ASPIRE: Student Assignment and Introduction Details',
  body: 'QC body',
  body_format: 'text',
}
const trueRef = () => ({
  match_id: P.match, student_id: P.student, unit_id: P.unit,
  cohort_id: P.cohort, preceptor_id: P.preceptor,
})
const placementMeta = () => (fakes.logInserts[0]?.metadata) || {}

test('PLACEMENT: a truthful handoff sends and stamps the verified placement', async () => {
  const res = await runDirect({ ...PLACEMENT_BASE, placement_ref: trueRef() })
  assert.equal(res.statusCode, 200, JSON.stringify(res.body))
  assert.equal(fakes.sends.length, 1, 'the email was sent')
  assert.equal(fakes.logInserts.length, 1)
  const m = placementMeta()
  assert.equal(m.placement_template_key, 'preceptor_assignment')
  assert.equal(m.placement_match_id, P.match)
  assert.equal(m.placement_student_id, P.student)
  assert.equal(m.placement_unit_id, P.unit)
  assert.equal(m.placement_cohort_id, P.cohort)
  assert.equal(m.placement_preceptor_id, P.preceptor)
})

test('PLACEMENT: the stamp comes from the DATABASE, not the payload', async () => {
  // Every claim is truthful EXCEPT that the payload also carries junk fields and
  // a differently-cased id. What lands on the row is the server's own value.
  const res = await runDirect({
    ...PLACEMENT_BASE,
    placement_ref: { ...trueRef(), placement_template_key: 'forged', extra: 'ignored' },
  })
  assert.equal(res.statusCode, 200, JSON.stringify(res.body))
  const m = placementMeta()
  assert.equal(m.placement_template_key, 'preceptor_assignment', 'a forged template key cannot ride along')
  assert.equal(m.extra, undefined, 'and no unknown field is copied onto the record')
})

test('PLACEMENT NEGATIVE CONTROL: a tampered student id is refused before Resend', async () => {
  const res = await runDirect({
    ...PLACEMENT_BASE,
    placement_ref: { ...trueRef(), student_id: 'aaaaaaaa-0000-4000-8000-000000000002' },
  })
  assert.equal(res.statusCode, 409)
  assert.equal(res.body.placement_error, 'student_mismatch')
  assert.equal(fakes.sends.length, 0, 'NO email may be sent')
  assert.equal(fakes.logInserts.length, 0, 'and NO notification row may be written')
})

test('PLACEMENT NEGATIVE CONTROL: a cross-cohort claim is refused before Resend', async () => {
  const res = await runDirect({
    ...PLACEMENT_BASE,
    placement_ref: { ...trueRef(), cohort_id: P.otherCohort },
  })
  assert.equal(res.statusCode, 409)
  assert.equal(res.body.placement_error, 'cohort_mismatch')
  assert.equal(fakes.sends.length, 0)
  assert.equal(fakes.logInserts.length, 0)
})

test('PLACEMENT NEGATIVE CONTROL: a cross-unit claim is refused before Resend', async () => {
  const res = await runDirect({
    ...PLACEMENT_BASE,
    placement_ref: { ...trueRef(), unit_id: P.otherUnit },
  })
  assert.equal(res.statusCode, 409)
  assert.equal(res.body.placement_error, 'unit_mismatch')
  assert.equal(fakes.sends.length, 0)
})

test('PLACEMENT NEGATIVE CONTROL: a wrong preceptor is refused before Resend', async () => {
  const res = await runDirect({
    ...PLACEMENT_BASE,
    placement_ref: { ...trueRef(), preceptor_id: P.other },
  })
  assert.equal(res.statusCode, 409)
  assert.equal(res.body.placement_error, 'preceptor_changed')
  assert.equal(fakes.sends.length, 0)
})

test('PLACEMENT NEGATIVE CONTROL: a deleted/stale match is refused before Resend', async () => {
  const res = await runDirect({
    ...PLACEMENT_BASE,
    placement_ref: { ...trueRef(), match_id: 'ffffffff-0000-4000-8000-00000000dead' },
  })
  assert.equal(res.statusCode, 409)
  assert.equal(res.body.placement_error, 'match_missing')
  assert.match(res.body.error, /no longer exists/)
  assert.equal(fakes.sends.length, 0)
  assert.equal(fakes.logInserts.length, 0)
})

test('PLACEMENT NEGATIVE CONTROL: the WRONG RECIPIENT is refused even with a true placement', async () => {
  // Every id is correct, but the message is addressed to a student rather than
  // the preceptor's contact.
  const res = await runDirect({
    recipient_type: 'student',
    recipient_id: 'aaaaaaaa-0000-4000-8000-000000000002',
    subject: 'QC', body: 'QC', body_format: 'text',
    placement_ref: trueRef(),
  })
  assert.equal(res.statusCode, 400)
  assert.equal(res.body.placement_error, 'recipient_type')
  assert.equal(fakes.sends.length, 0)
})

test('PLACEMENT NEGATIVE CONTROL: an incomplete handoff fails closed', async () => {
  for (const key of ['match_id', 'student_id', 'unit_id', 'cohort_id', 'preceptor_id']) {
    const ref = { ...trueRef() }
    delete ref[key]
    const res = await runDirect({ ...PLACEMENT_BASE, placement_ref: ref })
    assert.equal(res.statusCode, 400, `${key} missing must refuse`)
    assert.equal(fakes.sends.length, 0, `${key} missing must not send`)
    assert.equal(fakes.logInserts.length, 0)
  }
})

test('ORDINARY SEND: no placement handoff still works, and creates no placement state', async () => {
  const res = await runDirect({ ...DIRECT_BASE })
  assert.equal(res.statusCode, 200, JSON.stringify(res.body))
  assert.equal(fakes.sends.length, 1, 'an ordinary Connect email is unaffected')
  assert.equal(fakes.logInserts.length, 1)
  const m = placementMeta()
  for (const k of Object.keys(m)) {
    assert.ok(!k.startsWith('placement_'), `an ordinary send must not stamp ${k}`)
  }
})

test('ORDINARY SEND: a manual-template send to a contact creates no Sent chip', async () => {
  const res = await runDirect({ ...PLACEMENT_BASE })   // same recipient, NO placement_ref
  assert.equal(res.statusCode, 200, JSON.stringify(res.body))
  assert.equal(fakes.sends.length, 1)
  const m = placementMeta()
  assert.equal(m.placement_match_id, undefined,
    'choosing the template by hand must not attribute the send to a placement')
})

// ── PRECEPTOR-DRAFT-CONTINUITY-1: the manual confirmation endpoint ───────────
//
// The real handler runs against the same placement world. What these prove:
// the guard runs, the record is a CONFIRMATION (never a provider send), and
// repeated or redundant confirmation writes nothing.

async function runConfirm(body, { reset = true } = {}) {
  if (reset) fakes.__reset()
  const res = makeRes()
  await confirmHandler({ method: 'POST', headers: REQ_HEADERS, body }, res)
  return res
}
const CONFIRM_REF = {
  match_id: 'PLACEHOLDER', student_id: 'PLACEHOLDER', unit_id: 'PLACEHOLDER',
  cohort_id: 'PLACEHOLDER', preceptor_id: 'PLACEHOLDER',
}
const confirmRef = () => ({
  match_id: P.match, student_id: P.student, unit_id: P.unit,
  cohort_id: P.cohort, preceptor_id: P.preceptor,
})
void CONFIRM_REF

test('CONFIRM: a truthful confirmation records a manual row, never a provider send', async () => {
  const res = await runConfirm(confirmRef())
  assert.equal(res.statusCode, 200, JSON.stringify(res.body))
  assert.equal(res.body.recorded, true)
  assert.equal(res.body.sent_email, false)
  assert.equal(fakes.sends.length, 0, 'NO email leaves this endpoint')
  assert.equal(fakes.logInserts.length, 1)
  const row = fakes.logInserts[0]
  assert.equal(row.notification_type, 'placement_manual_confirmation')
  assert.equal(row.status, 'confirmed')
  assert.equal(row.metadata.source, 'manual_confirmation')
  assert.equal(row.metadata.confirmed_by, 'staff-1', 'the acting user comes from the session')
  assert.equal(row.metadata.placement_match_id, P.match)
  assert.equal(row.metadata.placement_preceptor_id, P.preceptor)
})

test('CONFIRM: repeating the confirmation is idempotent', async () => {
  await runConfirm(confirmRef())
  const second = await runConfirm(confirmRef(), { reset: false })
  assert.equal(second.statusCode, 200)
  assert.equal(second.body.already, true)
  assert.equal(fakes.logInserts.length, 1, 'the second Yes wrote nothing')
})

test('CONFIRM: existing PROVIDER evidence also answers already', async () => {
  fakes.__reset()
  // A real send already recorded this placement (delivered by now).
  fakes.logInserts.push({
    notification_type: 'direct_message_sent', status: 'delivered',
    metadata: {
      placement_template_key: 'preceptor_assignment',
      placement_match_id: P.match, placement_preceptor_id: P.preceptor,
    },
  })
  const res = await runConfirm(confirmRef(), { reset: false })
  assert.equal(res.body.already, true)
  assert.equal(fakes.logInserts.length, 1, 'no duplicate state on top of the provider row')
})

test('CONFIRM NEGATIVE CONTROL: a tampered placement is refused with nothing written', async () => {
  const res = await runConfirm({ ...confirmRef(), student_id: 'aaaaaaaa-0000-4000-8000-000000000002' })
  assert.equal(res.statusCode, 409)
  assert.equal(res.body.placement_error, 'student_mismatch')
  assert.equal(fakes.logInserts.length, 0)
})

test('CONFIRM NEGATIVE CONTROL: a stale match is refused', async () => {
  const res = await runConfirm({ ...confirmRef(), match_id: 'ffffffff-0000-4000-8000-00000000dead' })
  assert.equal(res.statusCode, 409)
  assert.equal(res.body.placement_error, 'match_missing')
  assert.equal(fakes.logInserts.length, 0)
})

test('CONFIRM NEGATIVE CONTROL: a body-supplied identity is refused outright', async () => {
  const res = await runConfirm({ ...confirmRef(), confirmed_by: 'someone-else' })
  assert.equal(res.statusCode, 400)
  assert.match(res.body.error, /taken from your session/)
  assert.equal(fakes.logInserts.length, 0)
})
