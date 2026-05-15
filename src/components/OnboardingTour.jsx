import { useState, useEffect } from 'react';
import { Joyride, STATUS } from 'react-joyride';
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
    spotlightShadow: '0 0 0 4px rgba(29, 37, 103, 0.25)',
  },
  tooltipContainer: {
    fontFamily: 'DM Sans, sans-serif',
    textAlign: 'left',
  },
  tooltip: {
    borderRadius: 12,
    padding: 20,
    maxWidth: 360,
  },
  tooltipTitle: {
    fontSize: 16,
    fontWeight: 700,
    marginBottom: 8,
  },
  tooltipContent: {
    fontSize: 13,
    lineHeight: 1.6,
    color: '#374151',
    padding: 0,
  },
  buttonNext: {
    background: '#1D2567',
    borderRadius: 8,
    fontFamily: 'DM Sans, sans-serif',
    fontWeight: 600,
    fontSize: 13,
  },
  buttonBack: {
    color: '#6B7280',
    fontFamily: 'DM Sans, sans-serif',
    fontWeight: 500,
    fontSize: 13,
  },
  buttonSkip: {
    color: '#9CA3AF',
    fontFamily: 'DM Sans, sans-serif',
    fontSize: 13,
  },
};

export default function OnboardingTour({ run, onClose }) {
  const { userProfile } = useAuth();
  const [steps, setSteps] = useState([]);
  const [showSkipModal, setShowSkipModal] = useState(false);

  useEffect(() => {
    if (userProfile) setSteps(getTourSteps(userProfile));
  }, [userProfile]);

  async function markCompleted() {
    if (!userProfile?.auth_user_id) return;
    await supabase
      .from('user_profiles')
      .update({
        onboarding_tour_completed:    true,
        onboarding_tour_completed_at: new Date().toISOString(),
        onboarding_tour_version:      TOUR_VERSION,
      })
      .eq('auth_user_id', userProfile.auth_user_id);
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

  function handleCallback(data) {
    const { status, action } = data;
    if (status === STATUS.FINISHED) {
      markCompleted();
      onClose();
    } else if (status === STATUS.SKIPPED || action === 'skip') {
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
      spotlightPadding={6}
      callback={handleCallback}
      styles={TOUR_STYLES}
      floaterProps={{
        disableAnimation: false,
        hideArrow: false,
        options: {
          preventOverflow: {
            enabled: true,
            boundariesElement: 'viewport',
          },
          flip: {
            enabled: true,
            boundariesElement: 'viewport',
          },
        },
      }}
      locale={{ back: 'Back', close: 'Close', last: 'Finish', next: 'Next →', skip: 'Skip tour' }}
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
