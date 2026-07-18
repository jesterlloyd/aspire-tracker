// ASPIRE-COMPASS: login refinements over the public-site restyle. AUTH
// BEHAVIOR IS UNCHANGED: signInWithPassword and resetPasswordForEmail are
// called exactly as before. What changed is presentation only: a
// show-password control, safe error differentiation (network and rate-limit
// failures get honest copy; credential failures stay one non-enumerating
// message), approved email guidance, and Fraunces on the display headings.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Eye, EyeOff, MailCheck } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { appUrl } from '../lib/appUrl';
import '../styles/aspireBrand.css';
import './login.css';

// Safe error mapping. NEVER distinguishes an unknown email from a wrong
// password: every credential-shaped failure collapses to one message. Only
// transport and throttling failures, which reveal nothing about any account,
// get their own copy.
function mapSignInError(error) {
  const msg = String(error?.message || '').toLowerCase();
  const status = error?.status;
  if (status === 429 || msg.includes('rate limit') || msg.includes('too many')) {
    return 'Too many sign-in attempts. Please wait a minute and try again.';
  }
  if (msg.includes('fetch') || msg.includes('network') || status === 0) {
    return 'We could not reach the sign-in service. Check your connection and try again.';
  }
  return 'Invalid email or password. Please try again.';
}

export default function Login() {
  const [email, setEmail]           = useState('');
  const [password, setPassword]     = useState('');
  const [showPw, setShowPw]         = useState(false);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');
  const [showForgot, setShowForgot] = useState(false);
  const [resetSent, setResetSent]   = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(mapSignInError(error));
    setLoading(false);
  };

  const handleReset = async (e) => {
    e.preventDefault();
    setLoading(true);
    // ASPIRE-DOMAIN-CANONICAL-1: canonical self-service reset redirect.
    // aspireintelligence.app is in the Supabase Auth URL allow-list, so this
    // redirectTo is accepted; the legacy vercel.app domain remains allow-listed.
    // The confirmation is always shown (never revealing whether the address
    // exists); only a transport failure surfaces separately.
    try {
      await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: appUrl('/auth/reset-password'),
      });
      setResetSent(true);
    } catch {
      setError('We could not reach the reset service. Check your connection and try again.');
    }
    setLoading(false);
  };

  return (
    <div className="lg-page">
      <div className="lg-top">
        <Link to="/" className="lg-back">
          <span aria-hidden="true">←</span> Public site
        </Link>
      </div>

      <div className="lg-center">
        <div className="lg-shell">

          {/* Brand panel: Cedars-Sinai (parent org) at the top, then the ASPIRE
              Intelligence title + Portal badge, supporting copy, the human hero
              illustration, and the institute attribution below it. The logo and
              institute name are deliberately NOT grouped together. */}
          <div className="lg-brand">
            <img src="/cs-logo-large.png" alt="Cedars-Sinai" className="lg-logo" />
            <div className="lg-brand-identity">
              <h1 className="lg-brand-name">ASPIRE Intelligence</h1>
              <span className="lg-brand-badge">Portal</span>
            </div>
            <p className="lg-brand-blurb">
              One secure sign-in for invited ASPIRE students, preceptors, unit
              leaders, academic partners, and Cedars-Sinai staff.
            </p>
            <div className="lg-brand-art" aria-hidden="true">
              <img src="/public-site/illustrations/hero.png" alt=""
                loading="lazy" decoding="async" />
            </div>
            <p className="lg-brand-inst">Geri &amp; Richard Brawerman Nursing Institute</p>
          </div>

          {/* Form panel (logic unchanged) */}
          <div className="lg-form-panel">
            {!showForgot ? (
              <>
                <h2 className="lg-form-title">Sign in</h2>
                <p className="lg-form-sub">
                  Use the email address on your ASPIRE account. During your rotation this
                  is usually your school email; after completion, use the personal email
                  on your profile.
                </p>

                {error && <div className="lg-error" role="alert">{error}</div>}

                <form onSubmit={handleLogin} className="lg-form">
                  <div>
                    <label className="lg-label" htmlFor="lg-email">Email address</label>
                    <input id="lg-email" className="lg-input" type="email" value={email}
                      onChange={e => setEmail(e.target.value)}
                      required placeholder="your@email.com" autoComplete="email"
                      inputMode="email" autoCapitalize="none" spellCheck="false" />
                  </div>
                  <div>
                    <label className="lg-label" htmlFor="lg-password">Password</label>
                    <div className="lg-pw-wrap">
                      <input id="lg-password" className="lg-input lg-input-pw"
                        type={showPw ? 'text' : 'password'} value={password}
                        onChange={e => setPassword(e.target.value)}
                        required placeholder="Enter your password" autoComplete="current-password" />
                      <button type="button" className="lg-pw-toggle"
                        onClick={() => setShowPw(v => !v)}
                        aria-label={showPw ? 'Hide password' : 'Show password'}
                        aria-pressed={showPw}>
                        {showPw ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
                      </button>
                    </div>
                  </div>
                  <button type="submit" disabled={loading} className="lg-submit">
                    {loading ? <span className="lg-submit-busy"><span className="lg-spinner" aria-hidden="true" /> Signing in...</span> : 'Sign in'}
                  </button>
                </form>

                <div className="lg-form-links">
                  <button onClick={() => setShowForgot(true)} className="lg-linkbtn">
                    Forgot your password?
                  </button>
                </div>
              </>
            ) : resetSent ? (
              <div className="lg-reset-done" role="status">
                <div className="lg-reset-done-icon" aria-hidden="true"><MailCheck size={34} /></div>
                <h2>Check your email</h2>
                <p>If an ASPIRE account uses {email}, a reset link is on its way.</p>
                <div className="lg-form-links">
                  <button onClick={() => { setShowForgot(false); setResetSent(false); }}
                    className="lg-linkbtn lg-linkbtn-strong">
                    ← Back to sign in
                  </button>
                </div>
              </div>
            ) : (
              <>
                <h2 className="lg-form-title">Reset your password</h2>
                <p className="lg-form-sub">
                  Enter your email and we will send you a reset link.
                </p>
                <form onSubmit={handleReset} className="lg-form">
                  <div>
                    <label className="lg-label" htmlFor="lg-reset-email">Email address</label>
                    <input id="lg-reset-email" className="lg-input" type="email" value={email}
                      onChange={e => setEmail(e.target.value)}
                      required placeholder="your@email.com" autoComplete="email" />
                  </div>
                  <button type="submit" disabled={loading} className="lg-submit">
                    {loading ? 'Sending...' : 'Send Reset Link'}
                  </button>
                </form>
                <div className="lg-form-links">
                  <button onClick={() => setShowForgot(false)} className="lg-linkbtn">
                    ← Back to sign in
                  </button>
                </div>
              </>
            )}

            <div className="lg-access">
              <p className="lg-access-note">Access is limited to invited ASPIRE participants, partners, and staff.</p>
              <p className="lg-access-help">
                Need account assistance? Contact{' '}
                <a href="mailto:aspire@cshs.org" className="lg-invite-link">aspire@cshs.org</a>.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
