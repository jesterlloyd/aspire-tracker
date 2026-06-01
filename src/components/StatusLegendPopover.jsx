import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';
import { ASPIRE_STATUSES } from '../lib/statuses';
import { DISPOSITION_TYPES, DISPOSITION_PILL_COLORS } from '../lib/dispositions';

const READINESS_COLORS = [
  {
    color: '#f9fafb', border: '#e5e7eb', dot: '#9ca3af',
    label: 'Neutral',
    description: 'Student is still in the early pipeline and no action is urgently needed.',
  },
  {
    color: '#fef3c7', border: '#fcd34d', dot: '#f59e0b',
    label: 'Amber',
    description: 'Student needs follow-up. An action item is pending in the Action Center.',
  },
  {
    color: '#fee2e2', border: '#fca5a5', dot: '#dc1e34',
    label: 'Red',
    description: 'Student has a time-sensitive blocker or is flagged as at risk.',
  },
  {
    color: '#dcfce7', border: '#86efac', dot: '#16a34a',
    label: 'Light Green',
    description: 'Student is placed and ready to begin their clinical rotation.',
  },
  {
    color: '#d1fae5', border: '#6ee7b7', dot: '#065f46',
    label: 'Solid Green',
    description: 'Student is actively completing their ASPIRE clinical rotation.',
  },
  {
    color: '#e0e7ff', border: '#a5b4fc', dot: '#1D2567',
    label: 'Indigo',
    description: 'Student has completed the ASPIRE rotation successfully.',
  },
  {
    color: '#fee2e2', border: '#fca5a5', dot: '#991b1b',
    label: 'Red (Declined)',
    description: 'Student is no longer moving forward in the ASPIRE placement pathway.',
  },
];

// The 8 active lifecycle statuses — excludes Declined (legacy) and Not Proceeding (terminal)
const LIFECYCLE_STATUSES = ASPIRE_STATUSES.filter(
  s => s.value !== 'Declined' && s.value !== 'Not Proceeding'
);

const STATUS_DESCRIPTIONS = [
  'Listed in the cohort but outreach has not yet started.',
  'Sent the ASPIRE Student Profile form and needs to complete it.',
  'Submitted the profile form and is ready for interview scheduling.',
  'Has selected or been assigned an interview appointment.',
  'Interview completed. Rubric outcome is available or pending review.',
  'Matched to a unit and ready to begin rotation.',
  'Currently completing the ASPIRE clinical rotation.',
  'Finished the ASPIRE rotation. Certificate pending.',
];

// Pre-placement disposition types shown in the Not Proceeding section
const PRE_PLACEMENT_DISPOSITIONS = [
  'not_selected', 'student_declined_offer', 'application_withdrawn', 'ineligible',
];
const POST_PLACEMENT_DISPOSITIONS = [
  'placement_cancelled', 'student_withdrew_after_placement',
  'rotation_discontinued', 'removed_from_program',
];

export default function StatusLegendPopover({ position = 'bottom-left', dark = false }) {
  const [isOpen,        setIsOpen]        = useState(false);
  const [showTooltip,   setShowTooltip]   = useState(false);
  const [tooltipPos,    setTooltipPos]    = useState({ top: 0, left: 0 });
  const [popoverCoords, setPopoverCoords] = useState({ top: 0, left: undefined, right: undefined });
  const popoverRef = useRef(null);
  const triggerRef = useRef(null);

  const handleToggle = () => {
    if (!isOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const coords = { top: rect.bottom + 8 };
      if (position.includes('right')) {
        coords.right = window.innerWidth - rect.right;
      } else {
        coords.left = rect.left;
      }
      setPopoverCoords(coords);
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

  // Close on external scroll only — ignore scroll events inside the popover itself
  useEffect(() => {
    if (!isOpen) return;
    const handleScroll = (e) => {
      if (popoverRef.current && popoverRef.current.contains(e.target)) return;
      setIsOpen(false);
    };
    window.addEventListener('scroll', handleScroll, true);
    return () => window.removeEventListener('scroll', handleScroll, true);
  }, [isOpen]);

  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>
      {/* Trigger icon — flexShrink:0 prevents the toolbar from squeezing this out of view */}
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

      {/* Hover tooltip — fixed position to escape overflow:hidden parents */}
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

      {/* Popover — portaled to document.body so no ancestor overflow clips it */}
      {isOpen && createPortal(
        <div
          ref={popoverRef}
          style={{
            position: 'fixed',
            top:   popoverCoords.top,
            left:  popoverCoords.left,
            right: popoverCoords.right,
            width: '360px',
            maxHeight: 'min(780px, calc(100vh - 60px))',
            background: '#ffffff',
            borderRadius: '14px',
            boxShadow: '0 8px 32px rgba(29,37,103,0.18), 0 2px 8px rgba(0,0,0,0.08)',
            zIndex: 9999,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Header */}
          <div style={{
            background: '#1D2567', padding: '14px 18px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div>
              <div style={{ fontFamily: 'DM Sans', fontWeight: 700, fontSize: '14px', color: '#ffffff' }}>
                ASPIRE Status Legend
              </div>
              <div style={{ fontFamily: 'DM Sans', fontSize: '11px', color: 'rgba(255,255,255,0.65)', marginTop: '2px' }}>
                Track where each student is in the ASPIRE pathway.
              </div>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', fontSize: '16px', lineHeight: 1, padding: '2px' }}
            >×</button>
          </div>

          <div style={{ padding: '14px 18px', flex: 1, overflowY: 'auto' }}>
            {/* Lifecycle statuses */}
            <div style={{ fontFamily: 'DM Sans', fontWeight: 600, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#9ca3af', marginBottom: '10px' }}>
              Active Pathway Statuses
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '7px', marginBottom: '18px' }}>
              {LIFECYCLE_STATUSES.map((status, i) => (
                <div key={status.value} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                  <span style={{
                    background: status.bg, color: status.color,
                    fontFamily: 'DM Sans', fontWeight: 600, fontSize: '10px',
                    padding: '3px 9px', borderRadius: '20px',
                    whiteSpace: 'nowrap', flexShrink: 0,
                    minWidth: '120px', textAlign: 'center',
                  }}>
                    {status.label}
                  </span>
                  <span style={{ fontFamily: 'DM Sans', fontSize: '12px', color: '#4b5563', lineHeight: 1.5, paddingTop: '2px' }}>
                    {STATUS_DESCRIPTIONS[i]}
                  </span>
                </div>
              ))}
            </div>

            {/* Not Proceeding section */}
            <div style={{ borderTop: '1px solid #f3f4f6', marginBottom: '14px' }} />
            <div style={{ fontFamily: 'DM Sans', fontWeight: 600, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#9ca3af', marginBottom: '10px' }}>
              Not Proceeding
            </div>
            <div style={{ marginBottom: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', marginBottom: '10px' }}>
                <span style={{
                  background: '#fdf2f8', color: '#9d174d',
                  fontFamily: 'DM Sans', fontWeight: 600, fontSize: '10px',
                  padding: '3px 9px', borderRadius: '20px',
                  whiteSpace: 'nowrap', flexShrink: 0,
                  minWidth: '120px', textAlign: 'center',
                }}>
                  Not Proceeding
                </span>
                <span style={{ fontFamily: 'DM Sans', fontSize: '12px', color: '#4b5563', lineHeight: 1.5, paddingTop: '2px' }}>
                  Student received a formal disposition and is no longer moving forward. The specific disposition type displays in place of this status on cards and rows.
                </span>
              </div>
              <div style={{ paddingLeft: '6px' }}>
                <div style={{ fontFamily: 'DM Sans', fontSize: '10px', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>
                  Pre-placement
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginBottom: '10px' }}>
                  {PRE_PLACEMENT_DISPOSITIONS.map(type => {
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
                  {POST_PLACEMENT_DISPOSITIONS.map(type => {
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
            </div>

            {/* Divider */}
            <div style={{ borderTop: '1px solid #f3f4f6', marginBottom: '14px' }} />

            {/* Readiness colors */}
            <div style={{ fontFamily: 'DM Sans', fontWeight: 600, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#9ca3af', marginBottom: '10px' }}>
              Readiness Colors
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
              {READINESS_COLORS.map((item, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
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
