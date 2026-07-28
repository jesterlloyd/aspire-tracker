// Reconciliation: the internal general-team core must have NO EXECUTE for any role, service_role
// INCLUDED. The original migration's core REVOKE now names service_role explicitly, and an idempotent
// follow-up migration re-affirms it for every environment. The core is granted to no role; the entry
// RPCs stay service_role-only. Static source guards over both migration files.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

const ORIGINAL = 'supabase/migrations/20260728000000_enable_academic_partner_team_messages.sql'
const FOLLOWUP = 'supabase/migrations/20260729000000_revoke_service_role_from_general_team_core.sql'
const original = read(ORIGINAL)

const CORE_SIG = 'messages_start_general_team_conversation_core(uuid, text, uuid, text, text, text, text, jsonb, text)'
const coreEsc = CORE_SIG.replace(/[().]/g, (m) => '\\' + m)

test('the ORIGINAL migration revokes the core from every role, service_role INCLUDED', () => {
  // Multi-line REVOKE: signature on one line, FROM ... on the next.
  assert.match(original, new RegExp(`REVOKE ALL ON FUNCTION public\\.${coreEsc}\\s*\\n\\s*FROM PUBLIC, anon, authenticated, service_role;`))
  // The core is granted to NO role.
  assert.doesNotMatch(original, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${coreEsc}`))
})

test('the follow-up migration exists, is one atomic transaction, and revokes service_role idempotently', () => {
  assert.ok(existsSync(join(root, FOLLOWUP)), 'follow-up migration file exists')
  const followup = read(FOLLOWUP)
  // Atomic.
  assert.match(followup, /\nBEGIN;/)
  assert.match(followup, /\nCOMMIT;/)
  assert.ok(followup.indexOf('\nBEGIN;') < followup.indexOf('\nCOMMIT;'))
  // Revokes the core from every role including service_role (the reconciliation).
  assert.match(followup, new RegExp(`REVOKE ALL ON FUNCTION public\\.messages_start_general_team_conversation_core\\(\\s*\\n\\s*uuid, text, uuid, text, text, text, text, jsonb, text\\s*\\n\\)\\s*\\nFROM PUBLIC, anon, authenticated, service_role;`))
  // Idempotent, and grants NOTHING.
  assert.match(followup, /[Ii]dempotent/)
  assert.doesNotMatch(followup, /GRANT\b/)
  // No function/table is created or replaced (privilege-only).
  assert.doesNotMatch(followup, /CREATE OR REPLACE FUNCTION|CREATE TABLE|ALTER TABLE/)
})

test('the follow-up documents verification showing EXECUTE = false for anon, authenticated, service_role', () => {
  const followup = read(FOLLOWUP)
  assert.match(followup, /has_function_privilege/)
  assert.match(followup, /anon\s*\|\s*f/)
  assert.match(followup, /authenticated\s*\|\s*f/)
  assert.match(followup, /service_role\s*\|\s*f/)
})

test('the entry RPCs remain service_role-only (unchanged by the reconciliation)', () => {
  for (const sig of [
    'messages_start_general_team_conversation(uuid, text, uuid, text, text, text, text, jsonb)',
    'messages_start_general_team_conversation_ap(uuid, uuid, text, text, text, text, jsonb, text)',
  ]) {
    const esc = sig.replace(/[().]/g, (m) => '\\' + m)
    assert.match(original, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${esc}\\s*\\n\\s*TO service_role;`), sig)
  }
})
