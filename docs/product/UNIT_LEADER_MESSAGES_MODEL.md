# Unit Leader Messages: the participant model

Answers the question the two-participant cap raises: if ASPIRE staff must view,
reply, and intervene, does staff intervention need a participant row?

**It does not.** Staff are structurally non-participants, in every path, today and
after this migration. The cap is therefore correct and is not redesigned.

## Who the two active participant rows are

| Thread shape | Active participant rows | Staff |
| --- | --- | --- |
| Student to ASPIRE Team (existing, unchanged) | 1: the student | not a participant |
| Unit Leader to ASPIRE Team (reserved shape, unchanged) | 1: the unit leader, `scope_kind='unit'` | not a participant |
| Unit Leader to student (new, direct) | 2: the student (`scope_kind='student'`, `scope_student_id` set) and the unit leader (`scope_kind='unit'`, `scope_unit_key` set, `scope_student_id` naming the student) | not a participant |

The cap is enforced by `trg_conversation_participant_limit`, a deferrable constraint
trigger that raises `MS409` above two active rows. The unique index is
`(conversation_id, participant_profile_id) WHERE removed_at IS NULL`, so one profile
cannot hold two rows on one conversation.

## How staff read and reply without becoming a participant

Verified against the deployed functions, not assumed:

| Staff capability | Gate | Participant row required |
| --- | --- | --- |
| List conversations | `messages_staff_list_conversations_v2`, `is_active_owner_or_admin()` | No |
| Read a thread | `messages_staff_get_thread_v2`, `is_active_owner_or_admin()` | No |
| Unread count | `messages_staff_unread_count`, `is_active_owner_or_admin()` | No |
| Reply | `messages_post_reply` with `p_actor_kind='staff'`, gated by `message_profile_is_active_owner_or_admin(p_actor_profile_id)` | No |
| Assign, status, category, follow up | `messages_set_*`, `is_active_owner_or_admin()` | No |

Staff authority is a global active Owner/Admin gate, never membership. This is why
staff can intervene in any thread, including one whose participants have changed.

## How staff authorship is stored

A staff reply inserts into `public.messages` with `author_role = 'staff'` and
`author_profile_id` = the staff `user_profiles.id`. No `conversation_participants`
row is created, so the active-participant count is unaffected by staff activity.

## Unread counts

| Reader | Function | Predicate |
| --- | --- | --- |
| Student | `messages_portal_unread_count` | `author_profile_id <> portal_profile_id()`, against `participant_conversation_reads` |
| Unit Leader | same function | same predicate |
| Staff | `messages_staff_unread_count` | `author_role <> 'staff'`, against `staff_conversation_reads` |

The portal predicate changed from `author_role = 'staff'` to "authored by anyone
other than me". For a student to ASPIRE Team thread the two are equivalent, so
existing behavior is byte-identical. For a direct thread it is the only correct
rule: under the old predicate a Unit Leader message would never have raised the
student's badge.

Staff already count `author_role <> 'staff'`, which now includes Unit Leader
messages. That is intended: staff monitor both directions.

`participant_conversation_reads` is keyed `(participant_profile_id,
conversation_id)`, so the student and the unit leader hold independent read
pointers on the same thread with no schema change.

## Existing threads remain unchanged

Nothing about a one-participant thread changes.

- The participant row shape is untouched; the `chk_participant_role_scope` student
  branch is preserved verbatim.
- The unique index is widened, never narrowed, so every existing row still passes.
- The two-participant trigger cannot fire on a one-participant thread.
- `my_message_conversation_ids()` keeps the student branch verbatim and adds the
  unit leader branch as an `OR`.
- A student reply still emits `portal_reply`, still routes to staff, still writes
  the same read pointer.
- `messages_staff_options.js` still offers student participants only, so no existing
  staff workflow changes.

## Access after a student changes unit

The unit leader's participant row records `scope_unit_key` **at thread creation**,
not the student's current unit. If the student moves from unit A to unit B, the unit
leader of A keeps their participant row, so the thread and its history remain
readable. The unit leader of B gets no retrospective access to it and starts a
separate thread.

## Access after the unit leader's scope ends

Read and send are separate authorizations. History survives; operational access does
not.

| Capability | While scope active | After scope ends or is revoked |
| --- | --- | --- |
| Unit Leader reads the direct thread | yes | **yes, read only** |
| Unit Leader sends in that thread | yes | no |
| Student reads the direct thread | yes | **yes, read only** |
| Student sends in that thread | yes | no |
| Either starts a new direct thread on that relationship | yes | no |
| ASPIRE staff read, reply, intervene | yes | **yes, unchanged** |
| Unit Leader roster, profile, resume, photo | yes | no, immediately |
| Unit Leader placement, capacity, milestone, preceptor actions | yes | no, immediately |

The mechanism is two predicates:

- `message_participant_can_read(conversation, profile)` rests on the identity-backed
  `conversation_participants` row created **while the scope was valid**, plus a live
  account and an active `unit_leader` role grant. It deliberately does **not**
  require an active `user_unit_scopes` row, which is what preserves history.
- `message_participant_can_send(conversation, profile)` requires read **and** current
  operational standing: an active unit scope for a Unit Leader, and for a student, a
  direct thread whose Unit Leader participant still holds active scope. Once the
  relationship ends the thread is frozen for **both** portal parties.

`messages_post_reply` gates portal actors on `can_send` and raises `MS404`, so a
frozen thread is indistinguishable from an invisible one. `messages_start_conversation`
requires active scope for a `unit_leader` actor, so an ended relationship can never be
restarted.

The participant row is never client-forged: only the server writes
`conversation_participants`, and no client-supplied unit value is ever trusted. The
student's unit membership is resolved server side from `students.matched_unit_id`.

### No live student data through a historical thread

Verified against the projections, not assumed. `messages_portal_get_thread_v2` reads
`conversations`, `messages`, and `user_profiles` (for a staff author name) only.
`messages_portal_list_conversations` reads `conversations`, `messages`, and
`participant_conversation_reads` only. Neither joins `students`, and neither projects
a `related_*` context column. A historical thread therefore shows the frozen
conversation and nothing that is re-fetched from live student records.

Roster, profile, resume, photo, placement, capacity, milestone, and preceptor access
all run through `resolveUnitScopedStudents`, which calls `getActiveUnitScopes` and
resolves an empty set the moment the scope ends. There is no path from a readable
historical thread back to live student data.

### A newly assigned Unit Leader gets a separate thread

Access is per participant row. A new Unit Leader holds no row on a predecessor's
conversation, so `can_read` is false for them on that thread, in perpetuity. When
they start a thread they create a **new** conversation with their own participant
row. Nothing is transferred, and the predecessor's history is not exposed to them.

### Account deactivation

`portal_profile_id()` maps `auth.uid()` to a profile and does **not** check
`is_active`, so the historical-read path checks it explicitly through
`message_profile_is_active`. An inactive Unit Leader is denied all portal access
including historical thread access, in SQL as well as at the API layer.

The student branch of `can_read` is deliberately left byte-identical to Phase 1, so
no existing portal to ASPIRE Team thread changes behavior. Inactive students are
already rejected upstream by `verifyPortalCaller`.

## Staff intervention after scope ends

Unaffected, because staff authority never depended on the participant row. Staff
still list, read, reply, assign, and resolve, including on a frozen thread.

One real defect this work surfaced and fixed: the staff branch of
`messages_post_reply` previously resolved the notification target with

```sql
SELECT cp.participant_profile_id INTO v_participant
FROM public.conversation_participants cp
WHERE cp.conversation_id = p_conversation_id AND cp.removed_at IS NULL
LIMIT 1;
```

With two participants and no `ORDER BY`, that is **nondeterministic**, and if it
happened to select the party whose access had ended it raised `MS409` and blocked a
legitimate intervention. It is replaced: the delivery's declared recipient is now
authoritative and is validated to be a participant who can still **read** the
conversation. Read is the correct bar, so staff can reply to a former Unit Leader and
have it reach them.

The same bug existed in the application layer: `loadActiveParticipant` used
`.maybeSingle()`, which errors on two rows and would have failed every staff reply
into a direct thread with `no_active_participant`. It is replaced by
`loadActiveParticipants`, and `api/messages-staff-reply.js` now chooses the recipient
deterministically: whoever sent the most recent non-staff message, else join order.

## New event types

| Event | Author | Recipient kind | Notes |
| --- | --- | --- | --- |
| `new_conversation` | portal | `shared_inbox` | unchanged |
| `portal_reply` | student | `shared_inbox` or `assigned_staff` | unchanged |
| `staff_reply` | staff | `portal_user` | unchanged |
| `unit_leader_message` | unit leader | `portal_user` | new, notifies the student |
| `student_to_unit_leader_message` | student | `portal_user` | new, notifies the unit leader |

`message_assert_valid_delivery` binds both new types to `portal_user`, because a
direct message notifies the other portal participant and never staff. Every
pre-existing binding is preserved unchanged.

## What is still to build

The migration and shared libraries support the model. Still to come in the
application pass: the Unit Leader messages endpoints, a
`verifyPortalUnitLeaderCaller` path through the messages API, direct-thread
creation, a participant picker for staff, and the thread authorship rendering
(`messages_portal_get_thread_v2` currently labels authorship as a `staff` versus
`You` binary, which must become three-way before a direct thread is shown to a
student). Until then no direct thread can be created, so the widened schema is
inert and every existing thread behaves exactly as before.
