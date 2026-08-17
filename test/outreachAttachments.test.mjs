// test/outreachAttachments.test.mjs
//
// OUTREACH-ATTACHMENTS-1.
//
// These execute the REAL resolver against a substituted database/storage client,
// so they test the shipped code rather than a description of it. The security
// claims under test are the ones that would matter if they were wrong:
//
//   - a client-supplied storage path or URL can never select a file;
//   - an inactive, unknown, or non-file resource is refused;
//   - bytes are checked against magic numbers, not the filename;
//   - count and total size are capped below Resend's ceiling;
//   - resolution happens ONCE and the same bytes go to every recipient;
//   - nothing that reaches an audit record contains bytes, paths, or URLs.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  resolveAttachments, normaliseSlugs, safeFilename, matchesMagic, extensionOf,
  formatBytes, ALLOWED_TYPES, REJECTED_TYPES, MAX_ATTACHMENTS, MAX_TOTAL_BYTES, MAX_FILE_BYTES,
  RESEND_ENCODED_CEILING_BYTES,
} from '../api/lib/outreachAttachments.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = f => fs.readFileSync(path.join(root, f), 'utf8')

// Fixtures are REAL files, not just magic prefixes: the validator now parses
// PDF structure and the OOXML container, so a stub would be rejected (which is
// the point of the correction).
import { crc32 } from 'node:zlib'

function zip(entries) {
  const files = [], central = []
  let offset = 0
  for (const [name, content] of entries) {
    const nameBuf = Buffer.from(name, 'utf8')
    const data = Buffer.from(content, 'utf8')
    const crc = crc32(data) >>> 0
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    files.push(local, nameBuf, data)
    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6)
    cd.writeUInt32LE(crc, 16)
    cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(data.length, 24)
    cd.writeUInt16LE(nameBuf.length, 28); cd.writeUInt32LE(offset, 42)
    central.push(cd, nameBuf)
    offset += local.length + nameBuf.length + data.length
  }
  const cdBuf = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(cdBuf.length, 12); eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([Buffer.concat(files), cdBuf, eocd])
}

const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n', 'latin1'), Buffer.alloc(100, 0x41), Buffer.from('\n%%EOF', 'latin1')])
const DOCX = zip([['[Content_Types].xml', '<Types/>'], ['word/document.xml', '<document/>']])
const MACRO_DOCX = zip([['[Content_Types].xml', '<Types/>'], ['word/document.xml', '<d/>'], ['word/vbaProject.bin', 'M']])
const BARE_ZIP = zip([['readme.txt', 'not an office file']])

const ROWS = [
  { slug: 'aspire-brochure', title: 'ASPIRE Brochure', storage_path: 'orientation/aspire-brochure.pdf', resource_type: 'internal_file', is_active: true },
  { slug: 'student-guidelines', title: 'Pre-Licensure Student General Guidelines', storage_path: 'policies/student-guidelines.docx', resource_type: 'internal_file', is_active: true },
  { slug: 'retired-doc', title: 'Retired Doc', storage_path: 'policies/retired.pdf', resource_type: 'internal_file', is_active: false },
  { slug: 'a-link', title: 'External Policy', storage_path: null, external_url: 'https://x', resource_type: 'external_link', is_active: true },
  { slug: 'danger', title: 'Installer', storage_path: 'policies/setup.exe', resource_type: 'internal_file', is_active: true },
  { slug: 'liar', title: 'Not Really A PDF', storage_path: 'policies/liar.pdf', resource_type: 'internal_file', is_active: true },
]

/** Substituted Supabase client. Records exactly which paths were downloaded. */
function fakeDb({ files = {}, downloads = [] } = {}) {
  return {
    downloads,
    from() {
      return {
        select() {
          return {
            in(_col, slugs) {
              return Promise.resolve({ data: ROWS.filter(r => slugs.includes(r.slug)), error: null })
            },
          }
        },
      }
    },
    storage: {
      from() {
        return {
          download(p) {
            downloads.push(p)
            const buf = files[p]
            if (!buf) return Promise.resolve({ data: null, error: { message: 'not found' } })
            return Promise.resolve({ data: { arrayBuffer: async () => buf }, error: null })
          },
        }
      },
    },
  }
}

const FILES = {
  'orientation/aspire-brochure.pdf': PDF,
  'policies/student-guidelines.docx': DOCX,
  'policies/retired.pdf': PDF,
  'policies/setup.exe': Buffer.from([0x4d, 0x5a, 0x90, 0x00]),
  'policies/liar.pdf': Buffer.from('<html>not a pdf at all</html>'),
}

// ── The happy path ──────────────────────────────────────────────────────────

test('resolves catalog slugs into Resend-ready attachments', async () => {
  const db = fakeDb({ files: FILES })
  const r = await resolveAttachments({ db, slugs: ['aspire-brochure', 'student-guidelines'] })

  assert.equal(r.ok, true)
  assert.equal(r.attachments.length, 2)
  const [a, b] = r.attachments
  assert.equal(a.filename, 'aspire-brochure.pdf')
  assert.equal(a.contentType, 'application/pdf')
  assert.equal(Buffer.from(a.content, 'base64').equals(PDF), true, 'the real bytes, Base64 encoded')
  assert.equal(b.contentType, ALLOWED_TYPES.docx.mime)
  // Only the two resolved objects were ever read.
  assert.deepEqual(db.downloads, ['orientation/aspire-brochure.pdf', 'policies/student-guidelines.docx'])
})

test('the summary carries metadata only - never bytes, paths, or URLs', async () => {
  const db = fakeDb({ files: FILES })
  const r = await resolveAttachments({ db, slugs: ['aspire-brochure'] })
  const s = r.summary[0]
  assert.deepEqual(Object.keys(s).sort(),
    ['content_type', 'filename', 'size_bytes', 'size_label', 'slug', 'source', 'title'].sort())
  const asText = JSON.stringify(r.summary)
  assert.doesNotMatch(asText, /orientation\//, 'no storage path')
  assert.doesNotMatch(asText, /http/, 'no URL')
  assert.doesNotMatch(asText, /JVBER|base64/i, 'no bytes')
  assert.equal(s.size_bytes, PDF.length)
})

// ── Client input can never choose a file ────────────────────────────────────

test('a storage path or URL supplied by the client selects nothing', async () => {
  const db = fakeDb({ files: FILES })
  for (const evil of [
    'orientation/aspire-brochure.pdf',
    '../../etc/passwd',
    'https://evil.example.com/x.pdf',
    'policies/../../secret.pdf',
  ]) {
    const r = await resolveAttachments({ db, slugs: [evil] })
    assert.equal(r.ok, false, `${evil} must not resolve`)
    assert.equal(r.status, 404)
  }
  // Nothing was ever downloaded for any of them.
  assert.deepEqual(db.downloads, [])
})

test('inactive, external-link and unknown resources are refused', async () => {
  const db = fakeDb({ files: FILES })
  const inactive = await resolveAttachments({ db, slugs: ['retired-doc'] })
  assert.equal(inactive.ok, false)
  assert.match(inactive.error, /no longer available/)

  const link = await resolveAttachments({ db, slugs: ['a-link'] })
  assert.equal(link.ok, false)
  assert.match(link.error, /Only ASPIRE Catalog files/)

  const missing = await resolveAttachments({ db, slugs: ['does-not-exist'] })
  assert.equal(missing.ok, false)
  assert.equal(missing.status, 404)

  assert.deepEqual(db.downloads, [], 'none of them reached storage')
})

// ── Content, not filename, decides ──────────────────────────────────────────

test('an executable extension is rejected before any download', async () => {
  const db = fakeDb({ files: FILES })
  const r = await resolveAttachments({ db, slugs: ['danger'] })
  assert.equal(r.ok, false)
  assert.match(r.error, /cannot be emailed/)
  assert.deepEqual(db.downloads, [], 'the .exe was never even read')
  assert.equal(Object.prototype.hasOwnProperty.call(ALLOWED_TYPES, 'exe'), false)
  for (const bad of ['exe', 'js', 'sh', 'bat', 'dll', 'zip', 'html', 'doc', 'xls', 'ppt', 'docm']) {
    assert.equal(Object.prototype.hasOwnProperty.call(ALLOWED_TYPES, bad), false, `${bad} must not be attachable`)
  }
})

test('a file whose bytes contradict its extension is rejected', async () => {
  const db = fakeDb({ files: FILES })
  const r = await resolveAttachments({ db, slugs: ['liar'] })
  assert.equal(r.ok, false)
  assert.match(r.error, /does not look like a valid PDF/)
  assert.deepEqual(db.downloads, ['policies/liar.pdf'], 'it was read, then rejected on content')
})

test('magic-byte matching accepts real signatures and rejects near misses', () => {
  assert.equal(matchesMagic(Buffer.from([0x25, 0x50, 0x44, 0x46]), 'pdf'), true)
  assert.equal(matchesMagic(Buffer.from([0x25, 0x50, 0x44, 0x00]), 'pdf'), false)
  assert.equal(matchesMagic(Buffer.from([0x50, 0x4b, 0x03, 0x04]), 'docx'), true)
  assert.equal(matchesMagic(Buffer.from([0xff, 0xd8, 0xff]), 'jpg'), true)
  assert.equal(matchesMagic(Buffer.from([0x00]), 'unknownext'), false)
  // Legacy OLE types were REMOVED: one signature cannot distinguish them.
  assert.equal(Object.prototype.hasOwnProperty.call(ALLOWED_TYPES, 'doc'), false)
  for (const gone of ['doc', 'xls', 'ppt']) {
    assert.ok(REJECTED_TYPES[gone], `${gone} is documented as deliberately unsupported`)
  }
})

test('a ZIP prefix alone is NOT accepted as an Office document', async () => {
  // The whole point of the validation correction: "some zip" is not a .docx.
  const db = fakeDb({ files: { 'policies/student-guidelines.docx': BARE_ZIP } })
  const r = await resolveAttachments({ db, slugs: ['student-guidelines'] })
  assert.equal(r.ok, false)
  assert.match(r.error, /not a valid Office document|not a valid DOCX/)
})

test('a macro-enabled container is rejected by name', async () => {
  const db = fakeDb({ files: { 'policies/student-guidelines.docx': MACRO_DOCX } })
  const r = await resolveAttachments({ db, slugs: ['student-guidelines'] })
  assert.equal(r.ok, false)
  assert.match(r.error, /macro-enabled/)
})

test('a truncated PDF without an EOF marker is rejected', async () => {
  const db = fakeDb({ files: { 'orientation/aspire-brochure.pdf': Buffer.from('%PDF-1.7 no ending here', 'latin1') } })
  const r = await resolveAttachments({ db, slugs: ['aspire-brochure'] })
  assert.equal(r.ok, false)
  assert.match(r.error, /end-of-file/)
})

// ── Limits ──────────────────────────────────────────────────────────────────

test('ASPIRE stays well under the provider ceiling', () => {
  const encoded = Math.ceil(MAX_TOTAL_BYTES * 4 / 3)
  assert.ok(encoded < RESEND_ENCODED_CEILING_BYTES / 2,
    'the encoded total must leave large headroom under 40 MB')
  assert.ok(MAX_FILE_BYTES <= MAX_TOTAL_BYTES)
  assert.equal(MAX_ATTACHMENTS, 5)
})

test('too many attachments are refused before any lookup', async () => {
  const db = fakeDb({ files: FILES })
  const many = Array.from({ length: MAX_ATTACHMENTS + 1 }, (_, i) => `slug-${i}`)
  const r = await resolveAttachments({ db, slugs: many })
  assert.equal(r.ok, false)
  assert.match(r.error, /up to 5 files/)
  assert.deepEqual(db.downloads, [])
})

test('an oversized file and an oversized total are both refused', async () => {
  const big = Buffer.concat([Buffer.from('%PDF-1.7\n', 'latin1'), Buffer.alloc(MAX_FILE_BYTES, 0x41), Buffer.from('\n%%EOF', 'latin1')])
  const one = await resolveAttachments({
    db: fakeDb({ files: { ...FILES, 'orientation/aspire-brochure.pdf': big } }),
    slugs: ['aspire-brochure'],
  })
  assert.equal(one.ok, false)
  assert.equal(one.status, 413)

  // Two files that each pass but together exceed the total.
  const half = Buffer.concat([Buffer.from('%PDF-1.7\n', 'latin1'), Buffer.alloc(MAX_TOTAL_BYTES * 0.6, 0x41), Buffer.from('\n%%EOF', 'latin1')])
  const halfDocx = zip([['[Content_Types].xml', '<Types/>'], ['word/document.xml', 'x'.repeat(MAX_TOTAL_BYTES * 0.6)]])
  const both = await resolveAttachments({
    db: fakeDb({ files: { 'orientation/aspire-brochure.pdf': half, 'policies/student-guidelines.docx': halfDocx } }),
    slugs: ['aspire-brochure', 'student-guidelines'],
  })
  assert.equal(both.ok, false)
  assert.equal(both.status, 413)
  assert.match(both.error, /total more than/)
})

test('an empty or unreadable object fails rather than sending nothing', async () => {
  const empty = await resolveAttachments({
    db: fakeDb({ files: { 'orientation/aspire-brochure.pdf': Buffer.alloc(0) } }),
    slugs: ['aspire-brochure'],
  })
  assert.equal(empty.ok, false)
  assert.match(empty.error, /empty/)

  const gone = await resolveAttachments({ db: fakeDb({ files: {} }), slugs: ['aspire-brochure'] })
  assert.equal(gone.ok, false)
  assert.equal(gone.status, 502)
})

test('a message with no attachments never depends on attachment plumbing', async () => {
  // The common case must succeed even with no database client at all, so the
  // feature cannot block ordinary Outreach.
  for (const slugs of [undefined, null, []]) {
    const r = await resolveAttachments({ slugs })
    assert.deepEqual(r, { ok: true, attachments: [], summary: [] })
  }
  // But asking for a file without a client is a hard failure, never a silent
  // "sent with no attachment".
  const r = await resolveAttachments({ slugs: ['aspire-brochure'] })
  assert.equal(r.ok, false)
  assert.equal(r.status, 500)
})

// ── Normalisation ───────────────────────────────────────────────────────────

test('slug normalisation dedupes, preserves order, and never invents entries', () => {
  assert.deepEqual(normaliseSlugs(['b', 'a', 'b', ' a ']).slugs, ['b', 'a'])
  assert.deepEqual(normaliseSlugs(null).slugs, [])
  assert.deepEqual(normaliseSlugs([]).slugs, [])
  assert.match(normaliseSlugs('not-an-array').error, /must be a list/)
  assert.match(normaliseSlugs([{ slug: 'x' }]).error, /Invalid attachment reference/)
  assert.match(normaliseSlugs(['x'.repeat(201)]).error, /Invalid attachment reference/)
})

test('filenames cannot break out of a MIME header', () => {
  assert.equal(safeFilename('a/b/c/report.pdf'), 'report.pdf')
  assert.equal(safeFilename('..\\..\\evil.pdf'), 'evil.pdf')
  // The security property: the quote and the CRLF are gone, so the value cannot
  // terminate the header or start a new one. What remains is inert text.
  const injected = safeFilename('bad"name\r\nBcc: x@y.com.pdf')
  assert.equal(injected, 'badnameBcc: x@y.com.pdf')
  assert.doesNotMatch(injected, /["\r\n]/)
  assert.equal(safeFilename('...hidden.pdf'), 'hidden.pdf')
  assert.equal(safeFilename(''), '')
  assert.equal(extensionOf('Report.FINAL.PDF'), 'pdf')
  assert.equal(formatBytes(2 * 1024 * 1024), '2.0 MB')
})

// ── Wiring: the guarantees that live in the endpoints ───────────────────────

test('both endpoints resolve attachments BEFORE constructing the Resend client', () => {
  for (const f of ['api/connect-send-direct-email.js', 'api/connect-send-bulk-message.js']) {
    const src = read(f)
    const resolveAt = src.indexOf('const att = await resolveAttachments(')
    const clientAt = src.indexOf('new Resend(process.env.RESEND_API_KEY)')
    assert.ok(resolveAt > -1, `${f} resolves attachments`)
    assert.ok(clientAt > -1, `${f} constructs a Resend client`)
    assert.ok(resolveAt < clientAt,
      `${f}: a bad attachment must fail before the provider client exists`)
    // And the failure returns rather than continuing.
    const between = src.slice(resolveAt, clientAt)
    assert.match(between, /if \(!att\.ok\)[\s\S]{0,220}return res\.status/,
      `${f}: an invalid attachment must return, not fall through`)
  }
})

test('the bulk batch resolves ONCE and reuses the same bytes for every recipient', () => {
  const src = read('api/connect-send-bulk-message.js')
  // Exactly one send-mode resolution, and it is outside the per-recipient loop.
  const resolveAt = src.indexOf('const att = await resolveAttachments(')
  const loopAt = src.indexOf('for (let i = 0; i < cleared.length; i++)')
  assert.ok(resolveAt > -1 && loopAt > -1)
  assert.ok(resolveAt < loopAt, 'resolution happens before the send loop')
  const loopBody = src.slice(loopAt)
  assert.doesNotMatch(loopBody, /resolveAttachments\(/,
    'the loop must never re-resolve a file per recipient')
  assert.match(loopBody, /\.\.\.\(att\.attachments\.length \? \{ attachments: att\.attachments \} : \{\}\)/,
    'each send reuses the same resolved array')
})

test('preview resolves for display but sends and writes nothing', () => {
  for (const f of ['api/connect-send-direct-email.js', 'api/connect-send-bulk-message.js']) {
    const src = read(f)
    const pv = src.indexOf('const pv = await resolveAttachments(')
    assert.ok(pv > -1, `${f} previews the attachment list`)
    const previewReturn = src.slice(pv, pv + 900)
    assert.match(previewReturn, /attachments: pv\.summary/, 'preview returns metadata only')
    assert.doesNotMatch(previewReturn, /emails\.send|notification_log|message_archive/,
      `${f}: preview must not send or write`)
  }
})

test('audit metadata records names and sizes, never bytes or paths', () => {
  for (const f of ['api/connect-send-direct-email.js', 'api/connect-send-bulk-message.js']) {
    const src = read(f)
    assert.match(src, /attachments:\s+att\.summary/, `${f} logs the summary`)
    assert.doesNotMatch(src, /attachments:\s+att\.attachments\s*,/,
      `${f} must never put the byte-bearing array into metadata`)
  }
  // message_archive is untouched by this feature.
  const archive = read('api/lib/messageArchive.js')
  assert.doesNotMatch(archive, /attachment/i, 'no attachment data enters message_archive')
})

test('the client sends slugs only - never bytes, paths, or URLs', () => {
  for (const f of ['src/components/connect/OutreachView.jsx', 'src/components/connect/BulkManualComposer.jsx']) {
    const src = read(f)
    assert.match(src, /attachment_slugs:\s+toSlugs\(/, `${f} sends slugs`)
    assert.doesNotMatch(src, /attachment_content|attachment_path|attachment_url|storage_path:/,
      `${f} must not send bytes or paths`)
  }
  const picker = read('src/components/connect/AttachmentPicker.jsx')
  assert.doesNotMatch(picker, /FileReader|readAsDataURL|<input[^>]*type="file"/,
    'Phase 1 has no local file input at all')
  // Product naming: this feature attaches from the ASPIRE Catalog.
  assert.match(picker, /Attach from ASPIRE Catalog/)
  assert.match(picker, /Search the ASPIRE Catalog/)
  assert.match(picker, /Loading the ASPIRE Catalog/)
  assert.match(picker, /Could not load the ASPIRE Catalog/)
  assert.doesNotMatch(picker, /Resource Library|from Library|the Library/,
    'no "Library" wording remains in this feature')
})

test('Sent History shows attachment metadata without promising a download', () => {
  const src = read('src/components/connect/SentHistory.jsx')
  assert.match(src, /data-testid="sent-attachments"/)
  assert.match(src, /Open the current version in ASPIRE Catalog/)
  // NEGATIVE CONTROL: no download affordance is rendered for a historical row.
  const comp = src.slice(src.indexOf('function AttachmentsRow'), src.indexOf('function AttachmentsRow') + 1400)
  assert.doesNotMatch(comp, /<a |href=|signedUrl|download/i,
    'a historical record must not pretend the file is still retrievable')
})

test('the sensitive-data warning is present and shown with attachments', () => {
  const lib = read('src/lib/connect/outreachAttachments.js')
  assert.match(lib, /Do not attach patient information/)
  const picker = read('src/components/connect/AttachmentPicker.jsx')
  assert.match(picker, /SENSITIVE_DATA_WARNING/)
  assert.match(picker, /data-testid="attachment-warning"/)
})

test('no migration or schema change ships with this feature', () => {
  const server = read('api/lib/outreachAttachments.js')
    .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
  assert.doesNotMatch(server, /CREATE |ALTER |INSERT INTO|\.rpc\(/,
    'the resolver only reads existing tables and storage')
  assert.match(server, /from\('catalog_resources'\)/)
  assert.match(server, /const BUCKET = 'aspire-catalog'/,
    'reuses the existing private catalog bucket - no new or unrelated bucket')
})
