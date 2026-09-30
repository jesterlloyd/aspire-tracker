// KEITH-P0: server-authoritative model routing.
//
// The model id and sampling parameters are resolved HERE, on the server, from a
// closed route table. Nothing about the model is ever taken from the request
// body: a client can name a skill, and the skill's stored `model_route` column
// names a route, but only this module turns a route into an actual model id.
// An unknown or missing route resolves to the default route rather than
// erroring, so a malformed skill row can never escalate to a costlier model.
//
// Sampling is set EXPLICITLY on every route. Before this module Keith sent no
// temperature at all and inherited the API default of 1.0, which is the wrong
// setting for an assistant whose whole design goal is grounded, non-inventive
// answers. Models from Claude 4.7 on refuse `temperature` with a 400, so a route
// on one of them says `temperature: null` and steers depth with `effort`
// instead; modelRequestParams() is the one place that turns a route into the
// request fields, and every caller builds its body from it.

export const DEFAULT_ROUTE = 'default';
export const QUALITY_ROUTE = 'quality';

// The ONLY place a model id appears in the Keith runtime.
const ROUTES = {
  // Base chat: unchanged from the pre-routing hardcoded model.
  [DEFAULT_ROUTE]: {
    model: 'claude-haiku-4-5-20251001',
    temperature: 0.2,
    maxTokens: 2048,
  },
  // The ESCALATION target: the chat picker's Sonnet choice (Owner/Admin),
  // Knowledge Center enrichment, and the skills seeded on it (budget receipts,
  // comment themes).
  //
  // Resume Interview Questions runs on the DEFAULT route (Haiku 4.5). That is a
  // measured choice, not an assumption: scripts/evalResumeInterviewQuestions.mjs
  // scored Haiku 27/27 across a detailed resume, a sparse one, and one carrying
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

// The models whose route table entry says `temperature: null`. A skill's route
// override may still set `temperature: 0` on a copy of any route (skillDefs.js
// does, for determinism on Haiku), so the request builder asks the MODEL, not
// the copy, whether sampling may be sent.
const NO_SAMPLING_MODELS = new Set(
  Object.values(ROUTES).filter(r => r.temperature === null).map(r => r.model),
);

/**
 * The model fields of a Messages API request body for `route` (a resolved
 * route, possibly overridden by a skill): model, max_tokens, and either
 * temperature or output_config.effort - never a temperature for a model that
 * refuses one.
 */
export function modelRequestParams(route) {
  const params = { model: route.model, max_tokens: route.maxTokens };
  if (!NO_SAMPLING_MODELS.has(route.model) && typeof route.temperature === 'number') {
    params.temperature = route.temperature;
  }
  if (route.effort) params.output_config = { effort: route.effort };
  return params;
}

// Shown in place of an answer when a model ends its turn with
// stop_reason "refusal" (Sonnet 5.5's safety classifiers can), which carries
// no text: without it the chat reported a malformed response.
export const MODEL_DECLINED_MESSAGE =
  "I can't help with that request. Try rephrasing it, or switch the model picker to Auto.";

// ── KEITH-MODEL-SELECT-1: user-facing chat model selection ────────────────────
// The user chooses an ABSTRACTION (auto | haiku | sonnet), never a model id.
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
  const route = resolveRoute(CHAT_SELECTIONS[known].route);
  return { selection: known, route, model: route.model, downgraded: false };
}

/** Which selections may this caller use? Drives the client control. */
export function allowedChatSelections({ role, isOwner } = {}) {
  const base = ['auto', 'haiku'];
  const sonnetOk = isOwner === true || SONNET_ROLES.includes(String(role || '').toLowerCase());
  return sonnetOk ? [...base, 'sonnet'] : base;
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
