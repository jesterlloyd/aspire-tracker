// KEITH-P0: server-authoritative model routing.
//
// The model id and sampling parameters are resolved HERE, on the server, from a
// closed route table. Nothing about the model is ever taken from the request
// body: a client can name a skill, and the skill's stored `model_route` column
// names a route, but only this module turns a route into an actual model id.
// An unknown or missing route resolves to the default route rather than
// erroring, so a malformed skill row can never escalate to a costlier model.
//
// Every model on these routes refuses `temperature` with a 400 (KEITH-MODELS-5-5),
// so no route sets one and depth is steered with `effort`. modelRequestParams()
// is the one place that turns a route into the request fields, and every caller
// builds its body from it.

export const DEFAULT_ROUTE = 'default';
export const QUALITY_ROUTE = 'quality';

// The ONLY place a model id appears in the Keith runtime.
const ROUTES = {
  // Base chat and the everyday skills. KEITH-MODELS-5-5 (2026-11-01): Haiku 5.5
  // replaced Haiku 4.5. It thinks by default and thinking counts toward
  // max_tokens, and the same text is about 30% more tokens, so the cap doubled
  // (the largest chat answer on record is 893 tokens). Low effort is Anthropic's
  // guidance for chat and short tool tasks.
  [DEFAULT_ROUTE]: {
    model: 'claude-haiku-5-5',
    temperature: null,
    effort: 'low',
    maxTokens: 4096,
  },
  // The ESCALATION target: the chat picker's Sonnet choice (Owner/Admin),
  // Knowledge Center enrichment, and the skills seeded on it (budget receipts,
  // comment themes).
  //
  // Resume Interview Questions runs on the DEFAULT route. That is a measured
  // choice, not an assumption: scripts/evalResumeInterviewQuestions.mjs scored
  // Haiku 4.5 27/27 across a detailed resume, a sparse one, and one carrying
  // an injected instruction - correct structure, grounded bases, no invented
  // experience, honest "not enough detail" fallbacks, and the injection refused.
  // Escalating to this route is a one-column change if a future evaluation ever
  // shows the smaller model slipping.
  //
  // KEITH-SONNET-5-5 (2026-09-30): Sonnet 4.5 retires 2026-11-24. Sonnet 5.5 at
  // LOW effort replaced it after a side-by-side on Keith's own prompt, tools and
  // resume fixtures: 86/86 checks (Sonnet 4.5: 84/86), about 16% cheaper per
  // chat and a third faster. High effort scored lower and ran slower, so low is
  // the measured choice. Sonnet 5.5 refuses `temperature`, hence null.
  [QUALITY_ROUTE]: {
    model: 'claude-sonnet-5-5',
    temperature: null,
    effort: 'low',
    maxTokens: 2048,
  },
};

export const ROUTE_NAMES = Object.keys(ROUTES);

/** True when `route` names a real route. Used to validate skill rows on save. */
export function isKnownRoute(route) {
  return Object.prototype.hasOwnProperty.call(ROUTES, String(route || ''));
}

/**
 * Resolve a route name to its model parameters. Falls back to the default route
 * for anything unrecognized - never throws, never upgrades an unknown value to a
 * more expensive route.
 */
export function resolveRoute(route) {
  const key = isKnownRoute(route) ? String(route) : DEFAULT_ROUTE;
  return { route: key, ...ROUTES[key] };
}

/**
 * The model fields of a Messages API request body for `route` (a resolved
 * route, possibly overridden by a skill): model, max_tokens and
 * output_config.effort. Never a temperature: every model here refuses one.
 */
export function modelRequestParams(route) {
  const params = { model: route.model, max_tokens: route.maxTokens };
  if (route.effort) params.output_config = { effort: route.effort };
  return params;
}

// Shown in place of an answer when a model ends its turn with
// stop_reason "refusal" (the safety classifiers on all three models can), which
// carries no text: without it the chat reported a malformed response.
export const MODEL_DECLINED_MESSAGE =
  "I can't help with that request. Try rephrasing it.";

// KEITH-MODELS-5-5: the Owner's Opus 5.5 chat choice. It is deliberately NOT in
// ROUTES: isKnownRoute() validates skill rows and resolveRoute() serves skills
// and crons, so a route that is not in that table cannot be reached by either.
// It is twice Sonnet's price and thinks more, so it has room of its own: a
// longer call and deadline (vercel.json gives api/keith.js 60s to match).
export const OWNER_OPUS_ROUTE = 'owner_opus';
const OWNER_OPUS = Object.freeze({
  route: OWNER_OPUS_ROUTE,
  model: 'claude-opus-5-5',
  temperature: null,
  effort: 'medium',
  maxTokens: 8000,
  callTimeoutMs: 45000,
  deadlineMs: 55000,
});

// STUDENT-IMPORT-KEITH-1 (Owner, 2026-11-03): the ONE exception to "a Skill never reaches Opus".
// Reading a spreadsheet's columns for an import runs on Opus when the Owner runs it ("use opus
// there"), and on the Skill's own route for anyone else. It is a function of the person, never of
// the Skill row, so OWNER_OPUS stays out of ROUTES and a skill row still cannot name it. Only the
// import-students definition calls this (a test holds it to that).
export function ownerOpusRouteFor(actor) {
  return actor?.is_owner === true ? OWNER_OPUS : null;
}

// ── KEITH-MODEL-SELECT-1: user-facing chat model selection ────────────────────
// The user chooses an ABSTRACTION (auto | haiku | sonnet | opus), never a model id.
// This closed table is the server-side allowlist that turns a selection into a
// route; anything unrecognized resolves to Auto. Sonnet is the QUALITY route
// (~2.7x the default's cost per chat, measured 2026-09-30), so its audience is a deliberate
// constant: RECOMMENDED RULE, pending Owner ratification - Owner and Admin
// only, matching the roles that already command Owner/Admin-priced surfaces
// (enrichment, usage). Widening it is a one-line change to SONNET_ROLES.
const SONNET_ROLES = ['owner', 'admin'];

export const CHAT_SELECTIONS = Object.freeze({
  auto:   { route: DEFAULT_ROUTE, explicit: false },
  haiku:  { route: DEFAULT_ROUTE, explicit: true },
  sonnet: { route: QUALITY_ROUTE, explicit: true },
  opus:   { route: OWNER_OPUS_ROUTE, explicit: true },
});

/**
 * Resolve the user's chat model selection to a route, enforcing the Sonnet
 * role allowlist server-side. Unknown selections and unauthorized Sonnet
 * requests fall back to Auto (the default route) and say so in the result -
 * never an error, never an upgrade.
 * Returns { selection, route, model, downgraded }.
 */
export function resolveChatSelection(selection, { role, isOwner } = {}) {
  const key = String(selection || 'auto').toLowerCase();
  const known = Object.prototype.hasOwnProperty.call(CHAT_SELECTIONS, key) ? key : 'auto';
  if (known === 'sonnet') {
    const allowed = isOwner === true || SONNET_ROLES.includes(String(role || '').toLowerCase());
    if (!allowed) {
      const fallback = resolveRoute(DEFAULT_ROUTE);
      return { selection: 'auto', route: fallback, model: fallback.model, downgraded: true };
    }
  }
  if (known === 'opus') {
    if (isOwner !== true) {
      const fallback = resolveRoute(DEFAULT_ROUTE);
      return { selection: 'auto', route: fallback, model: fallback.model, downgraded: true };
    }
    return { selection: known, route: OWNER_OPUS, model: OWNER_OPUS.model, downgraded: false };
  }
  const route = resolveRoute(CHAT_SELECTIONS[known].route);
  return { selection: known, route, model: route.model, downgraded: false };
}

/** Which selections may this caller use? Drives the client control. */
export function allowedChatSelections({ role, isOwner } = {}) {
  const base = ['auto', 'haiku'];
  const sonnetOk = isOwner === true || SONNET_ROLES.includes(String(role || '').toLowerCase());
  const allowed = sonnetOk ? [...base, 'sonnet'] : base;
  return isOwner === true ? [...allowed, 'opus'] : allowed;
}

/**
 * True when a request names Opus, by the picker's word or by a model id, in any
 * field. The handler refuses it for anyone but the Owner before anything else
 * runs, where a Sonnet request from the wrong role only falls back to Auto.
 */
export function requestNamesOpus(body) {
  if (!body || typeof body !== 'object') return false;
  return ['chat_model', 'model', 'model_route', 'modelRoute']
    .some(k => /opus/i.test(String(body[k] ?? '')));
}

/**
 * Guard for the request boundary. The client may never choose a model, so any
 * model-bearing key in a request body is treated as tampering and reported
 * rather than silently ignored. (`chat_model` is deliberately NOT in this
 * list: it carries a closed abstraction resolved by resolveChatSelection, not
 * a model id.)
 */
export function requestNamesModel(body) {
  if (!body || typeof body !== 'object') return false;
  return ['model', 'temperature', 'max_tokens', 'maxTokens', 'model_route', 'modelRoute']
    .some(k => Object.prototype.hasOwnProperty.call(body, k));
}
