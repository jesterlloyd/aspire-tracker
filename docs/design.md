# ASPIRE Intelligence Design System

This is the visual contract for ASPIRE Intelligence. Every new component should consume tokens from `src/lib/designTokens.js`. Pre-existing components migrate opportunistically; do not rewrite everything at once.

## Typography
- **One typeface only.** DM Sans, no exceptions. No serif, no display fonts.
- **Numbers always use** `font-variant-numeric: tabular-nums`.
- **Weight discipline.** Body 400, labels 500, titles 600, big numbers 700. Avoid 300 and 800.
- **Size hierarchy.** Use sizes from `type.sizes` only. Don't introduce ad-hoc px values.

## Color
- **Ink hierarchy.** ink1 for primary text, ink2 for Nightfall accents (brand moments), ink3–5 for secondary, tertiary, disabled.
- **One accent per surface.** Pick chroma OR sage OR dawn OR marina - not several. Use the tint variants for backgrounds.
- **Hairlines, not borders.** Use line1 (8% Nightfall) for visible separators, line2 (4%) for subtle internal divisions.

## Patterns

### Passive readouts
Use the unified band pattern (e.g., Program at a Glance, Matching at a Glance). One eyebrow strip, then a grid of `KPICell` components from `src/components/KPIBand.jsx`. No decorative icons. Big numbers do the visual lifting.

### Interactive filters
Use the card pattern with explicit hover and active states. Active card gets a 2px chroma border (`#930045`) and the `tintChroma` background. Each card's `onClick` sets the filter; the breadcrumb above the list shows "Showing: X · Clear filter" so the user can escape without hunting for the active card.

### Eyebrows
Short uppercase labels precede titled sections. Use `styles.eyebrow` from tokens: `font-size: 10.5px`, `letter-spacing: 0.14em`, `font-weight: 600`, `color: ink3`. Eyebrows work best for short status labels above content; standalone panel titles can stay as titles.

### Panel chrome
Every top-level panel uses `styles.panel`: white background, `line1` border, `radii.card` border-radius, `s1` resting shadow, `innerHighlight` top-edge gloss.

## Elevation
- Resting cards: `shadows.s1`
- Hover state: `shadows.s2`
- Floating elements (drawers, modals): `shadows.s3`
- Always pair with `shadows.innerHighlight` for the subtle top-edge gloss.

## Motion
- Hover transitions: 150ms ease.
- Page entrance: 500ms cubic-bezier(0.2, 0.7, 0.2, 1).
- Selected/active state pulses: 2.4s ease-in-out infinite.
- Avoid all other motion unless serving a specific affordance.

## Notification badges
All notification counters use **Chroma `#930045`** (the `chroma` token).

- **Solid badge** (Chroma bg, white text, pill shape): tab counters and prominent count displays.
- **Tinted badge** (`tintChroma` bg, Chroma text): inline priority pills in Action Center.
- **Dot indicator** (Chroma fill, optional halo border): bell-style notifications without a count.

Never use orange, red, or generic "warning" colors for counters. Chroma is the single attention color for ASPIRE.

## Files
- `src/lib/designTokens.js` - token primitives and composed styles
- `src/components/KPIBand.jsx` - shared `KPICell` and `useUpdatedLabel` for passive readout bands
