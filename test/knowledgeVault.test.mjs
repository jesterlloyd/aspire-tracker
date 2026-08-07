// KNOWLEDGE-VAULT-1: the Markdown knowledge vault.
//
// Plan of record: docs/product/KEITH_SKILLS_KNOWLEDGE_VAULT_PLAN.md Section 2.3
// and 3.2, reconciled against production on 2026-08-07.
//
// The Knowledge Center had ZERO dedicated tests before this file: nothing pinned
// the endpoint's action surface, its authorization split, the governance
// vocabulary, or the retrieval contract. A large share of what follows is
// therefore baseline coverage for behavior that already existed and must not
// change, not just coverage of what is new.
//
// Run: node --test test/knowledgeVault.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  serializeEntryFile, parseEntryFile, entryFilename, FRONTMATTER_KEYS,
} from '../lib/server/keith/knowledgeFrontmatter.js'
import {
  extractWikilinks, buildLinkIndex, resolveWikilink, resolveBodyLinks,
  stripWikilinksForPrompt, linkKey, LINK_STATUS,
} from '../lib/server/keith/knowledgeLinks.js'
import { _internals } from '../lib/server/keith/knowledgeRetrieval.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const endpoint = read('api/knowledge-admin.js')
const migration = read('supabase/migrations/20260807000001_knowledge_vault_markdown.sql')
const retrieval = read('lib/server/keith/knowledgeRetrieval.js')

// ── Frontmatter round trip ───────────────────────────────────────────────────

test('an entry round-trips through Markdown without loss', () => {
  const entry = {
    title: 'CS-Link Access', slug: 'cs-link-access', category: 'eligibility_placement',
    state: 'active', body_format: 'markdown', aliases: ['CS Link', 'CSLink'],
    tags: ['onboarding', 'access'], precedence_rank: 10,
    source_attribution: 'ASPIRE policy', effective_date: '2026-01-01',
    expires_at: '2027-01-01', review_date: '2026-09-01', confidence: 'verified',
    version: 3,
    body: '# Heading\n\nSee [[Rotation Matching]] for details.\n',
  }
  const { data, body } = parseEntryFile(serializeEntryFile(entry))
  assert.equal(body, entry.body, 'the body must survive byte for byte')
  assert.equal(data.title, 'CS-Link Access')
  assert.deepEqual(data.aliases, ['CS Link', 'CSLink'])
  assert.deepEqual(data.tags, ['onboarding', 'access'])
  assert.equal(data.confidence, 'verified')
  assert.equal(data.precedence_rank, '10')
})

test('values that could be read as YAML structure are quoted', () => {
  // A title containing a colon is the classic frontmatter corruption: unquoted,
  // "ASPIRE: The Program" parses as a nested key.
  const file = serializeEntryFile({ title: 'ASPIRE: The Program', body: 'x' })
  assert.match(file, /title: "ASPIRE: The Program"/)
  assert.equal(parseEntryFile(file).data.title, 'ASPIRE: The Program')

  for (const tricky of ['true', 'no', '123', '- dash', '#hash', 'trailing ', '']) {
    const round = parseEntryFile(serializeEntryFile({ title: tricky || 'x', source_attribution: tricky, body: '' }))
    if (tricky !== '') assert.equal(round.data.source_attribution, tricky, `"${tricky}" must survive`)
  }
})

test('empty and null fields are omitted, never written as empty keys', () => {
  const file = serializeEntryFile({ title: 'T', body: 'b', aliases: [], tags: [], confidence: null, review_date: undefined })
  assert.doesNotMatch(file, /aliases:/)
  assert.doesNotMatch(file, /tags:/)
  assert.doesNotMatch(file, /confidence:/)
  assert.doesNotMatch(file, /review_date:/)
  assert.equal(parseEntryFile(file).body, 'b')
})

test('a file with no frontmatter parses as all body, not as an error', () => {
  const { data, body, warnings } = parseEntryFile('# Just a note\n\nNo frontmatter here.')
  assert.deepEqual(data, {})
  assert.match(body, /Just a note/)
  assert.deepEqual(warnings, ['no_frontmatter'])
})

test('unknown keys and malformed lines are reported, not silently dropped', () => {
  const { data, warnings } = parseEntryFile('---\ntitle: T\nbogus_key: v\nnot a pair\n---\nbody')
  assert.equal(data.title, 'T')
  assert.ok(warnings.includes('unknown_key:bogus_key'))
  assert.ok(warnings.some(w => w.startsWith('malformed_line:')))
})

test('block sequences and a Windows BOM both parse', () => {
  const { data } = parseEntryFile('---\ntitle: T\ntags:\n  - alpha\n  - beta\n---\nbody')
  assert.deepEqual(data.tags, ['alpha', 'beta'])
  const bom = parseEntryFile('﻿---\ntitle: B\n---\nbody')
  assert.equal(bom.data.title, 'B', 'a BOM must not break the opening fence')
})

test('filenames are filesystem-safe and stable', () => {
  assert.equal(entryFilename({ slug: 'cs-link-access' }), 'cs-link-access.md')
  assert.equal(entryFilename({ title: 'CS-Link / Access?' }), 'cs-link-access.md')
  assert.equal(entryFilename({}), 'untitled.md')
})

test('the frontmatter key list covers every column the vault persists', () => {
  for (const k of ['title', 'slug', 'category', 'state', 'body_format', 'aliases', 'tags',
    'precedence_rank', 'source_attribution', 'effective_date', 'expires_at', 'review_date', 'confidence']) {
    assert.ok(FRONTMATTER_KEYS.includes(k), `${k} must round-trip`)
  }
})

// ── Wikilinks ────────────────────────────────────────────────────────────────

const CATALOG = [
  { id: 'e1', slug: 'cs-link-access', title: 'CS-Link Access', aliases: ['CS Link', 'Account Request'], state: 'active' },
  { id: 'e2', slug: 'rotation-matching', title: 'Rotation Matching', aliases: [], state: 'active' },
  { id: 'e3', slug: 'draft-page', title: 'Draft Page', aliases: [], state: 'draft' },
  { id: 'e4', slug: 'dupe-a', title: 'Shared Name', aliases: [], state: 'active' },
  { id: 'e5', slug: 'dupe-b', title: 'Shared Name', aliases: [], state: 'active' },
]

test('links are extracted in order, deduped, with optional labels', () => {
  const links = extractWikilinks('See [[CS-Link Access]] and [[Rotation Matching|matching]]. Again [[cs link access]].')
  assert.equal(links.length, 2, 'the same target twice is one link')
  assert.equal(links[0].target, 'CS-Link Access')
  assert.equal(links[0].label, null)
  assert.equal(links[1].label, 'matching')
})

test('resolution is case- and punctuation-insensitive', () => {
  const idx = buildLinkIndex(CATALOG)
  for (const written of ['CS-Link Access', 'cs link access', 'CS_LINK_ACCESS', 'cs-link-access']) {
    assert.equal(resolveWikilink(written, idx).entry?.id, 'e1', `"${written}" must resolve`)
  }
  assert.equal(linkKey('CS-Link  Access!'), 'cs link access')
})

test('slug wins over title, and title over alias', () => {
  // 'Account Request' is e1's alias; make it another entry's slug and the slug
  // must win, because a slug is the only globally unique handle a page has.
  const idx = buildLinkIndex([...CATALOG, { id: 'e9', slug: 'account-request', title: 'Other', aliases: [], state: 'active' }])
  const r = resolveWikilink('Account Request', idx)
  assert.equal(r.entry.id, 'e9')
  assert.equal(r.matchedOn, 'slug')
})

test('an ambiguous target resolves to NOTHING rather than guessing', () => {
  const idx = buildLinkIndex(CATALOG)
  const r = resolveWikilink('Shared Name', idx)
  assert.equal(r.status, LINK_STATUS.AMBIGUOUS)
  assert.equal(r.entry, null, 'guessing would let a rename silently repoint a link')
})

test('a link to a non-existent page is broken; a self-link is not', () => {
  const idx = buildLinkIndex(CATALOG)
  assert.equal(resolveWikilink('Nope', idx).status, LINK_STATUS.BROKEN)
  assert.equal(resolveWikilink('CS-Link Access', idx, 'e1').status, LINK_STATUS.SELF)
})

test('links may point at any state; the checker reports the state', () => {
  const links = resolveBodyLinks('See [[Draft Page]].', CATALOG)
  assert.equal(links[0].status, LINK_STATUS.RESOLVED, 'linking to a draft you are about to activate is normal')
  assert.equal(links[0].targetState, 'draft', 'but the state is reported so the checker can flag it')
})

test('resolveBodyLinks returns the persisted row shape', () => {
  const [l] = resolveBodyLinks('[[Rotation Matching|see this]]', CATALOG)
  assert.deepEqual(Object.keys(l).sort(),
    ['label', 'matchedOn', 'status', 'target', 'targetEntryId', 'targetSlug', 'targetState', 'targetTitle'].sort())
  assert.equal(l.label, 'see this')
  assert.equal(l.targetEntryId, 'e2')
})

// ── Wikilinks must never reach the model ─────────────────────────────────────

test('wikilinks are stripped to prose before prompt injection', () => {
  const out = stripWikilinksForPrompt(
    'Start with [[cs-link-access]], then [[Rotation Matching|the matching page]], then [[Ghost]].',
    CATALOG)
  assert.doesNotMatch(out, /\[\[|\]\]/, 'vault syntax must never reach the model')
  assert.match(out, /CS-Link Access/, 'a bare link becomes the page TITLE, not its slug')
  assert.match(out, /the matching page/, 'a piped label wins')
  assert.match(out, /Ghost/, 'an unresolved link keeps its literal text')
})

test('the retrieval renderer strips wikilinks and the budget measures the stripped text', () => {
  _internals.setLinkCatalog(CATALOG)
  const rendered = _internals.renderEntry(
    { title: 'T', category: 'faq', body: 'See [[cs-link-access]].', precedence_rank: 5 }, 1)
  assert.doesNotMatch(rendered, /\[\[/)
  assert.match(rendered, /See CS-Link Access\./)
  _internals.setLinkCatalog([])
})

// ── Retrieval scoring: strictly additive ─────────────────────────────────────

test('alias and tag matches score, and an entry without them is unchanged', () => {
  const { scoreEntry, WEIGHTS } = _internals
  const base = { title: 'Nothing Relevant', category: 'faq', body: '', source_attribution: '' }
  const withMeta = { ...base, aliases: ['Widget'], tags: ['gadget'] }

  assert.equal(scoreEntry(base, ['widget']), 0, 'no alias, no tag, no score')
  assert.equal(scoreEntry(withMeta, ['widget']), WEIGHTS.alias)
  assert.equal(scoreEntry(withMeta, ['gadget']), WEIGHTS.tag)
  // An alias is a title the author declared, so it weighs like one.
  assert.equal(WEIGHTS.alias, WEIGHTS.title)
  assert.equal(WEIGHTS.tag, WEIGHTS.category)
})

test('scoring is STRICTLY additive: adding metadata can never lower a score', () => {
  const { scoreEntry } = _internals
  const plain = { title: 'Rotation Matching', category: 'rotations_matching', body: 'matching rules', source_attribution: '' }
  const terms = ['rotation', 'matching', 'rules']
  const before = scoreEntry(plain, terms)
  const after = scoreEntry({ ...plain, aliases: ['Matching'], tags: ['rotations'] }, terms)
  assert.ok(after >= before, 'no query may rank lower than it did before this change')
  assert.equal(scoreEntry({ ...plain, aliases: [], tags: [] }, terms), before, 'empty metadata is a no-op')
})

test('a term scores at most once per field family', () => {
  const { scoreEntry, WEIGHTS } = _internals
  const spammed = { title: 'X', category: 'faq', body: '', source_attribution: '', aliases: ['zed', 'zed extra', 'zed more'] }
  assert.equal(scoreEntry(spammed, ['zed']), WEIGHTS.alias, 'repeating an alias must not inflate rank')
})

test('BOTH hardcoded alias families and the canon boost are still in place', () => {
  // The plan retires these once real aliases exist in production. Until then,
  // removing them would regress the two query families they were written to fix.
  assert.match(retrieval, /CS_LINK_TRIGGER/)
  assert.match(retrieval, /CS_LINK_ALIASES/)
  assert.match(retrieval, /EMAIL_ROUTING_TRIGGER/)
  assert.match(retrieval, /EMAIL_ROUTING_ALIASES/)
  assert.match(retrieval, /const EMAIL_ROUTING_CANON_BOOST = 50/)
  assert.equal(_internals.EMAIL_ROUTING_CANON_BOOST, 50)
  assert.equal(_internals.EMAIL_ROUTING_CANON_SLUG, 'aspire-email-routing-communication-guidance-canon')
})

test('retrieval still selects ONLY active entries and does NOT filter on expiry', () => {
  assert.match(retrieval, /\.eq\('state', 'active'\)/)
  // Owner decision 2026-08-07: expiry is reported, never enforced. A filter here
  // would silently drop entries from Keith with no warning.
  assert.doesNotMatch(retrieval, /\.lt\('expires_at'|\.gte\('expires_at'|filter\('expires_at'/)
  assert.match(retrieval, /staleCount/, 'expiry is instrumented instead')
  assert.match(retrieval, /INSTRUMENTATION ONLY/)
})

// ── Endpoint contract ────────────────────────────────────────────────────────

test('the vault fields are accepted on every content-writing action', () => {
  assert.match(endpoint, /const VAULT_FIELDS = \['body_format', 'aliases', 'tags', 'review_date', 'confidence'\]/)
  for (const action of ['create_entry_draft', 'update_entry_draft', 'submit_entry_revision', 'update_entry_revision']) {
    const re = new RegExp(`${action}:\\s*\\[[^\\]]*\\.\\.\\.VAULT_FIELDS`)
    assert.match(endpoint, re, `${action} must accept the vault fields`)
  }
})

test('the client still cannot supply slug, state, version or an actor id', () => {
  // Scope the check to the WRITE actions. `state` is a legitimate READ filter on
  // list_entries and export_vault, so a whole-block substring search would flag
  // a filter as if it were a settable column.
  const schemas = endpoint.slice(endpoint.indexOf('const ACTION_SCHEMAS'), endpoint.indexOf('// KT-2b: lifecycle actions'))
  const writeActions = ['create_entry_draft', 'update_entry_draft', 'submit_entry_revision', 'update_entry_revision']
  for (const action of writeActions) {
    const line = schemas.split('\n').find(l => l.trim().startsWith(`${action}:`))
    assert.ok(line, `${action} must be declared`)
    for (const forbidden of ['slug', 'state', 'current_version', 'created_by', 'updated_by', 'author_id', 'editor_id']) {
      assert.ok(!line.includes(`'${forbidden}'`), `${action} must not accept ${forbidden}`)
    }
  }
  // `state` on the two READ actions is a filter, not a write.
  assert.match(endpoint, /list_entries:\s*\['action', 'state', 'category', 'tag'\]/)
  assert.match(endpoint, /export_vault:\s*\['action', 'state'\]/)
})

test('the four new actions exist and lifecycle stays Owner-only', () => {
  for (const a of ['get_entry_links', 'link_report', 'export_vault', 'import_entry_file']) {
    assert.match(endpoint, new RegExp(`${a}:\\s*\\[`), `${a} must be declared`)
  }
  // The Owner-only set is UNCHANGED: none of the new actions joined it, and
  // none of the original four left it.
  assert.match(endpoint, /const LIFECYCLE_ACTIONS = new Set\(\[\s*\n\s*'activate_entry', 'apply_entry_revision', 'restore_entry_version', 'change_entry_state',\s*\n\]\)/)
  assert.match(endpoint, /function canGovern\(role, isOwner\) \{\s*\n\s*if \(isOwner\) return true\s*\n\s*return role === 'admin'/)
})

test('an imported file always lands as a DRAFT, whatever it claims', () => {
  const block = endpoint.slice(endpoint.indexOf("case 'import_entry_file'"), endpoint.indexOf('default:'))
  assert.match(block, /state: 'draft'/)
  assert.match(block, /ALWAYS lands as a DRAFT/)
  // It must not read state or version from the file's frontmatter.
  assert.doesNotMatch(block, /state: parsed\.data\.state|current_version: parsed/)
  assert.match(block, /nextAvailableSlug/, 'the slug is server-generated, never taken from the file')
})

test('export is bounded and reports its own truncation', () => {
  assert.match(endpoint, /const MAX_EXPORT_ENTRIES = 500/)
  assert.match(endpoint, /\.limit\(MAX_EXPORT_ENTRIES\)/)
  assert.match(endpoint, /truncated: rows\.length >= MAX_EXPORT_ENTRIES/)
})

test('aliases and tags are normalized and bounded', () => {
  assert.match(endpoint, /const MAX_ALIASES = 12/)
  assert.match(endpoint, /const MAX_TAGS = 16/)
  const fn = endpoint.slice(endpoint.indexOf('function validateVaultFields'), endpoint.indexOf('* KNOWLEDGE-VAULT-1: rebuild'))
  assert.match(fn, /seen\.has\(norm\)/, 'duplicates must be rejected case-insensitively')
  assert.match(fn, /BODY_FORMATS\.includes/)
  assert.match(fn, /CONFIDENCE\.includes/)
})

test('the link index is rebuilt on every write path that changes a body', () => {
  assert.match(endpoint, /rebuildEntryLinks\(db, data\.id, row\.body/)               // create
  assert.match(endpoint, /rebuildEntryLinks\(db, body\.entry_id, body\.body !== undefined/) // update
  assert.match(endpoint, /reindexFromStoredBody\(db, body\.entry_id, requestId\)/)   // apply/restore/activate
  // The rebuild must never fail the save that produced it.
  assert.match(endpoint, /Best-effort by design/)
  assert.match(endpoint, /console\.warn\('\[knowledge-admin\] link index rebuild failed'/)
})

test('version history now resolves editor NAMES', () => {
  assert.match(endpoint, /resolveProfileNames/)
  assert.match(endpoint, /editor_name: names\.get\(v\.editor_id\) \|\| null/)
  const ui = read('src/components/settings/KnowledgeVersionHistory.jsx')
  assert.match(ui, /function editorLabel/)
  assert.match(ui, /v\?\.editor_name/)
})

test('an ACTIVE entry can be converted to Markdown through the REVISION workflow', () => {
  // Decision D-A: conversion is opt-in per entry, through the normal governed
  // revision flow. Every legacy entry is ACTIVE, and an active entry's only
  // edit path is the revision panel - so if that panel cannot carry the vault
  // fields, not one existing entry can ever be converted or tagged, and the
  // headline capability of this release is unreachable for the real corpus.
  const rev = read('src/components/settings/KnowledgeRevisionPanel.jsx')
  assert.match(rev, /import \{ TermChips, MarkdownBodyEditor, ReviewFields \} from '\.\/KnowledgeVaultFields'/)
  assert.match(rev, /<MarkdownBodyEditor/)
  assert.match(rev, /onFormatChange=\{v => set\('body_format', v\)\}/)
  // The snapshot payload must actually carry them, or the endpoint silently
  // inherits the entry's current values and the conversion is a no-op.
  const payload = rev.slice(rev.indexOf("action: editorKind === 'create'"), rev.indexOf('const res = await postAdmin(payload)'))
  for (const f of ['body_format: form.body_format', 'aliases: form.aliases', 'tags: form.tags',
    'review_date:', 'confidence:']) {
    assert.ok(payload.includes(f), `the revision snapshot must send ${f}`)
  }
  // A NEW revision seeds from the live entry, so it starts as an exact copy of
  // what is currently governed rather than blanking metadata the author never saw.
  assert.match(rev, /body_format: entry\.body_format \|\| 'plain'/)
  assert.match(rev, /aliases: Array\.isArray\(entry\.aliases\)/)
  // The old plain-only textarea is gone from the body field.
  assert.doesNotMatch(rev, /value=\{form\.body\} onChange=\{e => set\('body', e\.target\.value\)\}/)
})

test('conversion is never a direct write to an active entry', () => {
  // update_entry_draft is guarded to draft state at BOTH layers. An active
  // entry changes only through submit -> review -> apply.
  assert.match(endpoint, /if \(entry\.state !== 'draft'\) return res\.status\(409\)/)
  assert.match(endpoint, /\.eq\('state', 'draft'\)/)
  const rev = read('src/components/settings/KnowledgeRevisionPanel.jsx')
  assert.doesNotMatch(rev, /update_entry_draft/)
})

test('the review signal is REPORTED by the endpoint, never enforced', () => {
  assert.match(endpoint, /expired: !!\(e\.expires_at && String\(e\.expires_at\) < today\)/)
  assert.match(endpoint, /due_for_review: !!\(e\.review_date && String\(e\.review_date\) <= today\)/)
  assert.match(endpoint, /needs_review_count/)
  assert.match(endpoint, /`expires_at` is reported, NOT/)
})

// ── Migration safety ─────────────────────────────────────────────────────────

test('the migration is additive: no DROP, no DELETE, no UPDATE of any row', () => {
  // Strip the commented-out rollback and verification sections first; they
  // legitimately contain DROP statements as documentation.
  const live = migration.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
  assert.doesNotMatch(live, /\bDROP TABLE\b/i)
  assert.doesNotMatch(live, /\bDROP COLUMN\b/i)
  assert.doesNotMatch(live, /\bTRUNCATE\b/i)
  assert.doesNotMatch(live, /\bDROP CONSTRAINT\b/i)
  // The migration itself must issue no DML at all. The one DELETE in the file
  // is INSIDE governance_apply_knowledge_revision's body, where it has always
  // removed the revision row it just applied - pre-existing behavior that this
  // migration reproduces verbatim, not a data change the migration performs.
  const outsideFunctions = live.split(/CREATE OR REPLACE FUNCTION/)[0]
  assert.doesNotMatch(outsideFunctions, /\bDELETE FROM\b/i)
  assert.doesNotMatch(outsideFunctions, /\bUPDATE\s+public\./i)
  assert.doesNotMatch(outsideFunctions, /\bINSERT INTO\b/i)
  // And no backfill of existing bodies anywhere.
  assert.doesNotMatch(live, /UPDATE public\.knowledge_entries\s+SET body\b/i)
})

test('existing entries default to plain, so nothing re-renders or changes meaning', () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS body_format text NOT NULL DEFAULT 'plain'/)
  assert.match(migration, /body_format IN \('plain', 'markdown'\)/)
  assert.match(migration, /REWRITES NO EXISTING ROW/)
})

test('the snapshot tables gain the same fields, so restore cannot blank them', () => {
  for (const table of ['knowledge_entry_versions', 'knowledge_revisions']) {
    const block = migration.slice(migration.indexOf(`ALTER TABLE public.${table}`))
    for (const col of ['body_format', 'aliases', 'tags', 'review_date', 'confidence']) {
      assert.ok(block.includes(col), `${table} must carry ${col}`)
    }
  }
  // And the restore RPC must actually write them onto the entry.
  const restore = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.governance_restore_knowledge_version'))
  assert.match(restore, /body_format = v_ver\.body_format, aliases = v_ver\.aliases, tags = v_ver\.tags/)
})

test('exactly three RPCs are replaced, with identical signatures', () => {
  const replaced = [...migration.matchAll(/CREATE OR REPLACE FUNCTION public\.(governance_\w+)/g)].map(m => m[1])
  assert.deepEqual(replaced.sort(), [
    'governance_activate_knowledge_entry',
    'governance_apply_knowledge_revision',
    'governance_restore_knowledge_version',
  ])
  // change_state touches no content column, so replacing it would be gratuitous
  // churn on a governed production function.
  assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION public\.governance_change_knowledge_state/)
  // Security posture preserved on all three. Count in the EXECUTABLE text only:
  // the file's own header comment names these settings when explaining them.
  const live = migration.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
  assert.equal((live.match(/SECURITY INVOKER/g) || []).length, 3)
  assert.equal((live.match(/SET search_path = pg_catalog, public/g) || []).length, 3)
  assert.doesNotMatch(live, /SECURITY DEFINER/)
})

test('the new table takes the deny-all chassis; existing grants are untouched', () => {
  assert.match(migration, /ALTER TABLE public\.knowledge_links ENABLE ROW LEVEL SECURITY/)
  assert.match(migration, /REVOKE ALL ON public\.knowledge_links FROM PUBLIC, anon, authenticated/)
  assert.match(migration, /GRANT SELECT, INSERT, DELETE ON public\.knowledge_links TO service_role/)
  assert.doesNotMatch(migration, /CREATE POLICY/)
  // Tightening the THREE existing knowledge tables is a real permissions change
  // and is deliberately out of scope for this migration.
  const live = migration.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
  for (const t of ['knowledge_entries', 'knowledge_entry_versions', 'knowledge_revisions']) {
    assert.ok(!new RegExp(`REVOKE[^;]*\\bpublic\\.${t}\\b`).test(live), `${t} grants must not change here`)
    assert.ok(!new RegExp(`GRANT[^;]*\\bpublic\\.${t}\\b`).test(live), `${t} grants must not change here`)
  }
})

test('the migration carries a precheck, verification and an exact rollback', () => {
  assert.match(migration, /KNOWLEDGE VAULT PRECHECK/)
  assert.match(migration, /ROLLBACK - exact and complete/)
  assert.match(migration, /NOTIFY pgrst, 'reload schema'/)
  for (const v of ['V1.', 'V2.', 'V3.', 'V4.', 'V5.', 'V6.', 'V7.', 'V8.']) {
    assert.ok(migration.includes(v), `${v} verification step must be documented`)
  }
})

// ── Nothing else moved ───────────────────────────────────────────────────────

test('routes, IA and Keith behavior are untouched', () => {
  const sections = read('src/components/settings/settingsSections.js')
  assert.match(sections, /path: '\/settings\/keith\/knowledge'/)
  const panel = read('src/components/settings/KeithPanel.jsx')
  assert.match(panel, /const KEITH_DEFAULT_WORKSPACE = 'knowledge'/)
  const order = [...panel.matchAll(/key: '(skills|knowledge|usage)',/g)].map(m => m[1])
  assert.deepEqual(order, ['knowledge', 'skills', 'usage'], 'the alphabetical Keith IA is preserved')

  // Keith's own runtime, the skills surface and Usage & Cost are not touched.
  const keith = read('api/keith.js')
  assert.match(keith, /\[\[GOVERNED_KNOWLEDGE\]\]|GOVERNED_KNOWLEDGE/)
  assert.ok(!read('api/keith-usage.js').includes('knowledge_links'))
})

test('the markdown renderer keeps its no-raw-HTML guarantee', () => {
  const md = read('src/lib/keithMarkdown.js')
  // Strip comments first: the module's own header promises "never
  // dangerouslySetInnerHTML", which would otherwise trip this assertion.
  const code = md.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
  assert.doesNotMatch(code, /dangerouslySetInnerHTML/)
  assert.doesNotMatch(code, /innerHTML/)
  assert.match(md, /const SAFE_URL = \/\^\(https\?:/, 'link schemes stay allow-listed')
  // Wikilinks render as a span, never as an anchor with an author-controlled href.
  const wiki = md.slice(md.indexOf('if (m[1]) {'), md.indexOf("} else if (m[4]) {"))
  assert.match(wiki, /React\.createElement\('span'/)
  assert.doesNotMatch(wiki, /href/)
})
