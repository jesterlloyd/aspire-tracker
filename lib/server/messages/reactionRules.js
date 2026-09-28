// lib/server/messages/reactionRules.js
//
// MESSAGES-SIMPLIFY-1: who may react to what. Staff react to participant
// messages; participants react to staff messages; nobody reacts to their own.
// Removing a reaction is always allowed, so a reaction left on a message before
// this rule existed can still be taken back.
//
// Enforced in the two react endpoints (api/messages-staff-manage.js and
// api/portal/messages-react.js) before the reaction RPC runs. The RPC keeps its
// own guards (active staff, or read access to the conversation).

export function reactionAllowed({ message, actorKind, actorProfileId, reactionKey }) {
  if (reactionKey === null || reactionKey === undefined) return true;
  if (!message) return false;
  if (message.author_profile_id && message.author_profile_id === actorProfileId) return false;
  const fromStaff = message.author_role === 'staff';
  return actorKind === 'staff' ? !fromStaff : fromStaff;
}

export async function loadReactionTarget(db, messageId) {
  const { data, error } = await db
    .from('messages')
    .select('id, author_role, author_profile_id')
    .eq('id', messageId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}
