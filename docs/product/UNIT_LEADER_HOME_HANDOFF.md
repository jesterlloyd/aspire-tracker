# Unit Leader Home Handoff

## Current Home structure

The Unit Leader Home page starts with the welcome heading and unit context, then
shows attention items when actionable. The existing rotation-activity calendar
and summary cards remain in place for this pass.

## Authorized unit selector

Home uses the shared compact `SegmentedTabs` unit selector when the caller has
more than one authorized unit. The selector is content-width, left-aligned, and
contains only:

- `All Assigned Units`
- server-authorized unit keys

The selector narrows the view only. Choosing all assigned units leaves authority
with the server-resolved scope.

## Your Students table

`Your students` defaults to alphabetical A-to-Z order by student display name.
The Student header is now a sortable button:

- first render: A to Z
- click: toggles Z to A
- click again: toggles back to A to Z

The header exposes `aria-sort`, uses the same simple arrow treatment as the other
sortable tables, and sorts a copied array so the authorized source roster is not
mutated. Names with punctuation, hyphens, and mixed case are handled through the
shared `Intl.Collator` helper in `src/portal/unit/unitLeaderStudentSort.js`.

## Boundaries

This Home pass did not expose staff-only data or controls, change Unit Leader
scope, fabricate forward schedules, run SQL, add migrations, or alter backend
activity semantics.
