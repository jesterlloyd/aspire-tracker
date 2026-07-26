# Student Portal Home refinement: reuse-first convergence notes

Branch: `student-portal-home-refinement` (baseline `67f2403`).

A reuse / convergence pass that brings the Student Portal home onto the approved shared
portal language, without a redesign-from-scratch and without disturbing the approved
Unit Leader work or the main app.

## 1. Masthead: reused, not rebuilt

The student-only navy "compass" hero (Welcome back / name / school+cohort /
current-stage + next + CTA / attention chips) was replaced with the **shared
`GreetingMasthead`** already used by the main app "At a Glance" and the Unit Leader
Home: greeting line, a date / cohort / last-visit sub-line, and the existing weather
scene.

Reused as-is (nothing new invented):
- `src/components/masthead/GreetingMasthead.jsx`: unchanged.
- `WeatherMasthead` / the saved weather assets: unchanged.
- `useLastVisitLabel` (`src/lib/lastVisit.js`): keyed per browser + student
  (`aspire:lastVisit:portal:student:<id>`), mirroring the Unit Leader key.
- The shared `.mast*` styling; one line, `.ptl-student .mast { margin: 0 }`, aligns it
  flush with the student column (parallel to the existing `.ptl-unit-page` rule).

Redundancy removed with the hero:
- The stage / next block is gone. **Your progress** (the timeline card) is now the
  single stage representation; the stage action stays on its own card (Hours has Log a
  Shift, Badge has Download Certificate), so there is no duplicated hero CTA. No stage
  information was lost, only de-duplicated.
- The hero attention chips are gone; those signals already live on the cards, the
  Messages tab badge, and the floating Messages button.
- The retired compass CSS (`.ptl-compass*`, `.ptl-attention*`, `.ptl-dot*`) was deleted.

## 2. Edit Profile drawer: extracted a shared primitive

The Edit Profile drawer converges on the approved student-profile identity language
(sky-blue header, circular photo, centred name). Rather than reuse another component's
classes (the project rule is that no two components share a `.ptl-*` class) or duplicate
markup, this pass **extracted a shared, role-neutral primitive**:

- `src/components/portal/ProfileIdentityHero.jsx` (new): a presentational hero with a
  circular photo (initials fallback), name, and optional subtitle. It owns its own
  `.ptl-idhero-*` classes.

The Student drawer renders it with the student's **own** server-mediated headshot
(Wave F-2), name, and school. Student-only boundaries are unchanged: only preferred
name and phone are editable via `/api/portal/update-profile`; School / Cohort / Status /
Placement stay read-only under "Managed by ASPIRE" with Request a correction; focus
trap, Escape, and the initial-focus target are preserved. No staff-only field or
control (support notes, learning highlight, review reason, evaluations, resume,
preceptor management) is exposed, and no new image asset was added.

The approved Unit Leader `StudentDetailDrawer` was **not** modified; it can adopt
`ProfileIdentityHero` later.

## 3. Home card layout

The Home **Messages card was removed** (redundant with the Messages tab and the floating
Messages button; both are unchanged). The remaining cards were rebalanced into a
purposeful 12-column IA:

| Row | Cards | Spans |
| --- | --- | --- |
| 1 | Placement, Your progress | 7 + 5 |
| 2 | Hours & shifts (full width) | 12 |
| 3 | Surveys, Badge & Certificate, Support | 4 + 4 + 4 |

Placement + Your progress lead because they are always populated and answer "where am
I / how far along." Hours & shifts is the full-width authoritative surface. Surveys /
Badge / Support are the compact lower trio. No student function was removed beyond the
redundant Messages card.

## 4. What this sets up

`GreetingMasthead` and the new `ProfileIdentityHero` are the shared presentation
primitives the portal family can keep converging on:
- The masthead is already shared by the main app, Unit Leader, and now Student.
- `ProfileIdentityHero` is used by the Student Edit Profile drawer now and is ready for
  the Unit Leader student view and the future Academic Partner portal to adopt, so the
  identity treatment stays consistent without per-surface reimplementation.

## Boundaries honored

No main-app component and no approved Unit Leader component were changed (the masthead
was reused unchanged; the UL drawer was left alone). No SQL, no migrations. Student
authorization, routes, and data boundaries are unchanged. The Messages tab and the
floating Messages utility are unchanged.

## Known pre-existing item

`StudentPortal.jsx` and `EditProfileDrawer.jsx` each carry one pre-existing
`react-hooks/set-state-in-effect` lint error (the data-load effect and the open-sync
effect). Both are present on baseline `main` and are unrelated to this refinement; they
were left untouched to avoid unrelated changes.
