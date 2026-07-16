// MESSAGES-PHASE2-A: static guard for the ASPIRE Messages Phase 2 Stage A
// notification-delivery and rate-limit database migration. Verifies the two
// tables, RLS, the separation of queue vs provider status, exact status/event/
// recipient sets, unique idempotency, atomic claiming with overlap protection,
// bounded retries, the no-body posture, service-role-only functions, the active
// student recipient gating (with no related/assignment context and no misuse of
// has_active_role_grant), the portal-user rate-limit mechanism, and that the
// Phase 1 migration is untouched.
//
// Run: node --test test/messagesPhase2DeliveryFoundation.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const P2 = join(here, '../supabase/migrations/20260716000001_messages_phase2_notification_delivery_foundation.sql')
const P1 = join(here, '../supabase/migrations/20260716000000_messages_phase1_schema_foundation.sql')
const VERIFY = join(here, '../db/audit/messages_phase2_verification.sql')
const DOC = join(here, '../docs/MESSAGES_PHASE2_DELIVERY.md')

const sql = readFileSync(P2, 'utf8')
const phase1 = readFileSync(P1, 'utf8')
const verify = readFileSync(VERIFY, 'utf8')
const doc = readFileSync(DOC, 'utf8')

// Executable SQL with comments removed, so token guards test code not prose.
const executableSql = sql.replace(/--[^\n]*/g, '')

// Body of the recipient-gating function (CREATE to its REVOKE).
const gatingStart = sql.indexOf('CREATE OR REPLACE FUNCTION public.message_recipient_has_active_access')
const gatingBody = sql.slice(gatingStart, sql.indexOf('REVOKE ALL ON FUNCTION public.claim_due_message_notification_deliveries'))

const FUNCTIONS = [
  'claim_due_message_notification_deliveries',
  'message_recipient_has_active_access',
  'consume_message_rate_limit',
]

test('ASPIRE Messages Phase 2 Stage A migration', async (t) => {
  await t.test('Phase 1 migration is untouched by Stage A', () => {
    for (const tbl of ['conversations', 'conversation_participants', 'messages',
      'staff_conversation_reads', 'participant_conversation_reads', 'conversation_events']) {
      assert.match(phase1, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${tbl}\\b`), `Phase 1 lost table ${tbl}`)
    }
    assert.match(phase1, /CREATE OR REPLACE FUNCTION public\.is_active_owner_or_admin\b/)
    assert.match(phase1, /CREATE OR REPLACE FUNCTION public\.my_message_conversation_ids\b/)
    // No Phase 2 object bled into the Phase 1 file.
    assert.doesNotMatch(phase1, /message_notification_deliveries|message_rate_limit_counters|consume_message_rate_limit/)
  })

  await t.test('Stage A does not ALTER or DROP any Phase 1 object', () => {
    assert.doesNotMatch(sql, /ALTER TABLE public\.(conversations|conversation_participants|messages|staff_conversation_reads|participant_conversation_reads|conversation_events)\b/)
    assert.doesNotMatch(executableSql, /\bDROP\b/)
    // Does not redefine the Phase 1 helpers.
    assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\.(is_active_owner_or_admin|my_message_conversation_ids)\b/)
  })

  await t.test('is atomic with BEGIN and COMMIT around the DDL', () => {
    assert.match(sql, /^BEGIN;/m)
    assert.match(sql, /^COMMIT;/m)
    assert.ok(sql.indexOf('\nBEGIN;') < sql.indexOf('CREATE TABLE'), 'BEGIN before first DDL')
    assert.ok(sql.indexOf('\nCOMMIT;') > sql.lastIndexOf('CREATE POLICY'), 'COMMIT after last policy')
  })

  await t.test('creates both tables with RLS enabled', () => {
    for (const tbl of ['message_notification_deliveries', 'message_rate_limit_counters']) {
      assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${tbl}\\b`), `missing table ${tbl}`)
      assert.match(sql, new RegExp(`ALTER TABLE public\\.${tbl}\\s+ENABLE ROW LEVEL SECURITY`), `RLS not enabled on ${tbl}`)
    }
  })

  await t.test('queue_status and provider_status are separate constrained columns', () => {
    assert.match(sql, /queue_status\s+text\s+NOT NULL DEFAULT 'queued'/, 'queue_status column missing')
    assert.match(sql, /provider_status\s+text,/, 'provider_status column missing')
    assert.match(sql, /queue_status IN \('queued', 'processing', 'retry_wait', 'sent', 'failed', 'suppressed'\)/, 'wrong queue_status set')
    assert.match(sql, /provider_status IS NULL OR provider_status IN \(\s*'sent', 'delivered', 'opened', 'clicked', 'bounced', 'complained'\)/, 'wrong provider_status set')
    // They are distinct constraints, not one shared column.
    assert.notEqual(sql.indexOf('chk_mnd_queue_status'), -1)
    assert.notEqual(sql.indexOf('chk_mnd_provider_status'), -1)
  })

  await t.test('event types are exact and there is no generic new_message event', () => {
    assert.match(sql, /event_type IN \('new_conversation', 'portal_reply', 'staff_reply'\)/, 'wrong event_type set')
    assert.doesNotMatch(executableSql, /'new_message'/, 'must not use a generic new_message event')
  })

  await t.test('recipient kinds are exact', () => {
    assert.match(sql, /recipient_kind IN \('shared_inbox', 'assigned_staff', 'portal_user'\)/, 'wrong recipient_kind set')
  })

  await t.test('idempotency_key is UNIQUE and composed from recipient identity', () => {
    assert.match(sql, /CONSTRAINT uq_message_notification_deliveries_idempotency UNIQUE \(idempotency_key\)/, 'missing unique idempotency constraint')
    // The composition comment documents recipient identity (profile + email), not kind alone.
    assert.match(sql, /recipient_profile_id plus normalized email/, 'idempotency composition must include recipient identity')
  })

  await t.test('atomic claim uses FOR UPDATE SKIP LOCKED with due filtering and stale recovery', () => {
    assert.match(sql, /FOR UPDATE SKIP LOCKED/, 'claim must use FOR UPDATE SKIP LOCKED')
    assert.match(sql, /queue_status IN \('queued', 'retry_wait'\)\s*\n\s*AND \(d\.next_attempt_at IS NULL OR d\.next_attempt_at <= v_now\)/, 'claim must filter to due queued/retry_wait rows')
    assert.match(sql, /d\.queue_status = 'processing'\s*\n\s*AND d\.locked_at IS NOT NULL\s*\n\s*AND d\.locked_at < v_now/, 'missing stale-claim recovery')
    // A processing row must carry an active claim.
    assert.match(sql, /queue_status <> 'processing' OR \(locked_at IS NOT NULL AND locked_by IS NOT NULL\)/, 'missing processing-claim constraint')
  })

  await t.test('retries are bounded', () => {
    assert.match(sql, /CHECK \(attempts >= 0\)/, 'attempts must be non-negative')
    assert.match(sql, /CHECK \(max_attempts > 0 AND max_attempts <= 10\)/, 'max_attempts must be bounded')
    assert.match(sql, /CHECK \(attempts <= max_attempts\)/, 'attempts must not exceed max_attempts')
    assert.match(sql, /max_attempts\s+integer\s+NOT NULL DEFAULT 5/, 'conservative default max_attempts expected')
  })

  await t.test('no message body, preview, snippet, content, or metadata column exists', () => {
    // Scope to the delivery table's column declarations only (prose in the
    // table COMMENT legitimately mentions these words).
    const columnBlock = sql.slice(
      sql.indexOf('CREATE TABLE IF NOT EXISTS public.message_notification_deliveries'),
      sql.indexOf('COMMENT ON TABLE public.message_notification_deliveries'),
    )
    for (const bad of ['body', 'message_body', 'preview', 'snippet', 'content', 'metadata']) {
      assert.doesNotMatch(
        columnBlock,
        new RegExp(`^\\s+${bad}\\s+(text|jsonb|json|uuid|integer|boolean|timestamptz)`, 'mi'),
        `unexpected ${bad} column`,
      )
    }
    // Only an explicit safe snapshot is persisted.
    assert.match(sql, /snapshot_sender_name\s+text/, 'expected explicit snapshot columns')
    assert.match(sql, /cta_path\s+text/, 'expected explicit CTA path column')
  })

  await t.test('terminal states are not retryable; retry_wait is scheduled', () => {
    assert.match(sql, /queue_status <> 'retry_wait' OR next_attempt_at IS NOT NULL/, 'retry_wait must be scheduled')
    assert.match(sql, /queue_status NOT IN \('sent', 'failed', 'suppressed'\) OR next_attempt_at IS NULL/, 'terminal states must not be retryable')
  })

  await t.test('active recipient gating checks target profile, active grant, and active link', () => {
    assert.match(gatingBody, /cp\.participant_profile_id = p_profile_id/, 'gating must check the explicit target profile')
    assert.match(gatingBody, /cp\.participant_role = 'student'/, 'gating must require student role')
    assert.match(gatingBody, /cp\.scope_kind = 'student'/, 'gating must require student scope')
    assert.match(gatingBody, /cp\.removed_at IS NULL/, 'gating must require an active participant')
    assert.match(gatingBody, /user_role_grants/, 'gating must check the role grant')
    assert.match(gatingBody, /revoked_at IS NULL/, 'gating must check revoked_at')
    assert.match(gatingBody, /starts_at <= now\(\)/, 'gating must check starts_at')
    assert.match(gatingBody, /expires_at IS NULL OR g\.expires_at > now\(\)/, 'gating must check expires_at')
    assert.match(gatingBody, /user_student_links/, 'gating must check the student link')
    assert.match(gatingBody, /l\.student_id = cp\.scope_student_id/, 'gating must match link to scope_student_id')
  })

  await t.test('recipient gating does not misuse caller-scoped helpers or related context', () => {
    assert.doesNotMatch(gatingBody, /has_active_role_grant/, 'must not use caller-scoped has_active_role_grant for a target recipient')
    assert.doesNotMatch(gatingBody, /portal_profile_id/, 'must not resolve the caller identity for a target recipient')
    assert.doesNotMatch(gatingBody, /related_student_id|related_unit_key|related_school_key|related_cohort_id/, 'must not authorize via related context')
    assert.doesNotMatch(gatingBody, /assigned_staff_profile_id/, 'must not authorize via assignment')
  })

  await t.test('all three functions are SECURITY DEFINER, fixed search_path, service-role only', () => {
    for (const fn of FUNCTIONS) {
      assert.match(sql, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\b`), `missing function ${fn}`)
    }
    const secdef = sql.match(/SECURITY DEFINER/g) || []
    assert.ok(secdef.length >= 3, `expected >=3 SECURITY DEFINER, found ${secdef.length}`)
    const sp = sql.match(/SET search_path = public, pg_catalog/g) || []
    assert.ok(sp.length >= 3, `expected >=3 fixed search_path, found ${sp.length}`)
    for (const fn of FUNCTIONS) {
      assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\)\\s*\\n?\\s*FROM PUBLIC, anon, authenticated;`), `missing REVOKE for ${fn}`)
      assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\)\\s*\\n?\\s*TO service_role;`), `missing service_role EXECUTE for ${fn}`)
      // Never grant these to authenticated or anon.
      assert.doesNotMatch(sql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}[^;]*TO[^;]*(authenticated|anon)`), `${fn} must not be granted to authenticated/anon`)
    }
  })

  await t.test('rate-limit mechanism is keyed by profile id with the approved windows', () => {
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.message_rate_limit_counters/, 'rate-limit table missing')
    assert.match(sql, /profile_id\s+uuid\s+NOT NULL REFERENCES public\.user_profiles\(id\)/, 'rate-limit must key on user_profiles.id')
    assert.match(sql, /action_kind IN \('new_conversation', 'message'\)/, 'wrong rate-limit action kinds')
    assert.match(sql, /CHECK \(count >= 0\)/, 'rate-limit count must be non-negative')
    // Bounded guardrails inside the consume function.
    assert.match(sql, /p_window_seconds > 3600/, 'window guardrail missing')
    assert.match(sql, /p_max_per_window > 1000/, 'limit guardrail missing')
    // Approved specific windows are recorded in the Stage A documentation.
    assert.match(doc, /5 new conversations per (profile|user).*3600|5 per 3600/, 'doc must record 5 new conversations per 3600s')
    assert.match(doc, /20 messages per (profile|user).*600|20 per 600/, 'doc must record 20 messages per 600s')
  })

  await t.test('rate-limit consume never trusts a client id and returns a 429 shape', () => {
    assert.match(sql, /server-verified/, 'consume must document server-verified id requirement')
    assert.match(sql, /'retry_after_seconds'/, 'consume must return retry timing')
    assert.match(sql, /'allowed'/, 'consume must return allowed flag')
  })

  await t.test('deliveries: authenticated SELECT only, no counters access, Owner/Admin policy', () => {
    assert.match(sql, /GRANT SELECT ON public\.message_notification_deliveries TO authenticated;/, 'authenticated needs SELECT on deliveries')
    assert.doesNotMatch(sql, /GRANT[^;]*ON public\.message_rate_limit_counters TO authenticated/, 'authenticated must not access counters')
    assert.doesNotMatch(sql, /GRANT[^;]*\b(INSERT|UPDATE|DELETE|TRUNCATE)\b[^;]*ON public\.message_notification_deliveries TO authenticated/i, 'authenticated must not mutate deliveries')
    assert.match(sql, /CREATE POLICY "mnd_staff_select" ON public\.message_notification_deliveries\s+FOR SELECT TO authenticated\s+USING \(public\.is_active_owner_or_admin\(\)\)/, 'missing Owner/Admin observability policy')
    assert.doesNotMatch(executableSql, /is_staff/, 'must not use is_staff')
    // No policy on the counters table.
    assert.doesNotMatch(sql, /CREATE POLICY "[^"]+" ON public\.message_rate_limit_counters/, 'counters must have no policy')
    // No portal policy on deliveries (the Phase 1 helper name appears only in
    // the prerequisites comment, which executableSql strips).
    assert.doesNotMatch(executableSql, /my_message_conversation_ids/, 'no portal read path in Stage A')
  })

  await t.test('service_role cannot DELETE or TRUNCATE the delivery record', () => {
    assert.match(sql, /GRANT SELECT, INSERT, UPDATE ON public\.message_notification_deliveries TO service_role;/, 'service_role delivery grant must be SELECT/INSERT/UPDATE only')
    assert.doesNotMatch(sql, /GRANT[^;]*\b(DELETE|TRUNCATE)\b[^;]*ON public\.message_notification_deliveries[^;]*TO service_role/i, 'service_role must not DELETE/TRUNCATE deliveries')
    // No GRANT statement anywhere confers TRUNCATE (scoped to GRANT, not prose).
    assert.doesNotMatch(sql, /GRANT[^;]*\bTRUNCATE\b/, 'no TRUNCATE grant permitted')
  })

  await t.test('Stage A makes no external HTTP call and seeds no data', () => {
    // resend_email_id is a legitimate correlation column; the send infrastructure
    // (Resend client, webhook, cron) is Stage B code, not this migration. What
    // must never appear is an in-SQL HTTP call or migration-time data seeding.
    assert.doesNotMatch(executableSql, /pg_net|net\.http|http_post|extensions\.http/i, 'Stage A SQL must not make external HTTP calls')
    // The only INSERT INTO is the rate-limit upsert inside the consume function
    // body; there is no migration-time seed (INSERT ... VALUES at top level with
    // literal rows). Guard against a seeded literal row set.
    assert.doesNotMatch(executableSql, /INSERT INTO public\.message_notification_deliveries/, 'must not seed delivery rows')
    assert.doesNotMatch(sql, /gen_random_uuid\(\),\s*'/, 'must not seed literal data rows')
  })
})

test('ASPIRE Messages Phase 2 Stage A verification file', async (t) => {
  await t.test('is labeled read-only, run-after-apply, and covers the required checks', () => {
    assert.match(verify, /READ-ONLY VERIFICATION QUERIES\.\s*\n--\s*RUN ONLY AFTER THE MIGRATION HAS BEEN APPLIED\./, 'missing read-only label')
    for (const tok of ['message_notification_deliveries', 'message_rate_limit_counters',
      'claim_due_message_notification_deliveries', 'message_recipient_has_active_access',
      'consume_message_rate_limit', 'prosecdef', 'role_table_grants', 'role_routine_grants']) {
      assert.ok(verify.includes(tok), `verification missing ${tok}`)
    }
  })
})
