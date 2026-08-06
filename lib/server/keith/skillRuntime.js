// KEITH-P1: the skill runtime.
//
// PROGRESSIVE LOADING is the whole point of this file. Keith never receives the
// skill catalogue and never receives an unselected skill's instructions. The
// sequence is:
//
//   1. Fetch enabled + active skills as METADATA ONLY (id, slug, name, triggers,
//      roles, classification). Instruction bodies are not selected.
//   2. Decide whether this turn explicitly invokes one.
//   3. Only then load THAT skill's instruction body and splice it into the
//      prompt at the [[ACTIVE_SKILL]] marker.
//
// EXPLICIT INVOCATION ONLY for confidential skills, per the approved policy. Two
// ways in, both deliberate acts by the caller:
//   - picker: the client sends skill_slug, chosen from a visible control.
//   - trigger_phrase: the user's message CONTAINS one of the skill's registered
//     phrases as a substring. Not a fuzzy match, not a keyword score.
// Anything else runs base Keith. A confidential skill is never selected because
// a question merely sounded relevant.

import { authorizeSkillForCaller, normalizeCaller, DENY } from './skillAuthorization.js';

export const ACTIVE_SKILL_MARKER = '[[ACTIVE_SKILL]]';

// Columns safe to load for every enabled skill on every request. Note the
// absence of instruction_body.
const CATALOG_COLUMNS = 'id, slug, display_name, description, version, status, enabled, allowed_roles, required_tools, required_data, trigger_phrases, data_classification, model_route';

/**
 * Skills this caller may see and invoke, metadata only. Returns [] on any
 * failure: a catalogue lookup problem must degrade to base Keith, never to an
 * unauthorized skill.
 */
export async function loadInvocableSkills(db, caller) {
  try {
    const { data, error } = await db
      .from('keith_skills')
      .select(CATALOG_COLUMNS)
      .eq('status', 'active')
      .eq('enabled', true);
    if (error) throw new Error(error.message);
    return (data || []).filter(s => authorizeSkillForCaller(s, caller).ok);
  } catch (err) {
    console.warn('[keith-skills] catalog load failed', { reason: err?.message });
    return [];
  }
}

/**
 * Decide which skill, if any, this turn invokes.
 * `requestedSlug` comes from the picker; `userText` is the last user message.
 * Returns { skill, mode } or null.
 */
export function selectSkill(skills, { requestedSlug, userText }) {
  const list = Array.isArray(skills) ? skills : [];
  if (!list.length) return null;

  if (requestedSlug) {
    const picked = list.find(s => s.slug === String(requestedSlug));
    return picked ? { skill: picked, mode: 'picker' } : null;
  }

  const text = String(userText || '').toLowerCase();
  if (!text) return null;

  // Longest phrase wins, so a specific phrase beats a generic one that happens
  // to be a prefix of it.
  let best = null;
  for (const skill of list) {
    for (const phrase of skill.trigger_phrases || []) {
      const p = String(phrase || '').toLowerCase().trim();
      if (!p || !text.includes(p)) continue;
      if (!best || p.length > best.phraseLength) best = { skill, phraseLength: p.length };
    }
  }
  return best ? { skill: best.skill, mode: 'trigger_phrase' } : null;
}

/** Load one skill's instruction body. Called only after authorization. */
export async function loadSkillInstructions(db, skillId) {
  const { data, error } = await db
    .from('keith_skills')
    .select('id, slug, version, instruction_body, status, enabled')
    .eq('id', skillId)
    .maybeSingle();
  if (error || !data) return null;
  // Re-check at load time: the skill could have been disabled between the
  // catalogue read and here.
  if (data.status !== 'active' || data.enabled !== true) return null;
  return data;
}

/**
 * Splice the active skill's instructions into the system prompt. Mirrors the
 * governed-knowledge marker contract exactly: substitute at the marker, and if
 * the marker is absent PREPEND rather than drop, so a prompt edit can never
 * silently remove a skill's constraints while leaving the skill running.
 */
export function applySkillMarker(systemPrompt, block) {
  const prompt = String(systemPrompt || '');
  if (!block) return prompt.includes(ACTIVE_SKILL_MARKER) ? prompt.replace(ACTIVE_SKILL_MARKER, '') : prompt;
  return prompt.includes(ACTIVE_SKILL_MARKER)
    ? prompt.replace(ACTIVE_SKILL_MARKER, block)
    : `${block}\n\n${prompt}`;
}

/** The delimited instruction block for the selected skill. */
export function buildSkillBlock(skill, instructionBody) {
  return [
    '=== ACTIVE SKILL (AUTHORITATIVE FOR THIS TURN) ===',
    `Skill: ${skill.display_name} (${skill.slug}) version ${skill.version}`,
    'The user explicitly invoked this skill. Follow its instructions exactly and',
    'produce only its declared output. If its required data is missing, say so',
    'plainly rather than substituting general knowledge.',
    '',
    String(instructionBody || '').trim(),
    '=== END ACTIVE SKILL ===',
  ].join('\n');
}

/**
 * The disclosure footer appended to every skill answer. Non-optional: a
 * confidential skill that ran without saying so would defeat the policy that
 * permits it to run at all.
 */
export function buildDisclosure({ skill, sources = [], notes = [] }) {
  const lines = [
    '',
    '---',
    `_Skill: **${skill.display_name}** v${skill.version} · Sources: ${sources.length ? sources.join(', ') : 'none'}_`,
  ];
  for (const note of notes) lines.push(`_${note}_`);
  return lines.join('\n');
}

export { DENY, normalizeCaller };
