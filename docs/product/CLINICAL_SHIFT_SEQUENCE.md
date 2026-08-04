# Clinical Shift Sequence (Shift #)

Status: **Released to production 2026-08-03 (SHIFT-SEQUENCE-1). Complete and
live.** Export decision recorded below; no export currently emits Shift #.

## Optional post-release visual QC

Two staff surfaces were verified on screen before release: Student Profiles >
Clinical Hours and Rotation > Activity > Active Rotation Progress, including a
same-day pair numbered 11/12 by check-in time, a pending-review row at 25, and
badges 21-25 confirming there is no 20-item ceiling. Because every surface
derives its number from the one shared helper, and parity is additionally
pinned by focused tests, no further verification is required.

The following are **optional** spot-checks if someone wants the remaining
surfaces seen on screen at some point:

1. UnitClinicalHours (Unit Leader Portal clinical-hours table)
2. Student Portal shift list
3. Unit Leader calendar badge (pre-existing ordinal)

Harness notes for anyone who does: Active Rotation Progress only renders its
cards for students whose status is Active Rotation; the Student Portal needs a
session whose student record actually resolves (a `get_my_portal_access` role
alone leaves it on "No student record is linked yet"); and the Unit Leader
surfaces need `unit-student-detail` plus `unit-shift-activity` mocks.

## Terminology

These records are **clinical shifts**, not logins. A `shift_logs` row exists
only once a student checks in for a clinical shift; it is never a portal
authentication event. All user-facing labels say "Shift #".

## The canonical rule (pre-existing, now shared)

`src/lib/shiftOrdinals.js` (`buildStudentShiftOrdinals`, `compareShiftChronological`)
is the one definition. `lib/server/shiftOrdinals.js` re-exports it so server and
client share the identical implementation.

- **Scope:** per student, **lifetime**. Never resets by month, unit, or cohort.
- **Ordering:** `shift_date` ascending (TEXT `YYYY-MM-DD` sorts chronologically),
  then `checked_in_at` ascending (a row with a check-in sorts before one
  without), then `id` ascending as an immutable, fully deterministic tie-break.
- **Included:** `completed`, `in_progress`, and `null` lifecycle_state (older
  rows predate the column).
- **Excluded:** any unexpected lifecycle_state (defensive only).
- **Not applicable:** ASPIRE holds no forward schedule and has no canceled or
  deleted rows, so there are no future placeholders or voided entries to filter.
- **Derived, never stored.** A late-entered older shift renumbers the shifts
  after it automatically. This is the intended behavior: the number always
  describes the student's actual chronological history, and no stored value can
  drift out of sync.

## Surfaces

| Surface | Component | Source of the number |
|---|---|---|
| Student Profiles > Clinical Hours | `ClinicalHoursPanel` | derived client-side from the shared helper |
| Rotation > Activity > Active Rotation Progress | `ClinicalHoursPanel` (same component) | same |
| Unit Leader Portal calendar | `UnitRotationCalendar` | `shift.ordinal`, server-computed by `api/portal/unit-shift-activity.js` over full history |
| Unit Leader Portal clinical hours | `UnitClinicalHours` | shared **comparator** directly (the panel is role-safe and must not reference an identifying field) |
| Student Portal shift list | `StudentPortal` | derived client-side from the shared helper |

Presentation is the shared `ShiftNumberBadge`: a styled circle (not Unicode
enclosed numerals, which stop around 20), widening past 99, with an
`aria-hidden` digit plus an sr-only "Shift N" so the sequence is never conveyed
by shape or color alone.

## Export recommendation

**Include Shift # only in row-level clinical-shift CSV exports**, and derive it
there through the same shared helper rather than recomputing it.

- **Include:** any export whose rows ARE individual clinical shifts (a shift-log
  CSV). The number is part of that row's identity and makes an exported file
  reconcilable against what staff see on screen.
- **Exclude: certificates.** A certificate attests to completed hours and
  program completion. A per-shift sequence is operational detail that adds no
  attestation value and invites misreading as a graded or ordered requirement.
- **Exclude: aggregate-only reports.** Where a row is a student, a cohort, or a
  unit rather than a shift, a shift ordinal has no meaning at that grain.
- **Derivation rule for any future export:** build the ordinal from the
  student's FULL history, not from the filtered export window. Numbering a
  filtered slice from 1 would produce a number that disagrees with every UI
  surface, which is exactly the drift this canonical helper exists to prevent.

No export emits Shift # today; this records the decision for whoever adds one.
