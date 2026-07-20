// UL-PORTAL corrections before SQL:
//   1. active Owner/Admin enforcement on every user_unit_scopes management caller
//   2. the Messages participant model, including compatibility for every existing
//      thread shape and the new direct shape
//   3. fail-closed rotation date backfill

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

const migration = read('supabase/migrations/20260720000000_unit_leader_portal_foundation.sql')
const preflight = read('db/audit/unit_leader_portal_preflight_and_verification.sql')
const model     = read('docs/product/UNIT_LEADER_MESSAGES_MODEL.md')
const invite    = read('api/invite-portal-user.js')
const revoke    = read('api/revoke-portal-access.js')
const listAcc   = read('api/list-portal-access.js')
const ctx       = read('api/lib/messagesContext.js')
const staffReply = read('api/messages-staff-reply.js')

const migrationLive = migration.replace(/\/\*[\s\S]*?\*\//g, '')
const migrationSql  = migrationLive.replace(/^\s*--.*$/gm, '')

// ── Correction 1: active Owner/Admin enforcement ─────────────────────────────
const MANAGERS = {
  'api/invite-portal-user.js': invite,
  'api/revoke-portal-access.js': revoke,
  'api/list-portal-access.js': listAcc,
}

test('every user_unit_scopes management caller selects is_active', () => {
  for (const [name, src] of Object.entries(MANAGERS)) {
    assert.match(src, /select\('id, role, is_owner, is_active'\)/, `${name} must select is_active`)
  }
})

test('every user_unit_scopes management caller denies an INACTIVE Owner/Admin', () => {
  for (const [name, src] of Object.entries(MANAGERS)) {
    assert.match(
      src,
      /if \(profile\.is_active === false\) return \{ authenticated: false, status: 403, reason: 'inactive' \}/,
      `${name} must fail closed on a deactivated account`)
  }
})

test('the inactive check runs BEFORE the caller is treated as authenticated', () => {
  for (const [name, src] of Object.entries(MANAGERS)) {
    const inactiveAt = src.indexOf("profile.is_active === false")
    const authedAt = src.indexOf('return { authenticated: true')
    assert.ok(inactiveAt > -1 && authedAt > -1, name)
    assert.ok(inactiveAt < authedAt, `${name}: inactive denial must precede the success return`)
  }
})

test('management callers still verify identity by auth_user_id and role', () => {
  for (const [name, src] of Object.entries(MANAGERS)) {
    assert.match(src, /\.eq\('auth_user_id', user\.id\)/, `${name} matches auth_user_id`)
    assert.match(src, /auth\.isOwner \|\| auth\.role === 'admin'/, `${name} requires owner or admin`)
  }
})

test('management callers never authorize by name, email, title, canEdit, or is_staff', () => {
  for (const [name, src] of Object.entries(MANAGERS)) {
    assert.doesNotMatch(src, /is_staff\(/, name)
    assert.doesNotMatch(src, /\bcanEdit\b/, name)
    assert.doesNotMatch(src, /\bisAdmin\b/, name)
    // Authorization never reads a display name or a title.
    assert.doesNotMatch(src, /authenticated: true[^}]*full_name/, name)
  }
})

// ── Correction 2: the Messages participant model ─────────────────────────────
test('the participant model is documented with every required question answered', () => {
  for (const heading of [
    'Who the two active participant rows are',
    'How staff read and reply without becoming a participant',
    'How staff authorship is stored',
    'Unread counts',
    'Existing threads remain unchanged',
    'Access after a student changes unit',
    'Access after the unit leader',
    'Staff intervention after scope ends',
  ]) {
    assert.ok(model.includes(heading), `model must document: ${heading}`)
  }
})

test('staff intervention requires NO participant row, so the two-cap stands', () => {
  assert.match(model, /Staff are structurally non-participants/)
  // The staff reply gate is an active owner/admin check, not membership.
  assert.match(migrationSql, /message_profile_is_active_owner_or_admin\(p_actor_profile_id\)/)
  // No staff participant row is ever inserted by the migration.
  assert.doesNotMatch(migrationSql, /INSERT INTO public\.conversation_participants/i)
})

test('the two-participant cap is enforced and fails closed', () => {
  assert.match(migrationSql, /IF v_active > 2 THEN/)
  assert.match(migrationSql, /RAISE EXCEPTION 'MS409 too many active participants/)
  assert.match(migrationSql, /CREATE CONSTRAINT TRIGGER trg_conversation_participant_limit/)
})

test('the staff reply target is validated, never picked arbitrarily', () => {
  const fn = migrationSql.slice(migrationSql.indexOf('CREATE OR REPLACE FUNCTION public.messages_post_reply'))
  // The nondeterministic LIMIT 1 resolution is gone.
  assert.doesNotMatch(fn, /SELECT cp\.participant_profile_id INTO v_participant[\s\S]{0,200}LIMIT 1;/)
  // The declared recipient is validated to be an active-access participant.
  assert.match(fn, /v_participant := NULLIF\(p_delivery->>'recipient_profile_id', ''\)::uuid;/)
  assert.match(fn, /AND cp\.participant_profile_id = v_participant/)
  assert.match(fn, /message_recipient_has_active_access\(p_conversation_id, v_participant\)/)
})

test('a unit leader may author a reply, gated by the same active-access predicate', () => {
  const fn = migrationSql.slice(migrationSql.indexOf('CREATE OR REPLACE FUNCTION public.messages_post_reply'))
  assert.match(fn, /p_actor_kind NOT IN \('student', 'staff', 'unit_leader'\)/)
  assert.match(fn, /v_author_role    := 'unit_leader';/)
  assert.match(fn, /v_expected_event := 'unit_leader_message';/)
  assert.match(fn, /IF p_actor_kind IN \('student', 'unit_leader'\) THEN[\s\S]{0,400}message_recipient_has_active_access\(p_conversation_id, p_actor_profile_id\)/)
})

test('a unit leader reply writes the participant read pointer, not the staff one', () => {
  const fn = migrationSql.slice(migrationSql.indexOf('CREATE OR REPLACE FUNCTION public.messages_post_reply'))
  assert.match(fn, /IF p_actor_kind IN \('student', 'unit_leader'\) THEN\s*\n\s*INSERT INTO public\.participant_conversation_reads/)
})

test('COMPATIBILITY: the student to ASPIRE Team shape is unchanged', () => {
  const fn = migrationSql.slice(migrationSql.indexOf('CREATE OR REPLACE FUNCTION public.messages_post_reply'))
  // Same author role and same event for a student reply.
  assert.match(fn, /v_author_role := 'student';/)
  assert.match(fn, /ELSE 'portal_reply' END;/)
  // The student branch of the conversation-id function is preserved verbatim.
  const ids = migrationSql.slice(
    migrationSql.indexOf('CREATE OR REPLACE FUNCTION public.my_message_conversation_ids'),
    migrationSql.indexOf('CREATE OR REPLACE FUNCTION public.message_recipient_has_active_access'))
  assert.match(ids, /p\.participant_role = 'student'\s*\n\s*AND p\.scope_kind = 'student'/)
  assert.match(ids, /user_student_links/)
})

test('COMPATIBILITY: the unique index is widened, never narrowed', () => {
  // Every existing single-participant row still satisfies the new index.
  assert.match(migrationSql, /ON public\.conversation_participants \(conversation_id, participant_profile_id\)\s*\n\s*WHERE removed_at IS NULL/)
})

test('COMPATIBILITY: every pre-existing delivery binding is preserved', () => {
  const fn = migrationSql.slice(migrationSql.indexOf('CREATE OR REPLACE FUNCTION public.message_assert_valid_delivery'))
  assert.match(fn, /new_conversation must route to the shared inbox/)
  assert.match(fn, /portal_reply must route to staff/)
  assert.match(fn, /staff_reply must route to the portal participant/)
  // And the two new directions route to the other portal participant.
  assert.match(fn, /'unit_leader_message', 'student_to_unit_leader_message'/)
  assert.match(fn, /direct portal message must route to the other portal participant/)
})

test('COMPATIBILITY: the reserved unit-scoped Unit Leader shape still validates', () => {
  const chk = migrationSql.slice(
    migrationSql.indexOf('ADD CONSTRAINT chk_participant_role_scope'),
    migrationSql.indexOf('ALTER TABLE public.message_notification_deliveries'))
  // scope_student_id is optional for a unit leader: NULL (unit thread) and set
  // (direct thread) both pass.
  const ul = chk.slice(chk.indexOf("participant_role = 'unit_leader'"))
  const ulBranch = ul.slice(0, ul.indexOf('OR\n'))
  assert.match(ulBranch, /scope_unit_key IS NOT NULL/)
  assert.doesNotMatch(ulBranch, /scope_student_id/)
})

test('the application layer no longer breaks on a two-participant thread', () => {
  // maybeSingle() errors on two rows; it is gone from the participant loader.
  assert.match(ctx, /export async function loadActiveParticipants/)
  const fn = ctx.slice(ctx.indexOf('export async function loadActiveParticipants'),
                       ctx.indexOf('export async function loadActiveParticipant('))
  assert.doesNotMatch(fn, /maybeSingle\(\)/)
  assert.match(fn, /\.order\('added_at', \{ ascending: true \}\)/)
})

test('staff reply chooses the recipient deterministically', () => {
  assert.match(staffReply, /loadActiveParticipants/)
  assert.match(staffReply, /\.neq\('author_role', 'staff'\)/)
  assert.match(staffReply, /\.order\('created_at', \{ ascending: false \}\)/)
  assert.match(staffReply, /if \(preferred\) participant = preferred/)
})

test('unread counting is correct for student, unit leader, and staff', () => {
  // Portal side: anyone other than me.
  assert.match(migrationSql, /m\.author_profile_id <> public\.portal_profile_id\(\)/)
  // Staff side is untouched by this migration and still counts non-staff authors.
  assert.doesNotMatch(migrationSql, /CREATE OR REPLACE FUNCTION public\.messages_staff_unread_count/)
  assert.match(model, /author_role <> 'staff'/)
})

test('scope revocation denies new messages and history, and is documented as such', () => {
  assert.match(model, /Revocation, expiry, or deactivation denies \*\*everything\*\*, including history/)
  // The mechanism: an active unit scope is required in the read path.
  const ids = migrationSql.slice(
    migrationSql.indexOf('CREATE OR REPLACE FUNCTION public.my_message_conversation_ids'),
    migrationSql.indexOf('CREATE OR REPLACE FUNCTION public.message_recipient_has_active_access'))
  assert.match(ids, /FROM public\.user_unit_scopes s[\s\S]{0,300}s\.revoked_at IS NULL/)
})

// ── Correction 3: fail-closed rotation date backfill ─────────────────────────
test('the backfill requires a unique, confident, non-sentinel source', () => {
  const bf = migrationSql.slice(
    migrationSql.indexOf('UPDATE public.students s'),
    migrationSql.indexOf('CREATE INDEX IF NOT EXISTS idx_students_rotation_end_date'))
  // Explicit FK join: cohort_school_rotations.id is the PK, so at most one source row.
  assert.match(bf, /WHERE s\.cohort_school_rotation_id = r\.id/)
  // Only fills a NULL, so it is idempotent and never overwrites a curated value.
  assert.match(bf, /AND s\.rotation_end_date IS NULL/)
  // Valid, non-sentinel date only.
  assert.match(bf, /AND r\.rotation_end_date IS NOT NULL/)
  assert.match(bf, /AND r\.rotation_end_date <> DATE '1900-01-01'/)
  // Confidence: the linked row must still agree with the student's cohort and school.
  assert.match(bf, /AND r\.cohort_id   = s\.cohort_id/)
  assert.match(bf, /AND r\.school_name = s\.school/)
})

test('the backfill infers nothing from shift logs or free text', () => {
  const bf = migrationSql.slice(
    migrationSql.indexOf('UPDATE public.students s'),
    migrationSql.indexOf('CREATE INDEX IF NOT EXISTS idx_students_rotation_end_date'))
  assert.doesNotMatch(bf, /student_shift_logs|shift_date/)
  assert.doesNotMatch(bf, /term_dates/)
  assert.doesNotMatch(bf, /cohorts\.start_date|cohorts\.end_date/)
  // No cast or parse: the source column is already a real date.
  assert.doesNotMatch(bf, /::date|to_date\(|CAST\(/i)
})

test('rotation_completed_at is never inferred by the backfill', () => {
  const bf = migrationSql.slice(
    migrationSql.indexOf('UPDATE public.students s'),
    migrationSql.indexOf('CREATE INDEX IF NOT EXISTS idx_students_rotation_end_date'))
  assert.doesNotMatch(bf, /rotation_completed_at/)
  assert.match(migration, /rotation_completed_at is deliberately NOT backfilled/)
})

test('preflight reports ambiguous or unconfident rotation sources for review', () => {
  assert.match(preflight, /PREFLIGHT 4b: rotation-date sources that are NOT confidently determined/)
  assert.match(preflight, /cohort_or_school_mismatch/)
  assert.match(preflight, /sentinel_pending_admin/)
  assert.match(preflight, /weak_match_candidates/)
  assert.match(preflight, /EXPLICIT REVIEW RESULT, not an automatic stop/)
  assert.match(preflight, /Any value above 1 is a STOP/)
})

// ── The existing public unit form is not weakened ────────────────────────────
test('the migration does not touch the legacy public unit form path', () => {
  assert.doesNotMatch(migrationSql, /unit_cohort_responses/)
  assert.doesNotMatch(migrationSql, /ALTER TABLE public\.units\b/)
  assert.doesNotMatch(migrationSql, /DROP POLICY[\s\S]{0,60}anon_/)
})

test('no em dash in the corrected artifacts', () => {
  for (const [name, src] of Object.entries({
    migration, preflight, model, invite, revoke, listAcc, ctx, staffReply,
  })) {
    assert.doesNotMatch(src, /—/, `${name} must not contain an em dash`)
  }
})
