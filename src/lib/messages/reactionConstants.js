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

import { firstName } from './messagesTriage.js';

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

// MESSAGES-SIMPLIFY-1: the staff thread also names who reacted (thread v5's
// reactors). Apply the viewer's change to that list the same way, so the badge's
// names and the banner update before the refetch lands.
export function applyOptimisticReactors(reactors, viewer, nextKey) {
  const list = Array.isArray(reactors) ? reactors : [];
  if (!viewer?.id) return list;
  const others = list.filter((r) => r?.profile_id !== viewer.id);
  if (!nextKey) return others;
  return [...others, { key: nextKey, profile_id: viewer.id, name: viewer.full_name || '', is_staff: true }];
}

// MESSAGES-SIMPLIFY-1: the corner badge (see src/components/shared/MessageReactions.jsx).
// Who reacted, as short sentences: "You reacted Got it", "Krystal reacted
// Thanks". Staff threads carry reactor identities; portal threads carry only
// counts and the viewer's own flag, so others read "Reacted Got it".
export function reactionSentences(message, viewerId = null) {
  const reactors = Array.isArray(message?.reactors) ? message.reactors : null;
  if (reactors && reactors.length) {
    return reactors
      .filter((r) => reactionByKey(r?.key))
      .map((r) => {
        const who = viewerId && r.profile_id === viewerId ? 'You' : (firstName(r.name) || 'Someone');
        return `${who} reacted ${reactionByKey(r.key).label}`;
      });
  }
  const list = (Array.isArray(message?.reactions) ? message.reactions : [])
    .filter((r) => r && reactionByKey(r.key) && r.count > 0);
  const out = [];
  for (const r of list) {
    const label = reactionByKey(r.key).label;
    if (r.mine) out.push(`You reacted ${label}`);
    const others = r.count - (r.mine ? 1 : 0);
    if (others === 1) out.push(`Reacted ${label}`);
    else if (others > 1) out.push(`${others} people reacted ${label}`);
  }
  return out;
}

// The badge's content: up to three distinct glyphs, most-used first, and the total.
export function reactionBadgeContent(message) {
  const list = (Array.isArray(message?.reactions) ? message.reactions : [])
    .filter((r) => r && reactionByKey(r.key) && r.count > 0);
  const total = list.reduce((n, r) => n + r.count, 0);
  const glyphs = list
    .slice()
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
    .map((r) => reactionByKey(r.key).glyph);
  return { glyphs, total };
}
