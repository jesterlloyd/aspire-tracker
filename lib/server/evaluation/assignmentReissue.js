// lib/server/evaluation/assignmentReissue.js
//
// SURVEY-REISSUE-2: the server-side half of a survey reissue, shared by the preceptor,
// unit-feedback and ASPIRE-feedback release paths. It is the Casey-Fink release endpoints'
// inline reissue block (SURVEY-REISSUE-1) lifted out step for step. Those two endpoints keep
// their inline copy, which their tests pin, and are the reference if the two ever differ.
//
// The database keeps one assignment row per (instrument, student, cohort, timepoint), so a
// reissue REUSES the expired or revoked row rather than inserting a second one:
//
//   1. claim     compare-and-set the terminal row to draft under a claim note, so of two
//                concurrent requests only one proceeds. revoked_at is cleared while claimed
//                so a concurrent reader cannot classify the draft row as reissuable.
//   2. tokens    retire every historical token row but one, then rotate that survivor to the
//                new hash (or insert one if none exists), so every old link stops working.
//   3. activate  set the row back to sent with fresh send metadata, guarded by the claim.
//
// Any failure after the claim puts the row back exactly as it was (restoreReissueClaim) and
// revokes the rotated token, so a failed reissue leaves the row reissuable and nothing live.
// The raw token never enters this module: the caller mints it and passes only the hash.
//
// Returns { ok: true, assignmentId }
//      or { ok: false, http, classification, error?, reason? } with nothing left claimed.

export async function restoreReissueClaim(db, row, claimNote, logPrefix = '[reissue]') {
  const { error } = await db
    .from('evaluation_assignments')
    .update({
      status:     row.status,
      revoked_at: row.revoked_at || null,
      notes:      row.notes || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', row.id)
    .eq('status', 'draft')
    .eq('notes', claimNote);
  if (error) console.error(`${logPrefix} reissue_restore_failed:`, { assignment_id: row.id, error: error.message });
}

export async function reissueAssignment({
  db, row, claimNote, activation, tokenHash, tokenHashPrefix, tokenExpiresAt,
  nowIso = new Date().toISOString(), logPrefix = '[reissue]',
}) {
  // 1. Claim. The status predicate is the compare-and-set: two requests may both read the
  //    old row, but only one can change its terminal status to draft.
  const { data: claimed, error: claimErr } = await db
    .from('evaluation_assignments')
    .update({ status: 'draft', revoked_at: null, notes: claimNote, updated_at: nowIso })
    .eq('id', row.id)
    .eq('status', row.status)
    .select('id')
    .maybeSingle();
  if (claimErr) {
    return { ok: false, http: 500, classification: 'reissue_claim_failed', error: 'Failed to claim the existing survey for reissue' };
  }
  if (!claimed) {
    return { ok: false, http: 409, classification: 'release_in_progress', reason: 'Another release attempt changed this survey. Re-run detection before trying again.' };
  }

  const fail = async (classification, error) => {
    await restoreReissueClaim(db, row, claimNote, logPrefix);
    return { ok: false, http: 500, classification, error };
  };

  // 2. Tokens. Historical data may hold more than one token row for this assignment. One row
  //    survives and is rotated; every other row is revoked. Writing the same unique hash to
  //    every historical row can never succeed.
  const { data: tokenRows, error: tokenLoadErr } = await db
    .from('evaluation_assignment_tokens')
    .select('id')
    .eq('assignment_id', row.id);
  if (tokenLoadErr) return fail('reissue_token_failed', 'Failed to load survey tokens for reissue');

  const survivor = tokenRows?.[0] || null;
  const obsoleteTokenIds = (tokenRows || []).slice(1).map(t => t.id);
  if (obsoleteTokenIds.length > 0) {
    const { error: retireErr } = await db
      .from('evaluation_assignment_tokens')
      .update({ revoked_at: nowIso })
      .in('id', obsoleteTokenIds);
    if (retireErr) return fail('reissue_token_failed', 'Failed to retire historical survey tokens');
  }
  if (survivor) {
    const { error: rotateErr } = await db
      .from('evaluation_assignment_tokens')
      .update({
        token_hash: tokenHash, token_hash_prefix: tokenHashPrefix,
        expires_at: tokenExpiresAt.toISOString(),
        revoked_at: null, used_at: null, ip_used_first: null, user_agent_used_first: null,
      })
      .eq('id', survivor.id);
    if (rotateErr) return fail('reissue_token_failed', 'Failed to refresh the survey token');
  } else {
    const { error: insertErr } = await db
      .from('evaluation_assignment_tokens')
      .insert({
        assignment_id: row.id, token_hash: tokenHash, token_hash_prefix: tokenHashPrefix,
        expires_at: tokenExpiresAt.toISOString(),
      });
    if (insertErr) return fail('reissue_token_failed', 'Failed to refresh the survey token');
  }

  // 3. Activate, guarded by the claim.
  const { data: activated, error: activateErr } = await db
    .from('evaluation_assignments')
    .update({ ...activation, status: 'sent', revoked_at: null, updated_at: nowIso })
    .eq('id', row.id)
    .eq('status', 'draft')
    .eq('notes', claimNote)
    .select('id')
    .maybeSingle();
  if (activateErr || !activated) {
    await db.from('evaluation_assignment_tokens')
      .update({ revoked_at: new Date().toISOString() }).eq('assignment_id', row.id);
    await restoreReissueClaim(db, row, claimNote, logPrefix);
    return { ok: false, http: 500, classification: 'reissue_activation_failed', error: 'Failed to activate the reissued survey' };
  }
  return { ok: true, assignmentId: activated.id };
}
