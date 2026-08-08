// KEITH-SKILL-INSTALL-1: portable, uploadable, installable skills.
//
// The trust model under test: a package is INSTRUCTIONS, never a plugin.
// Parsing is strict (skillPackage.js), imports always land as disabled
// drafts, built-ins are never overwritten, references stay skill-local, and
// nothing a package declares can widen what the server authorizes at
// invocation time (skillAuthorization decides from the DB row + verified
// caller, both out of the package's reach).
//
// Run: node --test test/keithSkillInstall.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  parseSkillPackage, serializeSkillPackage, normalizeExternalPackage,
  composeInstructionBody, splitInstructionBody, isValidReferenceName, MAX_REFERENCES,
} from '../lib/server/keith/skillPackage.js'
import { authorizeSkillForCaller } from '../lib/server/keith/skillAuthorization.js'
import { writeZip, readZip, crc32 } from '../src/lib/zipLite.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const endpoint = read('api/keith-skills-admin.js')
const installUi = read('src/components/settings/KeithSkillInstall.jsx')

const KEITH_MD = [
  '---', 'name: shift-brief', 'display_name: Shift Brief',
  'description: One-paragraph shift summary', 'allowed_roles:', '  - owner', '  - admin',
  'trigger_phrases:', '  - shift brief', '---', '', 'Write the brief.',
].join('\n')

// ── Fixture 1: simple single-file SKILL.md ───────────────────────────────────
test('a single-file SKILL.md parses and lands as a disabled draft', () => {
  const r = parseSkillPackage(KEITH_MD)
  assert.equal(r.ok, true)
  assert.equal(r.skill.status, 'draft')
  assert.equal(r.skill.enabled, false)
  assert.deepEqual(r.skill.trigger_phrases, ['shift brief'])
})

// ── Fixture 2: zipped skill with references ──────────────────────────────────
test('a zipped package round-trips: SKILL.md + references through compose/split', async () => {
  const refs = [
    { name: 'rubric.md', content: '# Rubric\n1. Basis' },
    { name: 'guidance.md', content: 'Ask open questions.' },
  ]
  const zip = writeZip([
    { name: 'shift-brief/SKILL.md', text: KEITH_MD },
    ...refs.map(r => ({ name: `shift-brief/references/${r.name}`, text: r.content })),
  ])
  const { entries } = await readZip(zip.buffer)
  assert.equal(entries.length, 3)
  const body = composeInstructionBody('Write the brief.', refs)
  const back = splitInstructionBody(body)
  assert.equal(back.instructions, 'Write the brief.')
  assert.deepEqual(back.references, refs.map(r => ({ name: r.name, content: r.content })))
})

// ── Fixture 3: Keith-exported skill re-import ────────────────────────────────
test('Keith export → re-import preserves the skill faithfully', () => {
  const stored = {
    slug: 'shift-brief', display_name: 'Shift Brief', description: 'd', version: 3,
    status: 'active', allowed_roles: ['owner', 'admin'], required_tools: [],
    required_data: ['student_profile_read'], trigger_phrases: ['shift brief'],
    data_classification: 'confidential', model_route: 'default', provenance: 'ASPIRE',
    instruction_body: composeInstructionBody('Write it.', [{ name: 'ref.md', content: 'R' }]),
  }
  const parts = splitInstructionBody(stored.instruction_body)
  const md = serializeSkillPackage({ ...stored, instruction_body: parts.instructions })
  const r = parseSkillPackage(md)
  assert.equal(r.ok, true)
  assert.equal(r.skill.slug, stored.slug)
  assert.deepEqual(r.skill.allowed_roles, stored.allowed_roles)
  assert.deepEqual(r.skill.required_data, stored.required_data)
  assert.equal(r.skill.data_classification, 'confidential')
  assert.equal(r.skill.instruction_body, 'Write it.')
  // Re-composing with the exported reference restores the stored body exactly.
  assert.equal(composeInstructionBody(r.skill.instruction_body, parts.references), stored.instruction_body)
  // Exported "status: active" is ignored - imports are always drafts.
  assert.equal(r.skill.status, 'draft')
})

// ── Fixture 4: Claude-style SKILL.md ─────────────────────────────────────────
test('a Claude-style SKILL.md imports best-effort with unsupported keys NAMED', () => {
  const claude = [
    '---', 'name: brainstorming', 'description: Guides structured ideation',
    'license: Apache-2.0', 'allowed-tools:', '  - bash', '  - web_search',
    'metadata:', '  author: someone', '---', '', '# Brainstorming', 'Facilitate.',
  ].join('\n')
  const norm = normalizeExternalPackage(claude)
  assert.deepEqual(norm.unsupported.sort(), ['allowed-tools', 'license', 'metadata'])
  const r = parseSkillPackage(norm.source)
  assert.equal(r.ok, true)
  assert.equal(r.skill.display_name, 'Brainstorming', 'display_name derived from name')
  // The dropped allowed-tools list items must NOT leak into any Keith field.
  assert.deepEqual(r.skill.required_tools, [])
  assert.deepEqual(r.skill.allowed_roles, [])
})

// ── Fixture 5: malformed package ─────────────────────────────────────────────
test('malformed packages fail with named errors, never a partial import', () => {
  assert.equal(parseSkillPackage('no frontmatter at all').ok, false)
  const bad = parseSkillPackage('---\nname: Bad Slug!\n---\nbody')
  assert.equal(bad.ok, false)
  assert.ok(bad.errors.some(e => /kebab-case/.test(e)))
  const empty = parseSkillPackage('---\nname: x\ndisplay_name: X\ndescription: d\n---\n')
  assert.equal(empty.ok, false)
  assert.ok(empty.errors.some(e => /instructions.*empty|empty/.test(e)))
})

// ── Fixture 6: duplicate slug + built-in protection ──────────────────────────
test('the endpoint refuses silent overwrites and protects built-ins', () => {
  assert.match(endpoint, /if \(body\.update_existing !== true\) \{\s*\n\s*return res\.status\(409\)\.json\(\{ error: 'slug_taken', conflict \}\)/)
  assert.match(endpoint, /if \(!existingIsImported\) \{\s*\n\s*return res\.status\(409\)\.json\(\{ error: 'builtin_protected', conflict \}\)/)
  assert.match(endpoint, /startsWith\('imported'\)/)
  // Updates land back in the safest non-live state.
  assert.match(endpoint, /status: 'draft', enabled: false,\s*\n\s*updated_by/)
})

// ── Fixtures 7+8: disabled skill / unauthorized user cannot invoke ───────────
test('imports cannot bypass runtime authorization: state and role still decide', () => {
  const skill = {
    slug: 's', status: 'draft', enabled: false,
    allowed_roles: ['owner', 'admin', 'co-lead', 'interviewer'],
    data_classification: 'internal', required_data: [],
  }
  // Disabled draft (the import landing state): not invocable even for an Owner.
  assert.equal(authorizeSkillForCaller(skill, { role: 'owner', isOwner: true }).ok, false)
  // Active+enabled, but the CALLER's role decides - a package granting itself
  // every role does not make an unauthorized user authorized.
  const live = { ...skill, status: 'active', enabled: true, allowed_roles: ['owner'] }
  assert.equal(authorizeSkillForCaller(live, { role: 'interviewer', isOwner: false }).ok, false)
  assert.equal(authorizeSkillForCaller(live, { role: 'owner', isOwner: true }).ok, true)
})

// ── Fixture 9: package requesting unsupported capabilities ───────────────────
test('unknown capabilities are rejected or named, never honored', () => {
  const greedy = parseSkillPackage([
    '---', 'name: greedy', 'display_name: G', 'description: d',
    'required_data:', '  - all_student_records', '---', '', 'x',
  ].join('\n'))
  assert.equal(greedy.ok, false)
  assert.ok(greedy.errors.some(e => /unknown required_data grant/.test(e)))
  const viewer = parseSkillPackage([
    '---', 'name: v', 'display_name: V', 'description: d',
    'allowed_roles:', '  - viewer', '---', '', 'x',
  ].join('\n'))
  assert.equal(viewer.ok, false)
})

// ── Fixture 10: executables are quarantined client-side ──────────────────────
test('executables and scripts never travel: quarantined in the UI, text-only to the server', () => {
  assert.match(installUi, /EXECUTABLE_RE = \/\\\.\(js\|mjs\|cjs\|ts\|py\|sh\|bash/)
  assert.match(installUi, /executable or script - never run, not imported/)
  // Only markdown/text reference content is ever put on the wire.
  assert.match(installUi, /TEXT_RE = \/\\\.\(md\|markdown\|txt\)\$\/i/)
  assert.match(installUi, /quarantined\.push/)
  // Server defense in depth: reference names are validated again server-side.
  assert.equal(isValidReferenceName('notes.md'), true)
  assert.equal(isValidReferenceName('run.py'), false)
  assert.equal(isValidReferenceName('../escape.md'), false)
  assert.ok(MAX_REFERENCES >= 1)
})

// ── Fixture 11: reference files stay skill-local ─────────────────────────────
test('references are skill-local: inside instruction_body, never the Knowledge Vault', () => {
  // Storage: composed into instruction_body, which the runtime loads only at
  // invocation (loadSkillInstructions) - pinned in skillRuntime itself.
  const runtime = read('lib/server/keith/skillRuntime.js')
  assert.match(runtime, /Load one skill's instruction body\. Called only after authorization\./)
  // The import path never touches knowledge tables.
  assert.doesNotMatch(endpoint, /knowledge_entries|knowledge_revisions/)
})

// ── Zip integrity ────────────────────────────────────────────────────────────
test('zipLite: crc and round-trip integrity, unsupported methods reported per entry', async () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xCBF43926, 'CRC-32 check vector')
  const zip = writeZip([{ name: 'a.md', text: 'alpha' }, { name: 'r/b.txt', text: 'beta' }])
  const { entries } = await readZip(zip.buffer)
  assert.deepEqual(entries.map(e => e.name), ['a.md', 'r/b.txt'])
  assert.equal(new TextDecoder().decode(entries[1].bytes), 'beta')
  await assert.rejects(() => readZip(new Uint8Array([1, 2, 3]).buffer), /not_a_zip/)
})

// ── The / menu stays canonical ───────────────────────────────────────────────
test('no second catalog: the / menu and invocation still flow through the registry', () => {
  const keithHandler = read('api/keith.js')
  assert.match(keithHandler, /loadInvocableSkills\(makeServiceRoleClient\(\), auth\)/)
  assert.doesNotMatch(installUi, /skills_catalog/, 'the installer does not maintain its own skills list')
})

// ── KEITH-SKILL-NATIVE-1: native Claude .skill support ───────────────────────
//
// Inspected real Claude-exported .skill files (2026-08-08): every one is a
// ZIP archive (PK\x03\x04, deflate) containing <slug>/SKILL.md and optional
// references/*.md, with frontmatter of name + description only. The BYTES
// route the file - never the extension, never the MIME type (browsers hand
// .skill over as application/octet-stream or nothing at all).

test('sniffPackageKind routes by content: zip magic, utf-8 text, binary', async () => {
  const { sniffPackageKind } = await import('../src/lib/zipLite.js')
  const zip = writeZip([{ name: 's/SKILL.md', text: 'x' }])
  assert.equal(sniffPackageKind(zip), 'zip')
  assert.equal(sniffPackageKind(new TextEncoder().encode('---\nname: a\n---\nBody')), 'text')
  assert.equal(sniffPackageKind(new Uint8Array([0x00, 0x01, 0x02, 0xff])), 'binary')
  assert.equal(sniffPackageKind(new Uint8Array([0xff, 0xfe, 0x00, 0x41])), 'binary', 'UTF-16 with NULs is not a package Keith reads')
})

test('a representative Claude .skill (zip: slug/SKILL.md + references) flows the archive path', async () => {
  // Mirrors the real structure byte-for-byte at the container level.
  const claudeMd = [
    '---', 'name: inquiry-routing',
    'description: ' + 'Route inquiries to the right team. '.repeat(20), // >500 chars, like real packages
    '---', '', '# Inquiry Routing', 'Route it.',
  ].join('\n')
  const skillFile = writeZip([
    { name: 'inquiry-routing/SKILL.md', text: claudeMd },
    { name: 'inquiry-routing/references/directory.md', text: 'The directory.' },
  ])
  const { sniffPackageKind } = await import('../src/lib/zipLite.js')
  assert.equal(sniffPackageKind(skillFile), 'zip')
  const { entries } = await readZip(skillFile.buffer)
  assert.equal(entries.length, 2)
  const norm = normalizeExternalPackage(new TextDecoder().decode(entries[0].bytes))
  const parsed = parseSkillPackage(norm.source)
  assert.equal(parsed.ok, true)
  assert.equal(parsed.skill.slug, 'inquiry-routing')
  assert.equal(parsed.skill.status, 'draft')
})

test('a bare-markdown .skill file flows the single-file path; junk bytes are refused precisely', async () => {
  const { sniffPackageKind } = await import('../src/lib/zipLite.js')
  // Extension says .skill, bytes say markdown → text path, same parser.
  const md = '---\nname: hand-rolled\ndisplay_name: Hand Rolled\ndescription: d\n---\nBody.'
  assert.equal(sniffPackageKind(new TextEncoder().encode(md)), 'text')
  assert.equal(parseSkillPackage(md).ok, true)
  // The installer names what it found instead of "unsupported file type".
  const ui = read('src/components/settings/KeithSkillInstall.jsx')
  assert.match(ui, /neither a ZIP archive nor readable text \(binary content\)/)
  assert.match(ui, /sniffPackageKind\(buf\)/)
  assert.doesNotMatch(ui, /file\.type/, 'MIME type is never consulted')
  assert.match(ui, /accept="\.md,\.markdown,\.zip,\.skill"/)
  assert.match(ui, /Claude\/Keith Skill \(\.skill\), Markdown \(\.md\), or Skill archive \(\.zip\)/)
})

test('overlong Claude descriptions truncate WITH a warning, never silently', () => {
  assert.match(endpoint, /description longer than \$\{CAPS\.description\} characters was truncated/)
  assert.match(endpoint, /s\.description\.slice\(0, CAPS\.description - 1\)/)
})

test('downloads use the .skill container: same zip bytes, user-recognizable name', () => {
  const drawer = read('src/components/settings/KeithSkillDrawer.jsx')
  assert.match(drawer, /const filename = `\$\{skill\.slug\}\.skill`/)
  assert.match(drawer, /writeZip\(json\.files\.map/)
  assert.doesNotMatch(drawer, /\.skill\.zip/, 'the old double-extension is retired')
})
