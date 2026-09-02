// test/ngrpTransitionPreview.test.mjs
//
// NGRP-TRANSITION-PREVIEW-1: the in-app preview of the Transition Form invitation.
//
// PREVIEW EQUALS SENT is the property worth guarding. A preview that re-implements the
// copy is a second template, and the drift is invisible until a student receives
// something nobody reviewed. So the email builder was extracted out of the endpoint,
// and both the send path and the preview import that one module.
//
// The second property is that a preview of a SECURE email cannot leak the thing that
// makes it secure. A real per-recipient token exists only inside the emailed URL and
// may never round-trip through the browser; the fixture must therefore be incapable of
// showing one, not merely unlikely to.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const strip = (src) => src.replace(/^\s*\/\/[^\n]*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')

const BUILDER = 'lib/server/email/ngrpTransitionEmail.js'
const FIXTURE = 'src/lib/ngrp/transitionPreviewFixture.js'
const ENDPOINT = 'api/ngrp-transition-send.js'
const TAB = 'src/components/ngrp/ProfilesTab.jsx'

const { NGRP_TRANSITION_PREVIEW, transitionPreviewFor } = await import('../src/lib/ngrp/transitionPreviewFixture.js')

// ── Preview equals sent ──────────────────────────────────────────────────────

test('one template: the send and the preview import the same builder', () => {
  assert.match(read(ENDPOINT), /import \{ buildTransitionEmail \} from '\.\.\/lib\/server\/email\/ngrpTransitionEmail\.js'/)
  assert.match(read(FIXTURE), /import \{ buildTransitionEmail \} from '[^']*ngrpTransitionEmail\.js'/)
  // The endpoint must not have kept a copy of the copy.
  const ep = strip(read(ENDPOINT))
  assert.doesNotMatch(ep, /Congratulations again on completing ASPIRE/)
  assert.doesNotMatch(ep, /aspireEmailShell\(/, 'the endpoint no longer builds the email itself')
})

test('the builder is pure: it can be imported by the browser', () => {
  const src = strip(read(BUILDER))
  for (const forbidden of [/from 'resend'/, /supabase/i, /generateToken/, /process\.env/]) {
    assert.doesNotMatch(src, forbidden, `builder must not reach for ${forbidden}`)
  }
  // It receives the URL; it never mints one. That is what keeps token minting on the server.
  assert.match(src, /export function buildTransitionEmail\(\{ student, cycle, url, closeText \}\)/)
})

// ── The preview cannot leak a token ──────────────────────────────────────────

test('the fixture URL is obviously fake and carries no token', () => {
  const { html } = NGRP_TRANSITION_PREVIEW.render('with_close')
  assert.match(html, /sample-preview-not-a-real-link/)
  // No token-shaped value anywhere in the rendered output.
  assert.doesNotMatch(html, /token=/)
  assert.doesNotMatch(html, /\b[a-f0-9]{32,}\b/i, 'nothing token-shaped may render')
})

test('the fixture invents its recipient: no real person or email', () => {
  const src = read(FIXTURE)
  assert.match(src, /Jordan/, 'a synthetic name')
  // It must not read anything live. A preview that queried would be a preview that
  // could show a real alumnus.
  const code = strip(src)
  assert.doesNotMatch(code, /supabase|useQuery|fetch\(/)
})

// ── The cohort name is live, and that is the point ───────────────────────────

test('the preview renders the caller\'s cohort, so it cannot go stale', () => {
  // A frozen sample name is how the preview came to show "January 2027" after the
  // cohort had been renamed: it read as though the template hard-coded a cohort. The
  // template always interpolated cycle.name; only the fixture froze one.
  assert.match(transitionPreviewFor('Winter 2027').render().html, /Winter 2027/)
  assert.match(transitionPreviewFor('Summer 2028').render().html, /Summer 2028/)
  // strip(): the comment above this line explains the stale name, so the assertion has
  // to read the CODE, not the prose about it.
  assert.doesNotMatch(strip(read(FIXTURE)), /January 2027/, 'no cohort name may be frozen here again')
})

test('no cohort in scope degrades to a generic phrase, never a made-up cohort', () => {
  for (const empty of [null, undefined, '', '   ']) {
    const html = transitionPreviewFor(empty).render().html
    assert.match(html, /the upcoming residency cohort/)
    assert.doesNotMatch(html, /\b(January|Winter|Summer|Fall|Spring) 20\d\d\b/)
  }
})

test('ApplicantsTab passes the live cohort and memoizes it', () => {
  const tab = read(TAB)
  assert.match(tab, /transitionPreviewFor\(cycle\?\.name\), \[cycle\?\.name\]\)/)
  assert.match(tab, /entry=\{transitionPreview\}/)
  // A fresh object every parent render would re-render the email on every keystroke in
  // the search box above it.
  assert.doesNotMatch(tab, /entry=\{transitionPreviewFor\(/)
})

// ── Both variants render, and the copy actually forks ────────────────────────

test('both variants render, and the close-date fork is real', () => {
  const withClose = NGRP_TRANSITION_PREVIEW.render('with_close')
  const noClose = NGRP_TRANSITION_PREVIEW.render('no_close')
  for (const r of [withClose, noClose]) {
    assert.match(r.subject, /Your NGRP Transition Form/)
    assert.ok(r.html.length > 1000, 'a full shell-wrapped email')
  }
  // The variants exist because the copy genuinely differs; if it stopped differing,
  // offering two would be theatre.
  assert.match(withClose.html, /until <strong>November 5, 2026<\/strong>/)
  assert.match(noClose.html, /until the cohort closes/)
  assert.notEqual(withClose.html, noClose.html)
})

test('the default variant is a real one, so a caller passing nothing still renders', () => {
  const keys = NGRP_TRANSITION_PREVIEW.variants.map(v => v.key)
  assert.deepEqual(keys, ['with_close', 'no_close'])
  assert.ok(NGRP_TRANSITION_PREVIEW.render().html.length > 1000)
})

// ── Where the affordance lives ───────────────────────────────────────────────

test('the eye sits in the roster header, not behind a selection', () => {
  const tab = read(TAB)
  const head = tab.slice(tab.indexOf('className="ngrp-roster-head"'), tab.indexOf('className="ngrp-roster-scroll"'))
  assert.match(head, /<Eye size=\{15\} \/>/, 'the eye is in the roster head')
  assert.match(head, /aria-label="Preview the Transition Form email"/)
  // Reading what the email says must not require selecting a real alumnus first, so it
  // must NOT be inside the bulk-selection bar.
  const selbar = tab.slice(tab.indexOf('className="ngrp-selbar"'))
  assert.doesNotMatch(selbar.slice(0, 1200), /<Eye /)
})

test('the drawer footer tells the truth about a hand-sent email', () => {
  // The shared drawer says "the automation sends", which is false here: nothing
  // schedules the Transition Form. The override exists for that one sentence.
  const tab = read(TAB)
  assert.match(tab, /footNote="[^"]*sent by hand, never on a schedule/)
  // And it no longer claims the whole preview is synthetic, because the cohort is real.
  assert.match(tab, /footNote="The recipient and link are synthetic; the cohort name is your live one/)
  const drawer = read('src/components/connect/AutomationEmailPreviewDrawer.jsx')
  assert.match(drawer, /footNote = null/, 'defaulted, so existing callers are unchanged')
  assert.match(drawer, /footNote \|\| 'This preview uses synthetic data and is rendered with the same template the automation sends\.'/)
})

test('no em dash in anything this change added', () => {
  // The character below is the em dash, written as an escape so this file has none.
  const EM = String.fromCharCode(0x2014)
  for (const f of [BUILDER, FIXTURE]) assert.ok(!read(f).includes(EM), `${f} contains an em dash`)
})
