// api/lib/placementSendGuard.js
//
// PLACEMENT-COMMUNICATION-HANDOFF-1A - proving a placement send is what it claims
// to be, BEFORE the mail provider is contacted.
//
// THE PROBLEM THIS SOLVES. The Placement Board hands ASPIRE Connect a reference to
// the placement a preceptor email is about, and a successful send stamps that
// reference onto the notification_log row the board later reads as "Sent". Until
// this guard existed the reference was merely SHAPE-checked: five UUIDs in, five
// UUIDs onto the record. Nothing proved the match existed, that the student and
// unit belonged to it, that the preceptor was still the one assigned, or that the
// person actually being emailed was that preceptor. A stale tab, an edited
// payload, or a placement that changed while a draft sat open could therefore
// attach a real send to the wrong placement - and the board would show a Sent
// chip that nobody could tell was false.
//
// THE RULE. The browser supplies ONE thing this guard trusts as a lookup handle:
// the match id. Everything else it sends is treated as a CLAIM to be disproved,
// and the record that goes into notification_log is built from the DATABASE ROWS,
// never from the request. A claim that does not match reality fails the send
// outright: no email, no row, and an error that names what disagreed.
//
// FAIL CLOSED, ALWAYS. Every unknown - a missing match, an unreadable table, a
// placement whose preceptor cannot be resolved - refuses the send. A placement
// send that cannot be proven is not downgraded to an ordinary send, because that
// would deliver the email while silently losing the evidence the board needs.
// (An ordinary Connect message with NO placement reference is untouched by this
// module and continues to work exactly as before.)

import { resolvePlacementPreceptor } from '../../src/lib/placementCommunication.js';
import { normalizeEmailForLookup } from '../../src/lib/emailUtils.js';
import { placementSendMetadata } from '../../src/lib/placementPreceptorSent.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v.trim());
const eq = (a, b) => String(a || '') === String(b || '');

const fail = (status, error, code) => ({ ok: false, status, error, code, metadata: null });

/**
 * Verify a claimed placement against the database and produce the metadata to
 * stamp on a successful send.
 *
 * @param db            service-role Supabase client
 * @param ref           the browser's claim: { match_id, student_id, unit_id, cohort_id, preceptor_id }
 * @param recipientType 'contact' | 'student' (server-resolved, not from the body)
 * @param recipientEmail the address the send will ACTUALLY use (server-resolved)
 * @returns {{ok: true, metadata: object}} | {{ok: false, status, error, code}}
 */
export async function verifyPlacementSend({ db, ref, recipientType, recipientEmail, skipRecipientCheck = false } = {}) {
  if (!ref) return fail(400, 'Placement reference missing.', 'ref_missing');

  // The handle. Everything else below is a claim, not an input.
  if (!isUuid(ref.match_id)) {
    return fail(400, 'This placement handoff is incomplete and cannot be attributed to a placement.', 'match_id_invalid');
  }
  for (const key of ['student_id', 'unit_id', 'cohort_id', 'preceptor_id']) {
    if (!isUuid(ref[key])) {
      return fail(400, 'This placement handoff is incomplete and cannot be attributed to a placement.', 'ref_incomplete');
    }
  }

  // A preceptor email is addressed to a CONTACT. A student recipient could never
  // be the preceptor, so the pairing is refused rather than reinterpreted.
  // skipRecipientCheck (PRECEPTOR-DRAFT-CONTINUITY-1) exists for the MANUAL
  // confirmation, where no message is being addressed to anyone - every
  // placement check below still runs; only the recipient-address tie is waived.
  if (!skipRecipientCheck && recipientType !== 'contact') {
    return fail(400, 'A placement preceptor email must be addressed to a contact.', 'recipient_type');
  }

  // ── 1. The match must exist ────────────────────────────────────────────────
  const { data: match, error: matchErr } = await db
    .from('matches')
    .select('id, student_id, unit_id, cohort_id, preceptor_id, preceptor_assigned')
    .eq('id', ref.match_id)
    .maybeSingle();
  if (matchErr) {
    return fail(503, 'The placement could not be verified, so nothing was sent. Please try again.', 'match_unreadable');
  }
  if (!match) {
    // The commonest real cause: the placement was unmatched or recreated while a
    // draft sat open. Saying so is more useful than "not found".
    return fail(409, 'This placement no longer exists. Reopen it from the Placement Board and try again.', 'match_missing');
  }

  // ── 2. It must be the student, unit and cohort the handoff claimed ─────────
  if (!eq(match.student_id, ref.student_id)) {
    return fail(409, 'This placement is for a different student than the handoff claimed. Nothing was sent.', 'student_mismatch');
  }
  if (!eq(match.unit_id, ref.unit_id)) {
    return fail(409, 'This placement is for a different unit than the handoff claimed. Nothing was sent.', 'unit_mismatch');
  }
  if (!eq(match.cohort_id, ref.cohort_id)) {
    return fail(409, 'This placement belongs to a different cohort than the handoff claimed. Nothing was sent.', 'cohort_mismatch');
  }

  // ── 3. The student must exist and sit in that same cohort ──────────────────
  const { data: student, error: studentErr } = await db
    .from('students')
    .select('id, cohort_id, preceptor_id, matched_preceptor, preceptor_email, shift_assigned')
    .eq('id', match.student_id)
    .maybeSingle();
  if (studentErr) {
    return fail(503, 'The placement could not be verified, so nothing was sent. Please try again.', 'student_unreadable');
  }
  if (!student) {
    return fail(409, 'The student on this placement no longer exists. Nothing was sent.', 'student_missing');
  }
  if (!eq(student.cohort_id, match.cohort_id)) {
    return fail(409, 'This student is not in the placement’s cohort. Nothing was sent.', 'student_cohort_mismatch');
  }

  // ── 4. The unit must exist and represent that cohort ───────────────────────
  const { data: unit, error: unitErr } = await db
    .from('units')
    .select('id, cohort_id, unit_name')
    .eq('id', match.unit_id)
    .maybeSingle();
  if (unitErr) {
    return fail(503, 'The placement could not be verified, so nothing was sent. Please try again.', 'unit_unreadable');
  }
  if (!unit) {
    return fail(409, 'The unit on this placement no longer exists. Nothing was sent.', 'unit_missing');
  }
  if (!eq(unit.cohort_id, match.cohort_id)) {
    return fail(409, 'This unit belongs to a different cohort than the placement. Nothing was sent.', 'unit_cohort_mismatch');
  }

  // ── 5. The CURRENT preceptor for this placement ────────────────────────────
  // Resolved through the same canonical rule the board displays with, including
  // its multi-placement guard - so a student-level preceptor can stand in only
  // when this is provably the student's single placement.
  const { data: siblingMatches, error: siblingErr } = await db
    .from('matches')
    .select('id, student_id, unit_id, preceptor_id, preceptor_assigned')
    .eq('student_id', match.student_id)
    .eq('cohort_id', match.cohort_id);
  if (siblingErr) {
    return fail(503, 'The placement could not be verified, so nothing was sent. Please try again.', 'placements_unreadable');
  }

  const preceptorIds = [...new Set(
    [match.preceptor_id, student.preceptor_id, ...(siblingMatches || []).map(m => m.preceptor_id)].filter(isUuid),
  )];
  let preceptorRows = [];
  if (preceptorIds.length) {
    const { data: rows, error: precErr } = await db
      .from('preceptors')
      .select('id, full_name, email, shift_type, is_active')
      .in('id', preceptorIds);
    if (precErr) {
      return fail(503, 'The preceptor could not be verified, so nothing was sent. Please try again.', 'preceptors_unreadable');
    }
    preceptorRows = rows || [];
  }
  const byId = new Map(preceptorRows.map(p => [String(p.id), p]));

  const current = resolvePlacementPreceptor({
    student,
    match,
    preceptorsById: byId,
    studentMatches: siblingMatches || [],
  });
  if (!current || !current.id) {
    return fail(409, 'This placement has no assigned preceptor to record a send against. Nothing was sent.', 'preceptor_unassigned');
  }
  if (!eq(current.id, ref.preceptor_id)) {
    // The classic stale-tab case: the preceptor was replaced after the draft opened.
    return fail(409, 'The preceptor assigned to this placement has changed. Reopen it from the Placement Board and try again.', 'preceptor_changed');
  }

  const preceptorRow = byId.get(String(current.id)) || null;
  if (!preceptorRow) {
    return fail(409, 'The assigned preceptor record could not be read. Nothing was sent.', 'preceptor_missing');
  }

  // ── 6. The address being emailed must be that preceptor's ──────────────────
  // The recipient email is the SERVER's resolution of the chosen contact, so this
  // ties the contact actually being written to back to the placement's preceptor.
  const preceptorEmail = normalizeEmailForLookup(preceptorRow.email);
  if (!skipRecipientCheck) {
    const sendingTo = normalizeEmailForLookup(recipientEmail);
    if (!preceptorEmail) {
      return fail(409, 'The assigned preceptor has no email on file. Nothing was sent.', 'preceptor_no_email');
    }
    if (!sendingTo || sendingTo !== preceptorEmail) {
      return fail(409, 'This message is addressed to someone other than the placement’s assigned preceptor. Nothing was sent.', 'recipient_mismatch');
    }
  }

  // ── 7. Stamp from the VERIFIED rows, never from the request ────────────────
  const metadata = placementSendMetadata({
    studentId: match.student_id,
    unitId: match.unit_id,
    preceptorId: current.id,
    cohortId: match.cohort_id,
    matchId: match.id,
  });
  if (!metadata) {
    return fail(500, 'The placement could not be recorded, so nothing was sent.', 'metadata_incomplete');
  }
  return {
    ok: true,
    metadata,
    verified: {
      matchId: match.id,
      unitName: unit.unit_name,
      preceptorName: preceptorRow.full_name,
      preceptorEmail: preceptorRow.email || '',
    },
  };
}
