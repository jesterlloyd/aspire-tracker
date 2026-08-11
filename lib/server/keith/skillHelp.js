// KEITH-SKILL-HELP-1: answering "how do I use /<slug>?" from the registry.
//
// THE DEFECT THIS FIXES
// An Interviewer asked "How do I use /resume-interview-questions?" and Keith
// replied that it had no documentation for that command - about a skill that
// caller is authorized to run. Two separate causes:
//
//   A. Keith deliberately never receives the skill catalogue (progressive
//      loading, see skillRuntime.js). Base Keith therefore cannot describe a
//      skill it was never told about, and the slug spelling (hyphenated) does
//      not match the registered trigger phrases (space-separated), so nothing
//      was selected either. The turn fell through to base Keith, which honestly
//      answered that it did not know the command.
//   B. The mirror-image failure: phrase the SAME question without the slashes -
//      "how do I use resume interview questions?" - and the trigger phrase
//      matches as a substring, so the skill EXECUTES. Asking for documentation
//      ran the tool.
//
// So this module does one thing: when a turn is clearly ASKING ABOUT a skill
// rather than invoking one, it answers from the canonical registry and returns
// before any execution path. Help and execution stay distinct in both
// directions - a help question never runs a skill, and this never intercepts a
// real invocation.
//
// PROGRESSIVE LOADING IS PRESERVED. The answer is built from the metadata the
// runtime already loaded for authorization (display_name, description,
// io_contract, trigger_phrases). Instruction bodies are NOT read, so a
// confidential skill's operating prompt is never surfaced to anyone - not even
// to a caller authorized to run it. Documentation is not the prompt.
//
// FAIL CLOSED, WITHOUT AN EXISTENCE ORACLE. Resolution runs against the
// caller's own invocable list, which is already filtered to active + enabled +
// role-authorized. A slug that is disabled, draft, or restricted to other roles
// is simply "not available to you" - the same answer as a slug that does not
// exist. An unauthorized caller cannot use this surface to discover that a
// confidential skill exists, and a draft skill is never described as usable.

/**
 * Phrasings that mean "tell me about this" rather than "do this".
 * Deliberately narrow: "use X for Sarah" is an invocation and must not match.
 */
const HELP_INTENT = [
  /\bhow\s+(?:do|can|would|should)\s+i\s+use\b/i,
  /\bhow\s+(?:to|do\s+you)\s+use\b/i,
  /\bhow\s+does\s+.{0,160}?\bwork\b/i,
  /\bwhat\s+(?:does|do)\b.{0,160}?\bdo\b/i,
  /\bwhat(?:'s|\s+is|\s+are)\b/i,
  /\bwhen\s+(?:should|do|would)\s+i\s+use\b/i,
  /\b(?:explain|describe)\b/i,
  /\btell\s+me\s+about\b/i,
  /\b(?:help|documentation|docs|instructions)\s+(?:for|on|with|about)\b/i,
];

export function hasHelpIntent(text) {
  const t = String(text || '');
  return HELP_INTENT.some(re => re.test(t));
}

/**
 * Phrasings that DIRECT Keith to run something, as opposed to asking about it.
 * These outrank help intent, so "run /x and explain the result" executes rather
 * than documenting - the "explain" there describes what to do with the OUTPUT,
 * not a request for documentation.
 *
 * Deliberately imperative. A bare "use" is not enough, because "how do I use
 * /x?" is the canonical help question; an imperative use names a target
 * ("use /x FOR this student").
 */
const RUN_INTENT = [
  /\b(?:run|execute|invoke)\b/i,
  /\buse\s+\/?[\w.-]+\s+(?:for|on|with|against)\b/i,
];

export function hasRunIntent(text) {
  const t = String(text || '');
  return RUN_INTENT.some(re => re.test(t));
}

/** Every `/slug`-shaped token in the text, lowercased, order preserved. */
export function extractSlashSlugs(text) {
  const out = [];
  const re = /\/([a-z0-9][a-z0-9._-]{1,80})/gi;
  let m;
  while ((m = re.exec(String(text || ''))) !== null) out.push(m[1].toLowerCase());
  return out;
}

/**
 * Is this turn asking ABOUT a skill?
 *
 * @param {string} userText
 * @param {Array}  skills - the caller's invocable skills (already authorized)
 * @returns {null | { skill: object|null, ref: string, matchedBy: string }}
 *   null            - not a help turn; the caller's normal path is untouched.
 *   { skill }       - resolved to a skill this caller may use.
 *   { skill: null } - a skill reference we will not confirm (unknown, draft,
 *                     disabled, or not this caller's) -> fail-closed answer.
 */
export function detectSkillHelp(userText, skills) {
  const text = String(userText || '');
  if (!text.trim() || !hasHelpIntent(text)) return null;
  // An explicit instruction to RUN outranks a help phrasing in the same
  // sentence. "Can you run /x and explain the result?" is an invocation whose
  // output the caller wants explained, not a request for documentation.
  if (hasRunIntent(text)) return null;

  const list = Array.isArray(skills) ? skills : [];
  const bySlug = new Map(list.map(s => [String(s.slug).toLowerCase(), s]));

  // 1. An explicit /slug reference anywhere in the sentence - the clearest
  //    signal, and the one the reported defect used.
  //
  //    AMBIGUITY FAILS CLOSED, matching selectSkill: two DIFFERENT resolvable
  //    slugs in one message resolve to neither. Answering about one of them
  //    would be a guess, and there is no multi-skill contract.
  const slashSlugs = extractSlashSlugs(text);
  const resolved = [...new Set(slashSlugs)].filter(sl => bySlug.has(sl));
  if (resolved.length > 1) {
    return { skill: null, ref: resolved.join('`, `/'), matchedBy: 'ambiguous', ambiguous: true };
  }
  if (resolved.length === 1) {
    return { skill: bySlug.get(resolved[0]), ref: resolved[0], matchedBy: 'slash_slug' };
  }
  if (slashSlugs.length) {
    // Referenced something slash-shaped we cannot serve. Answer without
    // revealing whether it exists.
    return { skill: null, ref: slashSlugs[0], matchedBy: 'slash_slug' };
  }

  // 2. A bare slug ("what does resume-interview-questions do?").
  const lower = text.toLowerCase();
  for (const [slug, skill] of bySlug) {
    if (lower.includes(slug)) return { skill, ref: slug, matchedBy: 'bare_slug' };
  }

  // 3. A registered trigger phrase inside a HELP question. This is the case
  //    that used to execute the skill; here it documents it instead. Longest
  //    phrase wins, mirroring selectSkill's own precedence.
  let best = null;
  for (const skill of list) {
    for (const phrase of skill.trigger_phrases || []) {
      const p = String(phrase || '').toLowerCase().trim();
      if (!p || !lower.includes(p)) continue;
      if (!best || p.length > best.len) best = { skill, len: p.length, ref: p };
    }
  }
  if (best) return { skill: best.skill, ref: best.ref, matchedBy: 'trigger_phrase' };

  // Help-shaped, but about nothing in the registry - leave it to base Keith.
  return null;
}

// ── Answer rendering ────────────────────────────────────────────────────────
// Deterministic and metadata-only: no model call, nothing to hallucinate, and
// no instruction body to leak.

function renderContractSide(value) {
  if (value == null) return null;
  if (Array.isArray(value)) return value.map(v => String(v)).join(', ');
  if (typeof value === 'object') {
    const parts = Object.entries(value).map(([k, v]) => {
      const label = k.replace(/_/g, ' ');
      return `- **${label}:** ${Array.isArray(v) ? v.map(String).join(', ') : String(v)}`;
    });
    return parts.length ? parts.join('\n') : null;
  }
  return String(value);
}

/** The usage answer for a skill this caller may run. */
export function buildSkillHelpResponse(skill) {
  const name = skill.display_name || skill.slug;
  const lines = [`**${name}** — \`/${skill.slug}\``, ''];

  if (skill.description) lines.push(skill.description, '');

  lines.push('**How to run it**');
  lines.push(`Type \`/\` in the message box and pick **${name}**, or type \`/${skill.slug}\` directly.`);
  const phrases = (skill.trigger_phrases || []).filter(Boolean);
  if (phrases.length) {
    lines.push(`Saying “${phrases[0]}” in a message also runs it.`);
  }
  lines.push('');

  const input = renderContractSide(skill.io_contract?.input);
  if (input) {
    lines.push('**What it needs from you**');
    lines.push(input);
    lines.push('');
  }

  const output = renderContractSide(skill.io_contract?.output);
  if (output) {
    lines.push('**What you get back**');
    lines.push(output);
    lines.push('');
  }

  if (skill.data_classification === 'confidential') {
    lines.push(
      '_This skill reads protected student information, so it is limited to specific roles ' +
      'and runs only on a student you are entitled to see._',
    );
  }

  return lines.join('\n').trim();
}

/**
 * The answer when a slash reference cannot be served to this caller. One
 * message for every reason - unknown, draft, disabled, or another role's -
 * so the reply is never an existence oracle.
 */
export function buildSkillAmbiguousResponse(refs) {
  const list = String(refs || '').split('`, `/').filter(Boolean);
  return [
    `Your message names more than one skill (\`/${list.join('`, `/')}\`), so I have not run or ` +
    'described either one.',
    '',
    'Ask about them one at a time, or send the command for the one you want.',
  ].join('\n');
}

export function buildSkillUnavailableResponse(ref, skills) {
  const available = (Array.isArray(skills) ? skills : []).filter(Boolean);
  const lines = [`I do not have a skill called \`/${ref}\` available for your role.`];
  if (available.length) {
    lines.push('', 'Skills you can run right now:');
    for (const s of available) {
      lines.push(`- \`/${s.slug}\` — ${s.display_name || s.slug}`);
    }
    lines.push('', 'Type `/` in the message box to pick one.');
  } else {
    lines.push('', 'You do not currently have any Keith skills available.');
  }
  return lines.join('\n');
}
