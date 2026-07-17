# ASPIRE Messages, Phase 5: Student Portal Interface

Phase 5 builds the student-facing ASPIRE Messages interface on top of the portal
APIs already deployed in production. It is delivered in two halves.

- Phase 5A (COMPLETE): the Student Portal thread reverse-pagination
  prerequisite. Backend and API foundation only. Migration applied and verified,
  endpoint integrated, deployed.
- Phase 5B (not started): the Student Portal Messages interface itself.

No Student Portal Messages interface exists yet, and Phase 5A does not build one.

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
