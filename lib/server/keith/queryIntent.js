// KLD-1.1: deterministic, model-free query-intent classifier for Keith. Intent gates
// which live sources are injected into the prompt (see api/keith.js), so the model
// cannot infer an answer from a source it should not use for a given question.
// Pure: no model call, no I/O, no dependencies, fully deterministic.

export const INTENTS = {
  PERSON_CONTACT_ROLE: 'person_contact_role',
  EMAIL_DRAFTING:      'email_drafting',
  COHORT_STATUS:       'cohort_status',
  PLACEMENT_CAPACITY:  'placement_capacity',
  POLICY_PROCESS:      'policy_process',
  GENERAL_OTHER:       'general_other',
};

// An explicit compose task (verb + message noun) is an unambiguous drafting request,
// even when it names a unit/leader/role - so "draft an email to unit leadership" or
// "create an email to students about their preceptors" is email drafting (the roster is
// needed) rather than a person lookup. KEITH-INTENT-ROUTING-1: include common create/
// revise verbs (create, revise, edit, update, make, rewrite, rework, put together) so a
// compose request is never misrouted to contact lookup just because it names a role word.
const DRAFT_VERB   = /\b(?:draft|write|compose|send|reply|respond|prepare|create|revise|edit|update|make|rewrite|rework)\b|\bput\s+together\b/;
const MESSAGE_NOUN = /\b(email|message|note|memo|invite|invitation|reminder|correspondence|letter)\b/;

// Explicit compose/revise request = a drafting verb + a message noun. Exported so the Keith
// handler can use it as a defense-in-depth guard that prevents the person_contact_role
// short-circuit from ever intercepting a clear drafting/revision request.
export function isExplicitEmailDrafting(rawText) {
  const q = String(rawText || '').toLowerCase();
  return DRAFT_VERB.test(q) && MESSAGE_NOUN.test(q);
}

// Program-leadership / app-ownership questions are answered by the standing ownership
// guardrail (ASPIRE = Cedars-Sinai program led by Jester; Jester = Owner of ASPIRE
// Intelligence, the app). These must route to general_other, NOT person_contact_role,
// so the guardrail answers them instead of a Contacts-unavailable redirect.
//  (a) leadership verb + ASPIRE: "who runs/leads/owns ... ASPIRE"
const OWNERSHIP_VERB_ASPIRE = /\bwho\s+(runs|leads?|owns?|spearheads?|heads?|founded|created|started|manages|oversees|is in charge of|is behind)\b[^?]*\baspire\b/;
//  (b) noun-phrased ownership of the program/app/system: "ASPIRE owner",
//      "ASPIRE Intelligence owner", "app owner", "system owner", "owner of ASPIRE …"
const OWNERSHIP_NOUN = /\b((aspire(\s+intelligence)?|app|system)\s+owner(ship)?|owner(ship)?\s+of\s+(the\s+)?(aspire(\s+intelligence)?|app|system))\b/;
function isOwnershipQuestion(q) {
  return OWNERSHIP_VERB_ASPIRE.test(q) || OWNERSHIP_NOUN.test(q);
}

// Person / contact / role signals.
const PERSON_ROLE_NOUN = /\b(npd[-\s]?p|npd practitioner|preceptors?|academic partners?|unit leaders?|unit leadership|school coordinators?|associate directors?|nurse managers?|assistant nurse managers?|nursing executives?|chief nursing|executive directors?|point of contact)\b/;
const CONTACT_INTENT   = /\b(who('?s| is| are| was| were)|who (leads|manages|oversees|runs|holds|to contact)|who do i (contact|email|reach)|contact (for|info|information|details|at)|email (for|address)|phone (for|number)|reach out to)\b/;

// Cohort predicates: "who is on campus / placed / interviewed / needs ..." are status
// questions about STUDENTS, not contact/role lookups - they must NOT route to person.
const COHORT_PREDICATE = /\b(on campus|placed|active rotation|rotating|completed|not proceeding|interviewed|needs?|still need|scheduled|form (sent|received)|cs[-\s]?link|badge|hours|shift|outreach|awaiting)\b/;

// Status / count questions about the current cohort (deliberately NOT triggered by a
// bare "student"/"unit" mention - those alone are not status questions).
const STATUS = /\b(how many|status breakdown|cohort status|current (cohort )?status|status of|placed|active rotation|rotating|completed|not proceeding|interviewed|on campus|cs[-\s]?link (status|active|pending|access)|shift (status|count)|hours (progress|logged|completed)|needs? (cs[-\s]?link|badge|outreach|interview|scheduling|a form)|who (still )?needs?|who is on campus)\b/;

const CAPACITY = /\b(capacity|slots?|hosting|not hosting|pending (unit )?response|unit response|open slots?|slot commitment|how many slots|which units)\b/;

const PROCESS = /\b(process|how do (we|i)|how to|step|requirement|eligib|cs[-\s]?link|healthstream|scrubex|parking|orientation|ngrp|policy|guideline|guarantee|promise|preferred unit|escalat|what is (the|aspire))\b/;

// "who is <Capitalized Name>" - a likely proper-name lookup (uses original casing).
function looksLikePersonName(original) {
  return /\bwho\s+(?:is|are|was|were)\s+(?:the\s+)?[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b/.test(original);
}

// ── KEITH-GOVERNED-ROUTING-1 ──────────────────────────────────────────────────
// The reported failure: "Who should I contact for a prelicensure group clinical
// request that is not an ASPIRE senior bedside preceptorship?" classified as
// person_contact_role (the phrase "contact for"), short-circuited to a Contacts
// search, and returned unrelated preceptors - while the Active BNI routing
// directory, the governed answer, was never consulted. The general problem: a
// generic contacts intent must not bypass a directly applicable Active
// Knowledge Vault entry. These predicates decide, from the QUESTION plus the
// retrieval evidence, when governed knowledge gets first refusal.

// A routing question asks WHERE TO DIRECT something, not WHO someone is:
// "who should I contact for X", "who handles X", "where do I send X".
const ROUTING_ASK = /\b(who|where|whom|which\s+(?:team|department|group|office))\b[^?]*\b(contact|reach|email|route|handles?|handling|responsible|in charge|escalate|send|submit|direct|refer|go(?:es)? to)\b/;
const ROUTING_VERB_SUBJECT = /\b(handles?|routes?|routing|escalat\w+|responsible for|in charge of)\b[^?]*\b(request|inquir\w+|question|issue|concern)s?\b/;
export function isRoutingQuestion(rawText) {
  const q = String(rawText || '').toLowerCase();
  return ROUTING_ASK.test(q) || ROUTING_VERB_SUBJECT.test(q);
}

// An identity lookup names a specific person (proper name or email address).
// These ALWAYS belong to Contacts, whatever the vault scores.
const EMAIL_IN_QUERY = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i;
export function isIdentityLookup(rawText) {
  const original = String(rawText || '');
  if (EMAIL_IN_QUERY.test(original)) return true;
  if (looksLikePersonName(original)) return true;
  // "Find/get/look up <First Last>('s) ..." - an explicit fetch of a named person.
  return /\b(?:find|get|look\s*up|pull(?:\s+up)?|show)\s+[A-Z][a-z]+\s+[A-Z][a-z]+(?:'s)?\b/.test(original);
}

// A directory query asks FOR a role group itself ("the preceptors for PACU",
// "unit leaders for 6 South") - Contacts territory. WORD-BOUNDARY matching is
// the point: "preceptorship" (a process noun) must NOT count as "preceptors".
const DIRECTORY_SUBJECT = /\b(preceptors?|unit leaders?|unit leadership|academic partners?|school coordinators?|clinical placement coordinators?|program coordinators?|npd[-\s]?ps?|npd practitioners?|nurse managers?|assistant nurse managers?|associate directors?|nursing executives?|interviewers?)\b/;
export function isDirectorySubjectQuery(rawText) {
  return DIRECTORY_SUBJECT.test(String(rawText || '').toLowerCase());
}

// Empirical floor, measured against the real 26-entry corpus (pre- and
// post-enrichment shapes): genuine routing questions with governed coverage
// score well above this (12-42); person lookups that merely brush governed
// vocabulary score at or below it once identity/directory questions are carved
// out. Deliberately above retrieval's MIN_SCORE (3): weak brushes stay with
// Contacts.
export const GOVERNED_ROUTING_MIN_SCORE = 10;

/**
 * Should this person_contact_role question be answered from governed knowledge
 * (full model path with the retrieval block) instead of the deterministic
 * Contacts short-circuit?
 *   - identity lookups and role-directory queries stay with Contacts, always;
 *   - otherwise, a routing-class question whose retrieval evidence clears the
 *     floor is governed territory.
 */
export function preferGovernedRouting({ question, topScore = 0 }) {
  if (isIdentityLookup(question)) return false;
  if (isDirectorySubjectQuery(question)) return false;
  if (!isRoutingQuestion(question)) return false;
  return Number(topScore) >= GOVERNED_ROUTING_MIN_SCORE;
}

export function classifyIntent(rawText) {
  const original = String(rawText || '');
  const q = original.toLowerCase();
  if (!q.trim()) return INTENTS.GENERAL_OTHER;

  // 1. Explicit drafting task.
  if (DRAFT_VERB.test(q) && MESSAGE_NOUN.test(q)) return INTENTS.EMAIL_DRAFTING;

  // 2. ASPIRE leadership / app ownership → answered by the ownership guardrail.
  if (isOwnershipQuestion(q)) return INTENTS.GENERAL_OTHER;

  // 3. Person / contact / role lookup - unless it is a cohort-predicate "who" question
  //    (e.g., "who is on campus") that carries no explicit role noun.
  const personSignal = PERSON_ROLE_NOUN.test(q) || CONTACT_INTENT.test(q) || looksLikePersonName(original);
  const cohortWho = /\bwho\b/.test(q) && COHORT_PREDICATE.test(q) && !PERSON_ROLE_NOUN.test(q);
  if (personSignal && !cohortWho) return INTENTS.PERSON_CONTACT_ROLE;

  // 4. Placement/capacity is checked BEFORE cohort_status: an explicit slot/hosting/
  //    unit-response/capacity term wins even when the query also says "how many" (a
  //    generic phrase that must not force cohort_status for a capacity question).
  if (CAPACITY.test(q)) return INTENTS.PLACEMENT_CAPACITY;

  // 5..7 - remaining tie-break: cohort_status > policy_process > general.
  if (STATUS.test(q))  return INTENTS.COHORT_STATUS;
  if (PROCESS.test(q)) return INTENTS.POLICY_PROCESS;
  return INTENTS.GENERAL_OTHER;
}
