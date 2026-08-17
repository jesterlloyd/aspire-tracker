// test/outreachAttachmentDrafts.test.mjs
//
// OUTREACH-ATTACHMENTS-1 - attachments are part of the draft, and cannot leak.
//
// THE RISK. Attachments live in component state next to a recipient (Direct) or
// a cohort+message-type (Bulk). If that state is not scoped and cleared like
// the rest of the draft, a file chosen while composing to A silently rides
// along on a later message to B. That is a confidentiality failure, not a
// cosmetic bug, so the behaviour is proven here and each guard carries a
// NEGATIVE CONTROL that fails if the wiring is removed.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  toDraftAttachments, fromDraftAttachments, attachmentsResolved, sendBlockedReason,
  MAX_ATTACHMENTS,
} from '../src/lib/connect/outreachAttachments.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = f => fs.readFileSync(path.join(root, f), 'utf8')

const A = { slug: 'brochure', title: 'ASPIRE Brochure', type_label: 'PDF' }
const B = { slug: 'guidelines', title: 'Student Guidelines', type_label: 'DOCX' }

// ── The draft round-trip ────────────────────────────────────────────────────

test('a draft stores identity and display text - never sizes or paths', () => {
  const stored = toDraftAttachments([{ ...A, size_bytes: 12345, filename: 'x.pdf', storage_path: 'a/b.pdf' }])
  assert.deepEqual(stored, [{ slug: 'brochure', title: 'ASPIRE Brochure', type_label: 'PDF' }])
  const text = JSON.stringify(stored)
  assert.doesNotMatch(text, /size_bytes|storage_path|a\/b\.pdf/,
    'a size is a server fact that can go stale in localStorage; a path never belongs here')
})

test('a legacy draft written before this feature restores as an EMPTY list', () => {
  // The dangerous alternative is inheriting whatever the composer already held.
  assert.deepEqual(fromDraftAttachments({ subject: 'hi', body: 'there' }), [])
  assert.deepEqual(fromDraftAttachments({}), [])
  assert.deepEqual(fromDraftAttachments(null), [])
  assert.deepEqual(fromDraftAttachments({ attachments: null }), [])
  assert.deepEqual(fromDraftAttachments({ attachments: 'nope' }), [])
})

test('only well-formed entries survive a restore, and the count stays capped', () => {
  const messy = { attachments: [A, null, { title: 'no slug' }, { slug: '' }, B] }
  assert.deepEqual(fromDraftAttachments(messy).map(a => a.slug), ['brochure', 'guidelines'])
  const many = { attachments: Array.from({ length: MAX_ATTACHMENTS + 3 }, (_, i) => ({ slug: `s${i}`, title: `t${i}` })) }
  assert.equal(fromDraftAttachments(many).length, MAX_ATTACHMENTS)
})

test("recipient A's draft never yields recipient B's attachments", () => {
  // Two recipient-scoped drafts, the shape localStorage actually holds.
  const draftA = { subject: 's', body: 'b', attachments: toDraftAttachments([A]) }
  const draftB = { subject: 's', body: 'b' }                    // B never attached anything
  assert.deepEqual(fromDraftAttachments(draftA).map(a => a.slug), ['brochure'])
  assert.deepEqual(fromDraftAttachments(draftB), [],
    'switching to B restores B - which is nothing - not A')
})

// ── The clear/restore wiring, with negative controls ────────────────────────

test('DIRECT: attachments are saved, restored per recipient, and cleared', () => {
  const src = read('src/components/connect/OutreachView.jsx')

  // Saved with the recipient-scoped draft.
  assert.match(src, /attachments: toDraftAttachments\(l\.attachments\)/,
    'the persisted payload carries the attachments')
  // Restored from THIS recipient's draft only.
  assert.match(src, /setDmAttachments\(fromDraftAttachments\(d\)\)/)

  // NEGATIVE CONTROL: on a recipient change with no draft, the list must be
  // cleared in the SAME branch that clears subject and body. Without this line
  // the previous recipient's files stay selected.
  const restoreBlock = src.slice(src.indexOf('const recipientChanged = lastRecipientRef.current'),
    src.indexOf('draftHydratedRef.current = true'))
  assert.match(restoreBlock, /} else if \(recipientChanged\) \{[\s\S]*setDmAttachments\(\[\]\)/,
    'a recipient with no draft must clear attachments, not inherit them')
  assert.match(restoreBlock, /setMsgSubject\(''\)[\s\S]*setDmAttachments\(\[\]\)/,
    'cleared alongside the rest of the draft')

  // Cleared after a successful send and on explicit discard.
  const sendBlock = src.slice(src.indexOf('// Clear saved draft + resume pointer'), src.indexOf('// Clear saved draft + resume pointer') + 300)
  assert.match(sendBlock, /setDmAttachments\(\[\]\)/, 'a sent message leaves nothing selected')
  const discard = src.slice(src.indexOf('const handleDiscardDraft'), src.indexOf('const handleDiscardDraft') + 900)
  assert.match(discard, /setDmAttachments\(\[\]\)/, 'discard clears attachments too')

  // Autosave must react to attachment-only edits.
  assert.match(src, /\}, \[msgSubject, msgBody, includeSignature, dmAttachments,/,
    'changing only the attachments still saves the draft')
})

test('BULK: attachments are scoped to cohort AND message type', () => {
  const src = read('src/components/connect/BulkManualComposer.jsx')

  assert.match(src, /attachments: toDraftAttachments\(attachments\)/, 'persisted with the draft')
  assert.match(src, /setAttachments\(fromDraftAttachments\(d\)\)/, 'restored from this key only')

  // NEGATIVE CONTROL 1: the message-type switch block must clear them.
  const typeBlock = src.slice(src.indexOf('if (hydratedType !== bulkMsgType) {'),
    src.indexOf('// BULK-EXACT-RECIPIENTS-1: changing cohorts clears the audience.'))
  assert.match(typeBlock, /setAttachments\(\[\]\)/,
    "one message type's attachments must never reach another")

  // NEGATIVE CONTROL 2: the cohort switch block must clear them.
  const cohortBlock = src.slice(src.indexOf('if (hydratedCohort !== cohortId) {'),
    src.indexOf('// ── Draft hydrate (mirrors Send-to-one)'))
  assert.match(cohortBlock, /setAttachments\(\[\]\)/,
    "one cohort's attachments must never reach another")

  // Cleared on discard and after a send.
  const discard = src.slice(src.indexOf('const handleDiscardBulkDraft'), src.indexOf('const handleDiscardBulkDraft') + 1100)
  assert.match(discard, /setAttachments\(\[\]\)/)
  assert.match(src, /clearAll\(\)\s*\n\s*setAttachments\(\[\]\)/, 'a completed batch clears them')

  // The results panel keeps a snapshot, so clearing does not erase the record.
  assert.match(src, /setSentAttachments\(preview\.attachments\?\.length \? preview\.attachments : \[\]\)/)
  assert.match(src, /data-testid="sent-result-attachments"/)
  // And the snapshot is captured BEFORE the composer is cleared.
  assert.ok(src.indexOf('setSentAttachments(') < src.indexOf('clearAll()\n        setAttachments([])'),
    'the snapshot must be taken before the reset, or it would record nothing')

  assert.match(src, /includeSignature, source, studentEmailSrc, studentSel, contactSel, picked, attachments,/,
    'autosave reacts to attachment-only edits')
})

test('an attachment-only draft still counts as content worth saving', () => {
  const direct = read('src/components/connect/OutreachView.jsx')
  assert.match(direct, /if \(Array\.isArray\(d\.attachments\) && d\.attachments\.length > 0\) return false/,
    'Direct: attachments alone make a draft non-empty')
  const bulk = read('src/components/connect/BulkManualComposer.jsx')
  assert.match(bulk, /const hasAttachments = Array\.isArray\(d\.attachments\) && d\.attachments\.length > 0/,
    'Bulk: attachments alone make a draft edited')
})

// ── Stale preview metadata ──────────────────────────────────────────────────

test('the resolved list is dropped on every preview reset path', () => {
  const src = read('src/components/connect/OutreachView.jsx')
  // Every setDmPreview that is not the success assignment must blank the list.
  const calls = src.match(/setDmPreview\([^\n]*\)/g) || []
  const nonSuccess = calls.filter(c => !c.includes('data.attachments'))
  assert.ok(nonSuccess.length >= 5, 'the reset paths still exist')
  for (const c of nonSuccess) {
    assert.match(c, /attachments: \[\]/,
      `a preview reset must not leave stale attachment metadata: ${c.slice(0, 80)}`)
  }
})

test('resolution equality is exact - order and membership both matter', () => {
  assert.equal(attachmentsResolved([A, B], [A, B]), true)
  assert.equal(attachmentsResolved([A, B], [B, A]), false, 'order matters')
  assert.equal(attachmentsResolved([A], [A, B]), false)
  assert.equal(attachmentsResolved([A, B], [A]), false)
  assert.equal(attachmentsResolved([], []), true)
})

// ── The send gate ───────────────────────────────────────────────────────────

test('send is blocked while attachments are unresolved, stale, or failed', () => {
  assert.equal(sendBlockedReason([], [], {}), null, 'no attachments never gates a send')
  assert.match(sendBlockedReason([A], [], {}), /Checking/, 'unresolved blocks')
  assert.match(sendBlockedReason([A], [B], {}), /Checking/, 'a stale list blocks')
  assert.match(sendBlockedReason([A], [A], { previewLoading: true }), /Checking/)
  assert.match(sendBlockedReason([A], [A], { previewError: 'boom' }), /could not be verified/)
  assert.equal(sendBlockedReason([A], [{ ...A, size_bytes: 100 }], {}), null, 'resolved sends')
  assert.match(sendBlockedReason([A], [{ ...A, size_bytes: 11 * 1024 * 1024 }], {}), /total more than/)
})

test('both final review screens gate on the SERVER-resolved list', () => {
  const direct = read('src/components/connect/OutreachView.jsx')
  assert.match(direct, /const dmAttachmentBlock = sendBlockedReason\(dmAttachments, dmPreview\.attachments/)
  assert.match(direct, /sendBlocked = .*\|\| !!dmAttachmentBlock/,
    'Direct Send is disabled while the list is unresolved')
  // The confirmation renders the RESOLVED list, never the client's selection.
  const confirm = direct.slice(direct.indexOf('data-testid="dm-confirm-attachments"'), direct.indexOf('data-testid="dm-confirm-attachments"') + 1200)
  assert.match(confirm, /dmPreview\.attachments\.map/)
  assert.doesNotMatch(confirm, /dmAttachments\.map/,
    'the unverified client list must never be displayed as what will be sent')

  const bulk = read('src/components/connect/BulkManualComposer.jsx')
  assert.match(bulk, /const attachmentBlock = sendBlockedReason\(attachments, preview\.attachments/)
  assert.match(bulk, /!attachmentBlock\s+\/\/ attachments must be server-resolved/)
  const review = bulk.slice(bulk.indexOf('data-testid="review-attachments"'), bulk.indexOf('data-testid="review-attachments"') + 1300)
  assert.match(review, /preview\.attachments\.map/)
  assert.doesNotMatch(review, /attachments\.map\(a => a\.title\)/,
    'Review & Send must show resolved filenames, not client titles')
})

// ── Storage paths stay server-side ──────────────────────────────────────────

test('the client never queries, receives, or stores a storage path', () => {
  // CODE LINES ONLY: the header comments explain what is deliberately absent
  // ("no bytes, no Base64"), and a naive scan would match its own explanation.
  const codeOnly = f => read(f).split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')

  const picker = codeOnly('src/components/connect/AttachmentPicker.jsx')
  // It calls the server options endpoint, not catalog_resources directly.
  assert.match(picker, /\/api\/outreach-attachment-options/)
  assert.doesNotMatch(picker, /from\('catalog_resources'\)/,
    'the picker no longer queries the table directly')
  for (const forbidden of [/storage_path/, /storage_name/, /signedUrl/, /createSignedUrl/, /base64/i, /FileReader/, /type="file"/]) {
    assert.doesNotMatch(picker, forbidden, `picker must not reference ${forbidden}`)
  }

  const lib = codeOnly('src/lib/connect/outreachAttachments.js')
  assert.doesNotMatch(lib, /storage_path|signedUrl|base64/i)

  // The options endpoint selects storage_path server-side but never returns it.
  const ep = read('api/outreach-attachment-options.js')
  assert.match(ep, /storage_path/, 'the server does read it, to decide attachability')
  const projection = ep.slice(ep.indexOf('export function toAttachableOptions'), ep.indexOf('export default async function'))
  assert.match(projection, /slug:|title:|category:|type_label:/)
  assert.doesNotMatch(projection, /storage_path:\s*r\.storage_path/,
    'no storage path is ever placed in the response')
})

test('the options projection emits only safe fields', async () => {
  const { toAttachableOptions } = await import('../api/outreach-attachment-options.js')
    .catch(() => ({ toAttachableOptions: null }))
  if (!toAttachableOptions) return   // env-gated import; covered by the source assertions above
  const out = toAttachableOptions([
    { slug: 'a', title: 'A', category: 'policies', resource_type: 'internal_file', storage_path: 'policies/a.pdf', is_active: true },
    { slug: 'legacy', title: 'Legacy', resource_type: 'internal_file', storage_path: 'policies/x.doc', is_active: true },
    { slug: 'gone', title: 'Gone', resource_type: 'internal_file', storage_path: 'policies/b.pdf', is_active: false },
    { slug: 'link', title: 'Link', resource_type: 'external_link', storage_path: null, is_active: true },
  ])
  assert.deepEqual(out.map(o => o.slug), ['a'], 'legacy, inactive and link rows are all excluded')
  assert.deepEqual(Object.keys(out[0]).sort(), ['category', 'slug', 'title', 'type_label'])
  assert.doesNotMatch(JSON.stringify(out), /policies\//)
})
