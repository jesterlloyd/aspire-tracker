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
// transparent lexical heuristic — entries are small and topic-specific by design, so
// whole-entry citation is the unit of retrieval.

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
const WEIGHTS = {
  title: 6,        // per distinct query term found in the title
  category: 3,     // per distinct query term found in the category label
  bodyPerHit: 1,   // per body occurrence (capped per term)
  bodyCapPerTerm: 4,
  bodyCapTotal: 12,
  source: 0.5,     // per distinct query term found in source_attribution
}
const MIN_SCORE = 3          // entries below this do not qualify → fallback territory
const TOP_N = 3              // default selection size
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
// or selection count — it only enriches the query's tokens so the CS-Link entry family
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

// Returns the query enriched with the CS-Link alias family when it is a CS-Link
// question; otherwise returns the query unchanged. Deterministic; no ranking impact.
function expandQueryAliases(question) {
  const q = String(question || '')
  return CS_LINK_TRIGGER.test(q) ? `${q} ${CS_LINK_ALIASES}` : q
}

function countOccurrences(haystack, term) {
  if (!haystack) return 0
  let count = 0
  let idx = haystack.indexOf(term)
  while (idx !== -1) { count++; idx = haystack.indexOf(term, idx + term.length) }
  return count
}

// Lexical score for one entry against the tokenized question. Case-insensitive.
function scoreEntry(entry, terms) {
  const title = String(entry.title || '').toLowerCase()
  const categoryLabel = (CATEGORY_LABELS[entry.category] || entry.category || '').toLowerCase()
  const body = String(entry.body || '').toLowerCase()
  const source = String(entry.source_attribution || '').toLowerCase()

  let score = 0
  let bodyTotal = 0
  for (const t of terms) {
    if (title.includes(t)) score += WEIGHTS.title
    if (categoryLabel.includes(t)) score += WEIGHTS.category
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

  // Whole-entry budget: add in ranked order while within budget; skip (do not
  // truncate) any entry that would overflow, so fewer whole entries beat truncation.
  const chosen = []
  let used = 0
  for (const e of candidates) {
    const cost = renderEntry(e, chosen.length + 1).length
    if (used + cost <= MAX_BLOCK_CHARS) { chosen.push(e); used += cost }
  }
  // Guarantee at least the single best entry even if it alone exceeds the budget
  // (small entries by design; this is a defensive floor).
  if (chosen.length === 0) chosen.push(candidates[0])
  return chosen
}

function renderEntry(entry, n) {
  const categoryLabel = CATEGORY_LABELS[entry.category] || entry.category || 'Uncategorized'
  const source = entry.source_attribution ? entry.source_attribution : '—'
  const precedence = Number.isFinite(entry.precedence_rank) ? entry.precedence_rank : 100
  return [
    `[${n}] ${entry.title || 'Untitled'}`,
    `Category: ${categoryLabel}`,
    `Precedence: ${precedence}`,
    `Source of truth: ${source}`,
    `${entry.body || ''}`.trim(),
  ].join('\n')
}

const GOVERNED_HEADER = '================ GOVERNED KNOWLEDGE (AUTHORITATIVE ASPIRE SOURCE OF TRUTH) ================'
const GOVERNED_FOOTER = '================ END GOVERNED KNOWLEDGE ================'

const GOVERNED_INSTRUCTIONS = [
  'The ASPIRE Knowledge Center entries below are the authoritative source of truth for ASPIRE program policy and guidance. When they cover a topic, treat them as authoritative and answer from them.',
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
  // KLD-1.1: enrich CS-Link queries with controlled aliases before tokenizing. Scoring
  // (scoreEntry / selectEntries / WEIGHTS / MIN_SCORE / TOP_N / MAX_N / budget) is unchanged.
  const terms = tokenize(expandQueryAliases(question))
  try {
    if (!supabase) throw new Error('no_supabase_client')
    const { data, error } = await supabase
      .from('knowledge_entries')
      .select('title, slug, category, body, source_attribution, precedence_rank, updated_at')
      .eq('state', 'active')
    // Throw a sanitized code only — never carry raw database error text into logs.
    if (error) throw new Error('query_failed')

    const rows = Array.isArray(data) ? data : []
    const scored = terms.length === 0
      ? []
      : rows.map(r => ({ ...r, score: scoreEntry(r, terms) }))
    const selected = selectEntries(scored)
    const block = buildGovernedBlock(selected)
    return {
      block,
      governedCovered: selected.length > 0,
      retrievalFailed: false,
      matchedCount: selected.length,
      slugs: selected.map(e => e.slug),
      scores: selected.map(e => e.score),
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
      blockChars: block.length,
      error: code,
    }
  }
}

// Exported for potential reuse/testing; not required by the handler.
export const _internals = { tokenize, scoreEntry, selectEntries, buildGovernedBlock, WEIGHTS, MIN_SCORE }
