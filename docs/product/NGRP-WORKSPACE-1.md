# NGRP-WORKSPACE-1: Phase-1 build handoff

Status: built on branch `ngrp-workspace-1`. Migration
`20260903000000_ngrp_foundation.sql` is written but **NOT applied** (Owner SQL
gate). No production data was touched.

**Product source of truth: `docs/product/NGRP_WORKSPACE_PRODUCT_PLAN.md`**
(2026-08-28). This document only records what Phase 1 actually built, where it
deliberately stops, and what must be applied next. Where this file and the
plan differ, the plan wins.

## What exists after Phase 1

- **Workspace switcher** (`src/components/Header/WorkspaceSwitcher.jsx`):
  explicit ASPIRE | NGRP segmented control in the header, brand-adjacent. The
  active workspace is the solid white segment; switching is plain navigation
  (no scroll/swipe). The ASPIRE cohort picker is untouched in both
  workspaces. Direct URLs, browser back/forward, and keyboard use all work.
- **NGRP six-tab nav** (`src/components/ngrp/NgrpNav.jsx`, tab data in
  `src/lib/ngrp/ngrpTabs.js`): Applicants, Support, Planning, Interviews,
  Residency, Evaluation - chips spell ASPIRE. Renders in the sticky
  `.top-section` exactly like UnifiedNav; routes are `/ngrp/<tab>` per the
  plan's route table, derived from the URL the same way the ASPIRE tabs are.
- **Cycle selector** (`NgrpWorkspace.jsx` cycle strip): the workspace's
  primary selector, reading `ngrp_cycles`. A cycle is not a cohort; the
  ASPIRE cohort remains a *filter* inside Applicants. Defaults to the active
  cycle; the last selection persists per browser (`aspire:ngrpCycleId`; the
  plan's per-user persistence can layer on later without UI change).
- **Applicants roster** (`ApplicantsTab.jsx`): derives from the canonical
  cohort-scoped `students` state App.jsx already loads - `status ===
  'Completed'` students ARE the prospective candidates. Identity (id, name,
  headshot via the existing signed-URL avatar, school, program, cohort) comes
  only from the student row. Cycle-specific state joins from
  `ngrp_candidates` by `student_id`, with neutral defaults when no row
  exists (Not Sent / No Response / Pending / Not Confirmed).
- KPI filter cards (reusing `FilterKPICard`), search + ASPIRE-cohort +
  school + sort controls **kept in the URL** (`?kpi=&q=&cohort=&school=&sort=`,
  written only from event handlers), result count, bulk selection with a
  validated Send review dialog (missing-email and already-sent recipients
  called out before anything happens), applicant detail drawer (reusing
  `DetailDrawer` + `StudentAvatar`), sticky table header, responsive column
  collapse, empty states.
- **Status language** (`src/lib/ngrp/ngrpStates.js` +
  `NgrpStatusPill.jsx`): every vocabulary from plan §5.3 with icon + text +
  color (color never the only signal); gray states styled neutral.
- **Fail-soft provisioning** (`src/lib/ngrp/useNgrpData.js`): while the
  migration is unapplied, PostgREST reports the tables missing (PGRST205 /
  42P01); the hooks return `provisioned: false`, the roster still renders
  fully, and every persisted action is visibly disabled with the reason.
- Support / Planning / Interviews / Residency / Evaluation render honest
  placeholder cards describing what each tab becomes (per plan §§9-13).

## Derivation contract (do not regress)

1. `students` is the only identity source. `ngrp_candidates` stores workflow
   state only - never a name, email, or headshot.
2. A candidate row is created **only when an NGRP action occurs** (form sent,
   interest recorded, eligibility calculated, application confirmed, unit
   assigned, interview recorded). Absence of a row is a neutral default.
3. A submitted Transition Form ≠ an application. An eligible result ≠ an
   application. Only `application_status = 'confirmed'` (an explicit staff
   act) places an alumnus on the official NGRP list.
4. Ranked unit preferences (alumnus request) and the HR-assigned unit are
   separate concepts and never substitute for each other.
5. Eligibility overrides require a reason (DB CHECK); the calculated result
   is always retained and shown beside the effective one.
6. Support participation never affects eligibility.
7. Legacy `ngrp_outcomes` table and `students.ngrp_cohort_target` /
   `ngrp_outcome` are untouched; the drawer shows the student fields
   read-only. Reconciliation is its own later, evidence-first step (plan §14).

## Phase-1 schema subset (why only two tables)

The plan's §14 model has fifteen tables. Phase 1 creates the two the roster
and selector read - `ngrp_cycles` (full §10.1 status vocabulary, date fields,
jsonb rule/checklist/benchmark configuration) and `ngrp_candidates` (interest,
calculated + effective eligibility with enforced override reason, application
state). Form lifecycle (`ngrp_transition_assignments/_tokens/_drafts/
_revisions`), `ngrp_cycle_units`, `ngrp_interviews`, support, residency,
mentorship, retention, and audit tables ship with their own workflow phases;
the roster columns they feed render neutral defaults until then. RLS on both
tables: SELECT for active owner/admin/co_lead (both spellings), no client
write path - all writes are future service-role endpoints.

## Must happen before persisted workflows can be tested

1. Owner applies `supabase/migrations/20260903000000_ngrp_foundation.sql` in
   the SQL Editor: PREFLIGHT (P1-P4, read-only) first, then the single
   transaction, then the one-row VERIFICATION select (expect 2 tables, RLS on
   both, 2 policies, 4 indexes, 2 triggers, 0 rows each). Rollback section
   included; lossless until the first candidate row exists.
2. Reload the app: the "Awaiting NGRP provisioning" chip disappears and cycle
   reads go live.
3. First cycle: either a one-time Owner INSERT into `ngrp_cycles`, or wait
   for the Phase-2 `cycle-manage` endpoint (Planning tab).
4. Phase-2 endpoints per plan §§6, 7, 15 (all service-role, active
   Owner/Admin/Co-Lead, activity-logged, idempotent upsert of the
   `(cycle_id, student_id)` row): cycle-manage, send-transition-form (token
   hash only + Connect Send-to-Many template `ngrp_transition_form_invitation`
   with per-recipient links and honest delivered/failed/skipped reporting),
   the public transition form route, recalculate-eligibility,
   override-eligibility, confirm-application / record-withdrawal.

Realtime posture (plan §5.4): invalidate `['ngrp_candidates', cycleId]` after
staff actions; quiet periodic refetch as fallback; no toasts for routine
background changes.
