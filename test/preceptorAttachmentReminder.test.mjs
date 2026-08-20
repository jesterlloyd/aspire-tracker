// test/preceptorAttachmentReminder.test.mjs
//
// PRECEPTOR-ATTACHMENT-REMINDER-1 - the attachment bullet, the two documents it
// promises, and the corrected Details Requested section.
//
// THE PRODUCTION DEFECT THIS FILE EXISTS TO PIN. The composer resolved the two
// promised ASPIRE Catalog documents by DISPLAY TITLE. The Catalog's brochure is
// titled "ASPIRE Digital Brochure"; the resolver only knew "ASPIRE Brochure" and
// "ASPIRE Program Brochure". So the brochure came back MISSING, ok went false,
// and one title mismatch produced BOTH live symptoms: the attachment reminder
// was suppressed and the draft carried one file instead of two.
//
// WHY THE EARLIER QC MISSED IT, IN ONE SENTENCE: every fixture invented Catalog
// rows titled "ASPIRE Brochure" - the resolver's own alias - so the tests
// asserted the alias against the alias and never met the real Catalog.
//
// So PROD_CATALOG below is the production `catalog_resources` rows verbatim, and
// every proof here runs against it. PROOF 17 is the negative control: it rebuilds
// the title-only resolver and shows it still fails on those same rows.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  buildPreceptorAssignmentDraft, PRECEPTOR_ATTACHMENT_REMINDER, STUDENT_NAME_PLACEHOLDER,
} from '../src/lib/outreachTemplates.js'
import {
  resolveRequiredAttachments, PRECEPTOR_ASSIGNMENT_DOCUMENTS, normalizeTitle,
  attachmentProblemText, attachmentWarningText, templateRefreshReason,
} from '../src/lib/connect/catalogAttachments.js'
import { buildDirectMessageEmail } from '../lib/server/connect/emailTemplates.js'
import { redactArchiveHtml } from '../api/lib/messageArchive.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = f => fs.readFileSync(path.join(root, f), 'utf8')
const strip = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/^\s*\*.*$/gm, '')

// ── The production ASPIRE Catalog, as /api/outreach-attachment-options offers it ──
// (Owner-run read-only SELECT, 2026-08-19. Only the attachable internal files
// matter here; the two required documents are the first two rows.)
const PROD_CATALOG = [
  { slug: 'aspire-digital-brochure', title: 'ASPIRE Digital Brochure', type_label: 'PDF' },
  { slug: 'general-guidelines-for-pre-licensure-students', title: 'General Guidelines for Pre-Licensure Students', type_label: 'PDF' },
  { slug: 'csmc-campus-map', title: 'CSMC Campus Map', type_label: 'PDF' },
  { slug: 'interview-scoring-sheet', title: 'Interview Scoring Sheet', type_label: 'DOCX' },
  { slug: 'scrubex-request-form', title: 'ScrubEx Request Form', type_label: 'PDF' },
  { slug: 'unit-brochure-5-scct', title: 'Unit Brochure (5 SCCT)', type_label: 'DOCX' },
]
const BROCHURE = 'aspire-digital-brochure'
const GUIDELINES = 'general-guidelines-for-pre-licensure-students'

const CANONICAL_BULLET =
  'Resources: Please see attached ASPIRE Brochure and General Guidelines for Pre-Licensure Students for your reference.'
const CANONICAL_RICH_BULLET =
  '<strong>Resources:</strong> Please see attached ASPIRE Brochure and General Guidelines for Pre-Licensure Students for your reference.'
const OBSOLETE_BULLETS = [
  'Please see the attached ASPIRE Brochure and General Guidelines for Pre-Licensure Students for your reference.',
  'Scope of practice: Please see attached ASPIRE Brochure',
]

const DETAIL_BULLETS = [
  'Your preferred name and title',
  'Preferred method of communication',
  'Best contact email and phone',
  'Unit and shift confirmation',
  'Typical schedule or upcoming shifts',
  'Optional photo to share with the student',
  "Any expectations or instructions for the student's first day",
]
const DETAILS_CLOSING =
  'The student is encouraged to contact you directly to introduce themselves, coordinate scheduling, and share their individual learning objectives.'
const DETAILS_NOTE_TITLE = 'When you have a moment'
const DETAILS_NOTE_BODY =
  'Please email us the details below so I can introduce you to your student and help make the first day as smooth as possible. Send to aspire@cshs.org, do not reply to this email.'

// The verified placement. `studentName` is the placement's own student - never
// the recipient, who is the preceptor.
// The Placement Board sends `studentNaturalName || studentName`
// (src/components/EmbedUnitCard.jsx), so the natural order is what the template
// really receives. The old roster-order fixture would not have caught a
// regression to "Tergalstanian, Chloe".
const PLACEMENT = {
  studentName: 'Chloe Tergalstanian',
  school: 'California State University, Northridge',
  unit: '5 SCCT',
  schedule: 'August 24–October 20, 2026',
  hoursRequired: '144 hours',
  notes: '',
  preceptorFirstName: 'Dana',
}
// A SECOND placement on a different unit, for the multi-unit cross-population proof.
const PLACEMENT_2 = { ...PLACEMENT, studentName: 'Tam Nguyen', unit: '3 South' }

const attached = () => buildPreceptorAssignmentDraft({ placement: PLACEMENT, attachmentsAttached: true })
const manual = () => buildPreceptorAssignmentDraft({ firstName: 'Dana', attachmentsAttached: true })
const bothPaths = () => [['handoff', attached()], ['manual', manual()]]

// ── PROOF 1: both canonical slugs resolve, against the real Catalog ─────────

test('PROOF 1: both required documents resolve from the production Catalog, by slug', () => {
  const r = resolveRequiredAttachments(PROD_CATALOG)
  assert.equal(r.ok, true, 'the production Catalog must resolve both documents')
  assert.deepEqual(r.resolved.map(a => a.slug), [BROCHURE, GUIDELINES])
  assert.deepEqual(r.resolved.map(a => a.matchedBy), ['slug', 'slug'],
    'identity is the slug - the title is only a fallback')
  assert.equal(r.problems.length, 0)

  // The slug is the identity, so a retitled row still resolves.
  const renamed = PROD_CATALOG.map(o => (o.slug === BROCHURE ? { ...o, title: 'Brochure (2027 revision)' } : o))
  assert.equal(resolveRequiredAttachments(renamed).ok, true, 'a future rename must not break resolution')

  // And the aliases still carry a row that lives under a different slug.
  const legacy = [
    { slug: 'legacy-a', title: 'ASPIRE Brochure', type_label: 'PDF' },
    { slug: 'legacy-b', title: 'Pre-Licensure Student General Guidelines', type_label: 'PDF' },
  ]
  const alt = resolveRequiredAttachments(legacy)
  assert.equal(alt.ok, true, 'title aliases remain, for backward compatibility')
  assert.deepEqual(alt.resolved.map(a => a.matchedBy), ['title', 'title'])
})

// ── PROOF 2: both attachments are selected, on both entry paths ─────────────

test('PROOF 2: both entry paths preselect exactly the two production documents', () => {
  const r = resolveRequiredAttachments(PROD_CATALOG)
  // The composer holds slug + display text only, and BOTH paths derive their
  // selection from this one resolved list (handoff: requiredDocs.resolved;
  // manual: docs.resolved in applyTemplate).
  const chips = r.resolved.map(a => ({ slug: a.slug, title: a.title, type_label: a.type_label, size_bytes: null }))
  assert.equal(chips.length, 2, 'two chips, not one')
  assert.deepEqual(chips.map(c => c.title), ['ASPIRE Digital Brochure', 'General Guidelines for Pre-Licensure Students'])
  for (const c of chips) assert.equal(c.size_bytes, null, 'size comes from the server preview, never the client')

  const src = strip(read('src/components/connect/OutreachView.jsx'))
  assert.match(src, /attachments: requiredDocs\.resolved\.map/, 'handoff seeds the chips from the resolved list')
  assert.match(src, /setDmAttachments\(docs\.resolved\.map/, 'manual apply preselects from the same list')
})

// ── PROOF 3 + 13 + 14: the corrected copy, in both bodies, on both paths ────

test('PROOF 3: the canonical bullet appears exactly once, under A Few Quick Reminders', () => {
  assert.equal(PRECEPTOR_ATTACHMENT_REMINDER, CANONICAL_BULLET,
    'the exported constant IS the requirement')
  for (const [label, d] of bothPaths()) {
    const inPlain = d.body.split(CANONICAL_BULLET).length - 1
    const inRich = d.richBody.split(CANONICAL_RICH_BULLET).length - 1
    assert.equal(inPlain, 1, `${label}: plain text must carry the bullet exactly once`)
    assert.equal(inRich, 1, `${label}: the rich body must carry it exactly once`)

    const heading = d.body.indexOf('A Few Quick Reminders')
    assert.ok(heading > 0 && d.body.indexOf(CANONICAL_BULLET) > heading,
      `${label}: the bullet must sit under the reminders heading`)
    const richHeading = d.richBody.indexOf('A Few Quick Reminders')
    assert.ok(richHeading > 0 && d.richBody.indexOf(CANONICAL_RICH_BULLET) > richHeading)
    // It is a real list item, so an editor round trip keeps it as one.
    assert.ok(d.richBody.includes('<li><strong>Resources:</strong> Please see attached ASPIRE Brochure and General Guidelines for Pre-Licensure Students for your reference.</li>'))
  }
})

test('PROOF 3b: no bullet at all when the documents are not both attached', () => {
  const d = buildPreceptorAssignmentDraft({ placement: PLACEMENT, attachmentsAttached: false })
  assert.ok(!/see (the )?attached/i.test(d.body), 'a draft never claims what it does not carry')
  assert.ok(!/see (the )?attached/i.test(d.richBody))
  assert.match(d.body, /A Few Quick Reminders/, 'the other three reminders still stand')
})

test('PROOF 13: the seven detail bullets appear once each, in the requested order', () => {
  for (const [label, d] of bothPaths()) {
    for (const rep of [['plain', d.body], ['rich', d.richBody]]) {
      const [kind, text] = rep
      const positions = DETAIL_BULLETS.map(b => {
        const count = text.split(b).length - 1
        assert.equal(count, 1, `${label}/${kind}: "${b}" appears ${count} times`)
        return text.indexOf(b)
      })
      const sorted = [...positions].sort((a, b) => a - b)
      assert.deepEqual(positions, sorted, `${label}/${kind}: the bullets are out of order`)
    }
    // NEGATIVE CONTROL: the superseded wording of two of them is gone, and the
    // two bodies no longer word the same bullet differently.
    for (const old of ['Best contact email and phone, if appropriate', 'Preferred name and title\'']) {
      assert.ok(!d.body.includes(old) && !d.richBody.includes(old), `superseded bullet survived: ${old}`)
    }
  }
})

test('PROOF 14: the Note directs the preceptor to the shared inbox, not a reply', () => {
  for (const [label, d] of bothPaths()) {
    assert.ok(d.body.includes(DETAILS_NOTE_BODY), `${label}: exact Note body missing from plain text`)
    assert.match(d.richBody, /data-aspire-block="note"[^>]+data-title="When you have a moment"/)
    assert.ok(d.richBody.includes(`data-body="${DETAILS_NOTE_BODY}"`), `${label}: exact Note body missing from rich text`)
    assert.ok(d.richBody.includes('data-mailto="aspire@cshs.org"'), `${label}: trusted inbox link missing`)
  }
})

test('PROOF 9: the corrected Details Requested section is identical on both paths', () => {
  for (const [label, d] of bothPaths()) {
    assert.match(d.body, /\nDetails Requested for the Introduction\n/, `${label}: heading`)
    assert.ok(d.richBody.includes('<h2>Details Requested for the Introduction</h2>'))
    assert.match(d.body, /\nWhen you have a moment\n/, `${label}: note title in plain text`)
    assert.ok(d.richBody.includes(`data-title="${DETAILS_NOTE_TITLE}"`))
    assert.ok(d.body.includes(DETAILS_CLOSING), `${label}: closing sentence in plain text`)
    assert.ok(d.richBody.includes(`<p>${DETAILS_CLOSING}</p>`))
    // The closing sentence follows the bullets, not the other way round.
    assert.ok(d.body.indexOf(DETAILS_CLOSING) > d.body.indexOf(DETAIL_BULLETS[6]))
  }
  // The Note sits between the section heading and the requested bullets in both bodies.
  const d = attached()
  for (const text of [d.body, d.richBody]) {
    assert.ok(text.indexOf(DETAILS_NOTE_TITLE) > text.indexOf('Details Requested for the Introduction'))
    assert.ok(text.indexOf(DETAIL_BULLETS[0]) > text.indexOf(DETAILS_NOTE_TITLE))
  }
})

// ── PROOF 10 + 11 + 12: whose student is named ─────────────────────────────

test('PROOF 10: the merged student is the placement’s own student', () => {
  const d = attached()
  assert.ok(d.body.includes('Student: Chloe Tergalstanian'))
  assert.ok(d.richBody.includes('<strong>Student:</strong> Chloe Tergalstanian'))
  // And the producer really does send the natural-order name.
  const producer = strip(read('src/components/EmbedUnitCard.jsx'))
  assert.match(producer, /studentName:\s*placement\.studentNaturalName \|\| placement\.studentName/,
    'the board hands over the natural display name, which is what this fixture uses')
  assert.ok(!d.body.includes(STUDENT_NAME_PLACEHOLDER), 'no placeholder survives a resolved placement')
})

test('PROOF 11: two placements cannot cross-populate each other’s student', () => {
  const a = buildPreceptorAssignmentDraft({ placement: PLACEMENT, attachmentsAttached: true })
  const b = buildPreceptorAssignmentDraft({ placement: PLACEMENT_2, attachmentsAttached: true })
  assert.ok(a.body.includes('Chloe Tergalstanian') && !a.body.includes('Tam Nguyen'))
  assert.ok(b.body.includes('Tam Nguyen') && !b.body.includes('Chloe Tergalstanian'))
  assert.ok(a.body.includes('Unit: 5 SCCT') && b.body.includes('Unit: 3 South'))
  // The builder is pure: nothing is carried between calls.
  const again = buildPreceptorAssignmentDraft({ placement: PLACEMENT, attachmentsAttached: true })
  assert.equal(again.body, a.body)
})

test('PROOF 12: manual selection never invents a student', () => {
  // The recipient is the PRECEPTOR. Their name must not become the student.
  const d = buildPreceptorAssignmentDraft({ firstName: 'Dana', attachmentsAttached: true })
  assert.ok(d.body.includes(`Student: ${STUDENT_NAME_PLACEHOLDER}`))
  assert.ok(!d.body.includes('Student: Dana'), 'the recipient never becomes the student')
  assert.match(d.body, /^Preceptor Assignment & Details\n\nDear Dana,/, 'Dana is the salutation, and only that')

  // And the composer warns about it before the send, from the SAME constant.
  const src = strip(read('src/components/connect/OutreachView.jsx'))
  assert.match(src, /const unresolvedStudentWarning = activeTemplateId === 'preceptor_assignment'/)
  assert.match(src, /String\(msgBody \|\| ''\)\.includes\(STUDENT_NAME_PLACEHOLDER\)/,
    'the warning tests the real body against the template’s own placeholder')
  assert.match(src, /data-testid="unresolved-student-warning"/, 'shown in the composer')
  assert.match(src, /data-testid="dm-confirm-unresolved-student"/, 'and again in Review & Send')
})

// ── PROOF 4: the superseded wordings are gone ───────────────────────────────

test('PROOF 4: both obsolete bullet versions have zero ACTIVE occurrences', () => {
  const files = [
    'src/lib/outreachTemplates.js', 'src/lib/connect/catalogAttachments.js',
    'src/components/connect/OutreachView.jsx', 'src/components/EmbedUnitCard.jsx',
    'src/components/ActionCenter.jsx', 'src/components/MatchingTab.jsx',
    'src/lib/keithKnowledge.js', 'src/lib/connect/templateRegistry.js',
    'lib/server/connect/emailTemplates.js',
  ]
  for (const f of files) {
    const src = strip(read(f))
    for (const old of OBSOLETE_BULLETS) {
      assert.ok(!src.includes(old), `a superseded bullet is still active in ${f}: ${old}`)
    }
  }
  // No builder state can emit either of them.
  for (const attachmentsAttached of [true, false]) {
    for (const args of [{ placement: PLACEMENT }, { firstName: 'Dana' }, {}]) {
      const d = buildPreceptorAssignmentDraft({ ...args, attachmentsAttached })
      for (const old of OBSOLETE_BULLETS) {
        assert.ok(!d.body.includes(old) && !d.richBody.includes(old), `builder emitted: ${old}`)
      }
    }
  }
  // The GUARD still recognizes the old phrasing, because a draft saved under it
  // is still making a claim that has to stay blocked. Recognizing is not using.
  const guard = read('src/lib/connect/catalogAttachments.js')
  assert.match(guard, /ATTACHMENT_CLAIM_FRAGMENTS = Object\.freeze\(\['see attached', 'see the attached'\]\)/)
})

// ── PROOF 5: a missing document is named the way the Catalog names it ───────

test('PROOF 5: missing-document warnings use the canonical Catalog title', () => {
  const withoutBrochure = PROD_CATALOG.filter(o => o.slug !== BROCHURE)
  const r = resolveRequiredAttachments(withoutBrochure)
  assert.equal(r.ok, false)
  assert.equal(r.problems.length, 1)
  assert.equal(r.problems[0].code, 'missing')

  const text = attachmentProblemText(r.problems[0])
  assert.match(text, /ASPIRE Digital Brochure/, 'the Owner must be sent to the file that exists')
  assert.ok(!/“ASPIRE Brochure”/.test(text), 'never name a Catalog title that has never existed')
  assert.match(attachmentWarningText(r.problems), /Attach it manually/)

  assert.deepEqual(PRECEPTOR_ASSIGNMENT_DOCUMENTS.map(d => d.label),
    ['ASPIRE Digital Brochure', 'General Guidelines for Pre-Licensure Students'])
  // The claim-block sentence is DERIVED from those labels, not hardcoded.
  const claimSrc = strip(read('src/lib/connect/catalogAttachments.js'))
  assert.match(claimSrc, /Re-attach \$\{namesOf\(required\)\}/)
  assert.ok(!claimSrc.includes('Re-attach the ASPIRE Brochure and the Pre-Licensure'),
    'the hardcoded pair of names is gone')
})

// ── PROOF 6: a stale launch context is never silent ─────────────────────────

test('PROOF 6: a context with no attachments object produces explicit problems', () => {
  // The real useMemo body, executed. `carried` is undefined exactly as it is for
  // a launch context written by a build that predates the attachments field.
  const src = read('src/components/connect/OutreachView.jsx')
  const OPEN = 'const requiredDocs = useMemo(() => {'
  const a = src.indexOf(OPEN)
  const b = src.indexOf('  }, [activePlacement])', a)
  assert.ok(a > 0 && b > a, 'the requiredDocs memo must be locatable')
  const bodySrc = src.slice(a + OPEN.length, b)
  const run = new Function('activePlacement', 'resolveRequiredAttachments', bodySrc)

  const stale = run({ recipient: { contactId: 'c1' }, placement: {} }, resolveRequiredAttachments)
  assert.equal(stale.ok, false)
  assert.equal(stale.problems.length, 2, 'BOTH documents must be reported, not silently dropped')
  assert.deepEqual(stale.problems.map(p => p.code), ['unavailable', 'unavailable'])
  assert.deepEqual(stale.problems.map(p => p.label),
    ['ASPIRE Digital Brochure', 'General Guidelines for Pre-Licensure Students'])
  // Which means a warning actually renders: the banner is driven by problems.length.
  assert.ok(attachmentWarningText(stale.problems).includes('ASPIRE Digital Brochure'))

  // NEGATIVE CONTROL: the shipped-before version returned an empty problems
  // list, so the composer had nothing to say and the bullet vanished silently.
  const broken = (carried) => (!carried ? { resolved: [], problems: [], ok: false } : carried)
  assert.equal(attachmentWarningText(broken(null).problems), '',
    'precondition: the old branch produced no warning text at all')

  // A carried answer is still used unchanged.
  const carried = run({ attachments: { resolved: [{ slug: BROCHURE }], problems: [], ok: true } }, resolveRequiredAttachments)
  assert.equal(carried.ok, true)
})

// ── PROOF 7 + 8: an obsolete saved draft is offered a refresh, never given one ──

test('PROOF 7: a one-attachment, bullet-less draft is recognized as obsolete', () => {
  const docs = resolveRequiredAttachments(PROD_CATALOG)
  // Exactly what production produced: the guidelines attached, no bullet.
  const obsoleteBody = buildPreceptorAssignmentDraft({ placement: PLACEMENT, attachmentsAttached: false }).body
  const reason = templateRefreshReason({
    body: obsoleteBody,
    selected: [{ slug: GUIDELINES }],
    docs,
    requiredBullet: CANONICAL_BULLET,
  })
  assert.ok(reason, 'the obsolete draft must be recognized')
  assert.match(reason, /a required document and the attachment reminder/)
  assert.match(reason, /available now/)

  // A CORRECT draft is left alone.
  const good = buildPreceptorAssignmentDraft({ placement: PLACEMENT, attachmentsAttached: true }).body
  assert.equal(templateRefreshReason({
    body: good, selected: [{ slug: BROCHURE }, { slug: GUIDELINES }], docs, requiredBullet: CANONICAL_BULLET,
  }), null, 'a complete draft is never nagged')

  // And nothing is offered while the documents still do not resolve - there
  // would be nothing better to refresh to.
  assert.equal(templateRefreshReason({
    body: obsoleteBody, selected: [], docs: resolveRequiredAttachments(null), requiredBullet: CANONICAL_BULLET,
  }), null)

  // An old draft carrying the SUPERSEDED bullet is obsolete too.
  assert.ok(templateRefreshReason({
    body: good.replace(CANONICAL_BULLET, OBSOLETE_BULLETS[0]),
    selected: [{ slug: BROCHURE }, { slug: GUIDELINES }], docs, requiredBullet: CANONICAL_BULLET,
  }), 'the interim wording is not the canonical wording')
})

test('PROOF 8: the refresh is OFFERED - it never replaces edits by itself', () => {
  const src = strip(read('src/components/connect/OutreachView.jsx'))
  // The button does one thing: open the branded Replace-draft confirmation.
  const i = src.indexOf('data-testid="stale-template-refresh"')
  assert.ok(i > 0, 'the offer must exist')
  const block = src.slice(i, i + 260)
  assert.match(block, /onClick=\{\(\) => setReplaceTemplateKey\('preceptor_assignment'\)\}/,
    'the offer opens the confirmation; it must not call applyTemplate directly')
  assert.ok(!/applyTemplate\(/.test(block), 'no direct application from the offer')

  // And the confirmation is the only thing that applies the template.
  assert.match(src, /setReplaceTemplateKey\(null\); applyTemplate\(k\)/,
    'application happens on confirm, with the draft still intact until then')
})

// ── PROOF 15 + 16: preview, payload, archive ───────────────────────────────

test('PROOF 15: the review step counts the SERVER-resolved attachments', () => {
  const src = strip(read('src/components/connect/OutreachView.jsx'))
  assert.match(src, /Attachments \(\{dmPreview\.attachments\.length\}\)/,
    'the count comes from what the server resolved, never the client selection')
  // Two resolved documents means two.
  assert.equal(resolveRequiredAttachments(PROD_CATALOG).resolved.length, 2)
})

test('PROOF 16: the sent HTML, the plain-text alternative and the archive all keep the corrected content', () => {
  const d = attached()

  // The exact payload the endpoint builds from the rich composer body.
  const { html } = buildDirectMessageEmail({ body: d.richBody, bodyFormat: 'html', includeSignature: true })
  assert.ok(html.includes(CANONICAL_RICH_BULLET), 'the bullet and bold label survive the server render')
  assert.ok(html.includes('Details Requested for the Introduction'))
  assert.ok(html.includes('<strong>Student:</strong> Chloe Tergalstanian'))
  for (const b of DETAIL_BULLETS) assert.ok(html.includes(b), `bullet lost in render: ${b}`)
  assert.ok(html.includes(DETAILS_CLOSING))
  assert.ok(html.includes(DETAILS_NOTE_TITLE), 'the Note title survives the server render')
  assert.ok(html.includes('href="mailto:aspire@cshs.org"'), 'the Note links the approved shared inbox')
  assert.ok(html.includes('do not reply to this email.'), 'the no-reply instruction survives the server render')

  // The plain-text alternative (rich compose OFF) carries the same content.
  const { html: textLane } = buildDirectMessageEmail({ body: d.body, bodyFormat: 'text', includeSignature: true })
  assert.ok(textLane.includes(CANONICAL_BULLET))
  assert.ok(textLane.includes('Student: Chloe Tergalstanian'))
  assert.ok(textLane.includes(DETAILS_NOTE_BODY))

  // The archive stores the very same bytes, redacted. Nothing corrected is lost,
  // and the mailto link is not neutralized (it carries no query or token).
  const archived = redactArchiveHtml(html)
  assert.ok(archived.includes(CANONICAL_RICH_BULLET), 'the archived preview keeps the bullet and bold label')
  assert.ok(archived.includes('<strong>Student:</strong> Chloe Tergalstanian'))
  assert.ok(archived.includes('href="mailto:aspire@cshs.org"'))
  assert.ok(archived.includes('do not reply to this email.'))
  for (const b of DETAIL_BULLETS) assert.ok(archived.includes(b))
})

test('PROOF 16b: a note without a mailto renders exactly as it always did', () => {
  // The link is OPT-IN. Every other Note block in the app must be untouched.
  const withOut = buildDirectMessageEmail({
    body: '<div data-aspire-block="note" data-title="T" data-body="Write to somebody@example.org today"></div>',
    bodyFormat: 'html', includeSignature: false,
  }).html
  assert.ok(!/<a href="mailto:/.test(withOut), 'addresses are never auto-detected')

  // And a mailto that does not appear in the body is not injected.
  const mismatched = buildDirectMessageEmail({
    body: '<div data-aspire-block="note" data-body="No address here" data-mailto="aspire@cshs.org"></div>',
    bodyFormat: 'html', includeSignature: false,
  }).html
  assert.ok(!/<a href="mailto:/.test(mismatched))

  // A malformed value is not linked either.
  const bogus = buildDirectMessageEmail({
    body: '<div data-aspire-block="note" data-body="Send to javascript:alert(1)" data-mailto="javascript:alert(1)"></div>',
    bodyFormat: 'html', includeSignature: false,
  }).html
  assert.ok(!/<a /.test(bogus), 'only a well-formed address is ever linked')
})

// ── PROOF 17: the negative control ─────────────────────────────────────────

test('PROOF 17: the old title-only resolver still fails on the real Catalog', () => {
  // The resolver as it shipped: titles only, label + aliases, no slugs.
  const OLD_DOCS = [
    { key: 'aspire_brochure', label: 'ASPIRE Brochure', aliases: ['ASPIRE Brochure', 'ASPIRE Program Brochure'] },
    {
      key: 'prelicensure_guidelines',
      label: 'Pre-Licensure Student General Guidelines',
      aliases: ['Pre-Licensure Student General Guidelines', 'Prelicensure Student General Guidelines',
        'Pre-Licensure Nursing Student General Guidelines', 'General Guidelines for Pre-Licensure Students'],
    },
  ]
  function titleOnlyResolve(options, required) {
    const byTitle = new Map()
    for (const o of options) {
      const norm = normalizeTitle(o.title)
      if (!byTitle.has(norm)) byTitle.set(norm, [])
      byTitle.get(norm).push(o)
    }
    const resolved = []; const problems = []
    for (const doc of required) {
      let hits = []
      for (const n of [doc.label, ...doc.aliases]) {
        const found = byTitle.get(normalizeTitle(n))
        if (found?.length) { hits = found; break }
      }
      if (hits.length !== 1) { problems.push({ key: doc.key, label: doc.label, code: 'missing' }); continue }
      resolved.push({ slug: hits[0].slug, requiredKey: doc.key })
    }
    return { resolved, problems, ok: problems.length === 0 && resolved.length === required.length }
  }

  // THE PRODUCTION FAILURE, REPRODUCED: one document resolves, one does not.
  const old = titleOnlyResolve(PROD_CATALOG, OLD_DOCS)
  assert.equal(old.ok, false, 'the old resolver must still fail - this is the defect')
  assert.deepEqual(old.resolved.map(r => r.slug), [GUIDELINES])
  assert.deepEqual(old.problems.map(p => p.key), ['aspire_brochure'])

  // Which suppressed the bullet and shipped a one-attachment draft.
  const draft = buildPreceptorAssignmentDraft({ placement: PLACEMENT, attachmentsAttached: old.ok })
  assert.ok(!draft.body.includes(CANONICAL_BULLET), 'reproduced: no attachment reminder')
  assert.equal(old.resolved.length, 1, 'reproduced: one attachment instead of two')

  // The shipped resolver, same rows, correct answer.
  assert.equal(resolveRequiredAttachments(PROD_CATALOG).ok, true)
})

test('PROOF 17b: a test that leaves the sentence in source but drops it from the payload FAILS', () => {
  // The mutation: the builder keeps ATTACHED_REMINDER defined but never pushes
  // it. A source-only test would still pass; the payload assertion must not.
  const src = read('src/lib/outreachTemplates.js')
  const mutated = src.replace('if (attachmentsAttached) reminders.push(PRECEPTOR_ATTACHMENT_REMINDER)', '')
  assert.notEqual(mutated, src, 'the mutation must apply')
  assert.ok(mutated.includes(CANONICAL_BULLET), 'the sentence is STILL in the mutated source')

  const tmp = path.join(root, 'test', `.mutant-${process.pid}.mjs`)
  fs.writeFileSync(tmp, mutated.replace("from './appUrl.js'", "from '../src/lib/appUrl.js'"))
  try {
    return import(`file://${tmp}`).then(m => {
      const d = m.buildPreceptorAssignmentDraft({ placement: PLACEMENT, attachmentsAttached: true })
      const { html } = buildDirectMessageEmail({ body: d.richBody, bodyFormat: 'html', includeSignature: false })
      assert.ok(!html.includes(CANONICAL_BULLET),
        'the payload proof catches a builder that keeps the sentence in source only')
      fs.unlinkSync(tmp)
    })
  } catch (e) {
    fs.existsSync(tmp) && fs.unlinkSync(tmp)
    throw e
  }
})

// ── Reviewer findings, pinned ───────────────────────────────────────────────

test('PROOF 18: editing the note does not delete the mailto link', () => {
  // ProseMirror's setNodeMarkup REPLACES the whole attribute set, substituting
  // each node type's DEFAULT for any key the caller omits. So a handler that
  // passes only { title, body } silently resets `mailto` to '' - and the Owner
  // merely opening the note callout and pressing Save would strip the link.
  const src = read('src/components/connect/RichTextEditor.jsx')
  const OPEN = 'const handleNoteSave = useCallback(({ title, body }) => {'
  const a = src.indexOf(OPEN)
  const b = src.indexOf('  }, [editor, noteModal.mode', a)
  assert.ok(a > 0 && b > a, 'handleNoteSave must be locatable')
  const bodySrc = src.slice(a + OPEN.length, b)

  const run = (noteModal) => {
    const calls = []
    const chain = {
      focus: () => chain,
      command: (fn) => { fn({ tr: { setNodeMarkup: (pos, t, attrs) => calls.push({ pos, attrs }) } }); return chain },
      insertAspireNote: (attrs) => { calls.push({ insert: attrs }); return chain },
      run: () => {},
    }
    const editor = { chain: () => chain }
    // `title` and `body` are the callback's own destructured arguments.
    new Function('editor', 'noteModal', 'setNoteModal', 'title', 'body', bodySrc)(
      editor, noteModal, () => {}, noteModal.title, noteModal.body)
    return calls
  }

  const edited = run({ mode: 'edit', pos: 4, title: 'When you have a moment', body: 'x', mailto: 'aspire@cshs.org' })
  assert.equal(edited.length, 1)
  assert.equal(edited[0].attrs.mailto, 'aspire@cshs.org',
    'an edit must carry the address through, not reset it to the default')

  // A hand-inserted note has no address, and none is invented.
  const inserted = run({ mode: 'insert', pos: null, title: 'T', body: 'B', mailto: '' })
  assert.deepEqual(inserted[0].insert, { title: 'T', body: 'B' })

  // The modal must be OPENED with the attribute too, or there is nothing to
  // carry back - and the NODE VIEW is the caller that supplies it. Missing
  // either half silently deletes the link, which is how this first shipped.
  assert.match(strip(src), /setNoteModal\(\{ open: true, mode: 'edit', pos, title: attrs\.title \|\| '', body: attrs\.body \|\| '', mailto: attrs\.mailto \|\| '' \}\)/)
  const nodeView = strip(read('src/components/connect/blocks/NoteNodeView.jsx'))
  assert.match(nodeView, /bridge\.requestEdit\(getPos\(\), \{ title, body, mailto \}\)/,
    'the node view must hand the address to the modal')
  assert.match(nodeView, /const mailto = node\.attrs\.mailto \|\| ''/)

  // NEGATIVE CONTROL: the pre-fix handler, which drops it.
  const broken = bodySrc.replace('{ title, body, mailto }', '{ title, body }')
  assert.notEqual(broken, bodySrc, 'the mutation must apply')
  const brokenCalls = []
  const brokenChain = {
    focus: () => brokenChain,
    command: (fn) => { fn({ tr: { setNodeMarkup: (pos, t, attrs) => brokenCalls.push(attrs) } }); return brokenChain },
    insertAspireNote: () => brokenChain, run: () => {},
  }
  new Function('editor', 'noteModal', 'setNoteModal', 'title', 'body', broken)(
    { chain: () => brokenChain },
    { mode: 'edit', pos: 4, title: 'T', body: 'x', mailto: 'aspire@cshs.org' }, () => {}, 'T', 'x')
  assert.equal(brokenCalls[0].mailto, undefined, 'precondition: the old handler dropped the address')
})

test('PROOF 19: a stale launch context RECOVERS once the Catalog answers', () => {
  // The composer's own two lines, executed. A carried answer wins; a stale
  // context (nothing carried) falls through to the fetched answer, so the
  // draft can be repaired instead of being stuck at "unavailable" forever.
  const src = read('src/components/connect/OutreachView.jsx')
  const OPEN = "const carriedDocs = activePlacement?.attachments ? requiredDocs : null"
  const a = src.indexOf(OPEN)
  assert.ok(a > 0, 'the carriedDocs line must be locatable')
  const expr = 'carriedDocs || manualDocs || resolveRequiredAttachments(null)'
  assert.ok(src.slice(a, a + 700).includes(expr), 'effectiveDocs must fall back to the fetched answer')

  const run = new Function('activePlacement', 'requiredDocs', 'manualDocs', 'resolveRequiredAttachments',
    `${OPEN}; return ${expr}`)

  const fetched = resolveRequiredAttachments(PROD_CATALOG)
  const unavailable = resolveRequiredAttachments(null)

  // Stale context, Catalog not yet fetched: explicit problems, never silence.
  const pending = run({ recipient: {} }, unavailable, null, resolveRequiredAttachments)
  assert.equal(pending.ok, false)
  assert.equal(pending.problems.length, 2)

  // Stale context, Catalog answered: RESOLVED, so chips appear and the refresh
  // offer has something to offer.
  const recovered = run({ recipient: {} }, unavailable, fetched, resolveRequiredAttachments)
  assert.equal(recovered.ok, true, 'a stale context must be able to recover')
  assert.deepEqual(recovered.resolved.map(a2 => a2.slug), [BROCHURE, GUIDELINES])
  assert.ok(templateRefreshReason({
    body: buildPreceptorAssignmentDraft({ placement: PLACEMENT, attachmentsAttached: false }).body,
    selected: [], docs: recovered, requiredBullet: CANONICAL_BULLET,
  }), 'and the refresh offer is then reachable')

  // A carried answer still wins outright - the draft was written from it.
  const carried = run({ attachments: fetched }, fetched, unavailable, resolveRequiredAttachments)
  assert.equal(carried.ok, true)

  // NEGATIVE CONTROL: the pre-fix expression pinned a stale context forever.
  const old = new Function('activePlacement', 'requiredDocs', 'manualDocs', 'resolveRequiredAttachments',
    'return activePlacement ? requiredDocs : (manualDocs || resolveRequiredAttachments(null))')
  assert.equal(old({ recipient: {} }, unavailable, fetched, resolveRequiredAttachments).ok, false,
    'precondition: the old expression ignored the fetched answer')
})
