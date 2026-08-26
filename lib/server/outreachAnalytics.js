// OUTREACH-ANALYTICS-1: the pure aggregation behind Sent History analytics.
//
// COUNTING SEMANTICS, stated once so the UI cannot drift from it:
// notification_log holds ONE ROW PER RECIPIENT DELIVERY. The "362
// communications" figure Sent History already shows is an exact count of
// those rows under the active filters. A campaign sent to 20 people is
// therefore 20 communications here, not 1, and these analytics keep that
// meaning exactly - the KPI total is the same number the list reports.
//
// AUDIENCE CLASSIFICATION uses canonical relationships only, never free text:
//   Students          recipient_type = 'student'
//   Academic Partners recipient_type = 'contact' AND contacts.category = 'Academic Partner'
//   Unit Leaders      recipient_type = 'contact' AND contacts.category = 'Unit Leader'
//   Other             everything else - internal/system rows (recipient_type
//                     null), contacts in other categories (Preceptor, BNI
//                     Team, Nursing Executive, Other), and any contact_id
//                     that no longer resolves.
// CONTACTS-CANON-1: the map accepts BOTH the canonical singular keys and the
// legacy plural values, because classification runs against the contact's
// CURRENT category and the rename migration may not be applied yet.
// A row we cannot classify confidently is counted as Other. It is never
// guessed from a subject line or an email address.

export const AUDIENCES = Object.freeze(['students', 'academic_partners', 'unit_leaders', 'other']);

export const AUDIENCE_LABELS = Object.freeze({
  students: 'Students',
  academic_partners: 'Academic Partners',
  unit_leaders: 'Unit Leaders',
  other: 'Other',
});

// The two contact categories that map to their own audience. Every other
// category is Other by design, not by omission. Canonical singular keys plus
// the legacy stored values (pre-migration rows).
const CATEGORY_TO_AUDIENCE = Object.freeze({
  'Academic Partner': 'academic_partners',
  'Academic Partners': 'academic_partners',
  'Unit Leader': 'unit_leaders',
  'Unit Leadership': 'unit_leaders',
});

/**
 * Classify one notification_log row.
 * @param {object} row - { recipient_type, contact_id }
 * @param {Map<string,string>} contactCategories - contact id → category
 */
export function classifyAudience(row, contactCategories) {
  if (row?.recipient_type === 'student') return 'students';
  if (row?.recipient_type === 'contact') {
    const category = contactCategories?.get?.(row.contact_id) ?? null;
    return CATEGORY_TO_AUDIENCE[category] || 'other';
  }
  return 'other';
}

// ── Delivery health ──────────────────────────────────────────────────────────
//
// The Resend webhook advances status monotonically: queued → sent → delivered
// → opened → clicked, with bounced/complained/failed terminal. A row that was
// delivered AND opened therefore reads 'opened', so counting only 'delivered'
// would badly understate delivery. These sets encode that reality.
const REACHED = new Set(['delivered', 'opened', 'clicked']);
const FAILED = new Set(['failed', 'bounced', 'complained']);
// Handed to the provider with no delivery event yet. If the webhook is not
// receiving events, essentially everything lands here - which is exactly the
// condition that makes a delivery rate untrustworthy.
const UNCONFIRMED = new Set(['sent', 'queued', 'delayed']);

// A delivery rate is only meaningful when enough rows carry a confirmed
// outcome. Below this share the metric is suppressed rather than shown as a
// misleading near-zero.
export const DELIVERY_CONFIDENCE_MIN = 0.5;

export function deliveryHealth(counts) {
  const total = counts.total || 0;
  const confirmed = (counts.reached || 0) + (counts.failed || 0);
  const coverage = total > 0 ? confirmed / total : 0;
  return {
    total,
    reached: counts.reached || 0,
    failed: counts.failed || 0,
    unconfirmed: counts.unconfirmed || 0,
    coverage,
    // Trustworthy only when most rows have a confirmed outcome.
    trustworthy: total > 0 && coverage >= DELIVERY_CONFIDENCE_MIN,
    rate: confirmed > 0 ? (counts.reached || 0) / confirmed : null,
  };
}

/**
 * Local calendar day (YYYY-MM-DD) for an instant, in the viewer's timezone.
 * Sent History's date filters are local-day boundaries computed in the
 * browser, so the buckets must use the same frame or the first and last bars
 * would disagree with the list.
 */
export function localDayKey(iso, tzOffsetMinutes = 0) {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  // getTimezoneOffset() is minutes BEHIND UTC (positive west of Greenwich).
  return new Date(t - tzOffsetMinutes * 60000).toISOString().slice(0, 10);
}

/** Inclusive list of local day keys spanning [start, endExclusive). */
export function dayRange(startIso, endIso, tzOffsetMinutes = 0) {
  const days = [];
  const start = localDayKey(startIso, tzOffsetMinutes);
  const endInstant = new Date(endIso).getTime() - 1; // end is exclusive
  const end = localDayKey(new Date(endInstant).toISOString(), tzOffsetMinutes);
  if (!start || !end) return days;
  const cur = new Date(`${start}T00:00:00.000Z`);
  const last = new Date(`${end}T00:00:00.000Z`);
  // Guard against an unbounded range (All time) producing a runaway series.
  let guard = 0;
  while (cur <= last && guard++ < 400) {
    days.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}

const emptyBuckets = () => ({ students: 0, academic_partners: 0, unit_leaders: 0, other: 0, total: 0 });

/**
 * Aggregate minimal rows into totals, a daily series, and delivery health.
 * @param {Array} rows - [{ sent_at, recipient_type, contact_id, status }]
 * @param {object} opts - { contactCategories: Map, startIso, endIso, tzOffsetMinutes }
 */
export function aggregateOutreach(rows, { contactCategories = new Map(), startIso, endIso, tzOffsetMinutes = 0 } = {}) {
  const totals = emptyBuckets();
  const byDay = new Map();
  const delivery = { total: 0, reached: 0, failed: 0, unconfirmed: 0 };

  for (const row of rows || []) {
    const audience = classifyAudience(row, contactCategories);
    totals[audience] += 1;
    totals.total += 1;

    const day = localDayKey(row.sent_at, tzOffsetMinutes);
    if (day) {
      if (!byDay.has(day)) byDay.set(day, { date: day, ...emptyBuckets() });
      const bucket = byDay.get(day);
      bucket[audience] += 1;
      bucket.total += 1;
    }

    delivery.total += 1;
    const status = String(row.status || '').toLowerCase();
    if (REACHED.has(status)) delivery.reached += 1;
    else if (FAILED.has(status)) delivery.failed += 1;
    else if (UNCONFIRMED.has(status)) delivery.unconfirmed += 1;
    // An unrecognized status counts toward the total only: it is neither a
    // confirmed success nor a confirmed failure, so it cannot inflate either.
  }

  // Zero-fill the window so a quiet day reads as a gap, not a missing bar.
  const days = (startIso && endIso) ? dayRange(startIso, endIso, tzOffsetMinutes) : [...byDay.keys()].sort();
  const daily = days.map(date => byDay.get(date) || { date, ...emptyBuckets() });

  return { totals, daily, delivery: deliveryHealth(delivery) };
}
