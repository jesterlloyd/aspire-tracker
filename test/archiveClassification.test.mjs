// ARCHIVE-SNAPSHOT-1 FAMILY 3 (registry): every notification type has exactly
// one archive owner, and an unknown type archives nothing.
// Run: node --test test/archiveClassification.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  classifyForArchive, sharedSenderMayArchive, OWNER,
  TEMPLATE_NOTIFICATION_TYPES, SECURE_LINK_TYPES, SPECIALIZED_OWNERS, NOT_ARCHIVED,
} from '../api/lib/archiveClassification.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

/** Every type registered in the shared template registry. */
function registeredTemplates() {
  const s = read('src/lib/notifications/templates/index.js')
  const block = s.slice(s.indexOf('export const templates = {'), s.indexOf('};', s.indexOf('export const templates = {')))
  return [...block.matchAll(/^\s{2}([a-z_]+):/gm)].map(m => m[1])
}

test('every registered template has exactly one archive owner', () => {
  const unclassified = registeredTemplates().filter(t => !classifyForArchive(t))
  assert.deepEqual(unclassified, [], `unclassified templates would archive nothing silently: ${unclassified}`)
})

test('no type appears in two categories', () => {
  const seen = new Map()
  const add = (t, where) => {
    if (seen.has(t)) assert.fail(`${t} is in both ${seen.get(t)} and ${where}`)
    seen.set(t, where)
  }
  TEMPLATE_NOTIFICATION_TYPES.forEach(t => add(t, 'template'))
  SECURE_LINK_TYPES.forEach(t => add(t, 'secure_link'))
  Object.keys(SPECIALIZED_OWNERS).forEach(t => add(t, 'specialized'))
  Object.keys(NOT_ARCHIVED).forEach(t => add(t, 'not_archived'))
})

test('secure-link templates can NEVER use the ordinary path', () => {
  for (const t of SECURE_LINK_TYPES) {
    assert.equal(classifyForArchive(t).contentKind, 'secure_link_email')
    assert.equal(sharedSenderMayArchive(t), false, `${t} must be reserved for the Family 4 gate`)
  }
})

test('specialized senders cannot also be archived by the shared path', () => {
  for (const t of Object.keys(SPECIALIZED_OWNERS)) {
    assert.equal(classifyForArchive(t).owner, OWNER.SPECIALIZED)
    assert.equal(sharedSenderMayArchive(t), false, `${t} already owns its archive - double write`)
  }
})

test('an unknown template archives nothing rather than defaulting', () => {
  assert.equal(classifyForArchive('a_brand_new_template'), null)
  assert.equal(sharedSenderMayArchive('a_brand_new_template'), false)
  assert.equal(sharedSenderMayArchive(undefined), false)
})

test('every not-archived entry states a reason', () => {
  for (const [t, why] of Object.entries(NOT_ARCHIVED)) {
    assert.ok(why && why.length > 40, `${t} needs a documented reason, not a bare exclusion`)
  }
})

test('ordinary templates are the only ones the shared sender may archive', () => {
  for (const t of TEMPLATE_NOTIFICATION_TYPES) {
    assert.equal(sharedSenderMayArchive(t), true)
    assert.equal(classifyForArchive(t).contentKind, 'template_notification')
  }
})

test('NEGATIVE CONTROL: moving a secure-link type to ordinary would fail', () => {
  // The suite keys off SECURE_LINK_TYPES; reclassifying one flips
  // sharedSenderMayArchive to true and breaks the exclusion test above.
  assert.ok(SECURE_LINK_TYPES.includes('evaluation_invitation_sent'))
  assert.ok(!TEMPLATE_NOTIFICATION_TYPES.includes('evaluation_invitation_sent'))
})

test('the specialized kinds match the writer and the migration', () => {
  const kinds = new Set(Object.values(SPECIALIZED_OWNERS))
  for (const k of kinds) assert.match(read('api/lib/messageArchive.js'), new RegExp(`'${k}'`))
  const sql = read('supabase/migrations/20260814000000_message_archive_content_kinds.sql')
  for (const k of [...kinds, 'template_notification', 'secure_link_email']) {
    assert.match(sql, new RegExp(`'${k}'`), `${k} missing from the migration CHECK`)
  }
})
