import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { mergeCcRecipientText, parseRecipientText } from '../src/lib/recipientParse.js'

const here = dirname(fileURLToPath(import.meta.url))
const outreach = readFileSync(join(here, '../src/components/connect/OutreachView.jsx'), 'utf8')

test('CC paste parses a comma-separated Contacts copy into separate recipients', () => {
  const text = 'Lyubov.Tashlyk@cshs.org,Azucena.Lesser@cshs.org,Jose.Chavez3@cshs.org'
  const result = mergeCcRecipientText({ text })

  assert.deepEqual(result.cc, [
    'Lyubov.Tashlyk@cshs.org',
    'Azucena.Lesser@cshs.org',
    'Jose.Chavez3@cshs.org',
  ])
  assert.deepEqual(result.added, result.cc)
  assert.deepEqual(result.invalid, [])
})

test('CC paste accepts semicolon, newline, and whitespace-separated bare emails', () => {
  const parsed = parseRecipientText('one@example.org;two@example.org\nthree@example.org four@example.org')
  assert.deepEqual(parsed.valid.map(r => r.email), [
    'one@example.org', 'two@example.org', 'three@example.org', 'four@example.org',
  ])
})

test('whitespace support does not split a named-address token', () => {
  const parsed = parseRecipientText('"Isaac Preceptor" <isaac@example.org>')
  assert.equal(parsed.valid.length, 1)
  assert.equal(parsed.valid[0].name, 'Isaac Preceptor')
  assert.equal(parsed.valid[0].email, 'isaac@example.org')
})

test('CC merge dedupes case-insensitively, excludes To, and keeps the five-recipient cap', () => {
  const result = mergeCcRecipientText({
    current: ['existing@example.org'],
    toEmail: 'to@example.org',
    text: 'EXISTING@example.org,to@example.org,two@example.org,three@example.org,four@example.org,five@example.org,six@example.org',
  })

  assert.deepEqual(result.cc, [
    'existing@example.org', 'two@example.org', 'three@example.org', 'four@example.org', 'five@example.org',
  ])
  assert.equal(result.duplicateCount, 1)
  assert.equal(result.sameAsToCount, 1)
  assert.equal(result.cappedCount, 1)
})

test('Send to One wires multi-address paste into the CC parser and sends parsed chips', () => {
  assert.match(outreach, /onPaste=\{handleCcPaste\}/)
  assert.match(outreach, /const addCcRecipients = useCallback/)
  assert.match(outreach, /mergeCcRecipientText\(\{[\s\S]*?text: ccInput,[\s\S]*?current: ccList,[\s\S]*?toEmail: resolvedToEmail/)
})
