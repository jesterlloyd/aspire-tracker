# Unit Leader Portal: manual acceptance

Everything below requires a real Unit Leader account and a real unit assignment.
Nothing here has been done automatically, and no account or scope was created.

Prerequisites: branch `unit-leader-portal` deployed, and all three migrations
already applied and verified (they are).

## Setup, in order

1. **Create the test account.** Invite one Unit Leader through
   `/api/invite-portal-user` with `portal_role: 'unit_leader'` and exactly one
   `unit_keys` entry. Use an address you control, never a student's.
   Note: `invite-portal-user.js:301` hardcodes `p_cohort_id: null`, so the grant is
   all-cohorts. That is existing behavior, not something this work changed.
2. **Choose the unit yourself.** Pick one with placed students, or the roster will
   be legitimately empty and prove nothing.
3. **Record the expectation before you look.** Run PREFLIGHT 8 from
   `db/audit/unit_leader_portal_preflight_and_verification.sql` filtered to that
   unit, so you know exactly who should appear.
4. **Re-run PREFLIGHT 9 immediately after granting.** It lists scoped `unit_key`
   values that match no `units.unit_name`. A hit there produces an empty roster with
   no error, which is the single most likely acceptance surprise.

## Checklist

### Access and scope
- [ ] Sign in. The portal opens on the Unit Leader Portal, not the Student Portal.
- [ ] The roster shows exactly the students PREFLIGHT 8 predicted.
- [ ] A completed student inside 90 days appears; one outside it does not.
- [ ] Grant a second unit. The unit switcher appears and `All assigned units` shows
      the union, never more.
- [ ] Revoke one unit. That unit's students disappear on the next load.
- [ ] Revoke all units. The portal shows the denied state, not an empty roster.
- [ ] Deactivate the account. All portal access is refused.

### Deep links and refresh
- [ ] Every section URL under `/portal/unit/<section>` survives a refresh.
- [ ] A pasted section link opens that section directly.
- [ ] An unknown section falls back to Home rather than a blank screen.
- [ ] Back and forward move between sections correctly.

### Workflows
- [ ] Respond to a placement request. It reads as recorded, and ASPIRE status stays
      `Awaiting ASPIRE`.
- [ ] Decide that request as ASPIRE through `/api/unit-leader-decisions`. The Unit
      Leader view updates and a row appears in `unit_placement_request_events`.
- [ ] Submit capacity for a unit with NO prior submission. This is the case that was
      broken until this pass.
- [ ] Correct that submission. The old row shows as superseded, not overwritten.
- [ ] Review it as ASPIRE. The outcome appears in the Unit Leader feed.
- [ ] Nominate a preceptor, then confirm it as ASPIRE. Confirm that
      `student_preceptor_assignments` was NOT written as a side effect.
- [ ] Confirm each of the four milestones. Confirming `rotation_conclusion` stamps
      `students.rotation_completed_at` exactly once.

### Messages
- [ ] Message a student from the Students screen. The thread opens.
- [ ] The STUDENT sees that message attributed to the Unit Leader by name, NOT to
      themselves. This is the three-way authorship fix and is the highest-value
      single check on this list.
- [ ] The student replies. The Unit Leader sees it and the unread badge rises.
- [ ] ASPIRE staff can read and reply to that thread.
- [ ] Report a Concern about a student. Confirm the student CANNOT see that
      conversation anywhere in their portal.
- [ ] Revoke the unit scope. The Unit Leader can still READ the direct thread but
      cannot send, and cannot start a new one.

### Files
- [ ] Photo and resume open for a scoped student, and the URL is short-lived.
- [ ] No public storage URL appears anywhere in the network tab.
- [ ] A student outside scope yields no file, and no error that confirms existence.

### Notifications
- [ ] An ASPIRE decision produces an in-app feed item.
- [ ] An approved alert sends one email, and a repeat does not send a second.
- [ ] Turn an alert off in Profile. No further email for it; the in-app item stays.
- [ ] An in-app-only alert type never emails.

### Quality
- [ ] Every section on a phone: no horizontal page scroll, tables stack with labels.
- [ ] Row actions open as a stacked menu, not cramped buttons.
- [ ] Full keyboard pass: focus is always visible and lands on the section heading
      after navigating.
- [ ] Loading, empty, error, and denied states each appear at least once.

### Regression
- [ ] Student Portal, Interviewer, Viewer, Owner/Admin unchanged.
- [ ] Existing student to ASPIRE Team threads unchanged, including authorship.
- [ ] Certificates, evaluations, and private files unchanged.

## Cleanup
- [ ] Revoke via `/api/revoke-portal-access` with the profile id and
      `role: 'unit_leader'`. Revocation is soft, so history is preserved and the
      account can be re-granted.
- [ ] Confirm the portal returns to the denied state afterward.
