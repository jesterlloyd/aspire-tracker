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
export async function loadActiveParticipant(db, conversationId) {
  const { data: cp, error } = await db
    .from('conversation_participants')
    .select('participant_profile_id, scope_student_id')
    .eq('conversation_id', conversationId)
    .is('removed_at', null)
    .maybeSingle();
  if (error || !cp) return null;

  const { data: p } = await db
    .from('user_profiles')
    .select('id, email, full_name')
    .eq('id', cp.participant_profile_id)
    .maybeSingle();
  if (!p) return null;

  return {
    profileId: p.id,
    email: p.email,
    fullName: p.full_name,
    studentId: cp.scope_student_id,
  };
}
