// src/lib/messages/reactionConstants.js
//
// MESSAGES-LIFECYCLE-PHASE3A-REACTIONS: shared constants and pure helpers for
// per-user message reactions on both the staff and portal Messages surfaces.
//
// Reactions are quiet acknowledgements: they never notify anyone and never
// change unread or archive state. That is enforced entirely server-side; this
// file only carries display constants and local (optimistic) merge helpers.
//
// The three keys below are a SERVER-ENFORCED allowlist (the
// message_reactions.reaction_key CHECK constraint in
// supabase/migrations/20260801000000_messages_phase3a_reactions.sql). A caller
// must never render a key outside this list; reactionByKey() returns undefined
// for anything else, and every renderer must treat that as "skip".

export const MESSAGE_REACTIONS = [
  { key: 'acknowledge', glyph: '✓', label: 'Got it' },
  { key: 'thanks', glyph: '🙏', label: 'Thank you' },
  { key: 'celebrate', glyph: '🎉', label: 'Celebrate' },
];

const BY_KEY = new Map(MESSAGE_REACTIONS.map((r) => [r.key, r]));

export function reactionByKey(key) {
  return BY_KEY.get(key);
}

// Optimistically apply a local reaction change to one message's `reactions`
// array, returning a NEW array (never mutates the input). Mirrors the
// authoritative server rule: one reaction per caller, clicking the current
// reaction removes it, clicking a different one replaces it. Callers only ever
// pass a nextKey that differs from the caller's current key (the UI sends
// null instead of re-selecting the same key), so this never has to special-
// case "select the same key again".
export function applyOptimisticReaction(reactions, nextKey) {
  const list = Array.isArray(reactions) ? reactions : [];
  const mine = list.find((r) => r?.mine);
  const withoutMine = list
    .map((r) => (r?.key === mine?.key ? { ...r, count: Math.max(0, (r.count || 0) - 1), mine: false } : r))
    .filter((r) => r.count > 0 || r.key !== mine?.key);

  if (!nextKey) return withoutMine;

  const existing = withoutMine.find((r) => r?.key === nextKey);
  if (existing) {
    return withoutMine.map((r) => (r.key === nextKey ? { ...r, count: r.count + 1, mine: true } : r));
  }
  return [...withoutMine, { key: nextKey, count: 1, mine: true }];
}
