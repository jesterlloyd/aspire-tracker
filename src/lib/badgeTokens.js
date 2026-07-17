// ASPIRE badge counters: the single source for every count badge in the app.
//
// This file exists because the counters drifted. Action Center's bell badge was
// #930045, the Messages badges were navy (#1D2567 and var(--color-accent-primary)),
// and each was written independently at its own call site. There was no shared
// definition to disagree with, so they disagreed.
//
// Anything that renders a numeric count badge should import from here rather than
// restate a color or re-measure the geometry. CSS call sites use the same
// underlying token directly: var(--cs-red), defined on :root in src/index.css.

// The one ASPIRE badge-counter color: Cedars-Sinai red #DC1E34.
// The literal is only the fallback; --cs-red is the source of truth.
export const BADGE_COUNT_BG = 'var(--cs-red, #DC1E34)';
export const BADGE_COUNT_FG = '#FFFFFF';

// The pin badge that sits on a header icon, anchored to its top-right corner.
// Shared by the Action Center bell and the ASPIRE Connect icon so the two cannot
// drift apart in size, shape, or position. The 1.5px navy ring is what keeps the
// red legible where the badge overlaps the navy header behind it.
//
// The host button must be position: relative with overflow: visible.
export const pinBadgeStyle = {
  position: 'absolute', top: -3, right: -3,
  minWidth: 16, height: 16, borderRadius: 8,
  background: BADGE_COUNT_BG, color: BADGE_COUNT_FG,
  fontSize: 10, fontWeight: 700, fontFamily: 'DM Sans',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: '0 3px', lineHeight: 1, border: '1.5px solid #1D2567',
};

// The inline count chip used beside a text label (a Connect tab, an inbox row)
// rather than pinned to an icon.
export const inlineBadgeStyle = {
  minWidth: 16, padding: '0 5px', borderRadius: 999,
  background: BADGE_COUNT_BG, color: BADGE_COUNT_FG,
  fontSize: 10, fontWeight: 700, lineHeight: '15px', textAlign: 'center',
};
