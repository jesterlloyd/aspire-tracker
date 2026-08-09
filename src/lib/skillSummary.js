// SKILL-PALETTE-1: a compact display summary for the "/" command palette.
//
// PRESENTATION ONLY. This never touches stored data: the canonical skill
// description, the full Claude trigger guidance, the instructions, the trigger
// phrases and the reference files are all unchanged and still reach the model
// and the detail drawer exactly as before. This function decides what ONE line
// of the picker says, nothing else.
//
// Imported Claude skills carry descriptions that double as activation guidance
// - several hundred characters of "use this whenever…, trigger on phrases
// like…" - which is correct for matching and useless in a palette. The rule:
// prefer the description's own first sentence when it is already concise;
// otherwise cut it down deterministically at a word boundary. Same rule for
// built-in and imported skills, so the menu reads consistently.

export const PALETTE_SUMMARY_MAX = 160;

// Abbreviations whose trailing period must not end a "sentence".
const ABBREVIATIONS = /\b(?:e\.g|i\.e|etc|vs|approx|Dr|Mr|Mrs|Ms|Prof|St|No|Inc|Ltd|Jr|Sr|a\.m|p\.m|U\.S)\.$/i;

/** Flatten the light markup a description may carry into plain prose. */
function flatten(text) {
  return String(text || '')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')   // wikilink label
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')          // markdown link
    .replace(/[*_`#>]/g, '')                          // emphasis / heading marks
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The first sentence, or null when the text has no clean sentence break.
 * A period that ends a known abbreviation does not end the sentence.
 */
function firstSentence(text) {
  const re = /[.!?]+(?=\s|$)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const end = m.index + m[0].length;
    const candidate = text.slice(0, end).trim();
    if (ABBREVIATIONS.test(candidate)) continue;      // "e.g." is not an ending
    if (candidate.length < 12) continue;              // "Ok." is not a summary
    return candidate;
  }
  return null;
}

/** Cut at the last word boundary that fits, and mark the cut. */
function clip(text, max) {
  if (text.length <= max) return text;
  const slice = text.slice(0, max - 1);
  const cut = slice.lastIndexOf(' ');
  const body = (cut > max * 0.6 ? slice.slice(0, cut) : slice).replace(/[\s,;:.]+$/, '');
  return `${body}…`;
}

/**
 * The palette line for a skill. Deterministic and pure.
 * Falls back through description → name → slug so the picker always shows
 * something meaningful, and never returns markup or a multi-line string.
 */
export function paletteSummary(skill, max = PALETTE_SUMMARY_MAX) {
  const description = flatten(skill?.description);
  if (description) {
    const sentence = firstSentence(description);
    // A concise first sentence is the author's own summary - prefer it.
    if (sentence && sentence.length <= max) return sentence;
    // Otherwise cut the description (or that long first sentence) to fit.
    return clip(sentence || description, max);
  }
  const name = flatten(skill?.name || skill?.display_name);
  return name ? clip(name, max) : '';
}
