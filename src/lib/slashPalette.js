// KEITH-SLASH-ANYWHERE-CLIENT-1: where the Skills palette is, and what
// selecting from it does.
//
// THE DEFECT THIS FIXES
// The server was taught to resolve `/slug` anywhere in a message
// (KEITH-SLASH-ANYWHERE-1), but the composer was not. The client asked
// `input.startsWith('/')`, so the palette only ever appeared when the slash was
// the very first character. Typing the natural sentence
//
//     Hey, can you use /
//
// produced no palette at all: the caller had to know the slug by heart, or
// erase what they had written and start the message with the command.
//
// Two further defects fell out of the same position-0 assumption, and both are
// fixed here because a mid-sentence palette makes them destructive rather than
// merely awkward:
//
//   - Selecting a skill rebuilt the whole composer as `/slug `, discarding
//     every word around it. Mid-sentence, that deletes the caller's message.
//   - Escape cleared the input. Mid-sentence, that deletes it too.
//
// THE MODEL
// The palette is anchored to a CARET, not to the string. There is an active
// slash token when the caret sits inside a `/`-led run of slug characters whose
// slash begins a token - the start of the text, or immediately after
// whitespace. Everything the composer needs (is it open, what filters it, what
// gets replaced on selection) is derived from that one token.
//
// This subsumes the old "committed" heuristic. The menu used to close by
// checking whether the text held an exact slug followed by a separator; now it
// closes because the caret is no longer inside a token - which is precisely
// what a selection leaves behind, and what typing past the command does too.
//
// WHAT IS DELIBERATELY NOT A COMMAND. The token-boundary rule is what keeps
// ordinary punctuation quiet: `50/50`, `8/11`, `http://host`, `and/or` and
// `mg/dL` all have a non-space character before the slash, so none of them
// opens a palette.
//
// AUTHORIZATION IS NOT THIS MODULE'S JOB, and it must never look like it is.
// The catalogue passed in is whatever `/api/keith` (mode `skills_catalog`)
// returned for THIS caller, already filtered server-side to active + enabled +
// role-authorized by loadInvocableSkills. Nothing here can widen it: filtering
// only ever narrows the given list, and selection can only ever insert a slug
// that was in it. An empty catalogue offers nothing.

// Characters that may appear in a command token. Deliberately matches the
// composer's own send-path slug shape ([a-z0-9-]) rather than the server's
// wider pattern: a "." is far more often the end of a sentence than part of a
// slug, and treating it as a token character swallowed the full stop in
// "Please use /some-skill." - replacing the punctuation along with the command.
const TOKEN_CHAR = /[A-Za-z0-9_-]/;

/**
 * The command token the caret is currently inside, if any.
 *
 * @param {string} text   the composer's full value
 * @param {number} caret  selectionStart; defaults to the end of the text
 * @returns {null | { start: number, end: number, query: string }}
 *   start - index of the `/`
 *   end   - index just past the token (may be beyond the caret when editing
 *           the middle of a word)
 *   query - the token body, lowercased, `''` for a bare `/`
 */
export function findSlashToken(text, caret) {
  const s = typeof text === 'string' ? text : '';
  const pos = Number.isInteger(caret)
    ? Math.max(0, Math.min(caret, s.length))
    : s.length;

  // Walk back from the caret over token characters; the slash must sit
  // immediately before the run. A caret directly after a bare `/` walks zero
  // steps, which is the "just typed the slash" case.
  let i = pos;
  while (i > 0 && TOKEN_CHAR.test(s[i - 1])) i -= 1;

  const start = i - 1;
  if (start < 0 || s[start] !== '/') return null;

  // TOKEN BOUNDARY: a command starts a word. Anything else before the slash
  // means this is punctuation, a path, or a fraction - not a command.
  if (start > 0 && !/\s/.test(s[start - 1])) return null;

  let end = pos;
  while (end < s.length && TOKEN_CHAR.test(s[end])) end += 1;

  return { start, end, query: s.slice(start + 1, end).toLowerCase() };
}

/**
 * The catalogue entries matching a token body. Narrowing only: every result
 * came from the supplied list, so an unauthorized skill cannot appear here
 * because it was never in the caller's catalogue to begin with.
 */
export function filterSkills(skills, query) {
  if (!Array.isArray(skills)) return [];
  const q = String(query || '').toLowerCase();
  if (!q) return skills;
  return skills.filter(s =>
    String(s?.slug || '').toLowerCase().includes(q)
    || String(s?.name || '').toLowerCase().includes(q));
}

/**
 * Replace ONLY the active token with the chosen command, keeping everything
 * the caller wrote around it.
 *
 * The caret lands after the command and its separating space - ready to type
 * the rest of the sentence - and, because it is then outside any token, that
 * placement is also what closes the palette.
 *
 * @returns {{ value: string, caret: number }} the composer's next state
 */
export function applySlashSelection(text, token, slug) {
  const s = typeof text === 'string' ? text : '';
  if (!token || typeof slug !== 'string' || !slug) return { value: s, caret: s.length };

  const before = s.slice(0, token.start);
  const after = s.slice(token.end);
  const command = `/${slug}`;
  // Exactly one separator after the command. A space is inserted unless the
  // caller's own text already supplies one - or supplies punctuation, where an
  // inserted space would read as a typo ("/slug .").
  const needsSpace = !/^[\s.,;:!?)\]]/.test(after);
  const value = before + command + (needsSpace ? ' ' : '') + after;

  // One past the separator, whether we inserted it or the caller already had
  // one. Uniform placement is what guarantees the caret is outside the token,
  // and therefore that selecting a skill always closes the palette.
  const caret = Math.min(before.length + command.length + 1, value.length);
  return { value, caret };
}
