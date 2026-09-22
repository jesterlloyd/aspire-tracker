// src/lib/messages/reactionConstants.js
//
// MESSAGES-LIFECYCLE-PHASE3A-REACTIONS: shared constants and pure helpers for
// per-user message reactions on both the staff and portal Messages surfaces.
//
// Reactions are quiet acknowledgements: they never notify anyone and never
// change unread or archive state. That is enforced entirely server-side; this
// file only carries display constants and local (optimistic) merge helpers.
//
// The six keys below are a SERVER-ENFORCED allowlist. The original keys remain
// stable so existing acknowledge, thanks, and celebrate rows keep their meaning
// while the refined picker changes their glyphs and labels. Migration
// 20260922000000_messages_refinement_triage_reactions expands the CHECK with
// on_it, done, and warm. A caller must never render a key outside this list.

export const MESSAGE_REACTIONS = [
  { key: 'acknowledge', glyph: '👍', label: 'Got it' },
  { key: 'on_it', glyph: '👀', label: 'On it' },
  { key: 'done', glyph: '✅', label: 'Done' },
  { key: 'thanks', glyph: '🙏', label: 'Thanks' },
  { key: 'warm', glyph: '🙂', label: 'Warm' },
  { key: 'celebrate', glyph: '🎉', label: 'Milestone' },
];

// Before the refinement migration is present, the thread endpoint reports
// reaction_set_version=1. Keep the deployed three-key set available so a
// code-first release never offers keys the database cannot yet accept.
export const LEGACY_MESSAGE_REACTIONS = MESSAGE_REACTIONS.filter((r) => (
  r.key === 'acknowledge' || r.key === 'thanks' || r.key === 'celebrate'
));

const BY_KEY = new Map(MESSAGE_REACTIONS.map((r) => [r.key, r]));

export function reactionByKey(key) {
  return BY_KEY.get(key);
}

export function reactionsForVersion(version) {
  return Number(version) >= 2 ? MESSAGE_REACTIONS : LEGACY_MESSAGE_REACTIONS;
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
