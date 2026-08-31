// lib/server/ngrpAudit.js
//
// NGRP-RELEASE-2: the one writer for ngrp_audit_events. Event types are an
// allowlist mirrored by the table CHECK; metadata is minimal and safe by
// construction - callers pass only ids, counts, labels, and hash PREFIXES.
// Raw tokens, links, emails, and form answers are never audit metadata.
// Best-effort: an audit failure is logged server-side but never fails the
// action it describes.

export const NGRP_AUDIT_EVENTS = Object.freeze([
  'cycle_created', 'cycle_updated', 'cycle_activated',
  'source_cohorts_changed', 'units_changed',
  'form_sent', 'form_opened', 'form_submitted', 'form_revised',
  'token_revoked', 'token_resent',
  'eligibility_calculated', 'eligibility_overridden',
  'application_confirmed', 'application_withdrawn',
])

const SAFE_META_KEYS = new Set([
  'batch_id', 'cycle_name', 'status', 'source_cohort_count', 'unit_count',
  'revision_number', 'result', 'previous_result', 'reason_category',
  'token_hash_prefix', 'recipient_count', 'sent', 'skipped', 'failed',
  'fields_changed',
])

export function sanitizeAuditMetadata(metadata) {
  const src = (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) ? metadata : {}
  const out = {}
  for (const [k, v] of Object.entries(src)) {
    if (!SAFE_META_KEYS.has(k)) continue
    if (typeof v === 'string') out[k] = v.slice(0, 200)
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = v
    else if (Array.isArray(v)) out[k] = v.filter(x => typeof x === 'string').slice(0, 30)
  }
  return out
}

export async function recordNgrpAudit(db, {
  eventType, cycleId = null, candidateId = null, assignmentId = null,
  studentId = null, actorProfileId = null, actorKind = 'staff', metadata = {},
}) {
  if (!NGRP_AUDIT_EVENTS.includes(eventType)) {
    console.error(`[ngrpAudit] refused unlisted event type: ${eventType}`)
    return false
  }
  const { error } = await db.from('ngrp_audit_events').insert({
    event_type: eventType,
    cycle_id: cycleId,
    candidate_id: candidateId,
    assignment_id: assignmentId,
    student_id: studentId,
    actor_profile_id: actorProfileId,
    actor_kind: actorKind,
    metadata: sanitizeAuditMetadata(metadata),
  })
  if (error) {
    console.error(`[ngrpAudit] ${eventType} not recorded: ${error.message}`)
    return false
  }
  return true
}
