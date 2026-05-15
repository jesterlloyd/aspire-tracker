import { useState, useEffect } from 'react';
import { Joyride, EVENTS, STATUS, ACTIONS } from 'react-joyride';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { getTourSteps, TOUR_VERSION } from '../lib/onboardingTours';

const TOUR_STYLES = {
  options: {
    primaryColor: '#1D2567',
    textColor: '#1D2567',
    backgroundColor: '#ffffff',
    overlayColor: 'rgba(20, 25, 40, 0.55)',
    arrowColor: '#ffffff',
    zIndex: 100000,
    spotlightShadow: '0 0 0 4px rgba(29, 37, 103, 0.35)',
  },
  tooltipContainer: {
    fontFamily: 'DM Sans, sans-serif',
    textAlign: 'left',
  },
  tooltip: {
    borderRadius: 12,
    padding: '24px 24px 20px 24px',
    maxWidth: 380,
    boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
    overflow: 'visible',
  },
  tooltipTitle: {
    fontSize: 16,
    fontWeight: 700,
    color: '#1D2567',
    marginBottom: 10,
    marginTop: 0,
    lineHeight: 1.3,
    display: 'block',
  },
  tooltipContent: {
    fontSize: 13,
    lineHeight: 1.6,
    color: '#374151',
    padding: 0,
    margin: 0,
  },
  tooltipFooter: {
    marginTop: 16,
  },
  buttonNext: {
    background: '#1D2567',
    borderRadius: 8,
    fontFamily: 'DM Sans, sans-serif',
    fontWeight: 600,
    fontSize: 13,
    padding: '8px 14px',
  },
  buttonBack: {
    color: '#6B7280',
    fontFamily: 'DM Sans, sans-serif',
    fontWeight: 500,
    fontSize: 13,
    marginRight: 8,
  },
  buttonSkip: {
    color: '#9CA3AF',
    fontFamily: 'DM Sans, sans-serif',
    fontSize: 13,
  },
};

export default function OnboardingTour({ run, onClose }) {
  const { userProfile, refreshUserProfile } = useAuth();
  const [steps, setSteps] = useState([]);
  const [showSkipModal, setShowSkipModal] = useState(false);

  useEffect(() => {
    if (userProfile) setSteps(getTourSteps(userProfile));
  }, [userProfile]);

  async function markCompleted() {
    if (!userProfile) {
      console.warn('[Tour] markCompleted called but no userProfile');
      return;
    }
    console.log('[Tour] markCompleted firing for', userProfile.auth_user_id);

    const { data, error } = await supabase
      .from('user_profiles')
      .update({
        onboarding_tour_completed:    true,
        onboarding_tour_completed_at: new Date().toISOString(),
        onboarding_tour_version:      TOUR_VERSION,
      })
      .eq('auth_user_id', userProfile.auth_user_id)
      .select();

    if (error) { console.error('[Tour] UPDATE failed:', error); return; }
    console.log('[Tour] UPDATE returned:', data);

    if (typeof refreshUserProfile === 'function') await refreshUserProfile();
  }

  async function markDismissed(permanent) {
    if (!userProfile?.auth_user_id) return;
    if (permanent) {
      await supabase
        .from('user_profiles')
        .update({ onboarding_tour_dismissed: true })
        .eq('auth_user_id', userProfile.auth_user_id);
    } else {
      sessionStorage.setItem('onboarding_tour_snoozed', 'true');
    }
  }

  async function handleCallback(data) {
    const { status, type, action, index } = data;
    console.log('[Tour callback]', { status, type, action, index });

    // Final step: user clicked Next/Finish on the last step
    if (
      action === ACTIONS.NEXT &&
      index === steps.length - 1 &&
      type === EVENTS.STEP_AFTER
    ) {
      await markCompleted();
      onClose();
      return;
    }

    // Joyride also emits STATUS.FINISHED after the last step completes
    if (status === STATUS.FINISHED) {
      await markCompleted();
      onClose();
      return;
    }

    // User explicitly skipped
    if (status === STATUS.SKIPPED || action === ACTIONS.SKIP) {
      setShowSkipModal(true);
      return;
    }

    // Any other close action (X button)
    if (type === EVENTS.TOOLTIP_CLOSE || action === ACTIONS.CLOSE) {
      setShowSkipModal(true);
    }
  }

  if (showSkipModal) {
    return (
      <SkipChoiceModal
        onSnooze={() => { markDismissed(false); setShowSkipModal(false); onClose(); }}
        onDismiss={() => { markDismissed(true);  setShowSkipModal(false); onClose(); }}
      />
    );
  }

  if (!run || steps.length === 0) return null;

  return (
    <Joyride
      steps={steps}
      run={run}
      continuous
      showProgress
      showSkipButton
      disableScrolling={false}
      scrollToFirstStep
      spotlightPadding={8}
      spotlightClicks={false}
      disableOverlayClose
      hideCloseButton={false}
      callback={handleCallback}
      styles={TOUR_STYLES}
      floaterProps={{
        disableAnimation: false,
        hideArrow: false,
        options: {
          preventOverflow: {
            enabled: true,
            boundariesElement: 'viewport',
            padding: 16,
          },
          flip: {
            enabled: true,
            boundariesElement: 'viewport',
          },
          offset: {
            offset: '0, 12',
          },
        },
      }}
      locale={{ back: 'Back', close: 'Close', last: 'Finish', next: 'Next', skip: 'Skip' }}
    />
  );
}

function SkipChoiceModal({ onSnooze, onDismiss }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 10001,
      background: 'rgba(20, 25, 40, 0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: '#fff', borderRadius: 12, padding: 28, maxWidth: 420, width: '90%',
        fontFamily: 'DM Sans, sans-serif', textAlign: 'center',
        boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
      }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: '#1D2567', marginBottom: 10 }}>
          Skip the tour?
        </div>
        <div style={{ fontSize: 13, color: '#374151', marginBottom: 20, lineHeight: 1.6 }}>
          You can always restart it later from your user menu.
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          <button onClick={onSnooze}
            style={{ background: '#F3F4F6', color: '#374151', border: '1px solid #E5E7EB', borderRadius: 8, padding: '10px 16px', fontWeight: 500, fontSize: 13, cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}>
            Remind me next time
          </button>
          <button onClick={onDismiss}
            style={{ background: '#1D2567', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 16px', fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}>
            Don't show again
          </button>
        </div>
      </div>
    </div>
  );
}
