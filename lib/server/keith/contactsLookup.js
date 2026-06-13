// CONTACTS-1b: deterministic, field-minimized ASPIRE Connect Contacts lookup for
// Keith's person_contact_role intent. NO embeddings, NO fuzzy AI, NO vector store, NO
// hardcoded contact answers. The Owner/Admin role gate is enforced in api/keith.js
// BEFORE this module is called; this module performs the service-role read, matches
// deterministically, and formats a directory-grade answer with a source label.
//
// Field minimization is structural: only the Owner-approved columns are ever selected,
// so forbidden fields (notes, phone, notification_preferences, linkedin_url, avatar_url,
// preferred_contact_method, raw ids, audit/created_by/updated_by) cannot be returned,
// logged, or injected — they are never read.

// Owner-approved projection ONLY. (No id, no notes, no phone, no notification prefs,
// no audit columns, no avatar/linkedin/preferred_contact_method.)
const SELECT_COLS = 'full_name, preferred_name, email, organization, role, role_qualifier, school_name, program_type, unit_name, related_units, category, is_active';

// Fixed, Owner-approved response strings.
export const CONTACTS_ROLE_DENIED = 'Contacts are not available to your role. Please verify current contact information through the appropriate ASPIRE administrator.';
export const CONTACTS_UNAVAILABLE = 'Contacts retrieval is temporarily unavailable. Please verify in ASPIRE Connect Contacts.';
export const CONTACTS_NO_MATCH = 'No matching contact record was found in ASPIRE Connect Contacts.';
const SOURCE_LABEL = 'Source: ASPIRE Connect Contacts.';
const RESULT_CAP = 8;

// Owner-approved alias substitutions — MATCHING AIDS ONLY, never answers.
const ALIASES = [
  [/\bl\s*and\s*d\b|\bl\s*\/\s*d\b/g, 'labor and delivery'],
  [/\bcsula\b/g, 'cal state la'],
  [/\bwcu\b/g, 'west coast university'],
];

// Deterministic normalization: lowercase, & → "and", apply aliases, strip punctuation,
// collapse whitespace.
function norm(s) {
  let t = String(s || '').toLowerCase();
  t = t.replace(/&/g, ' and ');
  for (const [re, sub] of ALIASES) t = t.replace(re, sub);
  t = t.replace(/[^a-z0-9\s]/g, ' ');
  return t.replace(/\s+/g, ' ').trim();
}
// Unit comparison ignores the trailing/standalone word "unit".
function normUnit(s) {
  return norm(s).replace(/\bunit\b/g, '').replace(/\s+/g, ' ').trim();
}

// Role/category signals: a query keyword maps to matching contact role values and/or a
// category. A contact matches a signal if its normalized role is listed or its category
// equals the signal's category. (Role values mirror the CONTACTS-1a-discovered vocab.)
const ROLE_SIGNALS = [
  { kw: ['npd p', 'npdp', 'npd practitioner'], roles: ['unit npd p', 'unit npd practitioner', 'npd practitioner'] },
  { kw: ['preceptor', 'preceptors'], roles: ['preceptor', 'clinical preceptor'], category: 'Preceptors' },
  { kw: ['academic partner'], category: 'Academic Partners' },
  { kw: ['school coordinator', 'clinical placement coordinator', 'program coordinator', 'program assistant'], roles: ['school coordinator', 'clinical placement coordinator', 'program coordinator', 'program assistant'], category: 'Academic Partners' },
  { kw: ['unit leadership', 'unit leader'], category: 'Unit Leadership' },
  { kw: ['associate director'], roles: ['associate director'] },
  { kw: ['assistant nurse manager', 'anm'], roles: ['assistant nurse manager'] },
  { kw: ['nursing executive', 'chief nursing', 'executive director', 'nursing leadership'], category: 'Nursing Executives' },
  { kw: ['bni'], category: 'BNI Team' },
];

function activeSignals(qn) {
  return ROLE_SIGNALS.filter(sig => sig.kw.some(k => qn.includes(k)));
}
function roleMatches(row, signals) {
  if (!signals.length) return false;
  const r = norm(row.role);
  const cat = row.category || '';
  return signals.some(sig => (sig.roles && sig.roles.includes(r)) || (sig.category && cat === sig.category));
}
function locationHit(row, qn) {
  const u = normUnit(row.unit_name);
  const rel = Array.isArray(row.related_units) ? row.related_units.map(normUnit) : [];
  const sch = norm(row.school_name);
  const org = norm(row.organization);
  const unit = (u && u.length >= 3 && qn.includes(u)) || rel.some(x => x && x.length >= 3 && qn.includes(x));
  const school = sch && sch.length >= 3 && qn.includes(sch);
  const orgn = org && org.length >= 3 && qn.includes(org);
  return unit || school || orgn;
}
function identityHit(row, qn) {
  const fn = norm(row.full_name);
  const pn = norm(row.preferred_name);
  const em = norm(row.email);
  if (em && em.length >= 5 && qn.includes(em)) return true;
  if (fn && qn.includes(fn)) return true;
  if (pn && pn.length >= 3 && qn.includes(pn)) return true;
  const toks = fn.split(' ').filter(t => t.length >= 2);
  if (toks.length >= 2 && toks.every(t => qn.includes(t))) return true;
  return false;
}

// Score one contact against the normalized query. Higher = more specific.
//   hasSignals  — the query named a role/category
//   hasLocation — the query referenced a known unit/school/org (any contact's location
//                 appears in the query)
// When the query names BOTH a role and a location, BOTH must match (a role-only or
// location-only contact is not a correct answer to "preceptors for PACU"). Role-only
// scoring applies only when the query has no location; location-only only when the
// query names no role.
function scoreRow(row, qn, signals, hasLocation) {
  if (identityHit(row, qn)) return 95;                 // name/email — a specific person
  const rm = signals.length > 0 && roleMatches(row, signals);
  const loc = locationHit(row, qn);
  if (signals.length > 0 && hasLocation) return (rm && loc) ? 80 : 0;
  if (signals.length > 0)  return rm ? 45 : 0;         // role/category group, no location
  if (hasLocation)         return loc ? 35 : 0;        // "contacts associated with X"
  return 0;
}

function minimize(row) {
  return {
    full_name: row.full_name,
    preferred_name: row.preferred_name || null,
    role: row.role || null,
    role_qualifier: row.role_qualifier || null,
    category: row.category || null,
    unit_name: row.unit_name || null,
    related_units: Array.isArray(row.related_units) ? row.related_units : [],
    school_name: row.school_name || null,
    organization: row.organization || null,
    email: row.email || null,
    is_active: row.is_active,
  };
}

function fmtLine(c) {
  const name = c.preferred_name && norm(c.preferred_name) !== norm(c.full_name)
    ? `${c.full_name} (${c.preferred_name})`
    : c.full_name;
  const bits = [];
  const roleStr = [c.role, c.role_qualifier].filter(Boolean).join(', ');
  if (roleStr) bits.push(roleStr);
  if (c.category) bits.push(c.category);
  if (c.unit_name) bits.push(`primary unit: ${c.unit_name}`);
  if (c.related_units && c.related_units.length) bits.push(`also: ${c.related_units.join(', ')}`);
  if (c.school_name) bits.push(c.school_name);
  if (c.organization) bits.push(c.organization);
  if (c.email) bits.push(c.email);
  if (c.is_active === false) bits.push('(inactive)');
  return bits.length ? `${name} — ${bits.join(' · ')}` : name;
}

export function formatContactsAnswer(matched) {
  if (!matched || matched.length === 0) return CONTACTS_NO_MATCH;
  if (matched.length === 1) return `${fmtLine(matched[0])}\n\n${SOURCE_LABEL}`;
  const lines = matched.map(c => `- ${fmtLine(c)}`).join('\n');
  return `${matched.length} matching contacts in ASPIRE Connect Contacts:\n${lines}\n\n${SOURCE_LABEL}`;
}

/**
 * Deterministically answer a person/contact/role query from ASPIRE Connect Contacts.
 * Caller MUST enforce the Owner/Admin role gate before calling this.
 *
 * @param {object} supabase - service-role client
 * @param {string} question - the user's question (used only for matching; never logged)
 * @returns {Promise<{ response: string, resultCount: number, error: string|null }>}
 */
export async function answerPersonContactQuery(supabase, question) {
  try {
    if (!supabase) return { response: CONTACTS_UNAVAILABLE, resultCount: 0, error: 'no_client' };
    const { data, error } = await supabase.from('contacts').select(SELECT_COLS).limit(2000);
    if (error) return { response: CONTACTS_UNAVAILABLE, resultCount: 0, error: 'query_failed' };

    const rows = Array.isArray(data) ? data : [];
    const qn = norm(question);
    const signals = activeSignals(qn);
    // The query references a "known location" if any contact's unit/school/org appears
    // in it — used to require role+location agreement for constrained group queries.
    const hasLocation = rows.some(r => locationHit(r, qn));

    const scored = rows
      .map(r => ({ row: r, score: scoreRow(r, qn, signals, hasLocation) }))
      .filter(x => x.score > 0);

    // Inactive policy: exclude inactive by default; surface an inactive record ONLY
    // when it is a specific identity (name/email) match and there is no active match.
    const active = scored.filter(x => x.row.is_active !== false);
    const inactiveIdentity = scored.filter(x => x.row.is_active === false && x.score >= 95);
    const pool = active.length ? active : inactiveIdentity;

    pool.sort((a, b) =>
      b.score - a.score ||
      String(a.row.full_name || '').localeCompare(String(b.row.full_name || ''))
    );

    const matched = pool.slice(0, RESULT_CAP).map(x => minimize(x.row));
    return { response: formatContactsAnswer(matched), resultCount: matched.length, error: null };
  } catch {
    return { response: CONTACTS_UNAVAILABLE, resultCount: 0, error: 'lookup_failed' };
  }
}
