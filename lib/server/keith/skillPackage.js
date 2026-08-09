// KEITH-P1: the SKILL.md import/export boundary.
//
// Skills are governed DATABASE ROWS at runtime; SKILL.md is the portable
// interchange shape, exactly as the Knowledge Vault treats Markdown. This module
// is the only place the two representations meet, so drift between them is a
// single file's problem rather than an architectural one.
//
// The YAML subset parsed here is deliberately tiny - scalars, quoted scalars,
// and block sequences of scalars - because that is all a SKILL.md frontmatter
// needs. An unsupported construct is a validation error, never a silent partial
// parse: a skill that half-imports is a security object with half its
// permissions.
//
// VERSIONS. The database is the version authority and uses integer forward-only
// versions, the same as knowledge_entry_versions. The semver in frontmatter is
// DERIVED on export (`1.<version>.0`) and IGNORED on import. There is exactly one
// version authority; a package cannot talk the app into a version it did not
// earn.

import { isKnownRoute } from './modelRouting.js';

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

// Every key a package may declare. Anything else is rejected rather than
// ignored, so a typo'd `allowed_role:` cannot silently produce a skill with no
// role restriction.
export const ALLOWED_KEYS = Object.freeze([
  'name', 'display_name', 'description', 'version', 'status', 'owner',
  'allowed_roles', 'required_tools', 'required_data', 'trigger_phrases',
  'data_classification', 'model_route', 'provenance',
]);

const REQUIRED_KEYS = Object.freeze(['name', 'display_name', 'description']);
const LIST_KEYS = Object.freeze(['allowed_roles', 'required_tools', 'required_data', 'trigger_phrases']);

export const VALID_STATUSES = Object.freeze(['draft', 'active', 'deprecated', 'archived']);
export const VALID_CLASSIFICATIONS = Object.freeze(['internal', 'confidential']);
export const VALID_ROLES = Object.freeze(['owner', 'admin', 'co-lead', 'interviewer', 'viewer']);
// Data grants a skill may declare. Kept closed so a package cannot invent one.
export const VALID_DATA_GRANTS = Object.freeze(['student_profile_read', 'student_resume_read']);

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function stripQuotes(raw) {
  const s = String(raw).trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

/** Minimal YAML subset parser. Returns { value, errors }. */
function parseFrontmatter(block) {
  const errors = [];
  const out = {};
  const lines = String(block).split(/\r?\n/);
  let currentListKey = null;
  // KEITH-SKILL-NATIVE-3: real Claude packages write long descriptions as YAML
  // BLOCK SCALARS (`description: >-` followed by an indented block). Folded
  // (>) joins lines with spaces; literal (|) keeps newlines; the chomping
  // indicator (-) trims the trailing newline. Read-only parsing of a value
  // form that already had to be supported for these packages to import at all;
  // every key remains subject to the same ALLOWED_KEYS validation.
  let blockKey = null;
  let blockStyle = null;   // 'folded' | 'literal'
  let blockLines = [];
  const closeBlock = () => {
    if (!blockKey) return;
    const text = blockStyle === 'literal'
      ? blockLines.join('\n')
      : blockLines.reduce((acc, ln) => {
          if (ln.trim() === '') return `${acc}\n`;
          return acc && !acc.endsWith('\n') ? `${acc} ${ln.trim()}` : acc + ln.trim();
        }, '');
    out[blockKey] = text.trim();
    blockKey = null; blockStyle = null; blockLines = [];
  };

  for (const line of lines) {
    // Inside a block scalar: indented lines belong to it; anything else ends it.
    if (blockKey) {
      if (line.trim() === '' || /^\s+\S/.test(line)) { blockLines.push(line.replace(/^\s{1,4}/, '')); continue; }
      closeBlock();
    }
    if (!line.trim() || line.trim().startsWith('#')) continue;

    const listItem = /^\s+-\s+(.*)$/.exec(line);
    if (listItem) {
      if (!currentListKey) { errors.push(`list item outside of a key: ${line.trim()}`); continue; }
      out[currentListKey].push(stripQuotes(listItem[1]));
      continue;
    }

    const kv = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
    if (!kv) { errors.push(`unparsable line: ${line.trim()}`); continue; }

    const [, key, rest] = kv;
    if (!ALLOWED_KEYS.includes(key)) { errors.push(`unknown key: ${key}`); currentListKey = null; continue; }

    const blockMarker = /^([|>])([-+]?)$/.exec(rest.trim());
    if (blockMarker) {
      blockKey = key;
      blockStyle = blockMarker[1] === '|' ? 'literal' : 'folded';
      blockLines = [];
      currentListKey = null;
    } else if (rest.trim() === '') {
      out[key] = [];
      currentListKey = key;
    } else if (rest.trim() === '[]') {
      // Explicit empty list, the shape serializeSkillPackage emits. Without this
      // an exported package with any empty list could not be re-imported.
      out[key] = [];
      currentListKey = null;
    } else {
      out[key] = stripQuotes(rest);
      currentListKey = null;
    }
  }
  closeBlock();
  return { value: out, errors };
}

/**
 * Parse a SKILL.md document into a validated skill record.
 * Returns { ok:true, skill, warnings } or { ok:false, errors }.
 */
export function parseSkillPackage(source) {
  const text = String(source || '');
  const m = FRONTMATTER_RE.exec(text);
  if (!m) return { ok: false, errors: ['missing YAML frontmatter delimited by --- lines'] };

  const { value: fm, errors } = parseFrontmatter(m[1]);
  const body = m[2].trim();
  const warnings = [];

  for (const k of REQUIRED_KEYS) {
    if (!fm[k]) errors.push(`missing required key: ${k}`);
  }
  for (const k of LIST_KEYS) {
    if (fm[k] !== undefined && !Array.isArray(fm[k])) errors.push(`${k} must be a list`);
  }
  if (!body) errors.push('SKILL.md body (the instructions) is empty');

  if (fm.name && !SLUG_RE.test(fm.name)) errors.push('name must be a lowercase kebab-case slug');

  const status = fm.status || 'draft';
  if (!VALID_STATUSES.includes(status)) errors.push(`invalid status: ${status}`);
  // An imported package NEVER arrives active. Activation is an Owner action
  // taken in the app, after review, never a property of a file someone sent.
  if (status !== 'draft') warnings.push(`status "${status}" ignored on import; imported skills always land as draft`);

  const classification = fm.data_classification || 'internal';
  if (!VALID_CLASSIFICATIONS.includes(classification)) errors.push(`invalid data_classification: ${classification}`);

  const route = fm.model_route || 'default';
  if (!isKnownRoute(route)) errors.push(`unknown model_route: ${route}`);

  const roles = (fm.allowed_roles || []).map(r => String(r).toLowerCase());
  for (const r of roles) if (!VALID_ROLES.includes(r)) errors.push(`unknown role in allowed_roles: ${r}`);
  if (roles.includes('viewer')) errors.push('viewer may not be granted skill access');

  const grants = fm.required_data || [];
  for (const g of grants) if (!VALID_DATA_GRANTS.includes(g)) errors.push(`unknown required_data grant: ${g}`);

  if (fm.version !== undefined) warnings.push('version in frontmatter is ignored; the database is the version authority');

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    warnings,
    skill: {
      slug: fm.name,
      display_name: fm.display_name,
      description: fm.description,
      status: 'draft',
      enabled: false,
      allowed_roles: roles,
      required_tools: fm.required_tools || [],
      required_data: grants,
      trigger_phrases: (fm.trigger_phrases || []).map(p => String(p).toLowerCase().trim()).filter(Boolean),
      data_classification: classification,
      model_route: route,
      owner_label: fm.owner || 'ASPIRE',
      provenance: fm.provenance || 'imported',
      instruction_body: body,
    },
  };
}

// ── KEITH-SKILL-INSTALL-1: reference files ───────────────────────────────────
// A package's references/ files are SKILL-LOCAL context: they must load only
// when the skill is invoked and must never become Knowledge Vault entries.
// The existing runtime already loads instruction_body exactly and only at
// invocation, so references are stored INSIDE it as delimited sections - no
// schema change, existing version history, existing caps. compose/split are
// exact inverses; the delimiter is chosen to never occur in normal Markdown.

const REF_DELIM = '===== SKILL REFERENCE: '
const REF_DELIM_RE = /^===== SKILL REFERENCE: (.+?) =====$/m
const REF_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._ -]*\.(md|markdown|txt)$/
export const MAX_REFERENCES = 8

/** Filename acceptable as a skill reference (markdown/text only). */
export function isValidReferenceName(name) {
  return REF_NAME_RE.test(String(name || ''))
}

/** Join instructions + references into the stored instruction_body. */
export function composeInstructionBody(instructions, references = []) {
  const parts = [String(instructions || '').trim()]
  for (const r of references) {
    parts.push(`${REF_DELIM}${r.name} =====\n${String(r.content || '').trim()}`)
  }
  return parts.join('\n\n')
}

/** Split a stored instruction_body back into { instructions, references }. */
export function splitInstructionBody(body) {
  const text = String(body || '')
  const first = text.search(REF_DELIM_RE)
  if (first === -1) return { instructions: text.trim(), references: [] }
  const instructions = text.slice(0, first).trim()
  const references = []
  const re = /^===== SKILL REFERENCE: (.+?) =====$/gm
  let m
  const marks = []
  while ((m = re.exec(text)) !== null) marks.push({ name: m[1], start: m.index, end: m.index + m[0].length })
  for (let i = 0; i < marks.length; i++) {
    const contentEnd = i + 1 < marks.length ? marks[i + 1].start : text.length
    references.push({ name: marks[i].name, content: text.slice(marks[i].end, contentEnd).trim() })
  }
  return { instructions, references }
}

// ── Claude-style compatibility pass ──────────────────────────────────────────
// Best-effort, honestly bounded: what Keith understands is mapped, what it
// does not is NAMED and dropped, never silently honored. A Claude SKILL.md
// typically carries name + description; display_name is derived from the
// name. Nothing here weakens strict parsing: the output of this pass still
// goes through parseSkillPackage unchanged.
const EXTERNAL_KEY_MAP = { title: 'display_name' }

export function normalizeExternalPackage(source) {
  const m = FRONTMATTER_RE.exec(String(source || ''))
  if (!m) return { source: String(source || ''), unsupported: [], mapped: [] }
  const lines = m[1].split(/\r?\n/)
  const kept = []
  const unsupported = []
  const mapped = []
  let dropping = false
  let sawDisplayName = false
  let nameVal = null
  for (const line of lines) {
    const kv = /^([A-Za-z_-][A-Za-z0-9_-]*):\s*(.*)$/.exec(line)
    if (!kv) { if (!dropping) kept.push(line); continue }
    const rawKey = kv[1]
    const key = EXTERNAL_KEY_MAP[rawKey] || rawKey
    if (key !== rawKey) mapped.push(`${rawKey} -> ${key}`)
    const normKey = key.replace(/-/g, '_')
    if (key === 'display_name') sawDisplayName = true
    if (key === 'name') nameVal = stripQuotes(kv[2])
    if (ALLOWED_KEYS.includes(normKey)) {
      dropping = false
      kept.push(`${normKey}:${line.slice(rawKey.length + 1)}`)
    } else {
      dropping = true // also drops the key's indented list items
      unsupported.push(rawKey)
    }
  }
  if (!sawDisplayName && nameVal) {
    // Derive a human name from the slug: "resume-interview-questions" ->
    // "Resume Interview Questions".
    const title = nameVal.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    kept.push(`display_name: ${title}`)
    mapped.push('display_name derived from name')
  }
  return {
    source: `---\n${kept.join('\n')}\n---\n${m[2]}`,
    unsupported: [...new Set(unsupported)],
    mapped,
  }
}

// KEITH-SKILL-NATIVE-2: Claude descriptions often EMBED trigger phrases
// ('Trigger on phrases like "humanize this," ...'). When a package declares no
// trigger_phrases of its own, quoted phrases from its description become
// Keith trigger phrases - the existing exact-substring invocation mechanism,
// fed from the package's own words, never invented.
export function extractTriggerHints(description) {
  const out = []
  for (const m of String(description || '').matchAll(/[\u201c"]([^\u201c\u201d"]{3,60})[\u201d"]/g)) {
    const phrase = m[1].trim().replace(/[.,;:]$/, '').toLowerCase()
    if (phrase && !out.includes(phrase)) out.push(phrase)
    if (out.length >= 12) break
  }
  return out
}

/** Semver derived from the integer version. The DB stays the one authority. */
export function derivedSemver(version) {
  const n = Number.isInteger(version) && version > 0 ? version : 1;
  return `1.${n}.0`;
}

function yamlList(key, values) {
  if (!values || !values.length) return `${key}: []`;
  return `${key}:\n${values.map(v => `  - ${v}`).join('\n')}`;
}

/** Serialize a stored skill row back to a SKILL.md document. */
export function serializeSkillPackage(skill) {
  const lines = [
    '---',
    `name: ${skill.slug}`,
    `display_name: ${skill.display_name}`,
    `description: ${skill.description}`,
    `version: ${derivedSemver(skill.version)}`,
    `status: ${skill.status}`,
    `owner: ${skill.owner_label || 'ASPIRE'}`,
    yamlList('allowed_roles', skill.allowed_roles),
    yamlList('required_tools', skill.required_tools),
    yamlList('required_data', skill.required_data),
    yamlList('trigger_phrases', skill.trigger_phrases),
    `data_classification: ${skill.data_classification}`,
    `model_route: ${skill.model_route}`,
    `provenance: ${skill.provenance || 'ASPIRE'}`,
    '---',
    '',
    skill.instruction_body || '',
    '',
  ];
  return lines.join('\n');
}
