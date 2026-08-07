// KEITH-USAGE-1: the ONLY place a dollar rate appears in ASPIRE Intelligence.
//
// Estimated cost is computed from ASPIRE's own recorded token usage
// (keith_requests / keith_skill_invocations) and the official Anthropic price
// for the model that actually served the request. Every figure derived from
// this module is an ESTIMATE for internal attribution; the Anthropic Console
// remains the billing authority, and the two will differ (the Console bills
// prompt-cache reads/writes at different rates, while ASPIRE records only base
// input/output token counts).
//
// PRICING SOURCE: https://platform.claude.com/docs/en/docs/about-claude/pricing
// retrieved 2026-08-06. Rates are USD per million tokens (MTok):
//   Claude Haiku 4.5   $1 input  / $5 output
//   Claude Sonnet 4.5  $3 input  / $15 output
// When Anthropic changes prices or a new route is added to modelRouting.js,
// update this table and the PRICING_AS_OF date in the same change.
//
// An unknown model id is NEVER priced as another model: estimateCostUsd returns
// null and the caller must show "pricing unavailable" rather than invent a
// figure. That is a correctness rule, not a convenience - pricing a future
// Sonnet 5 route at Haiku rates would silently understate spend.

export const PRICING_AS_OF = '2026-08-06';
export const PRICING_SOURCE = 'platform.claude.com/docs pricing page';

// Keyed by the EXACT model ids modelRouting.js can emit. keith_requests.model
// only ever holds values from that closed route table (or NULL on requests
// refused before a model call), so this map is exhaustive for priceable rows.
const MODEL_PRICES_PER_MTOK = Object.freeze({
  'claude-haiku-4-5-20251001':  Object.freeze({ input: 1, output: 5, label: 'Claude Haiku 4.5' }),
  'claude-sonnet-4-5-20250929': Object.freeze({ input: 3, output: 15, label: 'Claude Sonnet 4.5' }),
});

/** The rate row for a model id, or null when the model is unknown. */
export function priceForModel(model) {
  const key = String(model || '');
  return Object.prototype.hasOwnProperty.call(MODEL_PRICES_PER_MTOK, key)
    ? MODEL_PRICES_PER_MTOK[key]
    : null;
}

/** Human label for a model id; falls back to the raw id so nothing is hidden. */
export function modelLabel(model) {
  return priceForModel(model)?.label || String(model || 'unknown');
}

/**
 * Estimated USD cost of one request. Returns a number for a known model,
 * null when the model is unknown or missing - never a guessed figure.
 * Token counts are clamped to non-negative integers defensively; the DB
 * already CHECK-constrains them, but this module must be safe on any input.
 */
export function estimateCostUsd(model, inputTokens, outputTokens) {
  const price = priceForModel(model);
  if (!price) return null;
  const inTok = Number.isFinite(Number(inputTokens)) ? Math.max(0, Number(inputTokens)) : 0;
  const outTok = Number.isFinite(Number(outputTokens)) ? Math.max(0, Number(outputTokens)) : 0;
  return (inTok * price.input + outTok * price.output) / 1_000_000;
}

/** The full table, for surfacing the pricing basis in the UI. */
export function pricingTable() {
  return Object.entries(MODEL_PRICES_PER_MTOK).map(([model, p]) => ({
    model, label: p.label, inputPerMTok: p.input, outputPerMTok: p.output,
  }));
}
