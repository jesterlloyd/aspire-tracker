// ASPIRE-PUBLIC-SITE-REDESIGN: login restyled into the public site's visual
// system (cream, navy, DM Sans; prominent Cedars-Sinai identity via
// cs-logo-large.png; approved vector illustration on desktop). AUTH BEHAVIOR
// IS UNCHANGED: the sign-in, reset, error, and loading logic below is the
// exact pre-redesign code; only the markup and styling around it moved.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { appUrl } from '../lib/appUrl';
import './login.css';

export default function Login() {
  const [email, setEmail]           = useState('');
  const [password, setPassword]     = useState('');
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');
  const [showForgot, setShowForgot] = useState(false);
  const [resetSent, setResetSent]   = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError('Invalid email or password. Please try again.');
    setLoading(false);
  };

  const handleReset = async (e) => {
    e.preventDefault();
    setLoading(true);
    // ASPIRE-DOMAIN-CANONICAL-1: canonical self-service reset redirect.
    // aspireintelligence.app is in the Supabase Auth URL allow-list, so this
    // redirectTo is accepted; the legacy vercel.app domain remains allow-listed.
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: appUrl('/auth/reset-password'),
    });
    setResetSent(true);
    setLoading(false);
  };

  return (
    <div className="lg-page">
      <div className="lg-top">
        <Link to="/" className="lg-back">
          <span aria-hidden="true">←</span> Back to the ASPIRE site
        </Link>
      </div>

      <div className="lg-center">
        <div className="lg-shell">

          {/* Brand panel */}
          <div className="lg-brand">
            <img src="/cs-logo-large.png" alt="Cedars-Sinai" className="lg-logo" />
            <div className="lg-wordmark">
              <span className="lg-wordmark-name">ASPIRE Intelligence</span>
              <span className="lg-wordmark-sub">Portal</span>
            </div>
            <p className="lg-brand-blurb">
              One sign-in for everyone connected to ASPIRE: students in the
              pathway, unit leaders, academic partners, and the Cedars-Sinai
              team.
            </p>
            <p className="lg-brand-inst">Geri and Richard Brawerman Nursing Institute</p>
            <div className="lg-brand-art">
              <img src="/public-site/illustrations/login-panel.jpg" alt=""
                loading="lazy" decoding="async" />
            </div>
          </div>

          {/* Form panel (logic unchanged) */}
          <div className="lg-form-panel">
            {!showForgot ? (
              <>
                <h1 className="lg-form-title">Sign in</h1>
                <p className="lg-form-sub">
                  Use the account the ASPIRE team invited you with.
                </p>

                {error && <div className="lg-error">{error}</div>}

                <form onSubmit={handleLogin} className="lg-form">
                  <div>
                    <label className="lg-label" htmlFor="lg-email">Email address</label>
                    <input id="lg-email" className="lg-input" type="email" value={email}
                      onChange={e => setEmail(e.target.value)}
                      required placeholder="your@cshs.org" autoComplete="email" />
                  </div>
                  <div>
                    <label className="lg-label" htmlFor="lg-password">Password</label>
                    <input id="lg-password" className="lg-input" type="password" value={password}
                      onChange={e => setPassword(e.target.value)}
                      required placeholder="••••••••" autoComplete="current-password" />
                  </div>
                  <button type="submit" disabled={loading} className="lg-submit">
                    {loading ? 'Signing in...' : 'Sign In'}
                  </button>
                </form>

                <div className="lg-form-links">
                  <button onClick={() => setShowForgot(true)} className="lg-linkbtn">
                    Forgot your password?
                  </button>
                </div>
              </>
            ) : resetSent ? (
              <div className="lg-reset-done">
                <div className="lg-reset-done-icon" aria-hidden="true">📬</div>
                <h2>Check your email</h2>
                <p>We sent a reset link to {email}.</p>
                <div className="lg-form-links">
                  <button onClick={() => { setShowForgot(false); setResetSent(false); }}
                    className="lg-linkbtn lg-linkbtn-strong">
                    ← Back to sign in
                  </button>
                </div>
              </div>
            ) : (
              <>
                <h1 className="lg-form-title">Reset your password</h1>
                <p className="lg-form-sub">
                  Enter your email and we will send you a reset link.
                </p>
                <form onSubmit={handleReset} className="lg-form">
                  <div>
                    <label className="lg-label" htmlFor="lg-reset-email">Email address</label>
                    <input id="lg-reset-email" className="lg-input" type="email" value={email}
                      onChange={e => setEmail(e.target.value)}
                      required placeholder="your@cshs.org" autoComplete="email" />
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

            <div className="lg-invite">
              Access is available to invited ASPIRE participants and partners.
              <br />For account assistance, contact{' '}
              <a href="mailto:aspire@cshs.org" className="lg-invite-link">aspire@cshs.org</a>.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
