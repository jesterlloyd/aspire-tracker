# Clinical Shift Sequence (Shift #)

Status: **Committed 2026-08-03 (SHIFT-SEQUENCE-1) on local main; not pushed or
deployed.** Export decision recorded below; no export currently emits Shift #.
(The commit hash is deliberately not quoted here: a file inside the commit
cannot cite its own hash without changing it.)

## MANDATORY live-QC before release approval

Two staff surfaces were verified on screen (Student Profiles > Clinical Hours
and Rotation > Activity > Active Rotation Progress, including a same-day pair
numbered 11/12 by check-in time, a pending-review row at 25, and badges 21-25
proving there is no 20-item ceiling). The following were wired and are covered
by focused tests but were NOT rendered, and MUST be screenshotted and confirmed
before this ships:

1. **UnitClinicalHours** (Unit Leader Portal clinical-hours table)
2. **Student Portal** shift list
3. **Unit Leader calendar badge** (pre-existing ordinal, confirm parity)

For each, confirm the same underlying shift record shows the SAME ordinal it
shows on the staff surfaces. Note: Active Rotation Progress only renders its
cards for students whose status is Active Rotation, and the Student Portal
harness needs a student-role session with `get_my_portal_access`.

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
