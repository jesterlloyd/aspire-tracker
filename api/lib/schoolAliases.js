// api/lib/schoolAliases.js
//
// Centralized school name / abbreviation aliases for ASPIRE. School abbreviations are INITIALISMS,
// not substrings of the full name (e.g. "APU" = Azusa Pacific University), so a naive
// ilike('%APU%') misses them. Used by Keith's search_students to resolve school-level queries.
//
// Matching is case- and punctuation-insensitive. Add new schools/aliases here only - do not scatter
// hardcoded school checks elsewhere.

function norm(s) {
  return String(s || '').toLowerCase().replace(/[.,&/-]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Each group: a canonical full name plus its abbreviations / common variants. All matched normalized.
const SCHOOL_ALIAS_GROUPS = [
  { canonical: 'Azusa Pacific University', aliases: ['APU', 'Azusa Pacific', 'Azusa'] },
  { canonical: 'California State University, Long Beach', aliases: ['CSULB', 'Cal State Long Beach', 'CSU Long Beach', 'Long Beach State'] },
  { canonical: 'California State University, Los Angeles', aliases: ['CSULA', 'Cal State LA', 'Cal State Los Angeles', 'CSU Los Angeles'] },
  { canonical: 'West Coast University', aliases: ['WCU', 'West Coast'] },
  { canonical: 'West Coast University North Hollywood', aliases: ['WCU North Hollywood', 'WCU NoHo', 'West Coast University NoHo'] },
  { canonical: 'West Coast University Anaheim', aliases: ['WCU Anaheim'] },
];

// Expand a query to the set of normalized equivalent terms (its alias group). An exact alias/canonical
// match pulls in the whole group; otherwise the query stands alone.
export function resolveSchoolAliases(query) {
  const q = norm(query);
  if (!q) return [];
  const terms = new Set([q]);
  for (const g of SCHOOL_ALIAS_GROUPS) {
    const groupTerms = [g.canonical, ...g.aliases].map(norm);
    if (groupTerms.includes(q)) groupTerms.forEach(t => terms.add(t));
  }
  return [...terms];
}

// True if a student's stored school matches the user's query, accounting for aliases, abbreviations,
// and partial typing in either direction. Case/punctuation-insensitive.
export function schoolMatches(studentSchool, query) {
  const school = norm(studentSchool);
  const q = norm(query);
  if (!school || !q) return false;
  // Direct containment either way (handles partial typing like "Azusa" vs the full name).
  if (school.includes(q) || q.includes(school)) return true;
  // Expand the query to its alias group and test each term against the school.
  for (const t of resolveSchoolAliases(q)) {
    if (t && (school.includes(t) || t.includes(school))) return true;
  }
  // Expand the school side too (e.g. a roster value stored as an abbreviation).
  for (const t of resolveSchoolAliases(school)) {
    if (t && (t.includes(q) || q.includes(t))) return true;
  }
  return false;
}
