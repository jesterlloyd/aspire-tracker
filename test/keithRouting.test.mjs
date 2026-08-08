// KEITH-GOVERNED-ROUTING-1 / KEITH-MODEL-SELECT-1 / KEITH-SLASH-SKILLS-1
//
// The Keith audit's regression suite. The failure that motivated it: "Who
// should I contact for a prelicensure group clinical request that is not an
// ASPIRE senior bedside preceptorship?" was classified person_contact_role,
// short-circuited to a deterministic Contacts search BEFORE governed retrieval
// ever ran, and returned unrelated preceptors ("preceptorship" substring-
// matched the preceptor role signal) - while the Active BNI routing directory
// was never consulted.
//
// These tests exercise the REAL modules (queryIntent, knowledgeRetrieval,
// modelRouting) and pin the real handler wiring. Entry fixtures are
// structurally real (same columns retrieval selects) but synthetic: the
// production corpus must never be committed to the repo.
//
// Run: node --test test/keithRouting.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  classifyIntent, INTENTS, isRoutingQuestion, isIdentityLookup,
  isDirectorySubjectQuery, preferGovernedRouting, GOVERNED_ROUTING_MIN_SCORE,
} from '../lib/server/keith/queryIntent.js'
import { retrieveGovernedKnowledge, isRoutingDirectoryEntry, _internals } from '../lib/server/keith/knowledgeRetrieval.js'
import {
  resolveChatSelection, allowedChatSelections, resolveRoute, requestNamesModel,
  DEFAULT_ROUTE, QUALITY_ROUTE, CHAT_SELECTIONS,
} from '../lib/server/keith/modelRouting.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const handler = read('api/keith.js')
const keithUi = read('src/components/Keith.jsx')
const knowledge = read('src/lib/keithKnowledge.js')

// Structurally-real catalog: the columns retrieval actually selects, with a
// self-declared routing directory, a strong lexical decoy (the failure shape:
// aliases matching the words the request says it is NOT), and topical entries.
const CATALOG = [
  {
    id: 'k1', slug: 'program-overview-fx', title: 'Program Overview FX', category: 'program_overview',
    body: 'The program places senior nursing students at the bedside for a preceptorship rotation. '.repeat(4),
    aliases: ['senior nursing student', 'bedside rotation', 'preceptorship'], tags: ['program'],
    source_attribution: '', precedence_rank: 100, updated_at: '2026-08-01', body_format: 'markdown', expires_at: null, review_date: null,
  },
  {
    id: 'k2', slug: 'nursing-education-routing-directory-fx', title: 'Nursing Education Routing Directory FX', category: 'faq',
    body: 'Route prelicensure group clinical requests, shadowing inquiries, and non-program education requests to the correct education contact or team. Escalation paths for placement inquiries.',
    aliases: ['routing', 'education requests'], tags: ['education-routing'],
    source_attribution: '', precedence_rank: 100, updated_at: '2026-08-01', body_format: 'markdown', expires_at: null, review_date: null,
  },
  {
    id: 'k3', slug: 'parking-fx', title: 'Student Parking Instructions FX', category: 'student_requirements',
    body: 'Students who need parking complete the parking form and bring it to the Parking Office with their badge. The designated parking location and fee are governed here.',
    aliases: ['parking', 'parking passes'], tags: ['requirements'],
    source_attribution: '', precedence_rank: 100, updated_at: '2026-08-01', body_format: 'markdown', expires_at: null, review_date: null,
  },
]
const stubDb = (rows) => ({ from: () => ({ select: () => ({ eq: async () => ({ data: rows, error: null }) }) }) })

// ── The routing gate ─────────────────────────────────────────────────────────

test('the reported failure class routes to governed knowledge, not Contacts', async () => {
  const q = 'Who should I contact for a prelicensure group clinical request that is not a senior bedside preceptorship?'
  // Still classified person_contact_role (the phrasing IS a contact ask)...
  assert.equal(classifyIntent(q), INTENTS.PERSON_CONTACT_ROLE)
  // ...but it is a routing question, not an identity or directory lookup...
  assert.equal(isRoutingQuestion(q), true)
  assert.equal(isIdentityLookup(q), false)
  assert.equal(isDirectorySubjectQuery(q), false, '"preceptorship" must not count as the "preceptors" group')
  // ...and with governed coverage it prefers the vault.
  const r = await retrieveGovernedKnowledge(stubDb(CATALOG), q)
  const top = Math.max(0, ...r.scores)
  assert.ok(preferGovernedRouting({ question: q, topScore: top }), `gate opens at score ${top}`)
  // The routing directory holds its guaranteed seat even when a lexical decoy
  // (aliases = the words the request says it is NOT) outscores it.
  assert.ok(r.block.includes('Nursing Education Routing Directory FX'), 'the directory reaches the model')
})

test('named person lookups stay with Contacts, whatever the vault scores', () => {
  for (const q of [
    "Find Arturo Gomez's contact information",
    'who is Marisol Vega',
    'look up jane.doe@cshs.org',
  ]) {
    assert.equal(preferGovernedRouting({ question: q, topScore: 999 }), false, q)
  }
})

test('role-directory queries stay with Contacts', () => {
  for (const q of [
    'Show me the preceptors for PACU',
    'Who is the NPD practitioner for 6 South?',
    'unit leaders for 6 Southwest',
    'Who is the school coordinator for West Coast University?',
  ]) {
    assert.equal(preferGovernedRouting({ question: q, topScore: 999 }), false, q)
  }
})

test('a routing question without governed coverage still falls back to Contacts', () => {
  assert.equal(preferGovernedRouting({
    question: 'Who should I contact for cafeteria catering requests?',
    topScore: GOVERNED_ROUTING_MIN_SCORE - 1,
  }), false)
})

test('routing directories are self-declared by title or tag - no slug in code', () => {
  assert.equal(isRoutingDirectoryEntry({ title: 'BNI Nursing Education Structure and Routing Directory', tags: [] }), true)
  assert.equal(isRoutingDirectoryEntry({ title: 'Anything', tags: ['bni-routing'] }), true)
  // The Email Routing Canon governs channels, not who-handles-what.
  assert.equal(isRoutingDirectoryEntry({ title: 'ASPIRE Email Routing & Communication Guidance Canon', tags: ['communication-governance'] }), false)
  const src = read('lib/server/keith/knowledgeRetrieval.js')
  assert.doesNotMatch(src, /bni-nursing-education-structure/, 'no directory slug is hardcoded')
})

test('handler wiring: retrieval runs BEFORE the contacts short-circuit and is reused', () => {
  const gateAt = handler.indexOf('const governed = await retrieveGovernedKnowledge')
  const shortCircuitAt = handler.indexOf('answerPersonContactQuery(')
  assert.ok(gateAt > -1 && gateAt < shortCircuitAt, 'retrieval precedes the short-circuit')
  assert.match(handler, /isPersonContactRole && !governedRouting/)
  assert.match(handler, /preferGovernedRouting\(\{ question: lastUserText, topScore: governedTopScore \}\)/)
  // Retrieval is computed exactly once.
  assert.equal(handler.split('await retrieveGovernedKnowledge(').length - 1, 1)
  // The contacts role gate is unchanged: contacts DATA access is not widened.
  assert.match(handler, /\['owner', 'admin', 'interviewer'\]\.includes\(normalizedRole\)/)
})

// ── Source-of-truth state gating ─────────────────────────────────────────────

test('only Active entries can enter the governed block; skills load active+enabled only', () => {
  const retrievalSrc = read('lib/server/keith/knowledgeRetrieval.js')
  assert.match(retrievalSrc, /\.eq\('state', 'active'\)/)
  const skills = read('lib/server/keith/skillRuntime.js')
  assert.match(skills, /\.eq\('status', 'active'\)/)
  assert.match(skills, /\.eq\('enabled', true\)/)
  // Load-time re-check: a skill disabled between catalog and invocation is refused.
  assert.match(skills, /data\.status !== 'active' \|\| data\.enabled !== true/)
})

test('conflicting sources: the prompt names governed entries as the authority', () => {
  const src = read('lib/server/keith/knowledgeRetrieval.js')
  assert.match(src, /AUTHORITATIVE ASPIRE SOURCE OF TRUTH/)
  assert.match(knowledge, /Authoritative ASPIRE guidance comes ONLY from the GOVERNED KNOWLEDGE block/)
})

// ── Stale terminology retired ────────────────────────────────────────────────

test('the "future capability" Contacts posture is retired; routing precedence is stated', () => {
  assert.doesNotMatch(knowledge, /future capability/)
  assert.match(knowledge, /WHERE-TO-DIRECT questions are different/)
  assert.match(knowledge, /routing directory\) covers who handles a kind of request, answer from that governed entry/)
})

test('the welcome and empty state describe current capabilities in current terms', () => {
  assert.match(keithUi, /governed Knowledge Center/)
  assert.match(keithUi, /Type \/ to use a Skill/)
  assert.doesNotMatch(keithUi, /◦ Static/, 'the prototype Static badge is retired')
  assert.doesNotMatch(keithUi, /Powered by Claude/, 'the prototype footer is retired')
  assert.match(knowledge, /Who handles a school placement request\?/)
})

// ── Model selection ──────────────────────────────────────────────────────────

test('Auto preserves existing routing exactly', () => {
  const auto = resolveChatSelection('auto', { role: 'interviewer', isOwner: false })
  const legacy = resolveRoute(DEFAULT_ROUTE)
  assert.equal(auto.model, legacy.model)
  assert.equal(auto.route.temperature, legacy.temperature)
  assert.equal(auto.downgraded, false)
  // Absent/garbage selections are Auto too - never an error, never an upgrade.
  assert.equal(resolveChatSelection(undefined, {}).model, legacy.model)
  assert.equal(resolveChatSelection('gpt-9', {}).selection, 'auto')
})

test('Sonnet is allowlisted server-side: Owner/Admin only, others downgrade', () => {
  const owner = resolveChatSelection('sonnet', { role: 'owner', isOwner: true })
  assert.equal(owner.model, resolveRoute(QUALITY_ROUTE).model)
  const admin = resolveChatSelection('sonnet', { role: 'admin', isOwner: false })
  assert.equal(admin.downgraded, false)
  const interviewer = resolveChatSelection('sonnet', { role: 'interviewer', isOwner: false })
  assert.equal(interviewer.downgraded, true)
  assert.equal(interviewer.model, resolveRoute(DEFAULT_ROUTE).model, 'downgrade lands on the default, never errors')
  assert.deepEqual(allowedChatSelections({ role: 'interviewer', isOwner: false }), ['auto', 'haiku'])
  assert.deepEqual(allowedChatSelections({ role: 'admin', isOwner: false }), ['auto', 'haiku', 'sonnet'])
})

test('the selection is an abstraction: no client model id, tamper guard intact', () => {
  assert.deepEqual(Object.keys(CHAT_SELECTIONS).sort(), ['auto', 'haiku', 'sonnet'])
  assert.equal(requestNamesModel({ chat_model: 'sonnet' }), false, 'chat_model is the sanctioned field')
  assert.equal(requestNamesModel({ model: 'claude-opus-5' }), true, 'raw model keys are still tampering')
  // The handler honors the resolved route and records the truth.
  assert.match(handler, /const route = chatRoute \|\| resolveRoute\(DEFAULT_ROUTE_NAME\)/)
  assert.match(handler, /model: chatSelection\.model, modelRoute: chatSelection\.route\.route/)
  assert.match(handler, /inputTokens: usage\?\.input, outputTokens: usage\?\.output/)
})

test('QUALITY route and enrichment are untouched by chat selection', () => {
  const enrich = read('api/knowledge-enrich.js')
  assert.match(enrich, /resolveRoute\(QUALITY_ROUTE\)/)
  assert.doesNotMatch(enrich, /resolveChatSelection/)
  assert.equal(resolveRoute(QUALITY_ROUTE).model, 'claude-sonnet-4-5-20250929')
})

// ── Slash skills ─────────────────────────────────────────────────────────────

test('the / menu is fed by the canonical registry through the same authorization filter', () => {
  assert.match(handler, /mode === 'skills_catalog'/)
  assert.match(handler, /loadInvocableSkills\(makeServiceRoleClient\(\), auth\)/)
  // Metadata only - instruction bodies never travel to the client.
  assert.doesNotMatch(handler.slice(handler.indexOf("skills_catalog"), handler.indexOf("skills_catalog") + 600), /instruction_body/)
  // The client fetches on demand and keeps no second catalog.
  assert.match(keithUi, /mode: 'skills_catalog'/)
  assert.doesNotMatch(keithUi, /resume-interview-questions/, 'no skill slug is hardcoded in the UI')
})

test('the / menu closes on selection: a committed command never shows the palette', () => {
  // PRODUCTION QC BUG, 2026-08-08: after selecting a skill the composer held
  // "/resume-interview-questions " - still slash-prefixed - so the menu stayed
  // open and matched the trailing space against nothing, showing "No Skill
  // matches" over a perfectly valid selection. The menu is a SEARCH surface:
  // open while choosing, closed once the token after "/" names an invocable
  // skill with a separator after it (exactly the state a selection leaves).
  assert.match(keithUi, /const slashCommitted = slashActive && \/\\s\/\.test\(slashBody\)/)
  assert.match(keithUi, /skillCatalog\.some\(s => s\.slug === slashToken\)/)
  assert.match(keithUi, /const slashMenuOpen = slashActive && !slashCommitted/)
  // Both the listbox and the no-matches notice render only while the menu is
  // open, so the notice can never appear after a successful selection.
  assert.match(keithUi, /\{slashMenuOpen && skillCatalog !== null && \(/)
  assert.equal((keithUi.match(/slashActive && skillCatalog !== null/g) || []).length, 0,
    'no render path keys the palette off the bare slash prefix')
  // Escape dismisses in every open state, including zero matches, and cannot
  // fall through to the panel-level Escape that closes the whole drawer.
  assert.match(keithUi, /if \(slashMenuOpen && e\.key === 'Escape'\) \{ e\.preventDefault\(\); e\.stopPropagation\(\); setInput\(''\); return; \}/)
  // Filtering matches on the command token, not on trailing arguments.
  assert.match(keithUi, /s\.slug\.toLowerCase\(\)\.includes\(slashToken\)/)
})

test('the / menu has keyboard and mouse selection and populates the canonical command', () => {
  assert.match(keithUi, /role="listbox"/)
  assert.match(keithUi, /ArrowDown/)
  assert.match(keithUi, /ArrowUp/)
  assert.match(keithUi, /applySlashSelection\(slashMatches\[/)
  assert.match(keithUi, /onMouseDown=\{e => \{ e\.preventDefault\(\); applySlashSelection\(s\); \}\}/)
  assert.match(keithUi, /setInput\(`\/\$\{skill\.slug\} `\)/)
  // A typed /slug sends the canonical skill invocation.
  assert.match(keithUi, /skill_slug: skillSlug/)
})
