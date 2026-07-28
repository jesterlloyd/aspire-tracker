import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import {
  getTourSteps, TOUR_EXPERIENCES, parseTourAcks, serializeTourAcks, tourSnoozeKey,
} from '../lib/onboardingTours';

const NIGHTFALL = '#1D2567';
const OVERLAY   = 'rgba(20, 25, 40, 0.55)';
const TOOLTIP_WIDTH = 360;
const GAP = 14;

// WELCOME-TOUR-PORTALS-1: a step's target is "available" when it is 'body'
// (the only case that gets the centered treatment), or when the element it
// names exists AND is actually visible - getClientRects().length === 0 catches
// display:none (e.g. the responsive .ptl-nav-desktop-only / phone-only slots),
// and a zero-size rect catches the same thing by another route.
function isTargetAvailable(target) {
  if (target === 'body') return true;
  if (typeof document === 'undefined') return false;
  const el = document.querySelector(target);
  if (!el) return false;
  if (el.getClientRects().length === 0) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function isStepAvailable(step) {
  return Boolean(step) && isTargetAvailable(step.target);
}

export default function CustomOnboardingTour({ run, onClose, experience = 'staff', context = {} }) {
  const { userProfile, refreshUserProfile } = useAuth();
  const { apMessagesEnabled = false } = context || {};
  const [stepIndex,    setStepIndex]    = useState(0);
  const [tooltipSize,  setTooltipSize]  = useState({ width: TOOLTIP_WIDTH, height: 220 });
  const [showSkipModal, setShowSkipModal] = useState(false);
  // Bumped on resize/scroll so the target rect and availability are re-read;
  // the rect itself is computed straight from the DOM during render (see
  // targetRect below), not stored in state, so a step never renders one frame
  // behind its own measurement. The tick VALUE is a real dependency of the
  // availability memo and the re-settle effect below, so a rotation that hides
  // the current target recalculates the progress count and advances past the
  // hidden step on the same tick instead of waiting for an unrelated re-run.
  const [geometryTick, setGeometryTick] = useState(0);
  const tooltipRef = useRef(null);

  const steps = useMemo(
    () => (userProfile ? getTourSteps(experience, { userProfile, apMessagesEnabled }) : []),
    [experience, userProfile, apMessagesEnabled]
  );

  // Walk forward from `idx` until an available step is found, or return
  // steps.length if every remaining step is unavailable (the caller finishes).
  const settleForward = useCallback((idx) => {
    let i = idx;
    while (i < steps.length && !isStepAvailable(steps[i])) i += 1;
    return i;
  }, [steps]);

  // Walk backward from `idx` until an available step is found; clamps at 0
  // rather than going negative (the first step is always 'body', so it is
  // always available and this never actually needs the clamp in practice).
  const settleBackward = useCallback((idx) => {
    let i = idx;
    while (i >= 0 && !isStepAvailable(steps[i])) i -= 1;
    return i < 0 ? 0 : i;
  }, [steps]);

  const currentStep = steps[stepIndex];
  const isCentered  = !currentStep || currentStep.target === 'body';
  // Only 'body' steps get the centered treatment. A non-centered step is only
  // ever reached via settleForward/settleBackward, so by the time we render it
  // its target is expected to already be present and visible.
  const targetEl   = (!isCentered && currentStep) ? document.querySelector(currentStep.target) : null;
  const targetRect = targetEl ? targetEl.getBoundingClientRect() : null;

  // "n / N" counts only the steps that are CURRENTLY available, so a leader
  // with one unit (no switcher step) or a phone-width viewer (no desktop-only
  // sections) sees a true count rather than one inflated by steps they will
  // never see. ALL of the re-read signals are dependencies: run re-reads when
  // the tour actually starts (the memo first computes while the app shell is
  // still loading, before any nav target exists, so the welcome step would
  // otherwise open with a stale total), stepIndex re-reads on every normal
  // navigation, and geometryTick on resize/rotation while sitting on one step.
  const availableSteps = useMemo(() => steps.filter(isStepAvailable), [run, steps, stepIndex, geometryTick]); // eslint-disable-line react-hooks/exhaustive-deps
  const availablePosition = availableSteps.indexOf(currentStep);
  const progressCurrent = availablePosition >= 0 ? availablePosition + 1 : stepIndex + 1;
  const progressTotal = availableSteps.length || steps.length;
  const isLastStep = settleForward(stepIndex + 1) >= steps.length;

  // The component stays mounted between runs (run merely toggles), so a
  // restart from the profile menu or Settings > Tours & Help must rewind to
  // the first step explicitly; otherwise a finished tour would "restart" on
  // its final step, exactly where the previous run left stepIndex.
  useEffect(() => {
    if (run) { setStepIndex(0); setShowSkipModal(false); }
  }, [run]);

  useEffect(() => {
    if (!run) return;
    const handler = () => setGeometryTick(t => t + 1);
    window.addEventListener('resize', handler);
    window.addEventListener('scroll', handler, true);
    return () => {
      window.removeEventListener('resize', handler);
      window.removeEventListener('scroll', handler, true);
    };
  }, [run]);

  // Resize can flip a step's availability out from under the current index
  // (rotating a phone across the .ptl-nav-desktop-only breakpoint, for
  // example). Re-settle forward from the current position whenever that
  // happens, same rule as an explicit Next. geometryTick is a real dependency:
  // without it a rotation that hides the CURRENT target would leave the tour
  // rendering nothing until some unrelated state change re-ran this effect.
  useEffect(() => {
    if (!run || !currentStep) return;
    if (isStepAvailable(currentStep)) return;
    const settled = settleForward(stepIndex);
    if (settled >= steps.length) {
      markCompleted().finally(onClose);
    } else if (settled !== stepIndex) {
      setStepIndex(settled);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, stepIndex, steps, geometryTick]);

  // Measure rendered tooltip height so we can auto-flip placement
  useEffect(() => {
    if (tooltipRef.current) {
      const rect = tooltipRef.current.getBoundingClientRect();
      if (rect.height && rect.height !== tooltipSize.height) {
        setTooltipSize({ width: rect.width || TOOLTIP_WIDTH, height: rect.height });
      }
    }
  });

  // Focus the tooltip on every step change so a screen-reader user lands on
  // the new step instead of wherever focus happened to be.
  useEffect(() => {
    if (!run) return;
    tooltipRef.current?.focus();
  }, [run, stepIndex]);

  // ── Persistence ─────────────────────────────────────────────────────────────

  async function markCompleted() {
    if (!userProfile?.auth_user_id) {
      console.error('[Tour] No auth_user_id, cannot save completion');
      return;
    }
    // WELCOME-TOUR-PORTALS-1: merge this experience's acknowledgement into the
    // ledger rather than overwriting the whole column, so completing the
    // Student tour does not erase a Unit Leader (or staff) acknowledgement
    // already recorded for the same person.
    const acks = parseTourAcks(userProfile.onboarding_tour_version);
    acks[experience] = TOUR_EXPERIENCES[experience];
    const { error } = await supabase
      .from('user_profiles')
      .update({
        onboarding_tour_completed:    true,
        onboarding_tour_completed_at: new Date().toISOString(),
        onboarding_tour_version:      serializeTourAcks(acks),
      })
      .eq('auth_user_id', userProfile.auth_user_id);

    if (error) {
      console.error('[Tour] Save failed:', error);
      return;
    }
    if (typeof refreshUserProfile === 'function') await refreshUserProfile();
  }

  async function markDismissed(permanent) {
    if (!userProfile?.auth_user_id) return;
    if (permanent) {
      // WELCOME-TOUR-REFRESH-RESET / WELCOME-TOUR-PORTALS-1: "Don't show again"
      // is version-scoped per experience via the same merged ledger as
      // markCompleted, so dismissing the Unit Leader tour cannot suppress a
      // future staff (or student) tour bump for the same person.
      const acks = parseTourAcks(userProfile.onboarding_tour_version);
      acks[experience] = TOUR_EXPERIENCES[experience];
      const { error } = await supabase
        .from('user_profiles')
        .update({ onboarding_tour_dismissed: true, onboarding_tour_version: serializeTourAcks(acks) })
        .eq('auth_user_id', userProfile.auth_user_id);
      if (error) console.error('[Tour] Dismiss save failed:', error);
      if (typeof refreshUserProfile === 'function') await refreshUserProfile();
    } else {
      sessionStorage.setItem(tourSnoozeKey(experience), 'true');
      // Legacy plain key, staff only, so a build that still reads only that
      // key (or a snooze written by it) keeps working for staff.
      if (experience === 'staff') sessionStorage.setItem('onboarding_tour_snoozed', 'true');
    }
  }

  // ── Navigation ───────────────────────────────────────────────────────────────

  function handleNext() {
    const settled = settleForward(stepIndex + 1);
    if (settled >= steps.length) {
      markCompleted().finally(onClose);
    } else {
      setStepIndex(settled);
    }
  }

  function handleBack() {
    if (stepIndex <= 0) return;
    setStepIndex(settleBackward(stepIndex - 1));
  }

  // Keyboard: ArrowRight/Enter advances (Finish on the last available step),
  // ArrowLeft goes back, Escape opens the skip modal. Disabled while the skip
  // modal itself is open so its own buttons stay the only interaction. Tab is
  // left alone, the Back/Next/Skip buttons stay reachable in DOM order.
  // Enter on an INTERACTIVE element (a button, link, or form control) is left
  // to native activation: intercepting it too would advance twice (the native
  // click plus this shortcut), and pressing Enter on the focused Back or Skip
  // button must do what that button says, not act as a global Next.
  useEffect(() => {
    if (!run || showSkipModal) return undefined;
    const isInteractive = (el) =>
      Boolean(el && typeof el.closest === 'function'
        && el.closest('button, a[href], input, select, textarea, [role="button"]'));
    const onKeyDown = (e) => {
      if (e.key === 'Enter' && isInteractive(e.target)) return;
      if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); handleNext(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); handleBack(); }
      else if (e.key === 'Escape') { e.preventDefault(); setShowSkipModal(true); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, showSkipModal, stepIndex, steps]);

  if (!run || !currentStep) return null;

  // WELCOME-TOUR-PORTALS-1: the restart location differs by experience (staff
  // moved to Settings > Tours & Help under WS2.4; every portal keeps it in its
  // own profile menu), so the skip modal's own copy has to match rather than
  // repeat the old blanket "your user menu" claim.
  const restartHint = experience === 'staff' ? 'Settings > Tours & Help' : 'your profile menu';

  // A non-'body' step is only ever reached via settleForward/settleBackward (or
  // the resize-driven re-settle effect above), so targetRect is expected to be
  // non-null here. On the rare tick where it is not (the element vanished
  // between the settle check and this render, outside the tour's own control),
  // render nothing rather than ever falling back to a centered tooltip for a
  // missing target - the availability effect resolves it on the next tick.
  if (!isCentered && !targetRect) return null;

  // ── Tooltip positioning ──────────────────────────────────────────────────────

  let tooltipStyle;
  let arrowSide = null;

  if (isCentered) {
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
      {/* Spotlight overlay - 4 panels + ring. Centered ('body') steps get a
          plain full-screen overlay; every other step is guaranteed a real
          targetRect by this point, so there is no separate "target missing"
          rendering path left to maintain. */}
      {!isCentered && targetRect ? (
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
      <div
        ref={tooltipRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={currentStep.title}
        style={{
          ...tooltipStyle,
          background: '#fff',
          borderRadius: 12,
          padding: '22px 22px 18px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
          fontFamily: 'DM Sans, sans-serif',
          maxWidth: TOOLTIP_WIDTH,
          overflow: 'visible',
          outline: 'none',
        }}
      >
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
              {progressCurrent} / {progressTotal}
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
              You can always restart it from {restartHint}.
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
