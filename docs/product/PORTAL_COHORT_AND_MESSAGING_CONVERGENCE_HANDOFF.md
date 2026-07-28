# Portal Cohort Polish and Academic Partner Messages — Handoff

Branch: `portal-cohort-polish-and-ap-messages` (off `main` at `bd92c51`)
Status: complete on the branch; the branch code is NOT merged, pushed, or deployed. The primary
Owner-gated migration `20260728000000_enable_academic_partner_team_messages.sql` **has been applied in
production** (with a manual privilege correction — see §6, "Post-application privilege reconciliation");
an idempotent follow-up migration `20260729000000_revoke_service_role_from_general_team_core.sql` is
committed but **not applied** and is not required in the current production environment. Academic
Partner messaging remains fail-closed until the server env flag is set. See §6 for the activation
sequence and reconciliation.

Ordered commits:

Portal cohort + access-card + messaging convergence:
1. Converge portal cohort timeline ordering
2. Add Unit Leader cohort context
3. Center Academic Partner cohort access
4. Enable Academic Partner messages
5. Document portal cohort and messaging convergence (this doc + regression test updates)

Academic Partner messaging Owner gate:
6. Add Academic Partner messaging Owner migration (unapplied)
7. Gate Academic Partner messages by server capability (replaces the hardcoded client constant)
8. Harden Academic Partner messaging release gate (migration static-security + capability tests)
9. Document Academic Partner messaging activation (this doc's §6)

---

## 1. Canonical portal cohort timeline ordering

New shared helper: [`src/lib/derivations/cohortOrder.js`](../../src/lib/derivations/cohortOrder.js).
It is the single ordering canon the portals consume; the main app's own header switcher
(`src/App.jsx` `sortedCohorts`, start-date ascending) is intentionally **not** rewired, so the main
app's visible order never changes.

`orderCohortsByTimeline(cohorts)` returns a new array ordered:

1. **current** (`status === 'Active'`) — by `start_date` ascending
2. **upcoming** (`Planning`, or any non-terminal/unknown status) — by `start_date` ascending
3. **historical** (`Completed` / `Archived`) — by `start_date` descending

Missing start dates sort last within their group; ties fall back to `created_at` ascending, then
`name`, then `id` (stable and deterministic). Companion exports: `cohortLifecycle`, `currentCohorts`,
`newestByStart`.

Consumers:

- Academic Partner Students picker and Placement Requests submission picker
  (`src/portal/ap/academicPartnerRoster.js`: `splitCohorts`, `cohortOptions`,
  `submissionCohortOptions`), which now order via the helper while preserving their **defaults**:
  Students defaults to the newest Active cohort (`compareCohortNewest`); Placement Requests defaults
  to the nearest accepting cohort (the intake model keeps exactly one cohort accepting at a time).
- The new Unit Leader cohort picker (`src/portal/unit/unitCohortScope.js`).

Virtual aggregate options (`All Current Cohorts`, `All Cohorts`) always follow the real cohorts, and
`All Cohorts` is never a submission target. School / unit / campus authorization and WCU Anaheim vs
North Hollywood isolation are unchanged (all server-derived).

## 2. Unit Leader cohort context (workspace rules)

Header picker in the Nightfall header (`src/portal/UnitLeaderPortal.jsx`,
`src/portal/unit/unitCohortScope.js`). It is **context-aware, not a global filter**: it renders only
on genuinely cohort-scoped, roster-backed workspaces AND only when the authorized roster spans more
than one cohort (`cohortCount > 1`), so a single-cohort unit gets no cosmetic control.

| Workspace | Cohort picker? | Behavior |
|---|---|---|
| Home | Yes (when >1 cohort) | Default = newest Active cohort. `All Current Cohorts` when >1 Active; `All Cohorts` for historical viewing. Narrows the roster, its counts, On Campus Now, and the rotation calendar consistently (client-side, within the server-authorized set). "All Cohorts" applies no shift narrowing (prior behavior preserved). |
| Students | Yes (when >1 cohort) | Same cohort scoping applied to the roster table. |
| Placement Requests | No | Acts on the single server-resolved accepting cohort (`resolveAcceptingCohort`); a picker would be ambiguous/cosmetic. |
| Capacity | No | Same single accepting cohort; the in-form unit picker is unchanged. |
| Evaluations | No | The `unit-evaluations` endpoint has no cohort filter; released-evaluation privacy/release gates are untouched. |
| Preceptors | No | The preceptor directory is not cohort-specific. |
| Messages | No | No artificial cohort filtering. |

Server derives authorized unit scope; the browser cohort choice only narrows within it and never
mutates a student's cohort. The multi-unit "Viewing" selector and the 90-day completed-visibility
window / Owner-Admin override are unchanged. Cohort metadata rides on each roster student
(`unit-roster.js` returns `s.cohort = { id, name, status, start_date, end_date }`), so no server
change was needed.

## 3. Centered Academic Partner cohort-access card

New shared presentational component
[`src/components/CohortAccessCard.jsx`](../../src/components/CohortAccessCard.jsx) (classes
`.cohort-access-*` in `src/index.css`). Both gates render it:

- Public `/school-form` (`SchoolFormPage.jsx`): inside its full-screen `.uf-page` shell with the
  Cedars-Sinai logo passed in. Verify RPC + page-state transition unchanged.
- Academic Partner Placement Requests (`PlacementRequestsView.jsx`): centered in the workspace via
  `.ptl-plr-gate-center`, below the page heading and Nightfall header, no logo/full-screen shell. The
  checking, password, and verifying/invalid-password states all stay centered; once access succeeds
  the form uses the normal full width.

Preserved: cohort name in the copy, password input/error/`Access Form` action, keyboard and
password-manager behavior, no password stored/exposed, and final-POST server-side re-verification
(the transient verified password is re-attached to the POST and re-shown on a server reject).

## 4. Academic Partner messages with the ASPIRE Team

First-release scope: **Academic Partner ↔ ASPIRE Team general school-partner threads only**. Excluded:
AP↔student, AP↔preceptor, AP↔another school, student-linked threads, staff-internal threads, and any
recipient browsing. The recipient is the fixed server-resolved **ASPIRE Team** (shared inbox
`aspire@cshs.org`); there is no recipient picker.

**Reuse, no parallel system.** AP Messages reuses the canonical stack end to end: the shared
`PortalMessagesWorkspace` (`variant="academic_partner"`), the shared lower-right
`PortalTeamMessagesPanel` launcher with the `#DC1E34` unread badge, the shared React-Query cache keys
(`portal_messages_list` / `portal_messages_unread` / thread keys), and the existing endpoints
(`messages-list` / `messages-thread` / `messages-unread-count` / `messages-mark-read` /
`messages-reply` / `team-messages-start`). No new tables, endpoints, or message store were added.

**Authorization chain** (every read and write): verify the caller JWT → require an active
`academic_partner` grant → derive active school scope from `user_school_scopes`
(`verifyPortalAcademicPartnerCaller`, now chained last in `verifyPortalMessagesCaller`). Cross-school,
student-linked, revoked/expired, and WCU-campus isolation are enforced by that shared verifier and the
DB read/send predicates; browser-supplied identifiers never widen scope. `team-messages-start`
additionally requires an active school scope and derives identity/subject/routing server-side.

**Fail-closed server capability gate (no hardcoded client constant).** Enablement is a server-owned
capability, `resolveApMessagingCapability(db)` in
[`api/lib/apMessagingCapability.js`](../../api/lib/apMessagingCapability.js): it is `true` only when
BOTH the server env `AP_MESSAGING_ENABLED === 'true'` AND the database migration is applied (proved by
probing the `ap_team_messaging_capability()` sentinel via service role — read-only, no mutation, no
anon/RLS false positive). The client never decides enablement: `PortalApp` fetches one canonical result
from `GET /api/portal/portal-capabilities` (authenticated), and that single value gates both the
Messages tab and the lower-right launcher. Until enabled:

- the AP Messages tab shows an honest prepared state (no workspace, no polling);
- no lower-right Messages launcher mounts for an Academic Partner;
- `team-messages-start` refuses AP thread creation with `503 messaging_not_enabled` (never attempting
  the RPC);
- even if the read endpoints are reached, the DB predicates return an **empty** inbox (never a leak).

Writes re-authorize independently even when capability reports enabled (the caller JWT + role/scope
verification runs first, and the start RPC re-authorizes in the DB). The AP Messages tab and thread
deep links live under `/portal/ap/messages` and `/portal/ap/messages/:threadId`.

## 5. Shared lower-right launcher

`PortalUtilityLayer` now includes the Academic Partner kind in `messagesEnabled` (gated on
`messagesAuthorized`, which the AP branch drives from the server capability `apMessagesEnabled`), and
passes `variant="academic_partner"` to the one shared `PortalTeamMessagesPanel`. Same launcher, same
modal, same `#DC1E34` unread badge, same inbox/thread data as the Messages tab (shared cache keys, no
duplicate polling). The lower-left Feedback control is unchanged; there is never a second lower-right
launcher.

## 6. Owner activation — Academic Partner messaging (the ONLY remaining blocker)

The messaging schema already reserves the `academic_partner` / `school` participant shape
(`conversation_participants.chk_participant_role_scope` already allows it). The one remaining change is
a committed, unapplied, **atomic** migration.

1. **Exact migration filename:**
   [`supabase/migrations/20260728000000_enable_academic_partner_team_messages.sql`](../../supabase/migrations/20260728000000_enable_academic_partner_team_messages.sql)

2. **Copy-paste-ready SQL:** apply that migration file verbatim (it is the authoritative, review-ready
   SQL — kept in one place to avoid drift). The executable statements run inside ONE transaction
   (`BEGIN … COMMIT`); if any fails, nothing is applied. It is additive and idempotent
   (`CREATE OR REPLACE` + revoke/grant), changes no table, and performs no backfill. It:
   - adds `public.message_profile_has_active_academic_partner_portal_scope(uuid)` (active
     `academic_partner` grant + at least one active `user_school_scopes` row);
   - `CREATE OR REPLACE`s `message_participant_can_read` — student/unit_leader branches byte-for-byte,
     plus an academic_partner branch that EXPLICITLY enforces general-thread isolation: the participant
     row has no student/unit/cohort context, the joined **conversation** row has no student/unit/cohort
     context (the canonical general-team discriminator, since there is no stored `thread_kind` column),
     and `scope_school_key` EXACTLY equals an active `user_school_scopes.school_key` (WCU campuses
     isolated; never LIKE/substring/email-domain/display-name);
   - `CREATE OR REPLACE`s `message_participant_can_send` unchanged (it composes `can_read`, so AP
     inherits the active-scope check; only the unit_leader staleness guard remains);
   - refactors the general-team start path WITHOUT duplicating the workflow: an internal
     `messages_start_general_team_conversation_core(…, p_scope_school_key)` holds the shared workflow;
     the public 8-arg `messages_start_general_team_conversation` keeps its EXACT signature and admits
     ONLY student/unit_leader (delegating to the core); a dedicated
     `messages_start_general_team_conversation_ap(…, p_school_key)` handles the school-scoped path;
   - locks the Academic Partner recipient to `aspire@cshs.org` (asserted in the core BEFORE any write —
     the shared validator only forces the `shared_inbox` kind, not the exact address) and inserts a
     general thread (`related_*` NULL) with one `(academic_partner, school, scope_school_key)`
     participant and student/unit context NULL;
   - creates the `public.ap_team_messaging_capability()` sentinel LAST, so its presence proves the whole
     migration committed.

3. **Multi-school Academic Partners:** the browser selection is never authorization. A single-school AP
   auto-resolves server-side. A multi-school AP sends the selected school; `team-messages-start`
   verifies it against the caller's active `user_school_scopes` (`school_selection_required` /
   `invalid_school_scope` otherwise) and passes only the verified canonical key to the AP RPC, which
   re-verifies it is an active scope (exact match; WCU isolated) before the core writes.

4. **Verification queries:** at the bottom of the migration file (OUTSIDE the transaction) — (a) all
   functions exist with `prosecdef` (except the IMMUTABLE sentinel) and a locked `search_path`, exactly
   ONE 8-arg `messages_start_general_team_conversation` (student/UL), ONE 8-arg
   `messages_start_general_team_conversation_ap`, ONE 9-arg `_core`, and NO stray prior overload; (b)
   EXECUTE granted only to `service_role`, and the internal `_core` granted to NO ONE; (c)
   `SELECT public.ap_team_messaging_capability();` returns `true`; (d) student/unit_leader unchanged.

5. **Expected function signatures:**
   - `public.message_participant_can_read(p_conversation_id uuid, p_profile_id uuid) -> boolean`
   - `public.message_participant_can_send(p_conversation_id uuid, p_profile_id uuid) -> boolean`
   - `public.messages_start_general_team_conversation(uuid, text, uuid, text, text, text, text, jsonb) -> jsonb` (unchanged; student/UL only)
   - `public.messages_start_general_team_conversation_ap(uuid, uuid, text, text, text, text, jsonb, text) -> jsonb` (new; academic_partner)
   - `public.messages_start_general_team_conversation_core(uuid, text, uuid, text, text, text, text, jsonb, text) -> jsonb` (new; internal-only)
   - added: `public.message_profile_has_active_academic_partner_portal_scope(uuid) -> boolean`,
     `public.ap_team_messaging_capability() -> boolean`

6. **Expected grants:** `REVOKE ALL ... FROM PUBLIC, anon, authenticated;` for every function, plus
   `GRANT EXECUTE ... TO service_role;` for the two predicates, the two entry RPCs (8-arg + `_ap`), the
   scope helper, and the sentinel. The internal `_core` is revoked from everyone and granted to NO ONE
   (invoked only by the two SECURITY DEFINER entry RPCs).

7. **Environment variable:** `AP_MESSAGING_ENABLED` (server env, e.g. Vercel Production). Accepted
   enabling value: the exact string `true`. Missing or any other value = disabled (fail-closed). This
   is a server env var only; it is never exposed to the client (no `VITE_` variable).

8. **Activation sequence (no code edit required after the migration is approved):**
   1. Owner applies `20260728000000_enable_academic_partner_team_messages.sql`.
   2. Run the verification queries (signatures, DEFINER, grants, sentinel = true).
   3. Set server env `AP_MESSAGING_ENABLED=true`.
   4. Trigger a normal production deployment.
   5. `GET /api/portal/portal-capabilities` (authenticated) returns `{ "ap_messaging": true }`.
   6. The Academic Partner Messages tab and the lower-right launcher activate.

9. **Rollback (ordered; corrected function set):** additive migration, so no data to back out. Fastest
   operational disable WITHOUT SQL: unset `AP_MESSAGING_ENABLED` (or set it to anything but `true`) and
   redeploy — the capability gate reports disabled and the feature is fail-closed even while the
   migration remains applied. Full revert, in one transaction: (1) re-apply the prior definitions of
   `message_participant_can_read`, `message_participant_can_send`, and
   `messages_start_general_team_conversation` from `20260724000001_general_team_threads_backend.sql`;
   (2) `DROP FUNCTION public.messages_start_general_team_conversation_ap(...)`;
   (3) `DROP FUNCTION public.messages_start_general_team_conversation_core(...)`;
   (4) `DROP FUNCTION public.ap_team_messaging_capability()`;
   (5) `DROP FUNCTION public.message_profile_has_active_academic_partner_portal_scope(uuid)`.

10. **Authenticated live-QC checklist (after activation):**
    - An active Academic Partner sees the Messages tab render the canonical workspace and the
      lower-right launcher with the `#DC1E34` unread badge.
    - Compose a new thread → recipient shows as **ASPIRE Team**; the confirmation is "Your message was
      sent to the ASPIRE Team."; `aspire@cshs.org` receives the shared-inbox notification.
    - A multi-school AP picks the school in the launcher composer; a single-school AP sends with no
      picker. Reply to the thread; active-tab Refresh refetches inbox and the open thread; unread
      clears on read.
    - There is no recipient picker and no staff directory; the composer targets only ASPIRE Team.
    - A second authorized school cannot see the first school's thread; a partner with a revoked grant
      loses access; the two WCU campuses see only their own threads.
    - Student and Unit Leader messaging behave exactly as before.

11. **General-thread-only:** Academic Partner messaging is general school-partner threads to the ASPIRE
    Team only (`student_id`/student-context NULL). No AP-to-student, AP-to-preceptor, AP-to-another-
    school, student-linked, or staff-internal threads exist or are reachable.

12. **Student and Unit Leader messaging unchanged:** the migration reproduces the student and
    unit_leader branches byte-for-byte; the public 8-arg RPC keeps its exact signature and admits only
    student/unit_leader (delegating to the shared core), so their behavior is preserved. The server auth
    chain admits AP strictly last, after the unchanged student and unit_leader checks. Preceptor remains
    a schema reservation, admitted nowhere.

### Post-application privilege reconciliation (internal core EXECUTE)

- The primary migration `20260728000000_enable_academic_partner_team_messages.sql` **was applied in
  production.**
- Production verification found the internal
  `public.messages_start_general_team_conversation_core(...)` still had an **inherited `service_role`
  EXECUTE** privilege: the original `REVOKE` named only `PUBLIC, anon, authenticated`, so a role-level
  default left `service_role` able to execute the internal core directly. (The core is meant to be
  reachable only through the two SECURITY DEFINER entry RPCs.)
- The **Owner manually revoked** that privilege in production.
- **Final verified production state:** `EXECUTE` on the core is `false` for `anon`, `authenticated`,
  **and** `service_role`. The core is granted to no role; the two entry RPCs remain `service_role`-only.
- The primary migration file was updated so its core `REVOKE` names `service_role` explicitly, and an
  **idempotent follow-up migration**
  `20260729000000_revoke_service_role_from_general_team_core.sql` re-affirms the revoke so any future
  environment lands in the same state after applying the migration set. It is privilege-only (no
  function/table/data change), grants nothing, and is safe to run repeatedly.
- **No further production SQL is required now.** The follow-up is for parity in fresh/other
  environments and as the durable record of the reconciled state.

## Verification

- Focused + full suite: `node --test 'test/*.test.mjs'` — all passing.
- Changed-file ESLint — clean.
- Production build with `.env.development.local` — succeeds.
- `git diff --check` — clean.

New tests: `cohortTimelineOrdering`, `unitLeaderCohortContext`, `cohortAccessCardConvergence`,
`academicPartnerMessages`, `apMessagingMigration` (migration static-security), `apMessagingCapabilityGate`
(behavioral capability gate). Updated regressions: AP roster/students/shell, portal header scope, UL
scope-selector/polish/utility-layer/calendar, messaging phases 3B/5bi/5bii, docked-messages UI,
portal-experience convergence.

## Explicitly unchanged

Main app cohort switcher order; placement provenance / password security; email routing; the stray
`src/portal/UnitLeaderPortal 2.jsx` (untouched). The messaging DB predicates change ONLY via the
migrations in §6. The primary migration `20260728000000` has been applied in production (by the Owner,
with the manual privilege revoke reconciled in §6); the follow-up `20260729000000` is committed but
unapplied. No SQL was run from this branch. The former hardcoded client constant
`src/lib/apMessaging.js` was removed in favor of the server capability gate. The branch code was not
merged, pushed, or deployed.
