// KEITH-P0: server-authoritative model routing.
//
// The model id and sampling parameters are resolved HERE, on the server, from a
// closed route table. Nothing about the model is ever taken from the request
// body: a client can name a skill, and the skill's stored `model_route` column
// names a route, but only this module turns a route into an actual model id.
// An unknown or missing route resolves to the default route rather than
// erroring, so a malformed skill row can never escalate to a costlier model.
//
// Temperature is set EXPLICITLY on every route. Before this module Keith sent no
// temperature at all and inherited the API default of 1.0, which is the wrong
// setting for an assistant whose whole design goal is grounded, non-inventive
// answers.

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
  // The ESCALATION target, wired but not currently used by any skill.
  //
  // Resume Interview Questions runs on the DEFAULT route (Haiku 4.5). That is a
  // measured choice, not an assumption: scripts/evalResumeInterviewQuestions.mjs
  // scored Haiku 27/27 across a detailed resume, a sparse one, and one carrying
  // an injected instruction - correct structure, grounded bases, no invented
  // experience, honest "not enough detail" fallbacks, and the injection refused.
  // Escalating to this route is a one-column change if a future evaluation ever
  // shows the smaller model slipping.
  [QUALITY_ROUTE]: {
    model: 'claude-sonnet-4-5-20250929',
    temperature: 0.2,
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
 * Guard for the request boundary. The client may never choose a model, so any
 * model-bearing key in a request body is treated as tampering and reported
 * rather than silently ignored.
 */
export function requestNamesModel(body) {
  if (!body || typeof body !== 'object') return false;
  return ['model', 'temperature', 'max_tokens', 'maxTokens', 'model_route', 'modelRoute']
    .some(k => Object.prototype.hasOwnProperty.call(body, k));
}
