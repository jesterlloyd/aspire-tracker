// KEITH-USAGE-1: pure aggregation for Settings > Keith > Usage & Cost.
//
// api/keith-usage.js fetches bounded metadata rows from keith_requests and
// hands them here; every rollup the page shows is computed in this module so
// the arithmetic is testable without a database. Nothing in this module ever
// sees message content - keith_requests has no content-bearing column, and the
// summary echoes only aggregate numbers plus per-row metadata.
//
// Outcome semantics, decided with the schema and narrowed by Owner decision on
// 2026-08-06:
//
//   SUCCESS RATE = completed / (completed + errors).
//
// ONLY `error` counts against Keith. Everything else is a distinct operational
// signal reported on its own, never folded into the rate:
//   * `denied`       - an authorization boundary doing its job.
//   * `missing_data` - a student with no resume on file.
//   * `rate_limited` - the limiter working AS DESIGNED. It is a capacity and
//     budget signal, not a defect, so a busy day that trips the limiter must not
//     read as an unreliable day. It is surfaced beside the rate, not inside it.
//
// A day of nothing but denials and rate limits is a healthy day.

import { estimateCostUsd, priceForModel, modelLabel } from './modelPricing.js';

export const USAGE_RANGES = Object.freeze(['today', '7d', '30d']);

// Trend buckets and "today" follow the program's home timezone, matching how
// the rest of ASPIRE talks about days (interview days, shift ordinals).
export const USAGE_TIMEZONE = 'America/Los_Angeles';

/** YYYY-MM-DD of an instant in a timezone. */
export function dayKeyInTz(date, tz = USAGE_TIMEZONE) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

/**
 * The UTC instant of local midnight (start of `date`'s day) in `tz`.
 * Guess-and-correct: format the guess back into the timezone and shift by the
 * difference. DST-safe for the offsets this app can encounter because the
 * correction is computed at the guessed instant itself.
 */
export function startOfDayInTz(date, tz = USAGE_TIMEZONE) {
  const ymd = dayKeyInTz(date, tz);
  const guess = new Date(`${ymd}T00:00:00Z`);
  const asTz = new Date(guess.toLocaleString('en-US', { timeZone: tz }));
  const asUtc = new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(guess.getTime() - (asTz.getTime() - asUtc.getTime()));
}

/**
 * The inclusive lower bound for a named range, as a Date.
 * 'today' = local midnight in the program timezone; '7d'/'30d' = rolling
 * windows ending now. Unknown ranges fall back to '30d' (never wider).
 */
export function rangeStart(range, now = new Date(), tz = USAGE_TIMEZONE) {
  if (range === 'today') return startOfDayInTz(now, tz);
  const days = range === '7d' ? 7 : 30;
  return new Date(now.getTime() - days * 86400000);
}

const ALL_OUTCOMES = ['completed', 'denied', 'missing_data', 'rate_limited', 'error'];

function round4(n) { return Math.round(n * 10000) / 10000; }

/**
 * Aggregate keith_requests rows into everything the Usage & Cost page shows.
 *
 * rows: keith_requests metadata rows (see api/keith-usage.js for the exact
 *       column list). skillNames: Map<skill_id, display label>. profileNames:
 *       Map<profile_id, staff display name>. truncated: whether the fetch hit
 *       its row cap, echoed through so the UI can say so instead of presenting
 *       a silently partial total.
 */
export function summarizeUsage({ rows, skillNames, profileNames, range, now = new Date(), tz = USAGE_TIMEZONE, truncated = false, recentLimit = 50 }) {
  const skillLabel = (id) => (id && skillNames?.get?.(id)) || null;

  const totals = {
    requests: 0, inputTokens: 0, outputTokens: 0,
    estimatedCostUsd: 0, pricedRequests: 0, unpricedRequests: 0,
    avgCostPerRequestUsd: null, avgDurationMs: null,
  };
  const outcomes = Object.fromEntries(ALL_OUTCOMES.map(o => [o, 0]));
  const byModel = new Map();
  const byWorkload = new Map(); // key: skill_id or '__base__'
  const byDay = new Map();
  let durationSum = 0; let durationCount = 0;

  for (const r of rows) {
    totals.requests++;
    totals.inputTokens += r.input_tokens || 0;
    totals.outputTokens += r.output_tokens || 0;
    if (Object.prototype.hasOwnProperty.call(outcomes, r.outcome)) outcomes[r.outcome]++;
    if (Number.isFinite(r.duration_ms) && r.duration_ms !== null) { durationSum += r.duration_ms; durationCount++; }

    const cost = estimateCostUsd(r.model, r.input_tokens, r.output_tokens);
    // A NULL model with zero tokens is a request refused before any model call
    // (rate-limited, denied at the gate). It costs nothing and is counted as
    // priced-at-zero rather than "pricing unavailable", which is reserved for
    // genuinely unknown model ids carrying real token counts.
    const noModelNoTokens = !r.model && !(r.input_tokens || r.output_tokens);
    const rowCost = cost !== null ? cost : (noModelNoTokens ? 0 : null);
    if (rowCost !== null) { totals.estimatedCostUsd += rowCost; totals.pricedRequests++; }
    else totals.unpricedRequests++;

    // Per-model rollup (only rows that actually name a model).
    if (r.model) {
      const m = byModel.get(r.model) || {
        model: r.model, label: modelLabel(r.model), requests: 0,
        inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, priced: !!priceForModel(r.model),
      };
      m.requests++; m.inputTokens += r.input_tokens || 0; m.outputTokens += r.output_tokens || 0;
      if (cost !== null) m.estimatedCostUsd += cost;
      byModel.set(r.model, m);
    }

    // Workload rollup: Base Keith vs each skill.
    const wKey = r.skill_id || '__base__';
    const w = byWorkload.get(wKey) || {
      key: wKey,
      label: r.skill_id ? (skillLabel(r.skill_id) || 'Retired skill') : 'Base Keith',
      isSkill: !!r.skill_id,
      requests: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, unpriced: 0,
      failures: 0, rateLimited: 0, durationSum: 0, durationCount: 0,
    };
    w.requests++; w.inputTokens += r.input_tokens || 0; w.outputTokens += r.output_tokens || 0;
    if (rowCost !== null) w.estimatedCostUsd += rowCost; else w.unpriced++;
    if (r.outcome === 'error') w.failures++;
    if (r.outcome === 'rate_limited' || r.rate_limited === true) w.rateLimited++;
    if (Number.isFinite(r.duration_ms) && r.duration_ms !== null) { w.durationSum += r.duration_ms; w.durationCount++; }
    byWorkload.set(wKey, w);

    // Daily trend bucket (program-timezone days).
    const day = dayKeyInTz(new Date(r.created_at), tz);
    const d = byDay.get(day) || { day, requests: 0, estimatedCostUsd: 0 };
    d.requests++; if (rowCost !== null) d.estimatedCostUsd += rowCost;
    byDay.set(day, d);
  }

  totals.estimatedCostUsd = round4(totals.estimatedCostUsd);
  totals.avgCostPerRequestUsd = totals.pricedRequests > 0
    ? round4(totals.estimatedCostUsd / totals.pricedRequests) : null;
  totals.avgDurationMs = durationCount > 0 ? Math.round(durationSum / durationCount) : null;

  // completed / (completed + errors). Denials, missing data and rate limits are
  // excluded from BOTH sides: none of them is a success, and none of them is a
  // defect either, so counting them on either side would misstate reliability.
  // They travel alongside the rate as their own counts.
  const rateBase = outcomes.completed + outcomes.error;
  const health = {
    errors: outcomes.error,
    rateLimited: outcomes.rate_limited,
    denied: outcomes.denied,
    missingData: outcomes.missing_data,
    successRate: rateBase > 0
      ? Math.round((outcomes.completed / rateBase) * 1000) / 10
      : null,
  };

  // Continuous day axis from range start to now, so quiet days render as zero
  // instead of vanishing and compressing the trend.
  const trend = [];
  const startDay = startOfDayInTz(rangeStart(range, now, tz), tz);
  for (let t = startDay.getTime(); dayKeyInTz(new Date(t), tz) <= dayKeyInTz(now, tz); t += 86400000) {
    const key = dayKeyInTz(new Date(t), tz);
    if (trend.length && trend[trend.length - 1].day === key) continue; // DST double-count guard
    const bucket = byDay.get(key) || { day: key, requests: 0, estimatedCostUsd: 0 };
    trend.push({ ...bucket, estimatedCostUsd: round4(bucket.estimatedCostUsd) });
  }

  const models = [...byModel.values()]
    .map(m => ({
      ...m,
      estimatedCostUsd: m.priced ? round4(m.estimatedCostUsd) : null,
      avgCostPerRequestUsd: m.priced && m.requests > 0 ? round4(m.estimatedCostUsd / m.requests) : null,
    }))
    .sort((a, b) => b.requests - a.requests);

  const workloads = [...byWorkload.values()]
    .map(({ durationSum: ds, durationCount: dc, ...w }) => ({
      ...w,
      estimatedCostUsd: round4(w.estimatedCostUsd),
      avgDurationMs: dc > 0 ? Math.round(ds / dc) : null,
    }))
    .sort((a, b) => (a.isSkill === b.isSkill ? b.requests - a.requests : a.isSkill ? 1 : -1));

  // Recent activity: newest first, bounded, metadata only. Names resolve from
  // the profile map the endpoint built; a departed profile renders as its role.
  const recent = [...rows]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, recentLimit)
    .map(r => {
      const cost = estimateCostUsd(r.model, r.input_tokens, r.output_tokens);
      return {
        id: r.id, createdAt: r.created_at,
        user: (r.profile_id && profileNames?.get?.(r.profile_id)) || null,
        role: r.role || null, intent: r.intent || null,
        skill: skillLabel(r.skill_id), model: r.model || null,
        inputTokens: r.input_tokens || 0, outputTokens: r.output_tokens || 0,
        estimatedCostUsd: cost !== null ? round4(cost) : null,
        durationMs: r.duration_ms ?? null, outcome: r.outcome, rateLimited: r.rate_limited === true,
      };
    });

  return { range, timezone: tz, truncated, totals, outcomes, health, trend, models, workloads, recent };
}
