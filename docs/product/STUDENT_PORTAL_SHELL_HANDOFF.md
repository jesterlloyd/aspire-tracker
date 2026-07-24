# Student Portal Shell Handoff

## Shared portal header

The Student Portal now uses the same shared Nightfall `PortalShell` header as
the Unit Leader Portal.

Student branch configuration:

```text
headerVariant="nightfall"
logoSrc="/cs-logo-large.png"
```

The header preserves the existing Student Portal information architecture:

- `ASPIRE`
- `Student Portal`
- profile menu with `Edit Profile`, `Public site`, and `Sign out`
- light secondary/mobile portal navigation remains separate from the taskbar
- floating Messages utility remains mounted through `PortalShell`

It does not add staff-only cohort selectors, global search, analytics,
notification controls, staff account controls, or administrative actions.

## Student profile photo

The top-right profile control now shows the signed-in student's own headshot
when available.

Implementation:

- `PortalApp` calls `usePortalHeadshotUrl({ enabled: isStudent })`
- `usePortalHeadshotUrl` resolves through `/api/portal/student-file-access`
- the endpoint resolves the active linked student server-side
- the browser sends no student id or storage path
- the signed URL is cached only in the existing in-memory student photo cache

If no headshot is available, or if the image fails to load, the button falls back
to initials. Menu accessibility and behavior are unchanged.

## Unchanged boundaries

This shell pass did not change Student Portal data scope, Messages behavior,
profile-edit permissions, shift logging, evaluation/survey behavior, document
access, SQL, migrations, environment configuration, deploys, or Academic Partner
work.
