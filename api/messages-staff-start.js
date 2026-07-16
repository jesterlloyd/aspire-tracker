// api/messages-staff-start.js
//
// ASPIRE MESSAGES, PHASE 3 (STAGE B): POST a staff-started conversation with an
// active Student Portal participant. Active Owner or Admin only.
//
// The target must hold an active student grant and an active student link; the
// transactional RPC re-verifies this and raises MS409 without creating the
// conversation if portal access is inactive. The notification targets the portal
// account's user_profiles.email, never students.school_email or personal_email.

/* global process */
import { Resend } from 'resend';
import { verifyStaffCaller, getServiceDb } from './lib/messagesAuth.js';
import { methodGuard, readJsonBody, mapRpcError, logApiError } from './lib/messagesApi.js';
import { validateSubject, validateBody, validateCategory, isUuid } from '../lib/server/messages/validation.js';
import { startConversationForStaff } from '../lib/server/messages/conversationService.js';

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['POST'])) return;

  const caller = await verifyStaffCaller(req);
  if (!caller.ok) return res.status(caller.status).json({ error: caller.reason });

  const parsed = readJsonBody(req);
  if (!parsed.ok) return res.status(parsed.status).json({ error: parsed.error });

  const participantProfileId = parsed.body.participant_profile_id;
  const studentId = parsed.body.student_id;
  if (!isUuid(participantProfileId)) return res.status(422).json({ error: 'invalid_participant_profile_id' });
  if (!isUuid(studentId)) return res.status(422).json({ error: 'invalid_student_id' });

  const subject = validateSubject(parsed.body.subject);
  if (!subject.ok) return res.status(422).json({ error: subject.error });
  const body = validateBody(parsed.body.body);
  if (!body.ok) return res.status(422).json({ error: body.error });
  const category = validateCategory(parsed.body.category);
  if (!category.ok) return res.status(422).json({ error: category.error });

  const db = getServiceDb();

  try {
    // Resolve the portal account's authoritative notification email.
    const { data: target } = await db
      .from('user_profiles')
      .select('id, email')
      .eq('id', participantProfileId)
      .maybeSingle();
    if (!target?.email) return res.status(409).json({ error: 'conflict', reason: 'participant_email_unavailable' });

    const out = await startConversationForStaff(
      { db, resend: new Resend(process.env.RESEND_API_KEY) },
      {
        profile: caller.profile,
        participantProfileId,
        participantEmail: target.email,
        studentId,
        subject: subject.value,
        category: category.value,
        body: body.value,
      },
    );
    if (out.rpcError) {
      const mapped = mapRpcError(out.rpcError);
      logApiError('messages-staff-start', mapped.error, out.rpcError);
      return res.status(mapped.status).json({ error: mapped.error });
    }
    if (!out.ok) return res.status(409).json({ error: 'conflict', reason: out.reason });

    return res.status(201).json({
      conversation_id: out.result.conversation_id,
      message_id: out.result.message_id,
      created_at: out.result.created_at,
      status: 'open',
    });
  } catch (err) {
    logApiError('messages-staff-start', 'threw', err);
    return res.status(500).json({ error: 'internal_error' });
  }
}
