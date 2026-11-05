// STUDIO-1 (2026-11-05): ASPIRE Connect > Studio. The design rules, the one renderer, the send
// path's Studio branch, the records endpoint, and the migration, held here.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  BLOCKS, THEMES, sanitizeDesign, parseDesign, designProblems, makeBlock, contrastRatio, safeUrl, safeImageUrl, blankDesign,
} from '../src/lib/studio/studioBlocks.js'
import { renderStudioEmail, renderBlockRows, finishFormButtons, inlineMarkup, designFormIds } from '../src/lib/studio/renderEmail.js'
import { LAYOUTS } from '../src/lib/studio/studioLayouts.js'
import { previewFormButtons, formButtons } from '../lib/server/forms/outreachButtons.js'
import { applyMergeFields } from '../src/lib/recipientParse.js'
import { escapeHtml } from '../src/lib/htmlEscape.js'

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const FORM_ID = '11111111-2222-4333-8444-555555555555'

// ── Design rules ──────────────────────────────────────────────────────────────

test('every layout is a clean design: sanitizing it changes nothing, and it renders', () => {
  for (const l of LAYOUTS) {
    const d = l.build()
    assert.deepEqual(sanitizeDesign(d), d, `${l.key} is not already sanitized`)
    const { html, text } = renderStudioEmail(d)
    assert.match(html, /^<!doctype html>/)
    assert.ok(text.length > 20, `${l.key} has no text part`)
    assert.doesNotMatch(html, /<script/i)
  }
  const blank = blankDesign()
  assert.deepEqual(sanitizeDesign(blank), blank)
})

test('a layout never invents a link: its buttons start empty and block the send', () => {
  for (const l of LAYOUTS) {
    const d = l.build()
    for (const b of d.blocks.filter(x => x.type === 'button')) assert.equal(b.props.url, '', `${l.key} button has a link`)
    d.subject = 'Subject'
    const { blocking } = designProblems(d)
    const hasAction = d.blocks.some(b => b.type === 'button' || b.type === 'form')
    if (hasAction) assert.ok(blocking.length > 0, `${l.key} would send with an empty action`)
  }
})

test('sanitizeDesign drops unknown blocks, unknown style values and unsafe links', () => {
  const d = sanitizeDesign({
    theme: 'neon', subject: 'Hi\nthere',
    blocks: [
      { type: 'script', props: { text: 'x' } },
      { type: 'button', props: { label: 'Go', url: 'javascript:alert(1)' }, style: { bg: 'red', shape: 'blob', align: 'center' } },
      { type: 'image', props: { url: 'http://example.org/a.png', alt: 'A' } },
      { type: 'text', props: { text: 'ok', evil: '<b>' }, style: { size: 'xl' } },
      { type: 'form', props: { formId: 'not-a-uuid' } },
    ],
  })
  assert.equal(d.theme, 'navy')
  assert.equal(d.subject, 'Hi there')
  assert.deepEqual(d.blocks.map(b => b.type), ['button', 'image', 'text', 'form'])
  assert.equal(d.blocks[0].props.url, '')
  assert.equal(d.blocks[0].style.bg, 'theme')
  assert.equal(d.blocks[0].style.shape, 'rounded')
  assert.equal(d.blocks[1].props.url, '', 'an http image cannot show in a secure inbox, so it is dropped')
  assert.equal('evil' in d.blocks[2].props, false)
  assert.equal(d.blocks[2].style.size, 'm')
  assert.equal(d.blocks[3].props.formId, '')
})

test('links: https and mailto only, protocol-less addresses normalised', () => {
  assert.equal(safeUrl('https://cshs.org/apply'), 'https://cshs.org/apply')
  assert.equal(safeUrl('ngrp@cshs.org'), 'mailto:ngrp@cshs.org')
  assert.equal(safeUrl('cedars-sinai.org'), 'https://cedars-sinai.org')
  for (const bad of ['http://x.org', 'javascript:alert(1)', 'data:text/html,x', '//x.org', '']) assert.equal(safeUrl(bad), '')
  assert.equal(safeImageUrl('https://x.org/a.png'), 'https://x.org/a.png')
  assert.equal(safeImageUrl('https://x.org/a.png" onerror="x'), '')
})

test('parseDesign refuses anything that is not a design', () => {
  assert.throws(() => parseDesign('{"nope":1}'))
  assert.throws(() => parseDesign('not json'))
  assert.equal(parseDesign(JSON.stringify(blankDesign())).blocks.length, 4)
})

test('designProblems: a missing subject, a linkless button and a formless form block stop the send', () => {
  const d = sanitizeDesign({ subject: '', blocks: [makeBlock('button'), makeBlock('form'), makeBlock('image')] })
  const { blocking, warnings } = designProblems(d)
  assert.ok(blocking.some(m => /subject/i.test(m)))
  assert.ok(blocking.some(m => /Button.*needs a link/.test(m)))
  assert.ok(blocking.some(m => /Catalog form.*needs a Catalog form/.test(m)))
  assert.ok(blocking.some(m => /Image.*needs an image/.test(m)))
  assert.ok(warnings.some(m => /footer/i.test(m)))
})

// ── Contrast: every pair a theme paints text on ───────────────────────────────

test('every theme keeps every text pair at 4.5:1 or better', () => {
  for (const t of Object.values(THEMES)) {
    const pairs = [
      ['ink', 'surface'], ['muted', 'surface'], ['heading', 'surface'], ['link', 'surface'],
      ['heroInk', 'heroBg'], ['heroMuted', 'heroBg'], ['heroEyebrow', 'heroBg'],
      ['buttonInk', 'button'], ['accentInk', 'accent'], ['panelInk', 'panel'], ['muted', 'panel'],
    ]
    for (const [ink, bg] of pairs) {
      const r = contrastRatio(t[ink], t[bg])
      assert.ok(r >= 4.5, `${t.label}: ${ink} on ${bg} is ${r}:1`)
    }
  }
})

// ── The renderer ──────────────────────────────────────────────────────────────

test('every word is escaped; inline markup is the only markup', () => {
  const html = inlineMarkup('<img src=x onerror=alert(1)> **bold** *it* [ok](https://a.org?x=1&y=2) [bad](javascript:alert(1))')
  assert.doesNotMatch(html, /<img/)
  assert.match(html, /&lt;img/)
  assert.match(html, /<strong>bold<\/strong>/)
  assert.match(html, /<em>it<\/em>/)
  assert.match(html, /href="https:\/\/a\.org\?x=1&amp;y=2"/)
  assert.doesNotMatch(html, /javascript:/)
})

test('every block type renders on every theme without throwing, inside table rows', () => {
  for (const type of Object.keys(BLOCKS)) {
    for (const theme of Object.keys(THEMES)) {
      const rows = renderBlockRows(sanitizeDesign({ blocks: [makeBlock(type)] }).blocks[0], theme, { signature: { displayName: 'A B' } })
      if (rows) assert.match(rows, /^<tr>/, `${type} on ${theme} is not table rows`)
    }
  }
})

test('the email is one 600px presentation table with a phone media query and a hidden preheader', () => {
  const d = LAYOUTS[0].build(); d.preheader = 'Opens Nov 16'
  const { html } = renderStudioEmail(d)
  assert.match(html, /role="presentation" class="st-wrap" width="600"/)
  assert.match(html, /@media only screen and \(max-width:620px\)/)
  assert.match(html, /display:none;max-height:0;overflow:hidden;mso-hide:all;[^>]*>Opens Nov 16/)
})

test('merge tokens survive rendering and fill like an Outreach html body, escaped', () => {
  const d = sanitizeDesign({ subject: 'S', blocks: [makeBlock('text', { props: { text: 'Hi [First Name], from [School].' } })] })
  const { html } = renderStudioEmail(d)
  assert.ok(html.includes('[First Name]'))
  const filled = applyMergeFields(html, { firstName: escapeHtml('<Ann>'), school: escapeHtml('UCLA') })
  assert.ok(filled.includes('Hi &lt;Ann&gt;, from UCLA.'))
  assert.ok(!filled.includes('<Ann>'))
})

test('a Catalog form block becomes the Outreach form marker, and the styled button after the link is set', async () => {
  const form = makeBlock('form', { props: { formId: FORM_ID, label: 'Sign up', dueAt: '2026-12-01' } })
  const d = sanitizeDesign({ subject: 'S', blocks: [form] })
  const { html } = renderStudioEmail(d, { formMode: 'marker' })
  assert.deepEqual(formButtons(html), [{ formId: FORM_ID, dueAt: '2026-12-01', reminders: null }])
  assert.deepEqual(designFormIds(d), [FORM_ID])
  const withLink = await previewFormButtons(html, 'https://app.example.org')
  const done = finishFormButtons(withLink, d)
  assert.match(done, /<a href="https:\/\/app\.example\.org\/form"[^>]*>Sign up<\/a>/)
  assert.doesNotMatch(done, /data-aspire-block/)
  // A marker the engine never gave a link is dropped, never sent broken.
  assert.equal(finishFormButtons(html, d).includes('<a href'), false)
})

// ── The send path ─────────────────────────────────────────────────────────────

test("the bulk endpoint's Studio branch keeps every Outreach guard", () => {
  const src = read('api/connect-send-bulk-message.js')
  const gate = src.indexOf("if (!profile || !['owner', 'admin'].includes(profile.role))")
  const studioAt = src.indexOf("const isStudio = reqBodyFormat === 'studio'")
  assert.ok(gate > 0 && studioAt > gate, 'the Studio format is read only after the Owner/Admin check')
  // Studio code loads only for a Studio request, so an ordinary Outreach send never imports it.
  assert.match(src, /await import\('\.\.\/lib\/server\/studio\/studioSend\.js'\)/)
  assert.doesNotMatch(src, /^import[^\n]*studio/m)
  // The posted design is rendered by the server; from then on the body IS that rendering.
  assert.match(src, /studio = prepareStudio\(body\.body, \{ signature: senderSig\.signature, organization \}\)/)
  assert.match(src, /body\.body = studio\.markerHtml;/)
  // Blocking problems are refused before any recipient is validated or mailed.
  const refuse = src.indexOf('studio.problems.blocking.length')
  assert.ok(refuse > 0 && refuse < src.indexOf('validateBulkRecipients({'), 'blocking problems are refused before the allowlist')
  // The same allowlist, the same confirmation, the same 75 ceiling, the same form-link engine.
  assert.match(src, /const MAX_RECIPIENTS\s+= 75;/)
  assert.match(src, /body\.confirmation !== CONFIRMATION/)
  assert.match(src, /prepareFormButtons\(supabaseAdmin, bodyRaw\)/)
  assert.match(src, /\(resolvedBodyFormat === 'html' \|\| studio\) \? escapeHtml/)
  const lib = read('lib/server/studio/studioSend.js')
  assert.match(lib, /parseDesign\(raw\)/, 'the server parses the design itself')
  assert.match(lib, /formMode: 'marker'/)
})

test("Send me a test goes to the caller's own address only, and logs nothing", () => {
  const lib = read('lib/server/studio/studioSend.js')
  const fn = lib.slice(lib.indexOf('export async function sendStudioTest'))
  assert.match(fn, /const to = String\(profile\?\.email \|\| ''\)\.trim\(\)/)
  assert.match(fn, /to: \[to\]/)
  assert.doesNotMatch(fn, /recipients|recipient\b|body\./, 'a test never reads an address from the request')
  assert.doesNotMatch(lib, /notification_log|archiveSentMessage|personalizeFormButtons/)
  assert.match(fn, /createMailer\(\)/, 'through the demo mail guard')
})

test('prepareStudio refuses what is not a design, and renders form buttons as markers', async () => {
  process.env.SUPABASE_URL ||= 'https://example.supabase.co'
  const { prepareStudio } = await import('../lib/server/studio/studioSend.js')
  assert.throws(() => prepareStudio('{"x":1}', {}), /not a Studio design/)
  assert.throws(() => prepareStudio('x'.repeat(130000), {}), /too large/)
  const d = sanitizeDesign({ subject: 'S', blocks: [makeBlock('form', { props: { formId: FORM_ID } }), makeBlock('footer')] })
  const st = prepareStudio(JSON.stringify(d), { signature: { displayName: 'A' }, organization: null })
  assert.deepEqual(formButtons(st.markerHtml).map(b => b.formId), [FORM_ID])
  assert.equal(st.problems.blocking.length, 0)
  assert.match(st.textFor({ firstName: 'Ann' }), /personal link/)
})

// ── The records endpoint ──────────────────────────────────────────────────────

test('api/studio.js: Owner/Admin, one population, never deletes a design', () => {
  const src = read('api/studio.js')
  assert.match(src, /verifyOwnerAdmin\(req, supabaseAdmin\)/)
  assert.doesNotMatch(src, /from\('studio_designs'\)[^\n]*\.delete\(/)
  // Every read or change of a row is scoped to the request's population (DEMO-DATA-1).
  for (const m of src.matchAll(/from\('studio_(designs|saved_blocks)'\)\s*\.(select|update|delete)\(/g)) {
    const q = src.slice(m.index, m.index + 260)
    if (q.includes("select('id').limit(1)")) continue
    assert.match(q, /is_demo/, `not scoped to the population: ${q.slice(0, 80)}`)
  }
  assert.match(src, /is_demo: isDemo/)
  assert.match(src, /sanitizeDesign\(body\.design\)/)
})

// ── Wiring and canon ──────────────────────────────────────────────────────────

test('Connect shows Studio only to an active Owner or Admin, and loads it lazily', () => {
  const src = read('src/pages/Connect.jsx')
  assert.match(src, /const canUseStudio = canUseMessages/)
  assert.match(src, /\(onStudioPath && canUseStudio\)\s*\n\s*\? 'studio'/, 'an unauthorized path never resolves to Studio')
  assert.match(src, /canUseStudio \? \{ key: 'studio'/)
  assert.match(src, /lazyReload\(\(\) => import\('\.\.\/components\/studio\/StudioWorkspace'\)/)
})

test('the studio sheet writes no literal radius and the email column stays white in dark mode', () => {
  const css = read('src/components/studio/studio.css')
  assert.equal((css.match(/border-radius:\s*[0-9.]+px/g) || []).length, 0)
  assert.doesNotMatch(css, /\[data-theme="dark"\][^{]*\.st-email\b/)
})

test('the migration runs on Postgres: server-only tables, a design must hold blocks', async () => {
  const { PGlite } = await import('@electric-sql/pglite')
  const pg = new PGlite()
  await pg.exec(`
    DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    CREATE TABLE public.user_profiles (id uuid PRIMARY KEY);
  `)
  const sql = read('supabase/migrations/20261128000000_studio_designs.sql').replace(/NOTIFY pgrst, 'reload schema';/, '')
  await pg.exec(sql)
  await pg.exec(sql) // safe to re-run
  await pg.query(`INSERT INTO studio_designs (name, design) VALUES ('A', '{"blocks":[]}')`)
  await assert.rejects(pg.query(`INSERT INTO studio_designs (name, design) VALUES ('B', '{"theme":"navy"}')`))
  await assert.rejects(pg.query(`INSERT INTO studio_designs (name, design, status) VALUES ('C', '{"blocks":[]}', 'deleted')`))
  const grants = await pg.query(`SELECT DISTINCT grantee FROM information_schema.role_table_grants WHERE table_name IN ('studio_designs','studio_saved_blocks')`)
  assert.deepEqual(grants.rows.map(r => r.grantee).filter(g => g !== 'postgres'), ['service_role'])
  const del = await pg.query(`SELECT privilege_type FROM information_schema.role_table_grants WHERE table_name = 'studio_designs' AND grantee = 'service_role'`)
  assert.ok(!del.rows.some(r => r.privilege_type === 'DELETE'), 'a design is archived, never deleted')
  await pg.close()
})

test('a send is cut into batches of the endpoint ceiling, in order', async () => {
  const { toBatches, BATCH_MAX } = await import('../src/lib/studio/studioBatches.js')
  const src = read('api/connect-send-bulk-message.js')
  assert.equal(BATCH_MAX, Number(/const MAX_RECIPIENTS\s+= (\d+);/.exec(src)[1]))
  const list = Array.from({ length: 160 }, (_, i) => i)
  const b = toBatches(list)
  assert.deepEqual(b.map(x => x.length), [75, 75, 10])
  assert.deepEqual(b.flat(), list)
  assert.deepEqual(toBatches([]), [])
})
