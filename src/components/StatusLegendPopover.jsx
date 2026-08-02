import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';
import { ASPIRE_STATUSES } from '../lib/statuses';
import { ASPIRE_STATUS_CONFIG } from '../lib/constants';
import {
  DISPOSITION_TYPES, DISPOSITION_PILL_COLORS,
  PRE_PLACEMENT_DISPOSITION_TYPES, POST_PLACEMENT_DISPOSITION_TYPES,
} from '../lib/dispositions';
import {
  LEGEND_TITLE, LEGEND_INTRO, STATUS_DESCRIPTIONS_BY_AUDIENCE,
  NOT_PROCEEDING_DESCRIPTION, legendColorRows,
} from '../lib/statusLegendCopy';
import { computeLegendPlacement } from './statusLegendPlacement';

// The 8 active lifecycle statuses - excludes Declined (legacy) and Not Proceeding (terminal)
const LIFECYCLE_STATUSES = ASPIRE_STATUSES.filter(
  s => s.value !== 'Declined' && s.value !== 'Not Proceeding'
);

// Legend swatches use the SAME dictionary the real pills render from
// (ASPIRE_STATUS_CONFIG), so the legend can never drift from what tables show.
// statuses.js keeps supplying the canonical labels and ordering.
const swatchFor = (value) => ASPIRE_STATUS_CONFIG[value] || { bg: '#f3f4f6', text: '#374151', border: '#e5e7eb' };

// STATUS-LEGEND-AUDIENCE-1: one canonical legend, audience-aware copy.
//   audience="staff"            - full detail: statuses, Not Proceeding with the
//                                 disposition breakdown, and Status Colors.
//   audience="academic_partner" - external copy: statuses, the general
//   audience="unit_leader"        Not Proceeding entry (no disposition
//                                 breakdown), and Status Colors with no
//                                 internal terminology.
// Status names, pill colors, and ordering are canonical for every audience;
// only descriptions adapt (src/lib/statusLegendCopy.js).
export default function StatusLegendPopover({ position = 'bottom-left', dark = false, audience = 'staff' }) {
  const [isOpen,        setIsOpen]        = useState(false);
  const [showTooltip,   setShowTooltip]   = useState(false);
  const [tooltipPos,    setTooltipPos]    = useState({ top: 0, left: 0 });
  const [popoverCoords, setPopoverCoords] = useState({ placement: 'below', top: 0, bottom: null, left: 0, width: 360, maxHeight: 0 });
  const popoverRef = useRef(null);
  const triggerRef = useRef(null);
  const staffDetail = audience === 'staff';
  const statusDescriptions = STATUS_DESCRIPTIONS_BY_AUDIENCE[audience] || STATUS_DESCRIPTIONS_BY_AUDIENCE.staff;
  const colorRows = legendColorRows(audience);
  // Restore focus to the trigger when the popover closes (derived, not a setState-in-effect).
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !isOpen) triggerRef.current?.focus();
    wasOpen.current = isOpen;
  }, [isOpen]);

  // The popover is position:fixed and portaled, so its coordinates are anchored to the trigger's
  // current viewport rect. Shared by open and by the reposition-on-scroll effect below. The pure
  // geometry (viewport collision, below/above flip, clamping, bounded max-height) lives in
  // computeLegendPlacement so it is deterministically testable.
  const computeCoords = () => computeLegendPlacement({
    rect: triggerRef.current.getBoundingClientRect(),
    viewportW: window.innerWidth,
    viewportH: window.innerHeight,
    position,
  });

  const handleToggle = () => {
    if (!isOpen && triggerRef.current) {
      setPopoverCoords(computeCoords());
    }
    setIsOpen(p => !p);
  };

  useEffect(() => {
    function handleClickOutside(e) {
      if (
        popoverRef.current && !popoverRef.current.contains(e.target) &&
        triggerRef.current && !triggerRef.current.contains(e.target)
      ) {
        setIsOpen(false);
      }
    }
    if (isOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  useEffect(() => {
    function handleEscape(e) { if (e.key === 'Escape') setIsOpen(false); }
    if (isOpen) document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen]);

  // Stay open while the page, roster, or viewport scrolls: reposition the popover to follow the
  // trigger instead of closing. Scroll is a navigation gesture, not a dismiss gesture; the legend
  // closes only via the close button, an outside click, Escape, or toggling the trigger. A scroll
  // that originates INSIDE the popover's own scrollable body does not move the trigger, so it is
  // ignored. Capture phase is required because scroll events do not bubble. Resize is handled too, so
  // the anchor stays correct when the window changes size.
  useEffect(() => {
    if (!isOpen) return;
    const reposition = (e) => {
      if (e && e.type === 'scroll' && popoverRef.current && popoverRef.current.contains(e.target)) return;
      if (!triggerRef.current) return;
      setPopoverCoords(computeCoords());
    };
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>
      {/* Trigger icon - flexShrink:0 prevents the toolbar from squeezing this out of view */}
      <button
        ref={triggerRef}
        onClick={handleToggle}
        onMouseEnter={e => {
          const rect = e.currentTarget.getBoundingClientRect();
          setTooltipPos({ top: rect.top - 32, left: rect.left + rect.width / 2 });
          setShowTooltip(true);
        }}
        onMouseLeave={() => setShowTooltip(false)}
        onFocus={() => setShowTooltip(false)}
        aria-label="View status legend"
        aria-expanded={isOpen}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          width: '20px', height: '20px', flexShrink: 0,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          color: isOpen ? (dark ? '#9FAFF8' : '#1D2567') : (dark ? 'rgba(255,255,255,0.5)' : '#9ca3af'),
          transition: 'color 0.15s ease', borderRadius: '4px',
        }}
      >
        <Info size={15} strokeWidth={2} />
      </button>

      {/* Hover tooltip - fixed position to escape overflow:hidden parents */}
      {showTooltip && !isOpen && (
        <div style={{
          position: 'fixed',
          top: tooltipPos.top,
          left: tooltipPos.left,
          transform: 'translateX(-50%)',
          background: '#1D2567', color: '#ffffff',
          fontFamily: 'DM Sans', fontSize: '11px', fontWeight: 500,
          padding: '4px 10px', borderRadius: '6px',
          whiteSpace: 'nowrap', pointerEvents: 'none',
          zIndex: 9999,
          boxShadow: '0 2px 8px rgba(29,37,103,0.25)',
          textTransform: 'none', letterSpacing: 'normal',
        }}>
          View status legend
        </div>
      )}

      {/* Popover - portaled to document.body so no ancestor overflow clips it */}
      {isOpen && createPortal(
        <div
          ref={popoverRef}
          role="dialog"
          aria-label="ASPIRE Status Legend"
          style={{
            position: 'fixed',
            // Below-placements anchor by top; above-placements anchor by bottom so they grow upward.
            top:    popoverCoords.top != null ? popoverCoords.top : undefined,
            bottom: popoverCoords.bottom != null ? popoverCoords.bottom : undefined,
            left:   popoverCoords.left,
            width:  popoverCoords.width,
            // Viewport-bounded height for the chosen side; the body (below) scrolls within it.
            maxHeight: popoverCoords.maxHeight,
            background: '#ffffff',
            borderRadius: '14px',
            boxShadow: '0 8px 32px rgba(29,37,103,0.18), 0 2px 8px rgba(0,0,0,0.08)',
            zIndex: 9999,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Header: never shrinks, so the title and close button stay visible while the body scrolls. */}
          <div style={{
            background: '#1D2567', padding: '14px 18px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            flexShrink: 0,
          }}>
            <div>
              <div style={{ fontFamily: 'DM Sans', fontWeight: 700, fontSize: '14px', color: '#ffffff' }}>
                {LEGEND_TITLE}
              </div>
              <div style={{ fontFamily: 'DM Sans', fontSize: '11px', color: 'rgba(255,255,255,0.65)', marginTop: '2px' }}>
                {LEGEND_INTRO}
              </div>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              aria-label="Close status legend"
              style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', fontSize: '16px', lineHeight: 1, padding: '2px' }}
            >×</button>
          </div>

          {/* Scrollable body: minHeight:0 lets a flex child actually overflow-scroll within the bounded
              max-height; the whole page never scrolls to reveal legend content. Touch scrolling kept. */}
          <div style={{ padding: '14px 18px', flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
            {/* Lifecycle statuses - descriptions keyed by status VALUE per audience */}
            <div style={{ fontFamily: 'DM Sans', fontWeight: 600, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#9ca3af', marginBottom: '10px' }}>
              Active Pathway Statuses
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '7px', marginBottom: '18px' }}>
              {LIFECYCLE_STATUSES.map((status) => {
                const swatch = swatchFor(status.value);
                return (
                  <div key={status.value} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                    <span style={{
                      background: swatch.bg, color: swatch.text, border: `1px solid ${swatch.border}`,
                      fontFamily: 'DM Sans', fontWeight: 600, fontSize: '10px',
                      padding: '3px 9px', borderRadius: '20px',
                      whiteSpace: 'nowrap', flexShrink: 0,
                      minWidth: '120px', textAlign: 'center',
                    }}>
                      {status.label}
                    </span>
                    <span style={{ fontFamily: 'DM Sans', fontSize: '12px', color: '#4b5563', lineHeight: 1.5, paddingTop: '2px' }}>
                      {statusDescriptions[status.value]}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Not Proceeding - every audience sees the general status; only staff see the
                disposition breakdown beneath it. */}
            <div style={{ borderTop: '1px solid #f3f4f6', marginBottom: '14px' }} />
            <div style={{ fontFamily: 'DM Sans', fontWeight: 600, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#9ca3af', marginBottom: '10px' }}>
              Not Proceeding
            </div>
            <div style={{ marginBottom: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', marginBottom: staffDetail ? '10px' : 0 }}>
                <span style={{
                  background: swatchFor('Not Proceeding').bg, color: swatchFor('Not Proceeding').text,
                  border: `1px solid ${swatchFor('Not Proceeding').border}`,
                  fontFamily: 'DM Sans', fontWeight: 600, fontSize: '10px',
                  padding: '3px 9px', borderRadius: '20px',
                  whiteSpace: 'nowrap', flexShrink: 0,
                  minWidth: '120px', textAlign: 'center',
                }}>
                  Not Proceeding
                </span>
                <span style={{ fontFamily: 'DM Sans', fontSize: '12px', color: '#4b5563', lineHeight: 1.5, paddingTop: '2px' }}>
                  {NOT_PROCEEDING_DESCRIPTION}
                </span>
              </div>
              {staffDetail && (
              <div style={{ paddingLeft: '6px' }}>
                <div style={{ fontFamily: 'DM Sans', fontSize: '10px', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>
                  Pre-placement
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginBottom: '10px' }}>
                  {PRE_PLACEMENT_DISPOSITION_TYPES.map(type => {
                    const colors = DISPOSITION_PILL_COLORS[type]
                    return (
                      <div key={type} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{
                          background: colors.bg, color: colors.text, border: `1px solid ${colors.border}`,
                          fontFamily: 'DM Sans', fontWeight: 600, fontSize: '10px',
                          padding: '2px 8px', borderRadius: '20px', whiteSpace: 'nowrap', flexShrink: 0,
                        }}>
                          {DISPOSITION_TYPES[type]}
                        </span>
                      </div>
                    )
                  })}
                </div>
                <div style={{ fontFamily: 'DM Sans', fontSize: '10px', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>
                  Post-placement (Phase 4)
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                  {POST_PLACEMENT_DISPOSITION_TYPES.map(type => {
                    const colors = DISPOSITION_PILL_COLORS[type]
                    return (
                      <div key={type} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{
                          background: colors.bg, color: colors.text, border: `1px solid ${colors.border}`,
                          fontFamily: 'DM Sans', fontWeight: 600, fontSize: '10px',
                          padding: '2px 8px', borderRadius: '20px', whiteSpace: 'nowrap', flexShrink: 0,
                        }}>
                          {DISPOSITION_TYPES[type]}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
              )}
            </div>

            {/* Divider */}
            <div style={{ borderTop: '1px solid #f3f4f6', marginBottom: '14px' }} />

            {/* Status colors - color stays a supporting signal; every audience gets the meanings,
                with the amber row phrased for the reader (no Action Center outside the main app). */}
            <div style={{ fontFamily: 'DM Sans', fontWeight: 600, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#9ca3af', marginBottom: '10px' }}>
              Status Colors
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
              {colorRows.map((item) => (
                <div key={item.key} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                  <div style={{
                    width: '28px', height: '28px', borderRadius: '50%',
                    background: item.color, border: `2px solid ${item.border}`,
                    flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: item.dot }} />
                  </div>
                  <div>
                    <div style={{ fontFamily: 'DM Sans', fontWeight: 600, fontSize: '12px', color: '#1f2937' }}>
                      {item.label}
                    </div>
                    <div style={{ fontFamily: 'DM Sans', fontSize: '11px', color: '#6b7280', lineHeight: 1.4 }}>
                      {item.description}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
