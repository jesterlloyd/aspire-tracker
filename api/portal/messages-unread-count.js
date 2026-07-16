// api/portal/messages-unread-count.js
//
// ASPIRE MESSAGES, PHASE 3 (STAGE B): GET a lightweight unread count for the
// authenticated student, for a future navigation badge. Counts only
// staff-authored messages newer than this participant's own read pointer, in
// accessible conversations. The participant's own messages are never counted.

import { verifyPortalStudentCaller, getUserScopedDb } from '../lib/messagesAuth.js';
import { methodGuard, logApiError } from '../lib/messagesApi.js';

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['GET'])) return;

  const caller = await verifyPortalStudentCaller(req);
  if (!caller.ok) return res.status(caller.status).json({ error: caller.reason });

  const db = getUserScopedDb(req);
  if (!db) return res.status(401).json({ error: 'unauthenticated' });

  try {
    const { data, error } = await db.rpc('messages_portal_unread_count');
    if (error) {
      logApiError('portal/messages-unread-count', 'rpc_failed', error);
      return res.status(500).json({ error: 'internal_error' });
    }
    return res.status(200).json({ unread_count: Number(data) || 0 });
  } catch (err) {
    logApiError('portal/messages-unread-count', 'threw', err);
    return res.status(500).json({ error: 'internal_error' });
  }
}
