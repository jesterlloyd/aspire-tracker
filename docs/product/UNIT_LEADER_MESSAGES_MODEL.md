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
not the student's current unit. If the student moves from unit A to unit B, the
unit leader of A keeps an active scope on A, so `my_message_conversation_ids()`
still returns the thread and **history remains visible**. The unit leader of B gets
no retrospective access to it.

## Access after the unit leader's scope ends

Revocation, expiry, or deactivation denies **everything**, including history. This
is deliberate and follows the locked rule "no access after assignment revocation"
and "no access after account deactivation", which takes precedence over
convenience. The mechanism:

- `my_message_conversation_ids()` requires an ACTIVE `user_unit_scopes` row for
  the participant row's `scope_unit_key`, so the thread disappears from the list,
  the thread read, and the unread count on the very next call.
- `messages_post_reply` calls `message_recipient_has_active_access` for a
  `unit_leader` actor, so a **new message is refused** with `MS404`.
- The conversation and all its messages are retained; nothing is deleted. Access is
  what ends, not history. Restoring the scope restores visibility.

## Staff intervention after scope ends

Unaffected, because staff authority never depended on the participant. Staff still
list, read, reply, assign, and resolve.

One real defect this correction surfaced and fixed: the staff branch of
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
authoritative and is validated to be an active-access participant of that
conversation. Staff can therefore always intervene toward whichever party still has
access.

The same bug existed in the application layer: `loadActiveParticipant` used
`.maybeSingle()`, which errors on two rows and would have failed every staff reply
into a direct thread with `no_active_participant`. It is replaced by
`loadActiveParticipants`, and `api/messages-staff-reply.js` now chooses the
recipient deterministically: whoever sent the most recent non-staff message, else
join order.

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
