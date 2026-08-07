// KT-4: server-only retrieval of Active Knowledge Center entries for Keith.
//
// Keith answers ASPIRE questions from the governed Knowledge Center as the source of
// truth. This module fetches ONLY Active entries via the service-role client (RLS is
// enabled with zero client-role policies, so service-role reads are the only correct
// access path), scores them lexically against the user's question, selects the best
// few whole entries within a character budget, and renders a delimited GOVERNED
// KNOWLEDGE block for prompt injection. Per request, no cache.
//
// No new dependencies, no embeddings/vector store, no schema changes. Scoring is a
// transparent lexical heuristic - entries are small and topic-specific by design, so
// whole-entry citation is the unit of retrieval.

import { stripWikilinksForPrompt } from './knowledgeLinks.js'

// Category key → readable label (server-owned copy; mirrors the KT-1 vocabulary).
const CATEGORY_LABELS = {
  program_overview: 'Program Overview',
  eligibility_placement: 'Eligibility & Placement',
  interview_selection: 'Interview & Selection',
  rotations_matching: 'Rotations & Matching',
  student_requirements: 'Student Requirements',
  communication_guidance: 'Communication Guidance',
  terminology_navigation: 'Terminology & Navigation',
  faq: 'FAQ',
}

// ── Tuning knobs (all in one place) ───────────────────────────────────────────
// KNOWLEDGE-VAULT-1 added `alias` and `tag`. Both are STRICTLY ADDITIVE: an
// entry with no aliases and no tags scores exactly what it scored before, so
// no query can rank lower than it did. Aliases weigh the same as the title
// because an alias IS a title the author declared; tags weigh like a category
// because that is what a tag is - a coarser grouping.
const WEIGHTS = {
  title: 6,        // per distinct query term found in the title
  alias: 6,        // per distinct query term found in any alias
  category: 3,     // per distinct query term found in the category label
  tag: 3,          // per distinct query term found in any tag
  bodyPerHit: 1,   // per body occurrence (capped per term)
  bodyCapPerTerm: 4,
  bodyCapTotal: 12,
  source: 0.5,     // per distinct query term found in source_attribution
}
const MIN_SCORE = 3          // entries below this do not qualify → fallback territory
const TOP_N = 3              // default selection size
// KEITH-RETRIEVAL-1: when a query is clearly about email routing/communication channel, the one
// authoritative canon entry gets this additive score boost so same-category competitors (which carry
// a stronger precedence_rank) cannot push it out of the top results. Large enough to clear the
// typical lexical-score range; only ever applied to the exact canon slug on an email-routing query.
const EMAIL_ROUTING_CANON_BOOST = 50
const MAX_N = 5              // upper bound when scores cluster tightly
const CLUSTER_RATIO = 0.6    // a 4th/5th entry joins only if score ≥ ratio × top score
const MAX_BLOCK_CHARS = 8000 // hard budget for the whole governed block; whole entries preferred

const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'can', 'you', 'your', 'with', 'what', 'when', 'how',
  'does', 'did', 'is', 'it', 'its', 'to', 'of', 'in', 'on', 'as', 'an', 'or', 'my',
  'me', 'we', 'our', 'be', 'by', 'that', 'this', 'these', 'those', 'they', 'them',
  'from', 'will', 'would', 'should', 'could', 'about', 'into', 'who', 'whom', 'which',
  'has', 'have', 'had', 'was', 'were', 'not', 'yes', 'please', 'tell', 'show', 'give',
  'need', 'want', 'a', 'i', 'do', 'if', 'so', 'at', 'up', 'out', 'get', 'any', 'all',
])

// Lowercase, split on non-alphanumeric, drop stopwords and very short tokens, dedupe.
function tokenize(text) {
  const seen = new Set()
  for (const raw of String(text || '').toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3) continue
    if (STOPWORDS.has(raw)) continue
    seen.add(raw)
  }
  return [...seen]
}

// KLD-1.1: controlled CS-Link query-alias expansion, applied to the QUERY STRING only,
// BEFORE tokenize/scoring. It does NOT change the scoring algorithm, weights, threshold,
// or selection count - it only enriches the query's tokens so the CS-Link entry family
// is reachable. (Note: "CS" alone is a 2-char token dropped by tokenize, so a bare
// "CS-Link process" query under-overlaps; the aliases below add surviving tokens such
// as "cslink", "account", "provisioning", "stage", "cedars", "access".)
const CS_LINK_TRIGGER = /\bcs[\s-]?link\b|\bcslink\b|\bcs access\b|\bnon[\s-]?employee\b/i
const CS_LINK_ALIASES = [
  'CS-Link', 'CS Link', 'CSLink', 'CS-Link process', 'CS-Link access',
  'CS-Link Pending', 'CS-Link Active', 'account request', 'account provisioning',
  'Stage 1', 'Stage 2', 'Add Non-Employee', 'access request', 'Cedars account',
  'user provisioning', 'non-employee account', 'clinical student access',
].join(' ')

// KEITH-RETRIEVAL-1: controlled email-routing / communication-channel query-alias expansion,
// mirroring the CS-Link pattern above. Applied to the QUERY STRING only, before tokenize/scoring;
// it does not change the scoring algorithm, weights, threshold, or selection count - it only
// enriches the query's tokens so the "ASPIRE Email Routing & Communication Guidance Canon" is
// reachable when a user asks which channel/email to use, about post-rotation/NGRP/Casey-Fink
// surveys, fallback behavior, broad-resend questions, etc. The slug constant is also used to
// apply a targeted score boost (see retrieveGovernedKnowledge) so this one authoritative entry
// is not pushed out of the top results by same-category competitors with a stronger precedence_rank.
const EMAIL_ROUTING_CANON_SLUG = 'aspire-email-routing-communication-guidance-canon'
const EMAIL_ROUTING_TRIGGER = /\bemail routing\b|\bcommunication channel\b|\bcommunication guidance\b|\bpost[\s-]?rotation\b|\bngrp\b|\bcasey[\s-]?fink\b|\bbaseline survey\b|\bpost[\s-]?rotation survey\b|\bfallback\b|\bschool[\s-]?email\b|\bpersonal[\s-]?email\b|\bbroad resend\b|\bcorrection email\b|\bcorrection send\b|\bclock[\s-]?out reminder\b|\bactive[\s-]?rotation communication\b|\bshift operations?\b|\bdurable communication\b|\balumni follow[\s-]?up\b|\bwhich email\b/i
const EMAIL_ROUTING_ALIASES = [
  'email routing', 'communication channel', 'communication guidance',
  'school_email', 'personal_email', 'active rotation', 'post-rotation',
  'durable communication', 'NGRP', 'Casey-Fink Baseline', 'Casey-Fink Post-Rotation',
  'fallback', 'data-quality signal', 'broad resend', 'correction sends',
  'bespoke', 'exact-target', 'owner-confirmed', 'audited', 'channel-correct',
].join(' ')

// Returns the query enriched with the relevant alias family when it is a CS-Link and/or
// email-routing question; otherwise returns the query unchanged. Deterministic; the enrichment
// only adds query tokens - it does not alter the scoring algorithm itself.
function expandQueryAliases(question) {
  const q = String(question || '')
  let out = q
  if (CS_LINK_TRIGGER.test(q)) out += ` ${CS_LINK_ALIASES}`
  if (EMAIL_ROUTING_TRIGGER.test(q)) out += ` ${EMAIL_ROUTING_ALIASES}`
  return out
}

function countOccurrences(haystack, term) {
  if (!haystack) return 0
  let count = 0
  let idx = haystack.indexOf(term)
  while (idx !== -1) { count++; idx = haystack.indexOf(term, idx + term.length) }
  return count
}

// Lexical score for one entry against the tokenized question. Case-insensitive.
//
// KNOWLEDGE-VAULT-1: alias and tag matching are the GENERIC replacement for the
// two hardcoded alias families below. They are added here alongside those
// patches, not instead of them: until the real entries carry real aliases in
// production, removing the patches would regress the exact two query families
// they were written to fix. Retiring them is a separate, evidence-backed change.
function scoreEntry(entry, terms) {
  const title = String(entry.title || '').toLowerCase()
  const categoryLabel = (CATEGORY_LABELS[entry.category] || entry.category || '').toLowerCase()
  const body = String(entry.body || '').toLowerCase()
  const source = String(entry.source_attribution || '').toLowerCase()
  // One joined haystack per field family: an entry matches if ANY alias (or
  // tag) contains the term, and a term scores at most once per family, so a
  // page cannot inflate its rank by listing the same word as five aliases.
  const aliasText = (Array.isArray(entry.aliases) ? entry.aliases : []).join(' ').toLowerCase()
  const tagText = (Array.isArray(entry.tags) ? entry.tags : []).join(' ').toLowerCase()

  let score = 0
  let bodyTotal = 0
  for (const t of terms) {
    if (title.includes(t)) score += WEIGHTS.title
    if (aliasText.includes(t)) score += WEIGHTS.alias
    if (categoryLabel.includes(t)) score += WEIGHTS.category
    if (tagText.includes(t)) score += WEIGHTS.tag
    if (source.includes(t)) score += WEIGHTS.source
    const hits = Math.min(countOccurrences(body, t), WEIGHTS.bodyCapPerTerm)
    bodyTotal += hits * WEIGHTS.bodyPerHit
  }
  score += Math.min(bodyTotal, WEIGHTS.bodyCapTotal)
  return Math.round(score * 100) / 100
}

// Ranking comparator: relevance desc, then precedence_rank asc (lower = higher
// priority), then updated_at desc.
function rankCompare(a, b) {
  if (b.score !== a.score) return b.score - a.score
  const pa = Number.isFinite(a.precedence_rank) ? a.precedence_rank : 100
  const pb = Number.isFinite(b.precedence_rank) ? b.precedence_rank : 100
  if (pa !== pb) return pa - pb
  return String(b.updated_at || '').localeCompare(String(a.updated_at || ''))
}

// Select up to TOP_N (or MAX_N when the tail clusters tightly with the top), then
// honor the character budget preferring whole entries over truncation.
function selectEntries(scored) {
  const qualified = scored.filter(e => e.score >= MIN_SCORE).sort(rankCompare)
  if (qualified.length === 0) return []

  const top = qualified[0].score
  let cutoff = Math.min(TOP_N, qualified.length)
  for (let i = TOP_N; i < Math.min(MAX_N, qualified.length); i++) {
    if (qualified[i].score >= CLUSTER_RATIO * top) cutoff = i + 1
    else break
  }
  const candidates = qualified.slice(0, cutoff)

  // Whole-entry budget. The single best entry is ALWAYS included first, even if it alone
  // exceeds the budget - it is the most relevant governed source and must never be dropped
  // in favor of shorter lower-ranked neighbors. (This matters for large authoritative
  // entries such as the email-routing canon, whose body exceeds MAX_BLOCK_CHARS: it can be
  // boosted to the top rank yet would otherwise be skipped while smaller entries fill the
  // budget.) Remaining candidates then join in ranked order while the whole block stays
  // within budget; any that would overflow are skipped (not truncated).
  const chosen = [candidates[0]]
  let used = renderEntry(candidates[0], 1).length
  for (let i = 1; i < candidates.length; i++) {
    const cost = renderEntry(candidates[i], chosen.length + 1).length
    if (used + cost <= MAX_BLOCK_CHARS) { chosen.push(candidates[i]); used += cost }
  }
  return chosen
}

// KNOWLEDGE-VAULT-1: the module-level catalog used to turn [[wikilinks]] into
// readable prose. Set for the duration of one retrieval call (see below) so
// renderEntry, which is also called from selectEntries' budget arithmetic,
// measures the SAME string it will later emit. Measuring the un-stripped body
// and emitting the stripped one would make the character budget wrong.
let _linkCatalog = []

function renderEntry(entry, n) {
  const categoryLabel = CATEGORY_LABELS[entry.category] || entry.category || 'Uncategorized'
  const source = entry.source_attribution ? entry.source_attribution : '-'
  const precedence = Number.isFinite(entry.precedence_rank) ? entry.precedence_rank : 100
  // Vault syntax must never reach the model: [[Slug|Label]] is meaningless in
  // chat and exposes internal page identifiers. Links become the page's title
  // (or the pipe label), so Keith reads and cites natural prose.
  const body = stripWikilinksForPrompt(entry.body || '', _linkCatalog).trim()
  return [
    `[${n}] ${entry.title || 'Untitled'}`,
    `Category: ${categoryLabel}`,
    `Precedence: ${precedence}`,
    `Source of truth: ${source}`,
    body,
  ].join('\n')
}

const GOVERNED_HEADER = '================ GOVERNED KNOWLEDGE (AUTHORITATIVE ASPIRE SOURCE OF TRUTH) ================'
const GOVERNED_FOOTER = '================ END GOVERNED KNOWLEDGE ================'

const GOVERNED_INSTRUCTIONS = [
  'The ASPIRE Knowledge Center entries below are the authoritative source of truth for ASPIRE policy and guidance. When they cover a topic, treat them as authoritative and answer from them.',
  'Cite the entries you use by their title in natural prose. Never expose entry IDs, relevance scores, precedence numbers, or any internal structure to the user.',
  'Role-permission and privacy rules remain first priority and unchanged. Live operational data (your tools and the LIVE COHORT DATA block) remains authoritative for current student, unit, placement, and contact facts.',
  'The only valid entry state names are Draft, Active, Deprecated, and Archived; do not use any other status word for entries. Use "On Campus Now," never "On Campus Today."',
].join('\n')

function buildGovernedBlock(entries) {
  if (entries.length === 0) {
    return [
      GOVERNED_HEADER,
      'No Active Knowledge Center entry matched this question. You may still use authorized live tools and data for current operational records. Do not answer ASPIRE operational, policy, placement, eligibility, student, contact, role, or workflow questions from any legacy or remembered static ASPIRE content. If the question requires current ASPIRE guidance and no governed source or live data covers it, say that governed guidance was not found and recommend ASPIRE Owner/Admin verification. General non-ASPIRE questions may be answered normally.',
      'Role-permission and privacy rules remain first priority and unchanged.',
      GOVERNED_FOOTER,
    ].join('\n')
  }
  const rendered = entries.map((e, i) => renderEntry(e, i + 1)).join('\n\n')
  return [GOVERNED_HEADER, GOVERNED_INSTRUCTIONS, '', rendered, GOVERNED_FOOTER].join('\n')
}

// Distinct from a successful zero-match result: here the Knowledge Center query
// itself failed, so we cannot assert "no entry covers this." Steer Keith to the
// cautious posture (legacy for general/non-sensitive only; verify sensitive or
// operational answers with the Owner/Admin) rather than implying clean coverage.
function buildUnavailableBlock() {
  return [
    GOVERNED_HEADER,
    'Knowledge Center retrieval was unavailable. Do not answer current ASPIRE operational or policy questions as if governed guidance was checked. Recommend ASPIRE Owner/Admin verification for such questions. You may still use authorized live tools and data for current operational records, and general non-ASPIRE questions may be answered normally.',
    'Role-permission and privacy rules remain first priority and unchanged.',
    GOVERNED_FOOTER,
  ].join('\n')
}

/**
 * Retrieve governed knowledge for a question and render the injectable block.
 * Resilient by design, with two DISTINCT no-coverage outcomes:
 *   • success + zero qualifying entries → zero-coverage block (error=null, retrievalFailed=false)
 *   • the query/scoring itself failed    → retrieval-unavailable block (error=stable code, retrievalFailed=true)
 * Either way Keith still answers from labeled legacy fallback; instrumentation records
 * governed_coverage=false, and a failure additionally carries a sanitized error code.
 *
 * @param {object} supabase - a service-role Supabase client
 * @param {string} question - the user's latest message text (used only for scoring; never logged)
 * @returns {Promise<{ block: string, governedCovered: boolean, retrievalFailed: boolean, matchedCount: number, slugs: string[], scores: number[], blockChars: number, error: string|null }>}
 */
export async function retrieveGovernedKnowledge(supabase, question) {
  // KLD-1.1 / KEITH-RETRIEVAL-1: enrich CS-Link and email-routing queries with controlled
  // aliases before tokenizing. Scoring (scoreEntry / selectEntries / WEIGHTS / MIN_SCORE /
  // TOP_N / MAX_N / budget) is unchanged; only the query's token set is enriched.
  const terms = tokenize(expandQueryAliases(question))
  // Whether this is clearly an email-routing / communication-channel question - evaluated on the
  // ORIGINAL question (not the alias-expanded string) so the targeted canon boost only fires on a
  // genuine user signal, never because an alias term was injected.
  const isEmailRouting = EMAIL_ROUTING_TRIGGER.test(String(question || ''))
  try {
    if (!supabase) throw new Error('no_supabase_client')
    const { data, error } = await supabase
      .from('knowledge_entries')
      .select('id, title, slug, category, body, source_attribution, precedence_rank, updated_at, aliases, tags, body_format, expires_at, review_date')
      .eq('state', 'active')
    // Throw a sanitized code only - never carry raw database error text into logs.
    if (error) throw new Error('query_failed')

    const rows = Array.isArray(data) ? data : []
    // Catalog for wikilink resolution during rendering. Active entries only,
    // matching what retrieval can cite - a link to a draft renders as its
    // literal text rather than resolving to a page Keith cannot quote.
    _linkCatalog = rows
    const scored = terms.length === 0
      ? []
      : rows.map(r => {
          let score = scoreEntry(r, terms)
          // Targeted, narrowly-scoped boost: only on a genuine email-routing question and only for
          // the one canon slug, so this authoritative entry clears same-category competitors that
          // carry a stronger precedence_rank and is reliably retrieved in the top results.
          if (isEmailRouting && r.slug === EMAIL_ROUTING_CANON_SLUG) score += EMAIL_ROUTING_CANON_BOOST
          return { ...r, score }
        })
    const selected = selectEntries(scored)
    const block = buildGovernedBlock(selected)
    // KNOWLEDGE-VAULT-1: report how many SELECTED entries are already past
    // their expires_at. This is INSTRUMENTATION ONLY - expired entries are
    // still retrieved and still answer, exactly as before. The count exists so
    // the decision to start excluding them can be made on evidence rather than
    // on a guess about production data.
    const today = new Date().toISOString().slice(0, 10)
    const staleCount = selected.filter(e => e.expires_at && String(e.expires_at) < today).length
    return {
      block,
      governedCovered: selected.length > 0,
      retrievalFailed: false,
      matchedCount: selected.length,
      slugs: selected.map(e => e.slug),
      scores: selected.map(e => e.score),
      staleCount,
      blockChars: block.length,
      error: null,
    }
  } catch (e) {
    // Retrieval FAILED (distinct from a successful zero-match). Emit the cautious
    // retrieval-unavailable block, and sanitize the error to a small stable code so
    // no raw database text (or anything else) reaches the logs.
    const code = e?.message === 'no_supabase_client' ? 'no_supabase_client' : 'retrieval_failed'
    const block = buildUnavailableBlock()
    return {
      block,
      governedCovered: false,
      retrievalFailed: true,
      matchedCount: 0,
      slugs: [],
      scores: [],
      staleCount: 0,
      blockChars: block.length,
      error: code,
    }
  }
}

// Exported for potential reuse/testing; not required by the handler.
export const _internals = {
  tokenize, scoreEntry, selectEntries, buildGovernedBlock, expandQueryAliases,
  renderEntry,
  setLinkCatalog: (rows) => { _linkCatalog = Array.isArray(rows) ? rows : [] },
  WEIGHTS, MIN_SCORE,
  EMAIL_ROUTING_TRIGGER, EMAIL_ROUTING_ALIASES, EMAIL_ROUTING_CANON_SLUG, EMAIL_ROUTING_CANON_BOOST,
}
