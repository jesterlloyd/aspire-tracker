// Pure staff-triage helpers shared by the inbox rows, quick filters, and thread
// wait bar. These are derived states, never stored flags.

export function needsYourReply(item) {
  return item?.status !== 'resolved'
    && Boolean(item?.latest_author_role)
    && item.latest_author_role !== 'staff';
}

export function isUnassigned(item) {
  return item?.status !== 'resolved' && !item?.assigned_staff_profile_id;
}

export function ageInDays(value, now = new Date()) {
  const then = value instanceof Date ? value : new Date(value);
  const current = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(then.getTime()) || Number.isNaN(current.getTime())) return null;
  return Math.max(0, Math.floor((current.getTime() - then.getTime()) / 86400000));
}

export function isStale(item, now = new Date()) {
  const age = ageInDays(item?.last_message_at, now);
  return item?.status !== 'resolved' && age !== null && age >= 7;
}

export function waitState(conversation, latestMessage, now = new Date()) {
  if (conversation?.status === 'resolved') {
    return { kind: 'resolved', age: null, label: '✓ Resolved · no reply needed' };
  }
  const latestAuthorRole = latestMessage?.author_role || conversation?.latest_author_role;
  const age = ageInDays(latestMessage?.created_at || conversation?.last_message_at, now) ?? 0;
  const days = `${age} ${age === 1 ? 'day' : 'days'}`;
  if (latestAuthorRole === 'staff') {
    return { kind: 'waiting', age, label: `Waiting on them · ${days} since your reply` };
  }
  return {
    kind: 'needs_reply', age, label: `Needs your reply · they wrote ${days} ago`,
  };
}
