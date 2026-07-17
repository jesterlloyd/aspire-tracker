# ASPIRE Messages, Phase 5: Student Portal Interface

Phase 5 builds the student-facing ASPIRE Messages interface on top of the portal
APIs already deployed in production. It is delivered in two halves.

- Phase 5A (COMPLETE): the Student Portal thread reverse-pagination
  prerequisite. Backend and API foundation only. Migration applied and verified,
  endpoint integrated, deployed.
- Phase 5B-i (COMPLETE): the full Student Portal Messages workspace, built and
  deployed DORMANT. No portal navigation, route, or badge exposes it.
- Phase 5B-ii (not started): activation, plus final visual refinement.

No Student Portal Messages interface is EXPOSED. Phase 5B-i built the complete
workspace but left it dormant: it is reachable only from tests and from other
dormant Messages modules.

## Phase 5A scope

Phase 5A fixes one specific defect before any portal UI is built: the deployed
portal thread RPC pages the wrong way. Everything else about portal Messages
stays exactly as deployed.

In scope: a new `messages_portal_get_thread_v2` RPC, the portal thread endpoint
migrated onto it, and a dormant client pagination foundation.

Out of scope: portal navigation, inbox, thread screen, reply composer, New
message workflow, unread badge, polling, and every other portal UI surface.

## The oldest-first thread defect

The applied `messages_portal_get_thread` (migration `20260716000002`) selects:

```sql
WHERE m.conversation_id = p_conversation_id
  AND (p_cursor_ts IS NULL OR (m.created_at, m.id) > (p_cursor_ts, p_cursor_id))
ORDER BY m.created_at, m.id
LIMIT v_limit
```

That pages FORWARD from the oldest message. A student opening a thread with more
than 50 messages lands on the first message ever sent, and there is no cursor
direction that reaches the newest one. The message they were notified about is
the one they cannot see. "Load earlier messages" is not expressible against this
contract at all, because the only direction available is "load later messages"
starting from the beginning of history.

This is the same defect that migration `20260716000005` fixed for staff. Phase 5A
applies the identical remedy to the portal so both sides of a conversation share
one pagination model.

## Existing portal endpoint contracts

Verified by inspection at commit `71c08cf`. All six portal Messages endpoints
exist under `api/portal/`.

| Concern | File | Method | RPC called |
| --- | --- | --- | --- |
| Conversation list | `api/portal/messages-list.js` | GET | `messages_portal_list_conversations` |
| Conversation thread | `api/portal/messages-thread.js` | GET | `messages_portal_get_thread_v2` (was v1 before Stage B) |
| Start conversation | `api/portal/messages-start.js` | POST | `messages_start_conversation` |
| Reply | `api/portal/messages-reply.js` | POST | `messages_post_reply` |
| Mark read | `api/portal/messages-mark-read.js` | POST | `messages_mark_read` |
| Unread count | `api/portal/messages-unread-count.js` | GET | `messages_portal_unread_count` |

Start and reply call the shared write RPCs rather than portal-specific ones; the
caller kind is resolved server-side. Only the thread endpoint changes in Phase 5A.

### The thread endpoint BEFORE Stage B

Recorded as the starting point. See "Stage B: portal thread v2 API integration"
below for the current contract.

`GET /api/portal/messages-thread`

Query parameters: `conversation_id` (uuid, required), `limit` (default 50, max
100), `cursor_ts`, `cursor_id`.

Response: `{ conversation, messages, next_cursor }`.

Behavior worth noting: the endpoint derived `next_cursor` itself through
`nextCursorFrom(messages, limit.value, 'created_at')` because the v1 RPC returns
no pagination metadata. It guards methods through `methodGuard(req, res, ['GET'])`,
authenticates through `verifyPortalStudentCaller(req)`, and calls the RPC through
`getUserScopedDb(req)`, so the RPC runs as the signed-in student rather than as
service_role. A NULL RPC result maps to a non-enumerating 404. Stage B preserved
all of that and changed only the RPC and the pagination metadata.

## The portal thread v2 RPC

Migration: `supabase/migrations/20260716000006_messages_phase5_portal_thread_reverse_pagination.sql`

```sql
messages_portal_get_thread_v2(
  p_conversation_id uuid,
  p_limit           integer     DEFAULT 50,
  p_cursor_ts       timestamptz DEFAULT NULL,
  p_cursor_id       uuid        DEFAULT NULL
) RETURNS jsonb
```

The signature deliberately matches v1 and the staff v2, so the endpoint change is
a name swap plus new metadata rather than a rewrite.

### Newest page, backward cursor, chronological return

```sql
WITH page AS (
  SELECT ... FROM public.messages m
  WHERE m.conversation_id = p_conversation_id
    AND (p_cursor_ts IS NULL OR (m.created_at, m.id) < (p_cursor_ts, p_cursor_id))
  ORDER BY m.created_at DESC, m.id DESC
  LIMIT v_limit
)
```

With no cursor there is no lower bound, so the newest `v_limit` messages are
taken. With a cursor, the newest `v_limit` messages strictly older than it. The
bounded page is then aggregated `ORDER BY p.created_at, p.id`, so each page reads
top to bottom even though pages arrive newest-first.

The two orderings are the whole trick, and they must stay in this order: select
descending under `LIMIT` (bounding the scan to one page), then return ascending
(making the page readable). Aggregating first and reversing later would read the
entire thread.

### Deterministic ordering

Every ordering and every comparison carries the message id as a tie-breaker.
`(created_at, id)` row comparison is a real tuple comparison in Postgres, not a
pair of independent predicates, so two messages sharing a timestamp are returned
exactly once across pages: no duplicate, no skipped row. This matters more here
than it looks, because a staff reply and its automated follow-up can land in the
same transaction with identical timestamps.

### Page-size bounds

`LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100)`, identical to the staff v2.
Default 50, minimum 1, maximum 100. Zero, negative, and excessive values are
clamped rather than rejected, matching the established convention. There is no
unbounded retrieval path and no OFFSET anywhere.

### has_more and next_cursor

The oldest row of the bounded page is taken from the page itself (a CTE over
`page`, so no extra scan and no offset arithmetic). `has_more` is then a bounded
`EXISTS` check for any message strictly older than that row. This is why the API
does not need to over-fetch by one row to know whether a "Load earlier messages"
control should appear.

`next_cursor` is `{cursor_ts, cursor_id}` pointing at the oldest message of the
page just returned, and is null when no older history remains.

## Authorization

Unchanged from v1, and deliberately so: Phase 5A is a pagination fix, not an
access-model change.

```sql
IF v_me IS NULL OR p_conversation_id NOT IN (SELECT public.my_message_conversation_ids()) THEN
  RETURN NULL;
END IF;
```

### Identity resolution

The three identifiers stay distinct and are never forced equal:

- `auth.users.id` is the authenticated user
- `user_profiles.auth_user_id` maps that user to a profile
- `user_profiles.id` is the profile id used throughout Messages

`public.portal_profile_id()` performs the resolution
(`SELECT id FROM public.user_profiles WHERE auth_user_id = auth.uid()`). The
function never compares a profile id to `auth.uid()` directly.

### Active participation is the only key

`my_message_conversation_ids()` (Phase 1) requires ALL of:

- an unremoved participant row for the caller's profile in that conversation
- `participant_role = 'student'` and `scope_kind = 'student'`
- a live student role grant under the canonical active predicate
  (`revoked_at IS NULL AND starts_at <= now() AND (expires_at IS NULL OR expires_at > now())`)
- an active `user_student_links` row matching the participant scope

Reusing this helper is correct rather than merely convenient: it is the portal
participation helper, and it consults no staff context whatsoever.

Access is never granted by matching email, `student_id` alone, school, cohort,
unit, placement, preceptor relationship, related staff assignment, conversation
subject, or notification recipient. `is_staff()` is not used, and neither is any
staff helper such as `is_active_owner_or_admin()`. Staff access and portal access
remain entirely separate paths.

### Non-enumerating

An inaccessible conversation returns NULL exactly like a missing one, so a
student cannot probe for conversation ids by watching status codes. The endpoint
maps NULL to 404 either way.

## Return contract

The conversation and message projections are byte-identical to v1. Only
pagination metadata is added.

```
{
  "conversation": { "id", "subject", "category", "status", "last_message_at", "can_reply" },
  "messages": [ { "id", "body", "created_at", "author_type", "author_label", "author_name" } ],
  "limit": 50,
  "has_more": true,
  "next_cursor": { "cursor_ts": "...", "cursor_id": "..." }
}
```

`status` is the coarse portal label from `message_portal_status_label()`
(`Closed` or `Open`), never the staff workflow status. Staff authors are labeled
`ASPIRE Team` with an optional staff display name and never a staff email.

Never returned: any email address, notification delivery metadata, notification
routing, provider responses, service-role details, raw auth metadata, staff
workflow fields (assignee, follow-up flag, resolved timestamp, related cohort),
or unrelated profile data.

## Security

Follows the established Wave F-1 conventions: `SECURITY DEFINER STABLE` with
`SET search_path = public, pg_catalog`, schema-qualified references throughout,
`REVOKE ALL ... FROM PUBLIC, anon` then `GRANT EXECUTE ... TO authenticated,
service_role`.

The `authenticated` grant is what keeps service_role off the normal portal read
path: the endpoint calls the RPC as the signed-in student through
`getUserScopedDb(req)`, so the caller is resolved from their own JWT inside the
function. service_role is granted only for server tooling.

No RLS policy is weakened, no table is created or altered, no policy is added or
dropped, no anonymous access is granted, and no direct table access is granted.

## Migration application status

APPLIED AND VERIFIED. Applied manually in the Supabase SQL editor per the Owner
SQL gate, at Stage A commit `fbe2219`.

- Migration: `supabase/migrations/20260716000006_messages_phase5_portal_thread_reverse_pagination.sql`
- Verification: `db/audit/messages_phase5_portal_thread_reverse_pagination_verification.sql`

All 14 audits passed, run one numbered section at a time:

| Audit | Result |
| --- | --- |
| 1. v2 function exists | Correct signature, SECURITY DEFINER, stable volatility, fixed search_path |
| 2. No ambiguous overload | Portal v1, portal v2, and staff v2 each have exactly one overload |
| 3. Privileges | `authenticated` and `service_role` only |
| 4. Anonymous denial | `anon` and `PUBLIC` cannot execute |
| 5. Pagination source | All 10 checks PASS |
| 6. Authorization source | All 6 checks PASS |
| 7. Return privacy | All 4 checks PASS |
| 8. Portal v1 unmodified | Zero rows |
| 9. v1 and staff v2 present | Both present |
| 10. Staff v2 unmodified | Zero rows |
| 11. No anonymous portal execute | Zero rows |
| 12. RLS | Enabled on all six Messages tables |
| 13. Policy inventory unchanged | Zero rows |
| 14. Supporting index | `idx_messages_conversation_created` exists |

The migration is atomic (`BEGIN; ... COMMIT;`) and ends with
`NOTIFY pgrst, 'reload schema';` so PostgREST picked up the new function. The
verification file is read-only and remains safe to re-run at any time.

## Stage B: portal thread v2 API integration

`api/portal/messages-thread.js` now calls `messages_portal_get_thread_v2`. The
endpoint path, GET-only guard, authentication, authorization, query parameter
names, and the conversation and message projections are all unchanged. No
parallel endpoint was created; the RPC was swapped in place.

### Request

`GET /api/portal/messages-thread`

| Parameter | Rule |
| --- | --- |
| `conversation_id` | uuid, required, 422 `invalid_conversation_id` otherwise |
| `limit` | optional, default 50, max 100, 422 `invalid_limit` if not a positive integer |
| `cursor_ts` | optional, ISO timestamp, required together with `cursor_id` |
| `cursor_id` | optional, uuid, required together with `cursor_ts` |

Cursor naming is `cursor_ts` and `cursor_id`, the established repository
convention shared with the staff thread endpoint, `parseCursor`, and the RPC's own
`next_cursor` shape. That last point is the reason not to rename: a client feeds
`next_cursor` straight back as query parameters with no translation step. An
alternative such as `before_created_at` would have broken that round-trip and
diverged from staff for no gain.

### Response

```
{
  "conversation": { ... },
  "messages": [ ... ],
  "has_more": true,
  "next_cursor": { "cursor_ts": "...", "cursor_id": "..." }
}
```

`next_cursor` is null when no older page exists. Both fields now come from the
RPC and are passed through. The previous `nextCursorFrom(messages, limit,
'created_at')` derivation was removed from this endpoint: it inferred a FORWARD
cursor from the last row of a page, which cannot describe backward paging, and it
inferred "more history" from a full page, which is wrong whenever the oldest page
is exactly `limit` long. `nextCursorFrom` remains in use by both list endpoints,
which do page forward.

### Cursor rules

- Newest page: no cursor values, returns the newest bounded rows, chronological.
- Older page: BOTH `cursor_ts` and `cursor_id`, returns rows strictly older than
  the tuple.
- A partial cursor is rejected twice over: `parseCursor` returns 422
  `invalid_cursor` before the database is touched, and the RPC independently
  raises MS400 if one ever reaches it.
- The next cursor is the oldest message of the page returned.
- Equal timestamps are separated by the message id tie-breaker, so no duplicate
  and no skipped row.
- No offset, no page numbers, no forward cursor, no unbounded retrieval.

### Error mapping

| Condition | Status | Body |
| --- | --- | --- |
| Missing or invalid authentication | 401 | `unauthenticated` (or the caller's reason) |
| Invalid `conversation_id` | 422 | `invalid_conversation_id` |
| Invalid `limit` | 422 | `invalid_limit` |
| Invalid or partial cursor | 422 | `invalid_cursor` |
| RPC MS400 (partial cursor) | 422 | `validation_failed` |
| Inaccessible or missing conversation | 404 | non-enumerating |
| Anything else | 500 | `internal_error` |

There is no MS403 path on the portal: an inaccessible conversation returns NULL
from the RPC and maps to the same 404 as a missing one, so a student cannot
distinguish "not yours" from "does not exist". SQLSTATE, RPC names, stack traces,
raw Supabase errors, service-role details, and provider errors are never exposed.

### Privacy

Only a stable label and the error object reach `logApiError`. Message bodies,
previews, raw thread responses, authorization headers, bearer tokens, participant
data, and notification data are never logged. No analytics or telemetry was
added. No email is exposed.

## Dormant client foundation

`src/lib/messages/portalThreadState.js`. Pure, no React, no fetch, not imported
by any routed page.

| Export | Purpose |
| --- | --- |
| `PORTAL_THREAD_LIMIT_DEFAULT` / `_MAX` | 50 and 100, mirroring the RPC bounds |
| `clampThreadLimit` | Never request more than the backend honors |
| `portalThreadQueryKey` | Conversation-scoped cache key |
| `serializePortalThreadQuery` | Newest page or older page; never sends a partial cursor |
| `nextThreadCursor` | Reads the backward cursor; `has_more` is authoritative |
| `prependOlderPage` | Duplicate-safe merge of an older page in FRONT |
| `appendNewerPage` | Duplicate-safe merge of a refresh at the END |
| `threadPageIsCurrent` | Stale-response guard |

It exists as a separate file rather than reusing `inboxState.js` because the
thread inverts two of the inbox's assumptions. The inbox pages downward and
appends; the thread pages into history and must prepend. The inbox derives its
cursor from the last row; the thread RPC returns the authoritative backward
cursor, so the client round-trips it instead of computing one.

The stale-response rule is documented in the file for Phase 5B: key every query
by `portalThreadQueryKey(conversationId)`, pass the `AbortSignal` into the fetch,
and confirm `threadPageIsCurrent` before merging any page.

## Deployment verification

See the Phase 5A Stage B handoff for the deployed SHA and probe results.

## Phase 5B contract

Phase 5B may build: Student Portal Messages navigation, the portal inbox, the
portal conversation thread, "Load earlier messages", the portal unread badge, the
portal mark-read flow, the portal New message workflow, the portal reply
composer, portal polling, and responsive and accessibility behavior.

Phase 5B must reuse the Phase 5A v2 endpoint. It must not regress to oldest-first
pagination, and it must not reintroduce a direct browser RPC call.

## Known limitations

- `can_reply` is hardcoded `true` in both v1 and v2. Phase 5A preserved it
  verbatim rather than change portal behavior inside a pagination fix. Phase 5B
  should decide whether it must reflect real participant access state, since the
  reply endpoint independently rejects an inactive participant with a 409.
- `messages_portal_get_thread` (v1) remains deployed for rollback. It should be
  retired once the v2 integration is verified in production.
- `nextCursorFrom` is no longer used by the thread endpoint (the RPC returns the
  authoritative cursor). It remains correct and in use for both list endpoints,
  which page forward.
- Phase 5A verified the endpoint by static and pure-function tests plus
  unauthenticated production probes. No authenticated production thread read was
  performed, because opening a thread as a real student could move a read pointer.

## Phase 5B-i: dormant Student Portal Messages workspace

The complete student workspace, built and deployed but not exposed. Phase 5B-ii
performs the activation.

### Dormancy

Dormancy is structural, not conditional. No feature flag exists. `StudentPortal.jsx`,
`PortalApp.jsx`, `PortalShell.jsx`, and `App.jsx` are byte-for-byte unchanged, so
nothing routed imports the workspace and no half-built surface can appear.

The Student Portal has NO router and NO navigation: `PortalApp` resolves portal
roles through `get_my_portal_access()` and renders `StudentPortal` directly inside
`PortalShell`. There is therefore no route map to guard and no `/portal/messages`
path to leave dangling. The Phase 5B-ii activation points are exactly two:

- `src/portal/StudentPortal.jsx`, which would render the workspace as a section
- `src/portal/PortalShell.jsx`, which would host a navigation badge if one is wanted

Neither was touched.

### Files

| File | Role |
| --- | --- |
| `src/lib/messages/portalMessagesApiClient.js` | The six portal endpoints |
| `src/lib/messages/portalMessagesConstants.js` | Copy, status handling, safe errors |
| `src/lib/messages/portalMessagesPolling.js` | Unread hook, visibility, narrow width |
| `src/portal/messages/PortalMessagesWorkspace.jsx` | Composition, mark-read, mobile view |
| `src/portal/messages/PortalMessagesInbox.jsx` | Conversation list |
| `src/portal/messages/PortalMessagesThread.jsx` | Thread and Load earlier messages |
| `src/portal/messages/PortalNewMessageDrawer.jsx` | New message |
| `src/portal/messages/PortalReplyComposer.jsx` | Reply |
| `src/portal/portal.css` | Responsive and accessibility rules |

Portal components live under `src/portal/messages/`, never inside the staff
Connect tree.

### Client architecture

The portal client holds no transport logic. It reuses the exported `request` core
from `messagesApiClient.js`, which already owns the bearer token, the
routing-field guard, safe error mapping, and the no-raw-logging rule. Duplicating
that would have meant two places to get authentication wrong.

`MessagesApiError` now carries `reason` in addition to `code`. This was
additive: `code` is unchanged and the staff client is unaffected.

### Contracts as used

| Concern | Request | Response |
| --- | --- | --- |
| List | `limit` (25 default, 100 max), `cursor_ts`, `cursor_id` | `{conversations, next_cursor}` |
| Thread | `conversation_id`, `limit` (50 default), `cursor_ts`, `cursor_id` | `{conversation, messages, has_more, next_cursor}` |
| Start | `{subject, category, body}` | 201 `{conversation_id, message_id, created_at, status, confirmation}` |
| Reply | `{conversation_id, body}` | 201 `{message_id, created_at, reopened, confirmation}` |
| Mark read | `{conversation_id}` | 200 `{conversation_id, last_read_at}` |
| Unread | none | `{unread_count}` |

Start takes NO recipient and NO participant field: the server resolves the
student from the verified JWT and the ASPIRE Team is implicit. That is why there
is no recipient picker. Mark-read takes only `conversation_id`: the timestamp is
server-derived and the profile comes from the JWT, so a client clock and a client
profile id cannot move a pointer.

Both writes return a `confirmation` string. The UI announces the server's own
value and treats the local constant only as a fallback, so an announcement can
never contradict what actually happened. No email delivery is ever claimed.

### Status mapping

The browser does NOT map status. `message_portal_status_label()` already collapses
`waiting` into `Open` and `resolved` into `Closed` server-side, and both the list
RPC and the thread v2 RPC project that label rather than the raw workflow status.
The staff-only `Waiting` state is therefore unreachable from the portal by
construction rather than by client convention. `portalStatusLabel` normalizes what
the API sends and fails safe to `Open`.

### Thread pagination

Reuses the Phase 5A foundation unchanged: newest bounded page first, chronological
within each page, `cursor_ts` plus `cursor_id` paging backward, older pages
prepended duplicate-safe, `has_more` authoritative rather than inferred from page
length, no offset, no unbounded retrieval. Conversation-scoped query keys plus
`threadPageIsCurrent` keep a late response from a previous selection out of the
current thread.

### Author display

`author_label` is the server's own label (`You` or `ASPIRE Team`). A staff display
name renders as smaller, lighter secondary context, so an individual never
outranks the team. No staff email exists in the projection.

### Mark-read flow

Fires only when the newest page renders for the still-selected conversation,
keyed on the newest message id so loading an older page cannot trigger it. Unread
clears and the total refreshes only after the awaited success. Failure leaves
unread intact and recoverable rather than falsely clearing the badge.

### Polling

30 seconds for inbox, thread, and unread while Messages is active; 60 seconds for
the unread total elsewhere (`PORTAL_IDLE_UNREAD_POLL_MS`, wired in 5B-ii). Paused
while `document.hidden`, refreshed on focus, serialized per query key by React
Query so requests cannot overlap. No Supabase Realtime. Selection, pagination, and
drafts are component state, so a background refresh preserves them and shows no
full loading state.

### Responsive and accessibility

Desktop is a 320px list beside a flexible thread; tablet narrows to 260px; phone
collapses to one column, which is what makes list-first real rather than a
compressed split. Back to messages returns without clearing the selection.
Conversation rows are real buttons, so keyboard reach and focus come from the
platform. Touch targets are at least 44px. Unread carries weight plus a count
chip; Closed carries a text label; neither relies on color. The drawer is a
labeled modal with a focus trap, Escape close, and focus return to the trigger.

### Privacy

No logging of bodies, previews, drafts, raw responses, or tokens. No analytics or
telemetry. No browser persistence: drafts live in React state only. No email is
rendered. No `dangerouslySetInnerHTML` and no Markdown; bodies render as text with
`white-space: pre-wrap`, so line breaks survive and markup does not execute.

### Visual verification performed

An interactive local pass WAS performed, against a temporary harness with
synthetic nonclinical data, removed before committing. It exercised: empty inbox,
populated inbox, unread rows, Open and Closed, long subjects, long messages, Load
earlier, New message, validation, reply composer, the 409 state, mobile inbox,
mobile thread, Back to messages, focus, and overflow.

It found three real defects that static tests and lint had passed, all fixed and
now regression-tested:

1. Duplicate submit was not prevented. Three clicks in one tick produced three
   requests, because a `pending` React state check cannot block repeats inside a
   single tick. Both writes now use a synchronous ref mutex.
2. A 409 could never be recognized as access-lost, because the shared request core
   captured only `error` (`'conflict'`) and dropped the `reason` discriminator.
3. An unmeasured `window.innerWidth` of 0 collapsed the desktop into the mobile
   layout.

This is the argument for the harness: each defect was invisible to source
assertions, because the source looked correct in all three cases.

## Phase 5B-ii activation contract

Phase 5B-ii may:

- render `PortalMessagesWorkspace` from `StudentPortal.jsx`
- add Student Portal Messages navigation and a visible unread badge, driven by
  `usePortalUnreadCount` with `PORTAL_IDLE_UNREAD_POLL_MS` when Messages is not
  the active view
- perform final visual refinement and activated-route accessibility

It must not regress Phase 5A pagination to oldest-first, must not reintroduce a
direct browser RPC call, and must keep the activation commit last.

## Known limitations, Phase 5B-i

- `can_reply` remains hardcoded `true` in the list RPC, the thread v2 RPC, and
  their conversation projections, so it is not a usable access signal. The
  composer therefore stays available and the reply endpoint remains authoritative,
  with the 409 handled safely: the draft is preserved, sending disables, and the
  student sees safe copy. Phase 5B-ii or a later phase should decide whether
  `can_reply` must reflect real participant access.
- The unread summary in the workspace header is not the navigation badge; the
  badge itself is Phase 5B-ii.
- Component tests remain pure and static-source, matching the repository stack.
  They pin structure and contracts, not rendered output, which is why the
  interactive pass mattered.
