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

test('the welcome is computed, role-aware, and free of prototype messaging', () => {
  // KEITH-WELCOME-1: the welcome card derives from keithWelcome.js (greeting,
  // one capability sentence, role chips) - no static bullet wall, no recital.
  assert.match(keithUi, /greetingFor\(new Date\(\), firstName\)/)
  assert.match(keithUi, /capabilityLineFor\(\{ role: userProfile\?\.role/)
  assert.match(keithUi, /chipsFor\(\{ role: userProfile\?\.role/)
  assert.doesNotMatch(keithUi, /I'm Keith, your ASPIRE assistant/, 'the recited intro is retired')
  assert.doesNotMatch(keithUi, /• Answer program, policy/, 'the bullet wall is retired')
  assert.doesNotMatch(keithUi, /◦ Static/, 'the prototype Static badge stays retired')
  assert.doesNotMatch(keithUi, /Powered by Claude/, 'the prototype footer stays retired')
  // Returning users get the light form; the flag is written on engagement.
  assert.match(keithUi, /hasSeenWelcome\(userProfile\?\.id\)/)
  assert.match(keithUi, /rememberWelcomed\(\)/)
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

test('the / menu closes on selection: a committed command never shows the palette', async () => {
  // PRODUCTION QC BUG, 2026-08-08: after selecting a skill the composer held
  // "/resume-interview-questions " - still slash-prefixed - so the menu stayed
  // open and matched the trailing space against nothing, showing "No Skill
  // matches" over a perfectly valid selection. The menu is a SEARCH surface:
  // open while choosing, closed once the token after "/" names an invocable
  // skill with a separator after it (exactly the state a selection leaves).
  //
  // KEITH-SLASH-ANYWHERE-CLIENT-1 rewrote this from a set of source pins into
  // a behavioral check. The pins asserted the exact text of the old position-0
  // implementation, which meant they held the "/" must start the message
  // assumption in place and would have had to be deleted to fix it. The
  // GUARANTEE is what matters, so that is what is asserted now.
  const { findSlashToken, filterSkills, applySlashSelection } = await import('../src/lib/slashPalette.js')
  const catalog = [{ slug: 'fixture-command', name: 'Fixture', description: '' }]
  const open = (text, caret) => !!findSlashToken(text, caret)

  for (const typed of ['/fix', 'Please use /fix']) {
    const token = findSlashToken(typed, typed.length)
    assert.equal(open(typed, typed.length), true, `menu open while choosing: ${typed}`)
    assert.deepEqual(filterSkills(catalog, token.query).map(s => s.slug), ['fixture-command'],
      'filtering matches on the command token, not on trailing arguments')
    const after = applySlashSelection(typed, token, 'fixture-command')
    assert.equal(open(after.value, after.caret), false,
      `the menu must not survive a selection: ${typed}`)
  }

  // Both the listbox and the no-matches notice render only while the menu is
  // open, so the notice can never appear after a successful selection.
  assert.match(keithUi, /\{slashMenuOpen && skillCatalog !== null && \(/)
  assert.equal((keithUi.match(/slashActive && skillCatalog !== null/g) || []).length, 0,
    'no render path keys the palette off the bare slash prefix')
  // Escape dismisses in every open state, including zero matches, and cannot
  // fall through to the panel-level Escape that closes the whole drawer. It
  // dismisses the MENU only - clearing the composer would delete a
  // mid-sentence message.
  const escapeLine = keithUi.split('\n').find(l => l.includes("e.key === 'Escape'") && l.includes('slashMenuOpen'))
  assert.ok(escapeLine, 'the slash-menu Escape branch must exist')
  assert.match(escapeLine, /e\.preventDefault\(\); e\.stopPropagation\(\);/)
  assert.ok(!escapeLine.includes("setInput('')"), 'Escape must not clear the composer')
})

test('the / menu has keyboard and mouse selection and populates the canonical command', async () => {
  assert.match(keithUi, /role="listbox"/)
  assert.match(keithUi, /ArrowDown/)
  assert.match(keithUi, /ArrowUp/)
  assert.match(keithUi, /chooseSkill\(slashMatches\[/)
  assert.match(keithUi, /onMouseDown=\{e => \{ e\.preventDefault\(\); chooseSkill\(s\); \}\}/)
  // Selection writes the canonical "/slug " command. Asserted through the
  // module rather than by pinning the setInput literal, which previously
  // encoded the whole-composer overwrite that discarded surrounding text.
  const { findSlashToken, applySlashSelection } = await import('../src/lib/slashPalette.js')
  const first = applySlashSelection('/', findSlashToken('/', 1), 'fixture-command')
  assert.equal(first.value, '/fixture-command ')
  // A typed /slug sends the canonical skill invocation.
  assert.match(keithUi, /skill_slug: skillSlug/)
})

// ── KEITH-WELCOME-1: welcome copy and orb, pinned ────────────────────────────

test('greeting follows local time of day', async () => {
  const { greetingFor } = await import('../src/lib/keithWelcome.js')
  const at = (h) => greetingFor(new Date(2026, 7, 9, h), 'Jester')
  assert.equal(at(8), 'Good morning, Jester')
  assert.equal(at(14), 'Good afternoon, Jester')
  assert.equal(at(19), 'Good evening, Jester')
  assert.equal(at(1), 'Good evening, Jester')
  assert.equal(greetingFor(new Date(2026, 7, 9, 9)), 'Good morning', 'no name, no dangling comma')
})

test('the capability line never promises what the role cannot do', async () => {
  const { capabilityLineFor } = await import('../src/lib/keithWelcome.js')
  const owner = capabilityLineFor({ isOwner: true, cohortName: 'Fall 2026' })
  assert.match(owner, /Fall 2026 students/)
  assert.match(owner, /contacts/)
  // Co-Lead holds no keith_contacts capability - the line must not offer it.
  const co = capabilityLineFor({ role: 'co-lead' })
  assert.doesNotMatch(co, /contacts/)
  assert.match(co, /placements/)
  // Interviewer holds no placement capability.
  const iv = capabilityLineFor({ role: 'interviewer' })
  assert.doesNotMatch(iv, /placements/)
  assert.match(iv, /interviews/)
  // The underscore spelling is the same role.
  assert.equal(capabilityLineFor({ role: 'co_lead' }), co)
})

test('chips are role-aware, action-oriented, and at most four', async () => {
  const { chipsFor } = await import('../src/lib/keithWelcome.js')
  const { can } = await import('../lib/server/access.js')
  for (const caller of [{ isOwner: true }, { role: 'admin' }, { role: 'co-lead' }, { role: 'interviewer' }]) {
    const chips = chipsFor(caller)
    assert.ok(chips.length >= 3 && chips.length <= 4, `${JSON.stringify(caller)}: ${chips.length} chips`)
  }
  // No drafting or cohort chips for a role without those capabilities.
  const iv = chipsFor({ role: 'interviewer' })
  assert.ok(!iv.some(c => /draft/i.test(c)), 'interviewer cannot draft cohort emails')
  assert.ok(!iv.some(c => /on campus|cohort/i.test(c)), 'interviewer sees no cohort-status chips')
  // Viewer has no Keith at all - and gets no chips.
  assert.deepEqual(chipsFor({ role: 'viewer' }), [])
  assert.equal(can({ role: 'viewer' }, 'keith_chat'), false)
})

test('the launcher agrees with the resolved role model: no orb for Viewer', () => {
  assert.match(keithUi, /userProfile\?\.role === 'viewer' && userProfile\?\.is_owner !== true\) return null/)
})

test('the orb is layered, state-bearing, and respects reduced motion', () => {
  // Layered lens system, not the old flat swirl.
  for (const cls of ['keith-orb-drift', 'keith-orb-core', 'keith-orb-lens']) {
    assert.match(keithUi, new RegExp(cls))
  }
  assert.doesNotMatch(keithUi, /keithSpin|keithGlow|keithPulse/, 'the prototype swirl is retired')
  // Thinking state quickens the same layers - state, not decoration.
  assert.match(keithUi, /\.keith-orb\.thinking \.keith-orb-drift \{ animation-duration: 3\.2s/)
  assert.match(keithUi, /orb\(60, isTyping\)/)
  assert.match(keithUi, /orb\(36, isTyping\)/)
  // Reduced motion freezes every animated layer.
  assert.match(keithUi, /@media \(prefers-reduced-motion: reduce\)/)
  const rm = keithUi.slice(keithUi.indexOf('prefers-reduced-motion'))
  assert.match(rm, /animation: none/)
})

test('the panel adapts below 440px viewports', () => {
  assert.match(keithUi, /width: 'min\(400px, calc\(100vw - 24px\)\)'/)
})
