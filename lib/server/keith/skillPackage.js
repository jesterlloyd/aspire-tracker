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

  for (const line of lines) {
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

    if (rest.trim() === '') {
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
