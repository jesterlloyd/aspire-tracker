// Pure viewport-collision geometry for the shared StatusLegendPopover. No DOM, no React, so it is
// unit-testable with deterministic geometry mocks. Given the trigger's viewport rect and the viewport
// size, it returns a fixed-position placement that:
//   - anchors horizontally to the trigger side (left, or right when position includes 'right') and
//     clamps the popover fully inside the viewport with a minimum margin;
//   - prefers placing BELOW the trigger; flips ABOVE only when below cannot show the full legend AND
//     above has more room (otherwise the larger side is used);
//   - returns a viewport-bounded max-height for the chosen side so the popover never extends past the
//     viewport and its body scrolls internally instead;
//   - anchors an above-placement by its BOTTOM edge (so it grows upward without needing the rendered
//     height), and a below-placement by its TOP edge.

export function clampWithin(value, lo, hi) {
  // Guard against an inverted range on very small viewports (hi < lo): never return below lo.
  return Math.max(lo, Math.min(value, Math.max(lo, hi)));
}

export function computeLegendPlacement({
  rect,
  viewportW,
  viewportH,
  position = 'bottom-left',
  margin = 14,
  gap = 8,
  desktopWidth = 360,
  maxDesired = 780,
} = {}) {
  // Width: the full desktop width, clamped on a narrow screen so `margin` stays on both sides.
  const width = Math.min(desktopWidth, Math.max(0, viewportW - margin * 2));

  // Horizontal: anchor to the trigger side, then clamp within [margin, viewportW - width - margin].
  const anchoredLeft = position.includes('right') ? rect.right - width : rect.left;
  const left = clampWithin(anchoredLeft, margin, viewportW - width - margin);

  // Vertical: usable space below vs above the trigger (excluding the gap and the viewport margin).
  const spaceBelow = viewportH - rect.bottom - gap - margin;
  const spaceAbove = rect.top - gap - margin;
  // The tallest we would ever want the popover, itself bounded by the viewport.
  const desiredMax = Math.min(maxDesired, viewportH - margin * 2);

  // Prefer below: stay below when below fits the full desired height OR below has at least as much
  // room as above. Flip above only when below cannot show the full legend AND above has more room.
  const placeBelow = spaceBelow >= desiredMax || spaceBelow >= spaceAbove;

  if (placeBelow) {
    return {
      placement: 'below',
      top: Math.round(rect.bottom + gap),
      bottom: null,
      left: Math.round(left),
      width: Math.round(width),
      maxHeight: Math.max(0, Math.round(Math.min(desiredMax, spaceBelow))),
    };
  }
  return {
    placement: 'above',
    top: null,
    // Anchor the BOTTOM edge just above the trigger; the popover grows upward, capped by spaceAbove.
    bottom: Math.round(viewportH - (rect.top - gap)),
    left: Math.round(left),
    width: Math.round(width),
    maxHeight: Math.max(0, Math.round(Math.min(desiredMax, spaceAbove))),
  };
}
