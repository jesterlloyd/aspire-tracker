# Shared Segmented Tabs Handoff

## Canonical foundation

Compact segmented tab controls now use:

- `src/components/ui/SegmentedTabs.jsx`
- shared `.segmented-tabs*` styles in `src/index.css`

The component is reused by:

- ASPIRE Connect sub-tabs
- Unit Leader authorized-unit selector on unit-scoped portal pages

## Behavior

The control is content-width by default, left-aligns with the page content, and
scrolls horizontally only when its items cannot fit. It uses the main-app compact
tab treatment: small height, tight spacing, subtle border, active Nightfall fill,
shared typography, and consistent focus treatment.

Keyboard support includes arrow-key movement, Home, End, roving tab index, and
`role="tablist"` / `role="tab"` semantics with `aria-selected`.

## Unit Leader scope

For Unit Leaders, the items are:

- `All Assigned Units`
- each server-authorized unit

The selector remains a view-narrowing control. Selecting all assigned units does
not send a broadening authority token; the client omits `unit_key` and the server
returns only the caller's authorized scopes.

## Boundaries

This shared UI extraction did not change data loading, authorization, Messages
polling, unread-count semantics, portal permissions, or any backend API.
