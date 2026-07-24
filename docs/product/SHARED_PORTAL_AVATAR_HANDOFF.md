# Shared Portal Avatar Handoff

## Scope

`PortalShell` owns the top-right profile menu button for portal surfaces. It now
accepts:

```text
profileImageUrl
```

When `profileImageUrl` is present, the button renders the image inside the same
circular avatar footprint. When it is absent, or if image loading fails, the
button renders initials.

## Authorized image sources

Student Portal:

- source: `usePortalHeadshotUrl`
- endpoint: `/api/portal/student-file-access`
- server resolves the signed-in student's active portal link
- no student id, storage path, or arbitrary contact id is provided by the client

Unit Leader Portal:

- source: signed-in `userProfile.avatar_url`
- no arbitrary contact lookup is performed

## Safety behavior

- images use empty `alt` text because the button itself has the accessible name
  `Open profile menu`
- failed image loads fall back to initials through React state
- no broken-image placeholder is exposed
- signed Student headshot URLs stay in memory only via the existing photo cache
- avatar menu semantics, Escape behavior, click-outside close, and focus return
  are unchanged
