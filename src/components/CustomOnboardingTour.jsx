import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { getTourSteps, TOUR_VERSION } from '../lib/onboardingTours';

const NIGHTFALL = '#1D2567';
const OVERLAY   = 'rgba(20, 25, 40, 0.55)';
const TOOLTIP_WIDTH = 360;
const GAP = 14;

export default function CustomOnboardingTour({ run, onClose }) {
  const { userProfile, refreshUserProfile } = useAuth();
  const [stepIndex,    setStepIndex]    = useState(0);
  const [targetRect,   setTargetRect]   = useState(null);
  const [tooltipSize,  setTooltipSize]  = useState({ width: TOOLTIP_WIDTH, height: 220 });
  const [showSkipModal, setShowSkipModal] = useState(false);
  const tooltipRef = useRef(null);

  const steps       = userProfile ? getTourSteps(userProfile) : [];
  const currentStep = steps[stepIndex];
  const isLastStep  = stepIndex === steps.length - 1;
  const isCentered  = !currentStep || currentStep.target === 'body';

  // Locate target element and store its bounding rect
  const updateTarget = useCallback(() => {
    if (!currentStep || isCentered) { setTargetRect(null); return; }
    const el = document.querySelector(currentStep.target);
    if (el) {
      setTargetRect(el.getBoundingClientRect());
    } else {
      console.warn('[Tour] Target not found:', currentStep.target);
      setTargetRect(null);
    }
  }, [currentStep, isCentered]);

  useEffect(() => {
    if (!run) return;
    updateTarget();
    const handler = () => updateTarget();
    window.addEventListener('resize', handler);
    window.addEventListener('scroll', handler, true);
    return () => {
      window.removeEventListener('resize', handler);
      window.removeEventListener('scroll', handler, true);
    };
  }, [run, updateTarget]);

  // Measure rendered tooltip height so we can auto-flip placement
  useEffect(() => {
    if (tooltipRef.current) {
      const rect = tooltipRef.current.getBoundingClientRect();
      if (rect.height && rect.height !== tooltipSize.height) {
        setTooltipSize({ width: rect.width || TOOLTIP_WIDTH, height: rect.height });
      }
    }
  });

  // ── Persistence ─────────────────────────────────────────────────────────────

  async function markCompleted() {
    console.log('[Tour] markCompleted firing');
    if (!userProfile?.auth_user_id) {
      console.error('[Tour] No auth_user_id, cannot save');
      return;
    }
    const { data, error } = await supabase
      .from('user_profiles')
      .update({
        onboarding_tour_completed:    true,
        onboarding_tour_completed_at: new Date().toISOString(),
        onboarding_tour_version:      TOUR_VERSION,
      })
      .eq('auth_user_id', userProfile.auth_user_id)
      .select();

    if (error) {
      console.error('[Tour] Save failed:', error);
      alert('Could not save tour completion. See console.');
      return;
    }
    console.log('[Tour] Save succeeded:', data);
    if (typeof refreshUserProfile === 'function') await refreshUserProfile();
  }

  async function markDismissed(permanent) {
    if (!userProfile?.auth_user_id) return;
    if (permanent) {
      // WELCOME-TOUR-REFRESH-RESET: stamp the version so "Don't show again" is version-scoped -
      // a user who dismissed v1 still sees v2 once; dismissing v2 suppresses only v2.
      await supabase
        .from('user_profiles')
        .update({ onboarding_tour_dismissed: true, onboarding_tour_version: TOUR_VERSION })
        .eq('auth_user_id', userProfile.auth_user_id);
      if (typeof refreshUserProfile === 'function') await refreshUserProfile();
    } else {
      sessionStorage.setItem('onboarding_tour_snoozed', 'true');
    }
  }

  // ── Navigation ───────────────────────────────────────────────────────────────

  function handleNext() {
    if (isLastStep) {
      markCompleted().finally(onClose);
    } else {
      setStepIndex(i => i + 1);
    }
  }

  function handleBack() {
    if (stepIndex > 0) setStepIndex(i => i - 1);
  }

  if (!run || !currentStep) return null;

  // ── Tooltip positioning ──────────────────────────────────────────────────────

  let tooltipStyle;
  let arrowSide = null;

  if (isCentered || !targetRect) {
    tooltipStyle = {
      position: 'fixed',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      zIndex: 999999,
    };
  } else {
    const spaceBelow = window.innerHeight - targetRect.bottom;
    const spaceAbove = targetRect.top;
    const placeBelow = spaceBelow >= tooltipSize.height + GAP + 20 || spaceBelow >= spaceAbove;

    let top, left;
    if (placeBelow) {
      top  = targetRect.bottom + GAP;
      arrowSide = 'top';
    } else {
      top  = targetRect.top - tooltipSize.height - GAP;
      arrowSide = 'bottom';
    }

    left = targetRect.left + targetRect.width / 2 - tooltipSize.width / 2;
    if (left < 16) left = 16;
    if (left + tooltipSize.width > window.innerWidth - 16) {
      left = window.innerWidth - tooltipSize.width - 16;
    }

    tooltipStyle = { position: 'fixed', top, left, width: tooltipSize.width, zIndex: 999999 };
  }

  // Arrow offset relative to tooltip left edge
  const arrowLeft = targetRect
    ? Math.max(20, Math.min(
        targetRect.left + targetRect.width / 2 - (tooltipStyle.left ?? 0) - 8,
        tooltipSize.width - 32
      ))
    : tooltipSize.width / 2 - 8;

  // ── Render ───────────────────────────────────────────────────────────────────

  return createPortal(
    <>
      {/* Spotlight overlay - 4 panels + ring */}
      {targetRect ? (
        <>
          <div style={{ position:'fixed', inset:'0 0 auto 0', height: Math.max(0, targetRect.top - 4),          background: OVERLAY, zIndex: 999990 }} />
          <div style={{ position:'fixed', inset:'auto 0 0 0', top: targetRect.bottom + 4,                        background: OVERLAY, zIndex: 999990 }} />
          <div style={{ position:'fixed', top: targetRect.top - 4, left: 0, width: Math.max(0, targetRect.left - 4), height: targetRect.height + 8, background: OVERLAY, zIndex: 999990 }} />
          <div style={{ position:'fixed', top: targetRect.top - 4, left: targetRect.right + 4, right: 0,          height: targetRect.height + 8, background: OVERLAY, zIndex: 999990 }} />
          <div style={{
            position: 'fixed',
            top:    targetRect.top  - 4,
            left:   targetRect.left - 4,
            width:  targetRect.width  + 8,
            height: targetRect.height + 8,
            border: '2px solid rgba(255,255,255,0.9)',
            borderRadius: 8,
            boxShadow: '0 0 0 4px rgba(29,37,103,0.45)',
            pointerEvents: 'none',
            zIndex: 999991,
          }} />
        </>
      ) : (
        <div style={{ position: 'fixed', inset: 0, background: OVERLAY, zIndex: 999990 }} />
      )}

      {/* Tooltip */}
      <div ref={tooltipRef} style={{
        ...tooltipStyle,
        background: '#fff',
        borderRadius: 12,
        padding: '22px 22px 18px',
        boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        fontFamily: 'DM Sans, sans-serif',
        maxWidth: TOOLTIP_WIDTH,
        overflow: 'visible',
      }}>
        {/* Arrow */}
        {arrowSide && targetRect && (
          <div style={{
            position: 'absolute',
            ...(arrowSide === 'top' ? { top: -7 } : { bottom: -7 }),
            left: arrowLeft,
            width: 14,
            height: 14,
            background: '#fff',
            transform: 'rotate(45deg)',
            boxShadow: arrowSide === 'top'
              ? '-2px -2px 4px rgba(0,0,0,0.06)'
              : '2px 2px 4px rgba(0,0,0,0.06)',
          }} />
        )}

        <div style={{ fontSize: 16, fontWeight: 700, color: NIGHTFALL, marginBottom: 10, lineHeight: 1.3 }}>
          {currentStep.title}
        </div>
        <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.6, marginBottom: 18 }}>
          {currentStep.content}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button onClick={() => setShowSkipModal(true)} style={btnText}>Skip tour</button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: '#9CA3AF', marginRight: 4 }}>
              {stepIndex + 1} / {steps.length}
            </span>
            {stepIndex > 0 && (
              <button onClick={handleBack} style={btnSecondary}>Back</button>
            )}
            <button onClick={handleNext} style={btnPrimary}>
              {isLastStep ? 'Finish' : 'Next'}
            </button>
          </div>
        </div>
      </div>

      {/* Skip / dismiss modal */}
      {showSkipModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000000, background: 'rgba(20,25,40,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 28, maxWidth: 420, width: '90%', fontFamily: 'DM Sans, sans-serif', textAlign: 'center', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: NIGHTFALL, marginBottom: 10 }}>Skip the tour?</div>
            <div style={{ fontSize: 13, color: '#374151', marginBottom: 20, lineHeight: 1.5 }}>
              You can always restart it from your user menu.
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button style={btnSecondary} onClick={async () => { await markDismissed(false); setShowSkipModal(false); onClose(); }}>
                Remind me next time
              </button>
              <button style={btnPrimary} onClick={async () => { await markDismissed(true); setShowSkipModal(false); onClose(); }}>
                Don't show again
              </button>
            </div>
          </div>
        </div>
      )}
    </>,
    document.body
  );
}

const btnPrimary = {
  background: NIGHTFALL, color: '#fff', border: 'none',
  borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600,
  fontFamily: 'DM Sans, sans-serif', cursor: 'pointer',
};
const btnSecondary = {
  background: '#F3F4F6', color: '#374151', border: '1px solid #E5E7EB',
  borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 500,
  fontFamily: 'DM Sans, sans-serif', cursor: 'pointer',
};
const btnText = {
  background: 'transparent', color: '#9CA3AF', border: 'none',
  fontSize: 13, fontFamily: 'DM Sans, sans-serif', cursor: 'pointer', padding: 4,
};
