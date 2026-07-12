# ASPIRE Public Platform Content Governance

Phase 5 governance record. This file is the operating agreement for what may
appear on the public site and in the portals, who approves it, and how the
verification workflows run. Source inventory:
`reference/fable/public-platform/ASPIRE_Internal_SharePoint_Content_Source.md`
(internal, not committed).

## Status labels

Every public-facing content block carries exactly one status:

- approved for public use
- public with edits
- internal only
- requires legal or communications review
- requires data verification
- requires annual review
- requires policy-owner approval
- archived or outdated

## Current classification of the live public site

The Phase 1 public site shipped with "public with edits" content only, no
metrics, no partner-school names, no team bios, and `noindex` on every page.

| Page | Status | Notes |
|---|---|---|
| / (home) | public with edits | qualitative statements only, no figures |
| /about | public with edits | |
| /eligibility | public with edits | requirements summarized; detail deferred to school coordinators |
| /apply | public with edits | |
| /experience | public with edits | Magnet and PTAP language EXCLUDED pending verification |
| /preceptors | public with edits | |
| /faq | public with edits | NGRP pathway names kept generic pending verification |
| /contact | requires communications review | aspire@cshs.org public listing not yet approved; page routes to school coordinators |

Blocked until approval (do not add without the named sign-off):

| Item | Required approval |
|---|---|
| Outcome metrics (retention, hire rate, application rate, resident share) | data verification plus leadership approval, via the public_metrics workflow below |
| Affiliate school names | Nursing Academic Partnerships plus ASPIRE leadership |
| Team names, credentials, bios, headshots | individual consent plus Nursing Institute leadership |
| Magnet and PTAP designation language | current designation verification |
| aspire@cshs.org as public contact | ASPIRE leadership plus Cedars-Sinai communications |
| Public indexing (removing noindex) | Cedars-Sinai communications and digital governance |

## Public metrics workflow (public_metrics table)

A number appears on the public site only after all of these hold, enforced by
a database CHECK constraint plus the approved-only read path:

1. Row created with status `draft` (metric key, label, display value).
2. Source verification recorded: numerator definition, denominator
   definition, reporting period, source system, verified_by, verified_at.
   Status moves to `verified`.
3. Leadership approval recorded: approved_by, approved_at, review_due.
   Status moves to `approved`. Only now does `/api/public-metrics` return it.
4. `review_due` is a hard date; a metric past review is moved back to
   `verified` (or `retired`) until re-approved.

The four SharePoint figures (93.4 percent retention, 96.5 percent hire rate,
91.4 percent application rate, one-in-five residents) are NOT in the table
and must complete this workflow before any public use.

## Released reports workflow (released_reports table)

Unit and school portals show curated snapshots only, never live feedback:

1. Staff (owner or admin) curate content, applying small-cohort suppression:
   do not publish any aggregate where a cell could identify an individual;
   the working minimum is n below 5 suppressed.
2. Publish via `/api/released-reports-admin` (action `publish`) with
   audience_type `unit` or `school` and scope_ref set to the canonical unit
   or school key.
3. Revoke via action `revoke`; portals stop seeing the report immediately.

## Content owners (from the source inventory)

- ASPIRE overview and eligibility: ASPIRE lead and co-lead
- Academic affiliations: Nursing Academic Partnerships plus ASPIRE leadership
- Health and safety requirements: nursing education, employee health,
  compliance, and onboarding owners (never published in detail)
- Public outcomes: ASPIRE leadership, Nursing Institute leadership,
  analytics, and communications
- Team biographies: individual team members plus Nursing Institute leadership
- Public contact information: ASPIRE leadership plus communications
- Residency pathway language: NGRP leadership
- Public branding: Cedars-Sinai communications and digital governance

## Review cadence

- Public site copy: annual review, or immediately on any policy change
- Approved metrics: per-row review_due, set at approval
- Released reports: revoke and republish rather than edit in place
- This file: update whenever a blocked item gains approval or a page's
  status changes
