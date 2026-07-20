// api/lib/messagesContext.js
//
// ASPIRE MESSAGES, PHASE 3 (STAGE B): narrowly scoped server-side lookups needed
// to ROUTE a notification. These are the only service-role reads in the Messages
// API layer, and they exist because Phase 2 routing needs the conversation
// subject, category, any eligible assignee, and the active participant identity.
//
// They NEVER grant access. Every authoritative write still re-validates
// authorization inside the transactional RPC, and an inaccessible conversation
// still returns a non-enumerating 404. Nothing here is returned to a caller
// verbatim; it feeds the routing service only.

// Minimal conversation context for routing a portal reply.
// Returns null when the conversation does not exist.
export async function loadConversationRoutingContext(db, conversationId) {
  const { data: conv, error } = await db
    .from('conversations')
    .select('id, subject, category, assigned_staff_profile_id')
    .eq('id', conversationId)
    .maybeSingle();
  if (error || !conv) return null;

  let assignedStaff = null;
  if (conv.assigned_staff_profile_id) {
    const { data: a } = await db
      .from('user_profiles')
      .select('id, email, role, is_active')
      .eq('id', conv.assigned_staff_profile_id)
      .maybeSingle();
    if (a) {
      assignedStaff = {
        profileId: a.id,
        email: a.email,
        role: a.role,
        isActive: a.is_active !== false,
      };
    }
  }

  return {
    id: conv.id,
    subject: conv.subject,
    category: conv.category,
    assignedStaff,
  };
}

// The conversation's active portal participant, with the authoritative
// notification email. Messages always notifies user_profiles.email for the
// portal account, never students.school_email or students.personal_email.
// Returns null when there is no active participant row.
// UL-PORTAL: a conversation may now hold TWO active portal participants (a student
// and a unit leader). The previous implementation used .maybeSingle(), which ERRORS
// on more than one row and would have made every staff reply into a direct thread
// fail with no_active_participant. Staff themselves are never participants.
export async function loadActiveParticipants(db, conversationId) {
  const { data: rows, error } = await db
    .from('conversation_participants')
    .select('participant_profile_id, participant_role, scope_student_id, scope_unit_key, added_at')
    .eq('conversation_id', conversationId)
    .is('removed_at', null)
    .order('added_at', { ascending: true });
  if (error || !rows || rows.length === 0) return [];

  const ids = rows.map(r => r.participant_profile_id);
  const { data: profiles } = await db
    .from('user_profiles')
    .select('id, email, full_name')
    .in('id', ids);
  const byId = new Map((profiles || []).map(p => [p.id, p]));

  return rows
    .map(r => {
      const p = byId.get(r.participant_profile_id);
      if (!p) return null;
      return {
        profileId: p.id,
        email: p.email,
        fullName: p.full_name,
        role: r.participant_role,
        studentId: r.scope_student_id,
        unitKey: r.scope_unit_key,
      };
    })
    .filter(Boolean);
}

// Backward-compatible single-participant accessor. Returns the first active
// participant in join order, or null. Callers that must address a specific party in
// a two-party thread use loadActiveParticipants and choose explicitly.
export async function loadActiveParticipant(db, conversationId) {
  const all = await loadActiveParticipants(db, conversationId);
  return all.length > 0 ? all[0] : null;
}

// UL-PORTAL: resolve the OTHER portal participant of a direct thread, from verified
// server state only. Returns null for a single-participant (student to ASPIRE Team)
// conversation, which is how a caller distinguishes the two thread shapes without
// trusting anything from the request.
export async function loadDirectCounterpart(db, conversationId, selfProfileId) {
  const participants = await loadActiveParticipants(db, conversationId);
  if (participants.length < 2) return null;
  const other = participants.find(p => p.profileId !== selfProfileId);
  if (!other) return null;
  return {
    profileId: other.profileId,
    email: other.email,
    fullName: other.fullName,
    role: other.role,
    unitKey: other.unitKey || null,
    studentId: other.studentId || null,
  };
}
