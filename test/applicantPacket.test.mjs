// APPLICANT-PACKET-1: one PDF per applicant, built in the browser.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PDFDocument } from 'pdf-lib'
import { packetDocuments, packetSummary, packetFileName } from '../src/lib/ngrp/applicantPacketModel.js'
import { buildApplicantPacket } from '../src/lib/ngrp/applicantPacketPdf.js'
import { NGRP_AUDIT_EVENTS } from '../lib/server/ngrpAudit.js'
import { EVENT_LABELS } from '../src/lib/ngrp/residencyActivityModel.js'

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const types = [
  { key: 'transcript', label: 'Transcript', required: true, sort_order: 2 },
  { key: 'resume', label: 'Résumé', required: true, sort_order: 1 },
  { key: 'statement', label: 'Personal statement', required: true, sort_order: 3 },
  { key: 'bls', label: 'BLS card', required: false, sort_order: 4 },
  { key: 'photo', label: 'Badge photo', required: false, sort_order: 5 },
]
const documents = [
  { doc_type: 'resume', current_version_id: 'v2', versions: [{ id: 'v1', file_name: 'old.pdf', content_type: 'application/pdf' }, { id: 'v2', file_name: 'resume.pdf', content_type: 'application/pdf' }] },
  { doc_type: 'statement', current_version_id: 's1', versions: [{ id: 's1', file_name: 'statement.docx', content_type: null }] },
  { doc_type: 'photo', current_version_id: 'p1', versions: [{ id: 'p1', file_name: 'me.png', content_type: 'image/png' }] },
]
const row = {
  id: 'st1', candidate_id: 'c1', student: { id: 'st1', first_name: 'Ofer', preferred_first_name: 'Abel', last_name: 'DeLeon', school: 'West Coast University', program_type: 'ABSN', aspire_cohort: 'Summer 2026' },
  interest: 'interested', form_status: 'submitted', form_submitted_at: '2026-10-01T18:00:00Z', eligibility_calculated: 'eligible',
  interview_status: 'scheduled', interview_at: '2026-12-10T17:00:00Z', assigned_unit: '6 NE',
}

test('PACKET 1: documents in checklist order, the CURRENT file, Word listed not included', () => {
  const d = packetDocuments({ types, documents })
  assert.deepEqual(d.map(x => [x.key, x.status]), [['resume', 'include'], ['transcript', 'missing'], ['statement', 'word'], ['bls', 'missing'], ['photo', 'include']])
  assert.equal(d[0].versionId, 'v2', 'the current version, not the first')
  assert.equal(d[4].kind, 'image')
  assert.equal(d[3].required, false)
})

test('PACKET 2: contact only when shared; no score, review or preceptor feedback', () => {
  const docs = packetDocuments({ types, documents })
  const shared = packetSummary({ row, cycle: { name: 'Winter 2027' }, profile: { contactShared: true, student: { personal_email: 'a@b.com', phone: '555' } }, documents: docs, now: new Date('2026-10-05T18:00:00Z') })
  const applicant = shared.sections.find(s => s.heading === 'Applicant').rows
  assert.ok(applicant.some(([l, v]) => l === 'Personal email' && v === 'a@b.com'))
  const notShared = packetSummary({ row, cycle: { name: 'Winter 2027' }, profile: { contactShared: false, student: {} }, documents: docs })
  assert.ok(notShared.sections[0].rows.some(([l, v]) => l === 'Contact' && /Transition Form/.test(v)))
  assert.ok(!notShared.sections[0].rows.some(([l]) => /email/i.test(l)))
  const app = shared.sections.find(s => s.heading === 'Application').rows
  assert.deepEqual(app.find(([l]) => l === 'Eligibility'), ['Eligibility', 'Eligible'])
  assert.deepEqual(app.find(([l]) => l === 'Paired with'), ['Paired with', '6 NE'])
  const model = read('src/lib/ngrp/applicantPacketModel.js')
  assert.doesNotMatch(model.replace(/^\/\/.*$/gm, ''), /score|review_|feedback/i, 'the packet never reads a score, review or preceptor feedback')
  assert.equal(packetFileName(row.student, { name: 'Winter 2027' }), 'Applicant Packet - DeLeon, Abel - Winter 2027.pdf')
  assert.equal(packetFileName({ last_name: 'A/B:C' }, null), 'Applicant Packet - AB C.pdf'.replace('AB C', 'ABC'))
})

test('PACKET 3: the PDF is the summary, the form, then each file\'s own pages; a bad file is named, not fatal', async () => {
  const src = await PDFDocument.create(); src.addPage(); src.addPage(); src.addPage()
  const pdfBytes = await src.save()
  const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'))
  const docs = packetDocuments({ types, documents })
  const summary = packetSummary({
    row, cycle: { name: 'Winter 2027' }, documents: docs,
    revision: { revision_number: 1, submitted_at: '2026-10-01T18:00:00Z', payload: { identity: { preferred_phone: '555' }, education: { degree_type: 'BSN' } } },
    support: [{ activity: 'town_hall', occurred_on: '2026-09-20' }],
  })
  assert.equal(summary.form.rows.length, 4, 'two answers and the two consent lines (UNIT-SHARE-CONSENT-1 added the units one)')
  const out = await buildApplicantPacket({ summary, files: new Map([['v2', pdfBytes], ['p1', png]]) })
  const back = await PDFDocument.load(out)
  assert.equal(back.getPageCount(), 1 + 1 + 3 + 1, 'summary, form, three résumé pages, one image page')
  // A file that will not load is listed, and the packet still builds.
  const broken = await buildApplicantPacket({ summary, files: new Map([['v2', new Uint8Array([1, 2, 3])], ['p1', png]]) })
  assert.equal((await PDFDocument.load(broken)).getPageCount(), 1 + 1 + 1)
})

test('PACKET 4: the button is on every binder, and the download is logged for Residency Activity', () => {
  const chart = read('src/components/ngrp/ApplicantDrawer.jsx')
  assert.match(chart, /<PacketButton row=\{row\} cycle=\{cycle\} review=\{actions\.review \|\| null\} toast=\{toast\} \/>/)
  assert.ok(NGRP_AUDIT_EVENTS.includes('packet_downloaded'))
  assert.equal(EVENT_LABELS.packet_downloaded, 'Downloaded the applicant packet')
  const manage = read('api/ngrp-manage.js')
  assert.match(manage, /'packet_downloaded',\n\]\)/)
  assert.match(manage, /eventType: 'packet_downloaded'/)
  assert.match(read('src/lib/ngrp/applicantPacketClient.js'), /postNgrpManage\('packet_downloaded'/)
  assert.match(read('src/lib/ngrp/applicantPacketClient.js'), /await import\('\.\/applicantPacketPdf'\)/, 'pdf-lib loads only on press')
})
