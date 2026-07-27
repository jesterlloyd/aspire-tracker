# Portal Cohort Polish and Academic Partner Messages — Handoff

Branch: `portal-cohort-polish-and-ap-messages` (off `main` at `bd92c51`)
Status: complete on the branch; NOT merged, pushed, or deployed. No SQL or migration was added or
run. The one database change this work needs is reported below as an unapplied Owner SQL gate.

Five ordered commits:

1. Converge portal cohort timeline ordering
2. Add Unit Leader cohort context
3. Center Academic Partner cohort access
4. Enable Academic Partner messages
5. Document portal cohort and messaging convergence (this doc + regression test updates)

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

**Fail-closed capability flag.** [`src/lib/apMessaging.js`](../../src/lib/apMessaging.js) exports
`AP_MESSAGING_ENABLED = false`. Until the Owner SQL gate (below) is applied and this flag is flipped:

- the AP Messages tab shows an honest prepared state (no workspace, no polling);
- no lower-right Messages launcher mounts for an Academic Partner;
- `team-messages-start` refuses AP thread creation with `503 messaging_not_enabled` (never attempting
  the RPC);
- even if the read endpoints are reached, the DB predicates return an **empty** inbox (never a leak).

Flipping `AP_MESSAGING_ENABLED` to `true` after the Owner applies the SQL activates the fully-wired
canonical workspace + launcher with no further code change. The AP Messages tab and thread deep links
live under `/portal/ap/messages` and `/portal/ap/messages/:threadId`.

### Owner SQL gate (unapplied — the ONLY remaining blocker)

The messaging schema already reserves the `academic_partner` / `school` participant shape
(`conversation_participants.participant_role` and `scope_kind` CHECKs already list it), but three
`SECURITY DEFINER` functions admit only `student` and `unit_leader`. The Owner must
`CREATE OR REPLACE` all three, **preserving the existing student/unit_leader logic** and **adding** an
`academic_partner` branch. Smallest exact gate:

1. **`message_participant_can_read(...)`** and **`message_participant_can_send(...)`**
   (last defined in `supabase/migrations/20260724000001_general_team_threads_backend.sql`): admit a
   participant row where `participant_role = 'academic_partner'` and `scope_kind = 'school'`, gated to
   the caller's active `user_school_scopes` (`scope_school_key` must match an active, non-revoked,
   in-window school scope for `portal_profile_id()`), exactly mirroring how the `unit_leader` /
   `scope_unit_key` branch is gated to active unit scopes. Read admits the general (student-and-unit
   context null) thread; send admits the same. `my_message_conversation_ids()` inherits this through
   `message_participant_can_read`.

2. **`messages_start_general_team_conversation(p_actor_profile_id, p_actor_kind, ...)`**
   (same migration): accept `p_actor_kind = 'academic_partner'`, and create the conversation with all
   `related_*` columns NULL plus one participant row `(participant_role='academic_partner',
   scope_kind='school', scope_school_key = <the caller's active school scope>, all other scope columns
   NULL)`. Author role on the message = `'academic_partner'`. Rate-limit / idempotency behavior
   unchanged.

Security invariants the gate must keep: an AP sees only its own school's general threads; no
student-linked or staff-internal thread is ever readable; a revoked/expired grant or school scope
fails closed; and the two WCU campuses stay isolated (exact normalized `scope_school_key` match, never
substring).

After applying: flip `AP_MESSAGING_ENABLED` to `true` and redeploy.

## 5. Shared lower-right launcher

`PortalUtilityLayer` now includes the Academic Partner kind in `messagesEnabled` (gated on
`messagesAuthorized`, which the AP branch drives from `AP_MESSAGING_ENABLED`), and passes
`variant="academic_partner"` to the one shared `PortalTeamMessagesPanel`. Same launcher, same modal,
same `#DC1E34` unread badge, same inbox/thread data as the Messages tab (shared cache keys, no
duplicate polling). The lower-left Feedback control is unchanged; there is never a second lower-right
launcher.

## Verification

- Focused + full suite: `node --test 'test/*.test.mjs'` — all passing.
- Changed-file ESLint — clean.
- Production build with `.env.development.local` — succeeds.
- `git diff --check` — clean.

New tests: `cohortTimelineOrdering`, `unitLeaderCohortContext`, `cohortAccessCardConvergence`,
`academicPartnerMessages`. Updated regressions: AP roster/students/shell, portal header scope, UL
scope-selector/polish/utility-layer/calendar, messaging phases 3B/5bi/5bii, docked-messages UI,
portal-experience convergence.

## Explicitly unchanged

Main app cohort switcher order; placement provenance / password security; Supabase RLS and the
messaging DB predicates (the gate above is reported, not applied); email routing; the stray
`src/portal/UnitLeaderPortal 2.jsx` (untouched). Nothing was merged, pushed, or deployed.
