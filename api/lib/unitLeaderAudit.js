// api/lib/unitLeaderAudit.js
//
// UL-PORTAL: SUPPLEMENTARY activity-feed emission.
//
// THIS IS NOT THE AUDIT OF RECORD, and no workflow depends on it for auditability.
// Each Unit Leader workflow satisfies the audit requirement through its own
// authoritative table, which is why this module is best effort and why nothing is
// duplicated for the two workflows that already write their own history:
//
//   placement    unit_placement_request_events, written in the SAME transaction as
//                the response by the unit_placement_respond RPC
//   capacity     unit_capacity_submissions, whose rows are immutable apart from
//                superseded_at and carry full attribution and supersedes_id lineage
//   milestones   unit_student_milestones, a single INSERT with full attribution,
//                never hard deleted, corrections additive
//   nominations  unit_preceptor_nominations, likewise a single attributed INSERT
//
// It remains in use only for the two single-INSERT workflows above, purely to give
// staff a unified activity feed alongside other ASPIRE events. A failure here can
// therefore never leave a state change unaudited: the domain row is the audit.
//
// Reuses the existing public.activity_logs table rather than building a parallel
// system. Two constraints made that possible without a migration:
//   1. activity_logs RLS allows INSERT only under is_staff(), which excludes the
//      'portal' role, so a Unit Leader can never write from the browser. These
//      writes go through the service-role client, which bypasses RLS.
//   2. user_role would be the literal 'portal' for every Unit Leader, which is
//      useless in an audit trail, so the real acting role and the unit context are
//      carried explicitly in user_role and metadata.
//
// Every record captures: actor profile id, action, target entity, old and new state
// where applicable, timestamp (activity_logs default), unit context, optional
// comment, and the ASPIRE confirmation state where one exists.
//
// Best effort by design, matching api/aspire-events.js: a failure is logged and
// swallowed rather than failing the user's operation. That is safe precisely because
// the authoritative audit is the domain row the endpoint already wrote.

/**
 * Emit one Unit Leader audit record.
 *
 * @param {object} db          service-role Supabase client
 * @param {object} actor       { id, full_name } from the verified caller profile
 * @param {object} entry
 * @param {string} entry.action        e.g. 'unit_placement_response'
 * @param {string} entry.entityType    e.g. 'unit_placement_request'
 * @param {string} entry.entityId
 * @param {string} entry.unitKey       unit context, always recorded
 * @param {string} [entry.cohortId]
 * @param {string} [entry.fromValue]   old state
 * @param {string} [entry.toValue]     new state
 * @param {string} [entry.comment]     optional Unit Leader comment
 * @param {string} [entry.aspireStatus] ASPIRE confirmation state where applicable
 * @param {string} [entry.description] human-readable summary
 */
export async function emitUnitLeaderAudit(db, actor, entry) {
  try {
    const {
      action, entityType, entityId, unitKey, cohortId = null,
      fromValue = null, toValue = null, comment = null,
      aspireStatus = null, description = null,
    } = entry

    await db.from('activity_logs').insert({
      user_id: actor?.id ?? null,
      user_name: actor?.full_name ?? '',
      // The real acting role. user_profiles.role is the literal 'portal' for every
      // portal user, which would make the trail useless.
      user_role: 'unit_leader',
      action_type: action,
      entity_type: entityType,
      entity_id: String(entityId ?? ''),
      cohort_id: cohortId,
      description: description ?? defaultDescription(actor, entry),
      metadata: {
        unit_key: unitKey,
        from_value: fromValue,
        to_value: toValue,
        comment: comment || null,
        aspire_status: aspireStatus,
        actor_profile_id: actor?.id ?? null,
      },
    })
  } catch (err) {
    // Never fail the operation on an audit problem.
    console.warn('[unit-leader-audit] emit failed', err?.message || err)
  }
}

function defaultDescription(actor, entry) {
  const who = actor?.full_name || 'A Unit Leader'
  const unit = entry.unitKey ? ` for ${entry.unitKey}` : ''
  if (entry.fromValue && entry.toValue) {
    return `${who} changed ${entry.entityType} from ${entry.fromValue} to ${entry.toValue}${unit}`
  }
  if (entry.toValue) {
    return `${who} set ${entry.entityType} to ${entry.toValue}${unit}`
  }
  return `${who} performed ${entry.action}${unit}`
}
