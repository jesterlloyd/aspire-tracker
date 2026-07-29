// ASPIRE event recurrence: activation documentation.
//
// Guards that the discovery doc records the two-gate activation, the exact server flag contract, and
// an honest rollback story - especially the warning that a structural (column-drop) rollback destroys
// recurrence metadata, versus the safe operational (flag) rollback that preserves it.
//
// Run: node --test test/aspireEventRecurrenceActivationDoc.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const doc = readFileSync(join(here, '..', 'docs/product/CALENDAR_RECURRENCE_DISCOVERY.md'), 'utf8')

test('doc explains the two-gate activation (migration AND server flag)', () => {
  assert.match(doc, /## Event recurrence activation/)
  assert.match(doc, /two independent gates|two gates/i)
  assert.match(doc, /ASPIRE_EVENT_RECURRENCE_ENABLED/)
  assert.match(doc, /exact lowercase string\s*`?true`?/i)
  assert.match(doc, /aspire_event_recurrence_capability/)
})

test('doc documents the safe operational rollback that preserves recurrence settings', () => {
  assert.match(doc, /Operational[\s\S]{0,260}preserved/i)
  assert.match(doc, /unset `?ASPIRE_EVENT_RECURRENCE_ENABLED`?/)
})

test('doc warns that a structural rollback is destructive to recurrence metadata', () => {
  assert.match(doc, /Structural[\s\S]{0,120}(DESTRUCTIVE|destroy|discards)/i)
  assert.match(doc, /before any live recurring data exists|after an explicit export/i)
})

test('doc affirms RLS/grants unchanged and read-time-only occurrences', () => {
  assert.match(doc, /RLS[\s\S]{0,80}unchanged/i)
  assert.match(doc, /read-time expansions only|no materialized occurrence rows/i)
})
