# ASPIRE Messages, Phase 4: ASPIRE Connect Staff Interface

Phase 4 builds the staff-facing ASPIRE Messages interface inside ASPIRE Connect,
on top of the Phase 3 APIs already deployed in production. Phase 4 is COMPLETE:
the staff workspace is activated in ASPIRE Connect and available to an active
Owner or Admin.

- Phase 4A (done): the secure lookups, shared client and utilities, and the staff
  inbox component. Built, tested, and deployed as DORMANT code.
- Phase 4B Stage A (applied and verified): the v2 staff-list RPC with explicit
  filter modes, which unblocks Unassigned and Uncategorized.
- Phase 4B Stage B1 (done): the staff-list API migrated onto the v2 RPC. Still
  dormant.
- Phase 4B2a Stage A (applied and verified): the v2 staff thread RPC, which opens
  a thread at the newest messages and pages backward.
- Phase 4B2a Stage B (done): the workspace shell, thread, read state, and
  polling. Still dormant.
- Phase 4B2b-i (done): the new-message dialog, reply composer, and management
  controls. Still dormant.
- Phase 4B2b-ii (done): responsive and accessibility refinement, and the final
  Connect activation. Messages is now exposed.

## The dormancy strategy, and why it ended here

An incomplete Messages feature must not reach production users. Every stage from
Phase 4A through Phase 4B2b-i therefore shipped as DORMANT code: fully built,
tested, and deployed, but not imported by any routed page. `src/pages/Connect.jsx`
stayed byte-for-byte unchanged across all of them, so a half-built workspace could
never appear even mid-sequence. No feature flag was introduced; dormancy was
structural rather than conditional, which is why it could not be flipped on by
accident or by configuration drift.

Phase 4B2b-ii ends that deliberately and all at once. The activation commit is the
LAST commit of the phase and touches only `src/pages/Connect.jsx`, landing after
every test, lint, build, and scan already passed. The tests that formerly asserted
dormancy were retargeted in the same commit to assert the authorization gate that
replaced it, so the guarantee still cannot regress silently: it simply guards a
different invariant now.

## Files

- `api/messages-staff-options.js`: the two narrow lookups.
- `src/lib/messages/messagesConstants.js`: categories, statuses, labels, unread
  formatting, Intl timestamps, safe error mapping.
- `src/lib/messages/inboxState.js`: filter serialization, cursor handling,
  duplicate-safe page appending, query identity, debounce.
- `src/lib/messages/messagesApiClient.js`: the authenticated browser client.
- `src/components/connect/messages/MessagesInbox.jsx`: the staff inbox.
- `test/messagesPhase4aInbox.test.mjs`: 49 pure and static guards.

## Assignment-options endpoint

`GET /api/messages-staff-options?kind=assignees`. Active Owner or Admin only,
reusing the Phase 3 `verifyStaffCaller`, which never uses `is_staff()` (so
interviewer and viewer are excluded) and denies an inactive Owner or Admin.

It selects only `id, full_name, role, is_active`, filters to `role in (owner,
admin)` and `is_active !== false`, and returns exactly four fields:
`profile_id`, `display_name`, `role`, `is_current_user`. It returns no email, no
`auth_user_id`, no permission internals, no role-grant history, and no student
records. Results are bounded at 50, which comfortably covers the Owner/Admin
list. Identity is `user_profiles.id`, preserving the three-identity model.

## Participant lookup decision

`api/list-portal-access.js` was inspected and **rejected** for this purpose. It
is a portal-access admin view: it returns all role grants including historical,
revoked, and expired ones, across all portal roles (unit_leader and
academic_partner included), together with emails, `last_login_at`, and unit and
school scope history. That is a general directory, not the narrow lookup this
phase requires, and reusing it would over-expose data.

`GET /api/messages-staff-options?kind=participants&q=` is the smallest dedicated
alternative. Same active Owner/Admin gate. It returns active Student Portal
participants only, applying the canonical active predicate (`revoked_at IS NULL`,
`starts_at <= now`, `expires_at IS NULL OR expires_at > now`), requiring an active
`user_student_links` row and an active profile. It never queries any other portal
role. Search is bounded (80 characters, minimum 2 to filter) and results are
capped at 20. Fields: `participant_profile_id`, `student_id`, `display_name`, a
single disambiguating `context` (student school), and `access_active`. The
student read is `id, school` only. Phase 4B consumes it; Phase 4A does not mount
a picker.

## API client

`messagesApiClient.js` follows the existing Connect convention: the Supabase
access token from the session, sent as a bearer token. It calls only the deployed
Phase 3 endpoint paths, never a Supabase RPC directly, and never touches
service-role credentials. Query values that are undefined, null, or empty are
dropped so "no filter" never becomes the string `null`. `AbortSignal` is
supported throughout.

A hard guard, `assertNoRoutingFields`, throws if a caller ever tries to send
`p_delivery`, `recipient_email`, `recipient_kind`, `recipient_profile_id`,
`event_type`, `idempotency_key`, a snapshot field, or `cta_path`. The trusted
server owns all notification routing and delivery construction. Errors carry only
an HTTP status and a short safe code; the client logs nothing.

## Inbox architecture

`MessagesInbox` takes `selectedId`, `onSelect`, `refreshKey`, and an injectable
`api`. It needs no profile id: the server resolves the Me filter from the
verified caller. Data flows through React Query, the app's existing
convention: `useInfiniteQuery` for the cursor-paginated list and `useQuery` for
the small cached assignee list. React Query owns request cancellation, stale
responses, and loading flags, so the component holds no manual request state.

Row priority is participant identity, then subject, then latest activity, then
unread, then operational status. Each row also carries category, assignee,
follow-up, and a portal-access badge when access is inactive. Previews render as
plain text; there is no `dangerouslySetInnerHTML`, no Markdown, and no HTML
parsing. Staff email is never displayed.

## Search

A debounced search input at 300 milliseconds, inside the approved 250 to 400
range, so there is no request per keystroke. It searches SUBJECT ONLY, because
that is exactly what the applied server RPC supports; message bodies and
participant names are never searched. The label and placeholder ("Search
subjects") say so rather than implying otherwise. Clearing restores the current
filter set. A search change alters the query identity, which restarts pagination.

## Filters and a known limitation

Status (All, Open, Waiting, Resolved), Assignee (All, Unassigned, Me, each active
Owner/Admin), Category (All, Uncategorized, each approved category), and Follow up
(All, Flagged, Not flagged). All are labeled native selects, so keyboard use and
accessible naming are inherent. One Reset filters action clears filters and
search. Filters are reflected in the server request and preserved while paging.

**Unassigned and Uncategorized are now supported** (Phase 4B Stage A and Stage B1
below). They are real server-side filters through the v2 RPC modes; nothing is
client-filtered from a partial page.

## Pagination

The Phase 3 cursor model (`last_message_at` with a conversation id tie-breaker),
via Load more. The server limit is 25 with a hard cap of 100. Pages are flattened
through `appendPage`, which drops any row an overlapping page repeats and never
re-sorts, so server ordering stays authoritative. A malformed or partial cursor
normalizes to null rather than producing a bad request. Load more is disabled
while fetching.

## Unread presentation

Unread count is shown compactly (1 through 99, then 99+). Unread is never
conveyed by color alone: a row uses heavier participant and subject weight, a
dot, a count badge, and screen-reader text such as "3 unread messages". Phase 4A
does not write read pointers and never optimistically clears unread.

## Loading and error behavior

A restrained skeleton with an `aria-busy` region and a `role="status"` label for
the initial load, a separate Load more state, and three distinct empty states:
"No ASPIRE Messages yet.", "No conversations match these filters.", and "No
conversations match your search." Read errors map to safe copy with a keyboard
accessible Retry. Raw API errors, SQLSTATE, and provider text are never shown.

## Privacy controls

No message body, preview, draft, authorization header, or raw response is logged.
Nothing is written to localStorage or sessionStorage. No analytics or telemetry
was added. Previews are plain text only. Staff emails are never rendered.

## Accessibility

Labeled search and filters, native selects for keyboard operation, `aria-current`
on the selected row, accessible unread text, `aria-hidden` on decorative icons, a
`role="status"` loading announcement, 44 pixel minimum row touch targets, and
`title` attributes on truncated participant, subject, preview, and timestamp
content.

## Responsive foundation

The inbox is a fluid column with wrapping filters, truncating rows, and no
horizontal scrolling, so it is usable from phone to desktop width. The mobile
list-to-thread transition is Phase 4B, since it requires the thread workspace.

## Phase 4B integration contract

Phase 4B should: add `messages` to `VALID_TABS` and the tab bar between Outreach
and Automations (leaving the Automations `/connect/broadcasts` slug untouched),
route it at `/connect/messages`, and render `MessagesInbox` in the left column
with `selectedId`, `onSelect`, and the existing `refreshKey`. It
should gate the tab on an active Owner or Admin (`['owner','admin'].includes(role)`
plus `is_active !== false`), remembering that client hiding is not a security
boundary. The thread, composer, and management controls should reuse the typed
client functions already defined here (`getStaffThread`, `markStaffRead`,
`startStaffConversation`, `replyStaffConversation`, `manageStaffConversation`,
`listParticipantOptions`), which already carry the routing-field guard and error
mapping.

## Phase 4B Stage A: staff inbox null-filter support

Stage A resolves the Unassigned and Uncategorized blocker recorded above. It is a
database change only. The Messages interface remains dormant: Connect.jsx,
`VALID_TABS`, `App.jsx`, and the `/connect` redirect are untouched, no routed page
imports the inbox, and `/connect/messages` still falls through to the existing
default.

### Why the existing RPC could not express a null filter

The applied Phase 3 `messages_staff_list_conversations()` filters with
`(p_assignee IS NULL OR c.assigned_staff_profile_id = p_assignee)` and
`(p_category IS NULL OR c.category = p_category)`. A null therefore means "no
filter", so the function cannot distinguish "no assignee filter" from
`assigned_staff_profile_id IS NULL`, nor "no category filter" from
`category IS NULL`. The filter is inexpressible through that signature.

### Why client-side filtering was rejected

Filtering a partial cursor page in the browser would drop rows from an
already-limited server page, producing incorrect pagination and incorrect counts.
Phase 4A therefore omitted both options rather than ship a control that silently
returns wrong results.

### The new v2 RPC

`supabase/migrations/20260716000004_messages_phase4_staff_inbox_filter_modes.sql`
adds `messages_staff_list_conversations_v2` with explicit filter modes, so a null
is never ambiguous. The name is deliberately distinct: an overloaded
`messages_staff_list_conversations(...)` would make PostgREST function resolution
ambiguous. The query body, ordering, return shape, authorization, unread
calculation, preview truncation, and subject-only search are reused verbatim from
the applied Phase 3 definition; only the assignee and category predicates change,
plus added validation.

- **Assignee modes:** `any` (ignores the profile id), `unassigned`
  (`assigned_staff_profile_id IS NULL`), `specific` (exact `user_profiles.id`,
  and a null profile id is rejected). The UI option Me is simply `specific` plus
  the server-verified current staff profile id, so there is no separate database
  mode for Me.
- **Category modes:** `any`, `uncategorized` (`category IS NULL`), `specific`
  (one approved category; null or blank is rejected).
- **Status:** null means all; otherwise open, waiting, or resolved. Anything else
  is rejected.
- **Follow-up:** `p_flagged` stays nullable, so null means all.
- **Cursor:** unchanged and stable, `last_message_at` descending with the
  conversation id as tie-breaker. Every filter is applied before the limit, so
  Unassigned and Uncategorized page correctly across the full result set. A
  partial cursor is now rejected explicitly rather than silently returning an
  empty page.
- **Limits:** default 25, hard cap 100, no offset pagination.

Authorization is unchanged: active Owner or Admin via
`is_active_owner_or_admin()`. `is_staff()` is never used. Assignment and related
student, unit, school, or cohort context remain projections and filters only,
never authorization gates. Search stays subject only; message bodies are never
searched, and the only body read is the approved 160-character preview.

### Backward compatibility

The original `messages_staff_list_conversations` is not modified, replaced, or
dropped, and remains fully functional for any existing caller. The migration
creates no table, no policy, and no data, changes no row, and touches no
`message_archive` object. Nothing calls v2 yet; wiring it into the client is
Stage B.

### Manual SQL gate

The migration is committed and pushed before it is applied. The Owner runs it
whole, as one block, in the Supabase SQL editor, then runs the read-only
`db/audit/messages_phase4_staff_inbox_filter_modes_verification.sql`. The
committed migration is not modified after it is applied.

## Phase 4B Stage B1: v2 staff-list API integration

Stage A is applied and verified in production. Stage B1 wires the API onto it.

`api/messages-staff-list.js` now calls `messages_staff_list_conversations_v2` and
translates safe HTTP filter values into the explicit RPC modes. The browser never
calls the RPC directly; it reaches it only through this authenticated endpoint.

| HTTP value | RPC mode |
|---|---|
| assignee absent or `all` | `p_assignee_mode = any` |
| `assignee=unassigned` | `p_assignee_mode = unassigned` (`assigned_staff_profile_id IS NULL`) |
| `assignee=me` | `p_assignee_mode = specific` plus the SERVER-VERIFIED caller profile id |
| `assignee=<uuid>` | `p_assignee_mode = specific` with the validated id |
| category absent or `all` | `p_category_mode = any` |
| `category=uncategorized` | `p_category_mode = uncategorized` (`category IS NULL`) |
| `category=<approved>` | `p_category_mode = specific` |

Me is resolved only from `caller.profile.id`; a client-supplied profile id is
never trusted for Me. A specific assignee id must be a uuid and can come only
from the secure active Owner/Admin options endpoint. An RPC validation rejection
(`MS400`) maps to 422 and the staff gate (`MS403`) to 403; internal SQL text is
never returned. The cursor is forwarded unchanged and the response contract
(`conversations` plus `next_cursor`) is unchanged, so existing callers stay
compatible.

The dormant inbox now offers Unassigned, Me, and Uncategorized, and
`serializeInboxQuery` passes them through as sentinels with no `clientOnly`
fallback. Search is labeled truthfully as subject search ("Search subjects"),
because the applied RPC searches subject only and never message bodies.

## Phase 4B2a Stage A: staff thread reverse pagination

The staff workspace remains dormant. This stage is a database change only,
resolving a blocker found while inspecting the deployed thread contract.

### The oldest-first thread blocker

The applied `messages_staff_get_thread` pages FORWARD from the oldest message:

```
AND (p_cursor_ts IS NULL OR (m.created_at, m.id) > (p_cursor_ts, p_cursor_id))
ORDER BY m.created_at, m.id
LIMIT v_limit
```

A greater-than cursor with an ascending order means the first page is the OLDEST
messages and paging moves toward newer ones. Three consequences:

- "Load earlier messages" is impossible: nothing is earlier than page one.
- Staff opening a thread over 50 messages land on the oldest content, not the
  newest activity they opened it to read.
- `messages_mark_read` derives `max(created_at)` across the whole conversation,
  so marking read after only the oldest page rendered would mark newer messages
  read that were never displayed.

### Why an API-layer workaround was rejected

Reaching the newest page requires a reverse-ordered query. The only alternatives
are paging through the entire thread or fetching all of it, both unbounded and
unsafe. Viewport preservation while loading earlier history presumes newest-first
plus backward paging, which the deployed contract cannot express.

### The new staff v2 thread RPC

`supabase/migrations/20260716000005_messages_phase4_staff_thread_reverse_pagination.sql`
adds `messages_staff_get_thread_v2`. The name is deliberately distinct: an
overload would make PostgREST resolution ambiguous, so the original is untouched
and fully backward compatible.

- **Newest page first.** With no cursor it selects the newest `p_limit` rows.
- **Backward cursor.** With a cursor it selects the newest `p_limit` rows
  strictly older than it, using `(m.created_at, m.id) < (p_cursor_ts,
  p_cursor_id)`.
- **Bounded before aggregation.** The inner page CTE orders `created_at DESC,
  id DESC` and applies `LIMIT` first, so the thread is never fetched or
  aggregated unbounded. The bounded page is then reordered ascending for
  chronological display.
- **Cursor points backward.** `next_cursor` is the oldest message of the returned
  page, taken from the page itself (no OFFSET, no extra scan). An additive
  `has_more` boolean comes from a bounded EXISTS check.
- Default limit 50, cap 100, partial cursors rejected, no offset pagination,
  stable `(created_at, id)` ordering on ties.

The conversation, message, and event contract is reused verbatim. Authorization
is unchanged: active Owner or Admin via `is_active_owner_or_admin()`, never
`is_staff()`. Assignment and related context are projections only. An
inaccessible conversation still returns NULL (non-enumerating). No email is
projected.

### Relationship to mark-read safety

`messages_mark_read` is NOT modified. The Phase 4B2a interface will open the
NEWEST page and mark read only after that page successfully loads and renders;
loading older pages must not trigger a further mark-read. Because the newest
activity is present in the initial rendered page, mark-read may continue deriving
the authoritative latest timestamp server-side.

### Portal thread reserved for Phase 5

`messages_portal_get_thread` has the same oldest-first forward-cursor pattern and
is equally unsuitable for a portal thread view. It is intentionally NOT changed
here. A separate portal v2 thread RPC must be created before the Student Portal
Messages interface is built; the forward-pagination contract must not be silently
reused in Phase 5.

### Manual SQL gate

The migration is committed and pushed before it is applied. The Owner runs it
whole, as one block, in the Supabase SQL editor, then runs the read-only
`db/audit/messages_phase4_staff_thread_reverse_pagination_verification.sql`. The
committed migration is not modified after it is applied. The workspace stays
dormant until Phase 4B2a Stage B builds it on this RPC.

## Phase 4B2a Stage B: dormant workspace, thread, read state, and polling

Stage A is applied and verified. Stage B builds the staff workspace on it and
keeps it DORMANT: `Connect.jsx`, `App.jsx`, `VALID_TABS`, and the `/connect`
redirect are untouched, no routed page imports the workspace, and
`/connect/messages` still falls through to the existing default. No feature flag,
no debug route. Phase 4B2b adds New message, the reply composer, and management
controls, and only then exposes the Connect tab.

### Files

- `api/messages-staff-thread.js` (updated to v2)
- `src/lib/messages/messagesPolling.js` (reusable polling utilities)
- `src/components/connect/messages/MessagesWorkspace.jsx` (dormant workspace)
- `test/messagesPhase4b2aWorkspace.test.mjs`

### Staff thread v2 integration

The endpoint now calls `messages_staff_get_thread_v2`. The HTTP path, method,
authentication, and error mapping are unchanged; the response gains `has_more`,
and `next_cursor` is now the RPC's authoritative BACKWARD cursor (the oldest
message of the page) rather than a forward cursor derived from the returned rows.
`nextCursorFrom` is no longer used here. The browser never calls the RPC directly.
`MS400` maps to 422 (a partial cursor) and `MS403` to 403; no SQL text or function
name is ever returned.

### Thread behavior

The newest bounded page opens first, so staff land on the latest activity. "Load
earlier messages" sends `next_cursor.cursor_ts` and `cursor_id` to fetch older
history. Page 0 is the newest and each later page is older, so the flattened
array reverses the page order before merging through `appendPage`, which drops any
id an overlapping page repeats and never re-sorts. Existing messages stay visible
while an older page loads; only the initial load renders a loading state. No
offset pagination.

Messages render as plain text with `white-space: pre-wrap` and
`overflow-wrap: anywhere`, so line breaks are preserved and long text wraps. There
is no `dangerouslySetInnerHTML`, no Markdown, and no HTML interpretation. No email
is displayed. Date separators appear when the day changes.

### Read state

Mark-read runs only after the newest page has successfully loaded and rendered. It
is keyed on `${conversationId}:${newestMessageCreatedAt}`, so loading an older
page never re-triggers it, and it never fires from the inbox list or before thread
content exists. The request sends only `conversation_id`: no client timestamp and
no profile id, because the server derives both. Local unread clears only after
mark-read SUCCEEDS, invalidating `messages_staff_unread` and `messages_staff_list`.
A failure is non-fatal: the thread stays usable, the token resets so a later render
can retry, and unread reconciles on the next refresh.

### Unread

`useStaffUnreadCount` counts only portal-authored messages unread by the current
staff profile, so one staff member reading never clears another's count. Display is
compact (1 to 99, then 99+) with screen-reader text, never color alone.

### Polling

React Query drives every interval, so requests cancel on unmount and never overlap
for a key. There is no `setInterval` and no Supabase Realtime. Active workspace:
inbox, selected thread, and unread all refresh at 30 seconds. Polling pauses
entirely while `document.hidden` is true (`refetchInterval: false`) and refreshes
on focus. Background refresh never shows a full skeleton, and never resets the
selected conversation, search, filters, or loaded pages. `IDLE_UNREAD_POLL_MS`
(60 seconds) is exported and ready for the future Connect tab badge, but is not
mounted in Connect.

### Stale-request protection

The thread query key is scoped by conversation id and the `AbortSignal` is passed
through, so a response for a previously selected conversation can never populate a
newer selection or mark the wrong conversation read. No shared mutable thread state
exists.

### Mobile state

List-first. Selecting a conversation opens the thread; "Back to messages" returns
to the list. The inbox stays mounted, so search, filters, and pagination survive
the round trip. At phone width the layout is a single column, never a compressed
two-column split. The Back control is a real button with a 44px touch target.

### Accessibility

Keyboard-selectable rows with `aria-current` (from the Phase 4A inbox), a
`role="status"` loading announcement, keyboard-accessible Retry, unread and
participant-access conveyed by text as well as styling, `<time dateTime>` with a
full accessible timestamp, and `aria-hidden` on decorative icons.

### Privacy

No message body, preview, thread response, authorization header, or token is
logged. Nothing is written to localStorage, sessionStorage, or IndexedDB. No
analytics or telemetry. No direct browser RPC and no service-role credentials.
Message content exists only in authorized browser memory for rendering.

### Phase 4B2b integration contract

Phase 4B2b should: add `messages` to `VALID_TABS` and the tab bar between Outreach
and Automations (leaving the Automations `/connect/broadcasts` slug alone), route
it at `/connect/messages`, and render `MessagesWorkspace` with the existing
`refreshKey`. Gate the tab on an active Owner or Admin
(`['owner','admin'].includes(role)` plus `is_active !== false`), remembering that
client hiding is not a security boundary. Mount `useStaffUnreadCount({ intervalMs:
IDLE_UNREAD_POLL_MS })` for the tab badge while another sub-tab is active. Add the
New message dialog, reply composer, and management controls using the typed client
functions already defined (`startStaffConversation`, `replyStaffConversation`,
`manageStaffConversation`, `listParticipantOptions`), which already carry the
routing-field guard and error mapping. The workspace exposes participant access
state, so the composer can be disabled when access is inactive.

## Phase 4B2b-i: dormant staff writes and management controls

The workspace remains dormant. Connect.jsx, App.jsx, VALID_TABS, and the
/connect redirect are untouched, so nothing is exposed. Phase 4B2b-ii performs
the final responsive and accessibility pass and only then activates the Connect
Messages tab.

### Actual API contracts used

Inspected from the deployed endpoints, not invented:

- `POST /api/messages-staff-start` with `{participant_profile_id, student_id,
  subject, category, body}` returns `201 {conversation_id, message_id,
  created_at, status}`; `409 {error:'conflict', reason}`.
- `POST /api/messages-staff-reply` with `{conversation_id, body}` returns
  `201 {message_id, created_at, reopened}`; `409 {error:'conflict',
  reason:'no_active_participant'}`.
- `POST /api/messages-staff-manage` with `{action, conversation_id, ...}` where
  action is `assign` (`assignee_profile_id` uuid or null), `status`
  (`open|waiting|resolved`), `category` (approved or null), or `flag`
  (`flagged` boolean). Returns `200 {action, ...data}`.
- `GET /api/messages-staff-options?kind=participants&q=` returns
  `{options:[{participant_profile_id, student_id, display_name, context,
  access_active}]}`, minimum search 2, capped at 20.
- `GET /api/messages-staff-options?kind=assignees` returns
  `{options:[{profile_id, display_name, role, is_current_user}]}`.

### New message

`NewMessageDialog.jsx`, rendered inside the dormant workspace. Participant search
uses React Query with a 300ms debounce and the 2-character minimum, so nothing is
requested below it. Only `access_active` participants are selectable (a second
guard on top of the active-only endpoint). No email is displayed and no general
directory is used. Loading, no-results, and retryable error states are present.

Subject is trimmed and bounded 3 to 120 with a live count; category offers
Uncategorized (null) plus the seven approved values; body is plain text, trimmed
non-blank, capped at 5000 with a count that turns red near the limit.

The browser sends exactly `participant_profile_id`, `student_id`, `subject`,
`category`, and `body`. It never sends `p_delivery`, `recipient_email`,
`recipient_kind`, a notification `recipient_profile_id`, `event_type`,
`idempotency_key`, snapshot fields, a CTA path, or notification metadata, and the
client's `assertNoRoutingFields` guard still enforces this.

### Duplicate-submit protection

Backend notification idempotency does not cover a repeated HTTP request, so the
client guard is required. While pending, the submit handler returns early, the
submit button is disabled, and every field is disabled, so one activation
produces exactly one request whether triggered by click, Enter, or repeated
keyboard activation. The same pattern protects the reply composer and each
management action.

### Start success and failure

Success clears the form, closes the dialog, invalidates the inbox and unread
count, selects the returned `conversation_id` (whose authoritative thread then
loads), returns focus to the New message trigger, and announces exactly
`Message sent.` It never claims an email was delivered.

Failure preserves the participant selection, subject, category, and body, and
shows safe mapped copy. `reset()` runs only on the success path. A 409 clears the
participant, refreshes the options, and blocks submission until another active
participant is chosen.

### Reply composer

Below the thread, with a character count, Send, and the exact approved safety
notice verbatim. Sending is disabled when participant access is inactive, a
request is pending, the body is blank after trimming, the body exceeds 5000, or
no conversation is selected.

The draft lives in component memory only. It is never written to localStorage,
sessionStorage, IndexedDB, or analytics, and background polling never clears it.
Nothing is inserted optimistically, so a duplicate message cannot appear.

Success clears the draft, invalidates the thread, inbox, and unread count, and
announces `Message sent.`; the `reopened` flag arrives through the authoritative
thread refresh. Failure preserves the draft and shows safe retryable copy. A 409
preserves the draft and refreshes the thread so the header and composer reflect
the authoritative access state.

### Inactive participant

The exact approved notice is shown, history stays readable, and mark-read,
assignment, status, category, and follow-up all remain available. Only replying
and starting a new conversation with that participant are blocked. Email presence
is never treated as active access.

### Management controls

`ThreadActions.jsx` renders status, assignee, category, and follow-up in the
thread header. Assignee options come from the narrow active Owner/Admin lookup
(never a directory), include assign-to-self via `is_current_user`, and allow
clearing. Status maps to open/waiting/resolved; category uses null for
Uncategorized; follow-up is an `aria-pressed` toggle labeled `Follow up`.

None of these sends an email: assignment, status including resolution, category,
and follow-up are silent by backend design. Each action has its own pending state
so a slow assignment never blocks status, and no optimistic local value is
written, so a failure simply leaves the server state standing.

### Query invalidation

Success invalidates only `['messages_staff_thread', id]`, `['messages_staff_list']`,
and where relevant `['messages_staff_unread']`. Search, filters, pagination, the
selected conversation, and the mobile list or thread view are never reset.

### aria-live feedback

The workspace owns a single `role="status" aria-live="polite"` region. Sends
announce `Message sent.`; management actions announce a concise result such as
`Assignment updated.` or `Marked for follow up.` Message content is never
announced. Validation errors stay associated with their fields through
`aria-describedby` and `aria-invalid`.

### Accessibility foundation

Labeled participant search, subject, category, message, and reply fields; a
`role="dialog"` with `aria-modal` and `aria-labelledby`; Escape closes (unless a
request is pending); focus moves into the dialog on open and returns to the
trigger on close; icon-only buttons carry accessible names; the inactive-access
notice is text rather than color. The final tab semantics and full activation
pass belong to Phase 4B2b-ii.

### Phase 4B2b-ii activation contract

Remaining before exposure: the final responsive pass, the full accessibility
pass, Connect tab integration in the order Contacts, Outreach, Messages,
Automations (with Automations keeping `/connect/broadcasts`), the visible unread
badge with 60-second idle polling, and the active Owner/Admin visibility gate.
That gate must be `['owner','admin'].includes(role) && userProfile?.is_active !==
false`: `useAuth()` exposes `isAdmin` and `canEdit` as role-only, so using either
alone would show Messages to an inactive Owner or Admin.

## Phase 4B2b-ii: final refinement and Connect activation

The last stage of Phase 4. It exposes the workspace built across 4A through
4B2b-i, and changes exactly two files plus tests and this document.

### Files

- `src/lib/messages/messagesPolling.js` (refined): `useStaffUnreadCount` gained an
  `enabled` option.
- `src/pages/Connect.jsx` (activated): the Messages tab, route, gate, and badge.

### The authorization gate

```js
const canUseMessages = ['owner', 'admin'].includes(userProfile?.role)
  && userProfile?.is_active !== false
```

Both halves are required. `useAuth()` exposes `isAdmin` and `canEdit`, but both
are role-only, so either one alone would show Messages to a deactivated Owner or
Admin. `userProfile` comes from the `get_my_profile` RPC and does carry
`is_active`, which `src/App.jsx` already relies on to render the Account
Deactivated screen for the whole authenticated shell. That screen is a second,
independent block: an inactive Owner or Admin never reaches Connect at all. The
gate is written to stand on its own regardless, rather than depend on a guard
that lives in another file.

`is_staff()` is not used anywhere.

### Client-side hiding is not the security boundary

The gate hides the tab and prevents the workspace from mounting, which is a
usability and privacy measure, not an authorization one. Every read and write
still goes through the authenticated API endpoints, which independently verify an
active Owner or Admin against the caller's verified profile and return 403
otherwise. Removing the gate in a browser devtools session would reveal an empty
shell whose every request fails.

### Route resolution and the redirect

```js
const rawSubTab = /* derived from location.pathname */
const activeSubTab = (rawSubTab === 'messages' && !canUseMessages) ? 'contacts' : rawSubTab
```

`rawSubTab` is the path; `activeSubTab` is the resolved tab. Keeping them
separate is what makes the unauthorized redirect safe: the effect fires on
`rawSubTab`, so after it replaces the URL with `/connect/contacts` the path is no
longer `/connect/messages` and the effect cannot re-fire. A guard written against
`activeSubTab` would have been unable to distinguish "redirected away" from
"never asked", which is the classic redirect loop.

An unauthorized user who types `/connect/messages` therefore lands on Contacts,
mounts no workspace, and issues no Messages request of any kind. The unread query
is additionally disabled through `enabled: canUseMessages`, so not even the count
is fetched.

The last-tab store in `localStorage` is gated the same way in both directions: a
stored `messages` value is only honored for an authorized user, and is only
written by one.

### Tab order and preservation

Contacts, Outreach, Messages, Automations. Messages sits next to Outreach because
both are person-to-person; Automations stays last as the configuration surface,
and keeps its existing `/connect/broadcasts` slug, which was deliberately left
alone. Every existing tab keeps its route, its mounted-but-hidden `display`
behavior, and its props.

### The unread badge

The Messages tab carries a count chip that appears only above zero, uses the
shared `formatUnread` (capping at `99+`) and `unreadLabel` helpers, and pairs the
visible number with screen-reader text. The count is never conveyed by color
alone.

Cadence follows attention: `ACTIVE_POLL_MS` (30 seconds) while the Messages tab
is open, `IDLE_UNREAD_POLL_MS` (60 seconds) elsewhere in Connect, and paused
entirely while the document is hidden. The count comes from the staff unread
endpoint, which is scoped to the calling staff profile, so one staff member
reading a thread never clears another's badge. No global sidebar badge was added.

### The `enabled` option

`useStaffUnreadCount` previously polled unconditionally. Mounting it in Connect
would have made every Owner and Admin poll, but also required that an
unauthorized caller never poll at all. Rather than mount the hook conditionally
(which React's rules of hooks forbid), the hook took an `enabled` option that
gates the query, the interval, and the focus refetch together.

## Known limitations

- `messages_portal_get_thread` still pages oldest-first. Fixing it is a Phase 5
  prerequisite before any Student Portal Messages interface is built.
- No Student Portal Messages interface exists. Participants receive notification
  emails but have no in-app conversation view until Phase 5.
- Component tests are pure and static-source, matching the repository stack; no
  testing-library or jsdom was introduced. They pin structure and contracts, not
  rendered output.
- No interactive local visual pass was performed for this stage. See the
  verification notes in the Phase 4B2b-ii handoff.
- Subject search is subject-only; message bodies are deliberately not searchable.
