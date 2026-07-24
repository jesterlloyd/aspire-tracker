# Shared Student and Unit Leader Portal Chrome Handoff

## Shared Nightfall taskbar

Student and Unit Leader portals now opt into the same Nightfall top taskbar
through `PortalShell`:

- `headerVariant="nightfall"`
- `logoSrc="/cs-logo-large.png"`

The implementation is shared in `src/portal/PortalShell.jsx` and wired from the
Student and Unit Leader branches in `src/portal/PortalApp.jsx`. Academic Partner
keeps the existing light placeholder header until that portal is actually built.

The Nightfall treatment uses the canonical main-app token:

```text
var(--nightfall)
```

The shared taskbar includes:

- Cedars-Sinai logo
- `ASPIRE`
- portal context (`Student Portal` or `Unit Leader Portal`)
- Unit Leader signed-in name on desktop where already approved
- avatar/profile menu

## Canonical logo asset

The portal header uses the existing repository public asset:

```text
public/cs-logo-large.png
```

No new logo file was created. The image keeps the accessible alt text
`Cedars-Sinai`, preserves its aspect ratio, and follows the main app's
Nightfall taskbar treatment:

- desktop height: `46px`
- mobile height: `34px`
- `object-fit: contain`
- no white logo pill
- no custom recoloring or generated replacement

The shared header includes the same subtle divider rhythm used by the main app
brand area.

## Profile photo behavior

The profile menu button now renders an authorized profile image when one is
available and falls back to initials when no image exists or the image fails to
load.

Student Portal:

- resolves only the signed-in student's own headshot through
  `usePortalHeadshotUrl`
- uses `/api/portal/student-file-access`
- stores no signed URL outside the existing in-memory photo cache
- sends no student id, path, or arbitrary contact identifier from the browser

Unit Leader Portal:

- uses the signed-in Unit Leader's `userProfile.avatar_url`
- does not read arbitrary contact images

Both roles keep the same avatar dimensions, border treatment, accessible menu
button name, and profile-menu behavior.

## PortalShell scope

`PortalShell` now has opt-in presentation props:

- `headerVariant`
- `logoSrc`
- `profileImageUrl`

Defaults preserve existing behavior:

- `headerVariant="light"`
- `logoSrc="/Cedars-Sinai.png"`
- `profileImageUrl={null}`

The shell still does not mount portal navigation, Messages workspace, cohort
selectors, global search, Action Center, staff account controls, or any
staff-only administrative actions.

## Secondary navigation

Unit Leader section navigation remains structurally separate from the top
taskbar. `UnitLeaderNav` still renders inside the Unit Leader portal content,
using the existing light secondary navigation surface and the same mobile More
sheet behavior.

## Accessibility and responsive behavior

The Nightfall variant preserves:

- sticky safe-area-aware header behavior
- accessible logo alt text
- visible focus treatment on dark chrome
- avatar button menu semantics
- Escape and click-outside profile-menu close behavior
- desktop-only signed-in-name display
- mobile bottom navigation and More dialog behavior

## Unchanged boundaries

This chrome pass did not add staff-only data, controls, cohort selectors,
global search, notifications, administrative actions, SQL, migrations,
environment configuration changes, deploys, pushes, or Academic Partner work.
