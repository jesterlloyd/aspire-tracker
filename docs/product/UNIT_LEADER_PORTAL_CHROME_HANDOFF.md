# Unit Leader Portal Chrome Handoff

## Nightfall taskbar

The Unit Leader Portal now opts into a Nightfall top taskbar through
`PortalShell`:

- `headerVariant="nightfall"`
- `logoSrc="/cs-logo-large.png"`

The implementation is scoped to the Unit Leader branch in `src/portal/PortalApp.jsx`.
Student and Academic Partner portals keep the existing light portal header.

The Nightfall treatment uses the canonical main-app token:

```text
var(--nightfall)
```

The taskbar includes:

- Cedars-Sinai logo
- `ASPIRE`
- `Unit Leader Portal`
- Unit Leader signed-in name on desktop
- avatar/profile menu

## Canonical logo asset

The Unit Leader header uses the existing repository public asset:

```text
public/cs-logo-large.png
```

No new logo file was created. The image keeps the accessible alt text
`Cedars-Sinai`, preserves its aspect ratio, and is placed on a small Pearl badge
inside the Nightfall bar so the approved red mark remains legible.

## PortalShell scope

`PortalShell` now has opt-in presentation props:

- `headerVariant`
- `logoSrc`

Defaults preserve existing behavior:

- `headerVariant="light"`
- `logoSrc="/Cedars-Sinai.png"`

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
