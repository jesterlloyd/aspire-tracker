# Preceptor Directory Handoff

## Canonical foundation

The main app Preceptor Directory is the canonical visual and interaction
reference. The shared implementation is:

- `src/components/shared/PreceptorDirectoryTable.jsx`
- `src/components/shared/RowActionsMenu.jsx`
- `src/lib/preceptorDirectory.js`

Both the main app and Unit Leader Portal consume the same white table foundation:
compact row density, near-white headers, white rows, row separators, sortable
headers with `aria-sort`, shared status and assignment-role badges, circular
profile-photo/initials treatment, and the same Current Student display.

## Current Student column

The Current Student column contains assignment data only:

- student name
- Primary, Secondary, or Coverage badge

Multiple active assignments remain visible and stacked compactly. The empty state
is neutral: `No current student`.

The student unit remains available in normalized assignment data for authorized
downstream flows such as the assignment manager, but the directory cell no longer
repeats it because the table already has a dedicated Unit column.

## Row actions

The rightmost kebab menu is the only row action surface.

Accessible name:

```text
Open actions for <Preceptor Name>
```

Staff may see:

- Manage Preceptor Assignments
- Edit Preceptor
- Delete Preceptor

Unit Leaders may see only:

- Manage Preceptor Assignments

The menu is viewport-clamped, closes on Escape/click-away/scroll/resize, restores
focus to its trigger, and uses real menu buttons.

## Unit Leader controls

The Unit Leader Preceptors workspace uses a compact row:

- `+ Add Preceptor`
- search
- Filters disclosure for shift, status, and association

Sorting lives in table headers. The old oversized filter card and Sort dropdown
are retired.

Multi-unit Unit Leaders use the canonical shared segmented tab foundation in
`src/components/ui/SegmentedTabs.jsx`:

- All Assigned Units
- each authorized unit

Only authorized units appear. The selector is content-width, left-aligned with the
page content, keyboard accessible, and horizontally scrollable only when the
authorized unit list cannot fit.

## Profile pictures

The main app resolves preceptor photos from Contacts by email. The Unit Leader
endpoint returns the same authorized contact avatar URL only for preceptors already
included in the scoped roster. The shared table displays that image when available
and falls back to initials without broken-image placeholders.

## Boundaries

This directory convergence did not change backend assignment semantics, SQL,
migrations, audit behavior, notification behavior, sender behavior, Reply-To
behavior, Unit Leader authority, or data scope.

The assignment manager opened from this menu uses the shared title
`Manage Preceptor Assignments` and the shared `Student · Unit · Shift` subtitle
model documented in `UNIT_LEADER_PRECEPTOR_ASSIGNMENT_MANAGER_HANDOFF.md`.
