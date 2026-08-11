// KEITH-SKILL-HELP-1: asking about a skill answers from the registry, and never
// runs it.
//
// Reported defect: an Interviewer asked "How do I use /resume-interview-questions?"
// and Keith said it had no documentation for that command - for a skill that
// caller is authorized to run. Root causes, both proven below:
//   A. base Keith never receives the catalogue, and the hyphenated slug does
//      not match the space-separated trigger phrases, so nothing resolved;
//   B. the same question WITHOUT slashes matches a trigger phrase as a
//      substring, so asking for help executed the skill.
// Run: node --test test/keithSkillHelp.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  detectSkillHelp, hasHelpIntent, extractSlashSlugs,
  buildSkillHelpResponse, buildSkillUnavailableResponse,
} from '../lib/server/keith/skillHelp.js'
import { selectSkill } from '../lib/server/keith/skillRuntime.js'
import { authorizeSkillForCaller } from '../lib/server/keith/skillAuthorization.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

// The production skill, as registered. allowed_roles and classification are the
// registry's, not this test's assumption.
const RIQ = {
  id: 'skill-riq', slug: 'resume-interview-questions',
  display_name: 'Resume Interview Questions',
  description: 'Creates three resume-grounded interview questions across the approved ASPIRE domains.',
  status: 'active', enabled: true, version: 1,
  allowed_roles: ['admin', 'co-lead', 'interviewer'],
  required_data: ['student_profile_read', 'student_resume_read'],
  trigger_phrases: ['resume interview questions', 'use resume interview questions'],
  data_classification: 'confidential', model_route: 'default',
  io_contract: {
    input: { student: 'one canonically resolved student' },
    output: {
      domains: ['Clinical Judgment', 'Professional Presence', 'Goal Alignment'],
      per_domain: ['Question', 'Resume basis'],
    },
  },
}
// A second, non-confidential skill proves nothing is hardcoded to RIQ.
const IMPORTED = {
  id: 'skill-imp', slug: 'cohort-summary', display_name: 'Cohort Summary',
  description: 'Summarizes a cohort at a glance.',
  status: 'active', enabled: true, version: 3,
  allowed_roles: ['admin', 'co-lead', 'interviewer'],
  trigger_phrases: ['cohort summary'], data_classification: 'internal',
  io_contract: { input: { cohort: 'the active cohort' }, output: ['headline counts', 'notable changes'] },
}
const DRAFT = { ...RIQ, id: 'skill-draft', slug: 'draft-only', display_name: 'Draft Only', status: 'draft', enabled: false }

// The caller's invocable list, exactly as loadInvocableSkills builds it.
const invocableFor = (caller, all = [RIQ, IMPORTED, DRAFT]) =>
  all.filter(s => authorizeSkillForCaller(s, caller).ok)

const INTERVIEWER = { role: 'interviewer', isOwner: false }
const OWNER = { role: 'owner', isOwner: true }
const VIEWER = { role: 'viewer', isOwner: false }

test('THE REPORTED CASE: Interviewer asks how to use the slug and gets real usage', () => {
  const skills = invocableFor(INTERVIEWER)
  const help = detectSkillHelp('How do I use /resume-interview-questions?', skills)
  assert.ok(help, 'the question must be recognized as a help request')
  assert.equal(help.skill?.slug, 'resume-interview-questions')
  assert.equal(help.matchedBy, 'slash_slug')

  const answer = buildSkillHelpResponse(help.skill)
  assert.match(answer, /Resume Interview Questions/)
  assert.match(answer, /\/resume-interview-questions/)          // how to invoke
  assert.match(answer, /three resume-grounded interview questions/i) // what it does
  assert.match(answer, /What it needs from you/)                 // input expectations
  assert.match(answer, /one canonically resolved student/)
  assert.match(answer, /What you get back/)
  assert.match(answer, /Clinical Judgment/)
  // The old failure mode must be impossible.
  assert.ok(!/not familiar|no documentation|ask the ASPIRE Owner/i.test(answer))
})

test('asking for help does NOT execute the skill - in either phrasing', () => {
  const skills = invocableFor(INTERVIEWER)

  // Slug phrasing: previously fell through to base Keith.
  assert.ok(detectSkillHelp('How do I use /resume-interview-questions?', skills))

  // Phrase phrasing: previously EXECUTED, because the trigger matched.
  const phrased = 'How do I use resume interview questions?'
  assert.ok(selectSkill(skills, { requestedSlug: null, userText: phrased }),
    'sanity: this phrasing really would have been selected for execution')
  const help = detectSkillHelp(phrased, skills)
  assert.ok(help && help.skill, 'help must claim the turn first')
  assert.equal(help.matchedBy, 'trigger_phrase')

  // The endpoint must consult help BEFORE selectSkill, and skip it when the
  // picker sent an explicit slug.
  const api = read('api/keith.js')
  assert.ok(api.indexOf('detectSkillHelp(') < api.indexOf('selectSkill(invocable'),
    'help resolution must precede skill selection')
  assert.match(api, /if \(!skillRequested\) \{/)
})

test('a real invocation is never hijacked by the help path', () => {
  const skills = invocableFor(INTERVIEWER)
  // No help intent -> help declines, execution proceeds as before.
  for (const text of [
    'use resume interview questions for Nathalie Imamoto',
    'resume interview questions for Sam Rivera',
  ]) {
    assert.equal(detectSkillHelp(text, skills), null, `must not intercept: ${text}`)
    assert.ok(selectSkill(skills, { requestedSlug: null, userText: text }), 'still executes')
  }
})

test('explicit picker invocation always executes, never documents', () => {
  const api = read('api/keith.js')
  // The help block is guarded on !skillRequested, so a picker slug goes straight
  // to selection.
  const helpBlock = api.slice(api.indexOf('KEITH-SKILL-HELP-1: documentation'), api.indexOf('const selected = selectSkill'))
  assert.match(helpBlock, /if \(!skillRequested\)/)
})

test('unauthorized roles get no instructions and no existence oracle', () => {
  // A viewer may reach no skill at all (storage-level and predicate-level).
  const viewerSkills = invocableFor(VIEWER)
  assert.equal(viewerSkills.length, 0)
  const help = detectSkillHelp('How do I use /resume-interview-questions?', viewerSkills)
  assert.ok(help, 'still recognized as a help turn')
  assert.equal(help.skill, null, 'but resolves to nothing')

  const answer = buildSkillUnavailableResponse(help.ref, viewerSkills)
  assert.match(answer, /do not have a skill called/)
  // Nothing confidential leaks: no name, no description, no contract, no
  // confirmation the skill exists.
  assert.ok(!/Resume Interview Questions/.test(answer))
  assert.ok(!/Clinical Judgment|resume-grounded|canonically resolved/.test(answer))
  assert.ok(!/exists|disabled|draft|not authorized|permission/i.test(answer),
    'the reason must not distinguish unauthorized from nonexistent')
})

test('the unavailable answer is identical for unknown, draft, and unauthorized', () => {
  // Same caller, three different underlying reasons -> one indistinguishable reply.
  const skills = invocableFor(INTERVIEWER)
  const unknown = buildSkillUnavailableResponse('no-such-skill', skills)
  const draft = buildSkillUnavailableResponse('draft-only', skills)
  assert.equal(unknown.replace('no-such-skill', 'X'), draft.replace('draft-only', 'X'))
})

test('draft/disabled skills are never described as available', () => {
  const skills = invocableFor(INTERVIEWER)
  assert.ok(!skills.some(s => s.slug === 'draft-only'), 'draft is filtered from the invocable list')
  const help = detectSkillHelp('What does /draft-only do?', skills)
  assert.equal(help.skill, null)
  // And it must not appear in the directory the fail-closed answer prints.
  assert.ok(!/draft-only/.test(buildSkillUnavailableResponse('x', skills).replace('`/x`', '')))
})

test('imported/non-confidential skills work through the same mechanism', () => {
  const skills = invocableFor(INTERVIEWER)
  const help = detectSkillHelp('what does /cohort-summary do?', skills)
  assert.equal(help.skill?.slug, 'cohort-summary')
  const answer = buildSkillHelpResponse(help.skill)
  assert.match(answer, /Cohort Summary/)
  assert.match(answer, /headline counts/)
  // The confidentiality note belongs only to confidential skills.
  assert.ok(!/protected student information/.test(answer))
  assert.match(buildSkillHelpResponse(RIQ), /protected student information/)
})

test('Owner is implicit: no allowed_roles entry needed', () => {
  const ownerOnlyByOmission = { ...IMPORTED, slug: 'owner-tool', allowed_roles: [] }
  assert.equal(authorizeSkillForCaller(ownerOnlyByOmission, OWNER).ok, true)
  assert.equal(authorizeSkillForCaller(ownerOnlyByOmission, INTERVIEWER).ok, false)
  const help = detectSkillHelp('how do I use /owner-tool?', invocableFor(OWNER, [ownerOnlyByOmission]))
  assert.equal(help.skill?.slug, 'owner-tool')
})

test('all three question forms resolve', () => {
  const skills = invocableFor(INTERVIEWER)
  for (const q of [
    'How do I use /resume-interview-questions?',
    'What does /resume-interview-questions do?',
    'When should I use /resume-interview-questions?',
  ]) {
    const h = detectSkillHelp(q, skills)
    assert.equal(h?.skill?.slug, 'resume-interview-questions', `failed for: ${q}`)
  }
})

test('help turns record no skill invocation and spend no model tokens', () => {
  const api = read('api/keith.js')
  const block = api.slice(api.indexOf('KEITH-SKILL-HELP-1: documentation'), api.indexOf('const selected = selectSkill'))
  assert.ok(!/recordSkillInvocation/.test(block), 'a help lookup is not an invocation')
  assert.ok(!/anthropic|messages\.create/i.test(block), 'no model call on the help path')
  assert.match(block, /return res\.status\(200\)\.json\(/)
})

test('non-skill questions still reach base Keith', () => {
  const skills = invocableFor(INTERVIEWER)
  for (const q of ['How do I use ASPIRE?', 'what is the midpoint threshold?', 'explain the rotation schedule']) {
    assert.equal(detectSkillHelp(q, skills), null, `must not intercept: ${q}`)
  }
})

test('help-intent and slug extraction behave', () => {
  assert.ok(hasHelpIntent('How do I use /x?'))
  assert.ok(hasHelpIntent('when should I use this'))
  assert.ok(!hasHelpIntent('run it for Sarah'))
  assert.deepEqual(extractSlashSlugs('try /alpha-one and /beta.two'), ['alpha-one', 'beta.two'])
})

test('the help path reads no instruction body', () => {
  const src = read('lib/server/keith/skillHelp.js')
  assert.ok(!/instruction_body/.test(src),
    'documentation is built from metadata; the confidential prompt is never surfaced')
  const api = read('api/keith.js')
  const block = api.slice(api.indexOf('KEITH-SKILL-HELP-1: documentation'), api.indexOf('const selected = selectSkill'))
  assert.ok(!/loadSkillInstructions/.test(block))
})

test('the Vault entry keeps the registry authoritative, not a stale list', () => {
  const doc = read('docs/knowledge/keith-skills-slash-commands.md')
  // Mechanics the entry must teach.
  assert.match(doc, /Type `\/` in the Keith message box/)
  assert.match(doc, /How do I use \/resume-interview-questions\?/)
  assert.match(doc, /What does \/resume-interview-questions do\?/)
  assert.match(doc, /When should I use \/resume-interview-questions\?/)
  assert.match(doc, /role-aware/)
  assert.match(doc, /Asking about a skill never runs it|never runs it, so you can read the documentation first/)
  // Non-disclosure rules.
  assert.match(doc, /deliberately the same whether the command does not exist, is still in draft/)
  assert.match(doc, /Reveal a skill's internal operating instructions/)
  // The registry stays the catalogue; the entry must not enumerate skills.
  assert.match(doc, /Skills registry in the application is authoritative/)
  assert.match(doc, /deliberately does not list them/)
  const body = doc.split('---').slice(1).join('---')
  assert.ok(!/^\s*[-*]\s*`\/[a-z-]+`\s*—/m.test(body), 'no hardcoded skill directory to go stale')
})
