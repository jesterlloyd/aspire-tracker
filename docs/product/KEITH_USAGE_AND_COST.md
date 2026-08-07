# Keith Usage & Cost: Implementation Report

Status: **BUILT AND VERIFIED LOCALLY.** No SQL was written or applied, no Keith
skill state was changed, and no permission was broadened. Every figure in
verification comes from synthetic fixture telemetry; no production Keith record
was read during development.

Prompt: `ASPIRE_Keith_Usage_and_Cost.md`. Prior work this builds on:
`docs/product/KEITH_P0_P1_IMPLEMENTATION.md`.

---

## 1. Telemetry audit: no new SQL is required

The first question the plan asked was whether the existing schema could carry
this page. It can, without a migration.

`keith_requests` (created in `20260805000001_keith_p0_foundations_and_skills.sql`)
already persists every dimension the page needs:

| Need | Column |
| --- | --- |
| Who | `profile_id`, `role` |
| What kind of request | `intent`, `skill_id`, `skill_version` |
| Which model | `model`, `model_route` |
| How much | `input_tokens`, `output_tokens`, `rounds` |
| How long | `duration_ms` |
| How it ended | `outcome`, `rate_limited` |
| When | `created_at` (indexed `DESC`) |

Two findings made the "no new SQL" answer safe rather than merely convenient:

1. **Model ids are closed.** `lib/server/keith/modelRouting.js` is the only
   place a model id is produced, and `recordKeithUsage` writes exactly what it
   resolved. So every row that names a model names one of two known models, and
   pricing coverage is provable rather than hopeful (a test asserts every
   routable model has a price row).
2. **Skill attribution already lives on `keith_requests`.** `keith_skill_invocations`
   was not needed for this page; it remains the confidential-invocation audit.

The existing `idx_keith_requests_created` index serves the bounded range query,
so no index was added either.

**Nothing in this feature creates, alters, or drops a table, policy, grant, or
function.**

---

## 2. Files

### New

| File | Role |
| --- | --- |
| `lib/server/keith/modelPricing.js` | The ONLY place a dollar rate exists. |
| `lib/server/keith/usageSummary.js` | Pure aggregation; all page arithmetic. |
| `api/keith-usage.js` | Owner/Admin-only read path for the telemetry. |
| `src/components/settings/KeithUsagePanel.jsx` | The workspace. |
| `test/keithUsageCost.test.mjs` | 25 tests across all three layers. |

### Modified

| File | Change |
| --- | --- |
| `src/components/settings/settingsSections.js` | Added `keithUsage`; workspaces reordered alphabetically. |
| `src/components/settings/SettingsShell.jsx` | `/settings/keith` → `knowledge`; `KEITH_SUBKEYS` gained `keithUsage`. |
| `src/components/settings/KeithPanel.jsx` | Third workspace, alphabetical order, new default. |
| `test/settingsKeithNested.test.mjs` | Pins updated for the new order/default, with annotations. |
| `test/settingsUnifiedIa.test.mjs` | `KEITH_SUBKEYS` pin updated, with annotation. |

`src/portal/UnitLeaderPortal 2.jsx` was not touched.

---

## 3. Navigation

Keith's workspaces are now **alphabetical**, matching the Settings > General
convention:

1. Knowledge Center
2. Skills
3. Usage & Cost

`/settings/keith` replace-redirects to `/settings/keith/knowledge` (previously
Skills). All three workspace routes are directly deep-linkable, the legacy
`/settings/knowledge` → `/settings/keith/knowledge` redirect is unchanged, and
the compact picker below 1280px plus the anchored/sticky navigation shipped in
`ca3d5ee` both carry the third destination without modification.

---

## 4. Cost methodology

**Every dollar figure on this page is an ESTIMATE, and is labeled as one.**

Estimated cost is computed as recorded base tokens times the official Anthropic
rate for the model that actually served that request:

```
cost = (input_tokens × input_rate + output_tokens × output_rate) / 1,000,000
```

Rates, per million tokens, from
`https://platform.claude.com/docs/en/docs/about-claude/pricing` retrieved
**2026-08-06** (recorded as `PRICING_AS_OF` in the module):

| Model | Input | Output |
| --- | --- | --- |
| Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) | $1 | $5 |
| Claude Sonnet 4.5 (`claude-sonnet-4-5-20250929`) | $3 | $15 |

Rules that make the number honest rather than merely plausible:

- **An unknown model is never priced as another model.** `estimateCostUsd`
  returns `null`, and the UI renders "Pricing unavailable" while still reporting
  that request's token counts. A future Sonnet 5 route priced at Haiku rates
  would silently understate spend; this refuses to do that.
- **A request refused before any model call** (rate-limited, denied at the gate)
  has no model and zero tokens. It is counted as priced-at-zero, not as
  "pricing unavailable", so the unpriced count means only what it says.
- **The Anthropic Console remains the billing authority.** The page says so, and
  links out. The two will differ: the Console bills prompt-cache reads and writes
  at their own multipliers, while ASPIRE records only base input/output counts.
- **No Anthropic billing or admin credential exists** in the client, the server,
  or the environment. There is no billing-API integration in this phase.

When Anthropic changes prices or `modelRouting.js` gains a route, update
`modelPricing.js` and `PRICING_AS_OF` in the same change.

---

## 5. Outcome semantics: Success Rate

Decided 2026-08-06, and narrowed from the first implementation on Owner review:

```
Success Rate = completed / (completed + errors)
```

**Only `error` counts against Keith.** The other three outcomes are distinct
operational signals, each reported on its own and none folded into the rate:

| Outcome | Why it is outside the ratio |
| --- | --- |
| `denied` | An authorization boundary doing its job. |
| `missing_data` | A student with no resume on file. |
| `rate_limited` | The limiter working **as designed** — a capacity and budget signal, not a defect. A busy day that trips the limiter must not read as an unreliable day. |

A period with completions and no errors reports 100% even while the limiter is
actively engaging. A period with neither completions nor errors reports **no
rate at all** (`null`) rather than 0%, which would read as "everything broke".

Because a reader seeing rate limits beside a high success rate could reasonably
think the two contradict each other, the page states the exclusion directly
beneath the outcome counts.

---

## 6. Access control and privacy

**Owner and Admin only**, enforced independently in two places:

- **Client:** the section registry gates every Keith route on `isAdmin`, which
  is exactly `['owner','admin']`, plus a defensive guard in the panel itself.
- **Server (the real authority):** `api/keith-usage.js` verifies the JWT,
  resolves the profile, rejects deactivated accounts, and 403s anyone who is
  neither Owner nor role `admin`. Co-Lead, Interviewer, Viewer, and every portal
  role are denied. Keith spend and usage analytics are not exposed to them in v1.

The endpoint follows the `keith-skills-admin` governance shape: one POST, an
`{ action, ...params }` body, a strict per-action key allow-list (an unexpected
field is a 400), `Cache-Control: no-store`, and range input validated against a
closed list.

**Privacy posture, preserved exactly:**

- The browser never reads `keith_requests` directly. That table's deny-all RLS
  (zero policies, no `authenticated` grant) is untouched; the service-role
  endpoint is the only read path.
- The response is metadata only. `request_id` is deliberately not selected — it
  exists to correlate server logs and the browser has no use for it — and there
  is no student linkage in the recent-activity rows.
- No prompt, answer, resume text, or extracted document text can appear here,
  because `keith_requests` has no content-bearing column to hold one.

---

## 7. Performance

- Bounded date ranges (Today / 7 days / 30 days), server-side aggregation, and
  no historical dump to the browser: the page receives rollups plus the 50 most
  recent metadata rows.
- Reuses `idx_keith_requests_created`; no new index.
- `ROW_CAP` is 10,000. At current volume a 30-day window is orders of magnitude
  below that. If the cap is ever hit, the response carries `truncated: true`,
  the server logs it, and the page shows a banner — a silently partial total
  would be worse than no total.
- No warehouse and no background aggregation, per scope.

---

## 8. Verification

**Tests: 3818/3818 pass.** 25 are new, across three layers:

- *Pricing:* exact rates, per-model arithmetic, clamping of malformed token
  counts, unknown models returning `null`, and a guard asserting every model
  `modelRouting.js` can emit has a price row.
- *Aggregation:* range bounds, program-timezone day math across the UTC boundary
  and across DST, continuous trend axis (quiet days render as zero), workload
  attribution including a skill whose row has since vanished, truncation echo,
  and the Success Rate rules above — including four rate-limited rows that would
  have dragged the earlier formula to 37.5% and leave the rate at 75%.
- *Source pins:* endpoint authorization and allow-list posture, the metadata-only
  column list, no Anthropic credential in the client, exactly one fetch target,
  no direct audit-table read, and the retired combined-failure field being gone
  so no stale consumer can read the old semantics.

**Lint:** 0 problems on all touched files.

**Build:** production build green; the built bundle was scanned and carries no
Anthropic credential.

**Visual QA:** six screenshots at 1500px and 1100px against synthetic fixture
telemetry (241 requests over 30 days, five staff, base chat plus Resume Interview
Questions, seeded outcomes) generated through the real aggregation modules.

### One defect found by measurement during visual QA

`DataTable`'s `SurfaceCard` sets `overflow: hidden`, so a table wider than its
container **silently loses its rightmost columns** — an outer `overflow-x`
wrapper cannot rescue it. The recent-usage table initially measured 1008px in a
780px workspace, hiding Latency and Outcome. Fixed by folding the model under
the Workload cell (the Skills slug pattern) and stacking the Time cell into
date-over-time, bringing the table to exactly 780px with no data dropped.

---

## 9. Not built (per scope)

- No Anthropic billing API integration and no browser-side billing credential.
- No manual actual-spend entry: a persistent financial record that could drift
  from the Console would mislead rather than reconcile.
- No custom date range; the three bounded ranges cover the operational question.
- No warehouse, no background aggregation, no new analytics tables.
