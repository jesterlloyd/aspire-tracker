import React, { useState } from 'react';
import { supabase } from '../lib/supabase';

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
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: 'https://aspire-tracker.vercel.app/auth/reset-password',
    });
    setResetSent(true);
    setLoading(false);
  };

  const inputStyle = {
    width: '100%', padding: '11px 14px',
    border: '1px solid #e5e7eb', borderRadius: '10px',
    fontSize: '14px', color: '#374151', outline: 'none',
    boxSizing: 'border-box', fontFamily: 'DM Sans, sans-serif',
  };

  return (
    <div style={{
      minHeight: '100vh', background: '#F4F1EC',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '24px', fontFamily: 'DM Sans, sans-serif',
    }}>
      <div style={{
        width: '100%', maxWidth: '400px', background: '#ffffff',
        borderRadius: '20px', overflow: 'hidden',
        boxShadow: '0 8px 40px rgba(29,37,103,0.16)',
      }}>

        {/* Header */}
        <div style={{
          background: 'linear-gradient(180deg, #1c2452 0%, #141928 100%)',
          padding: '28px 32px 24px', textAlign: 'center',
        }}>
          <img src="/cs-logo-rev.png" alt="Cedars-Sinai"
            style={{ height: '28px', width: 'auto', marginBottom: '14px' }} />
          <div style={{ fontWeight: 700, fontSize: '20px', color: '#ffffff', marginBottom: '4px' }}>
            ASPIRE Intelligence
          </div>
          <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)' }}>
            Geri and Richard Brawerman Nursing Institute
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '32px' }}>
          {!showForgot ? (
            <>
              <div style={{ fontWeight: 600, fontSize: '15px', color: '#1D2567', marginBottom: '20px', textAlign: 'center' }}>
                Sign in to your account
              </div>

              {error && (
                <div style={{
                  background: '#fff1f2', border: '1px solid #fca5a5',
                  borderRadius: '8px', padding: '10px 14px',
                  fontSize: '13px', color: '#991b1b', marginBottom: '16px',
                }}>
                  {error}
                </div>
              )}

              <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div>
                  <label style={{ fontWeight: 600, fontSize: '12px', color: '#374151', display: 'block', marginBottom: '6px' }}>
                    Email address
                  </label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                    required placeholder="your@cshs.org" style={inputStyle}
                    onFocus={e => e.target.style.borderColor = '#1D2567'}
                    onBlur={e => e.target.style.borderColor = '#e5e7eb'}
                  />
                </div>

                <div>
                  <label style={{ fontWeight: 600, fontSize: '12px', color: '#374151', display: 'block', marginBottom: '6px' }}>
                    Password
                  </label>
                  <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                    required placeholder="••••••••" style={inputStyle}
                    onFocus={e => e.target.style.borderColor = '#1D2567'}
                    onBlur={e => e.target.style.borderColor = '#e5e7eb'}
                  />
                </div>

                <button type="submit" disabled={loading} style={{
                  width: '100%', padding: '13px',
                  background: loading ? '#e5e7eb' : '#1D2567',
                  border: 'none', borderRadius: '10px',
                  fontWeight: 700, fontSize: '14px', color: '#ffffff',
                  cursor: loading ? 'default' : 'pointer', marginTop: '4px',
                  fontFamily: 'DM Sans, sans-serif',
                }}>
                  {loading ? 'Signing in...' : 'Sign In'}
                </button>
              </form>

              <div style={{ textAlign: 'center', marginTop: '16px' }}>
                <button onClick={() => setShowForgot(true)} style={{
                  background: 'none', border: 'none', fontSize: '12px',
                  color: '#6b7280', cursor: 'pointer', textDecoration: 'underline',
                  fontFamily: 'DM Sans, sans-serif',
                }}>
                  Forgot your password?
                </button>
              </div>
            </>
          ) : resetSent ? (
            <div style={{ textAlign: 'center', padding: '16px 0' }}>
              <div style={{ fontSize: '36px', marginBottom: '12px' }}>📬</div>
              <div style={{ fontWeight: 700, fontSize: '15px', color: '#1D2567', marginBottom: '8px' }}>
                Check your email
              </div>
              <div style={{ fontSize: '13px', color: '#6b7280', lineHeight: 1.6 }}>
                We sent a reset link to {email}.
              </div>
              <button onClick={() => { setShowForgot(false); setResetSent(false); }} style={{
                marginTop: '20px', background: 'none', border: 'none',
                fontSize: '13px', color: '#1D2567', cursor: 'pointer', fontWeight: 600,
                fontFamily: 'DM Sans, sans-serif',
              }}>
                ← Back to sign in
              </button>
            </div>
          ) : (
            <>
              <div style={{ fontWeight: 700, fontSize: '15px', color: '#1D2567', marginBottom: '8px' }}>
                Reset your password
              </div>
              <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '20px', lineHeight: 1.6 }}>
                Enter your email and we will send you a reset link.
              </div>
              <form onSubmit={handleReset} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                  required placeholder="your@cshs.org" style={inputStyle}
                />
                <button type="submit" disabled={loading} style={{
                  width: '100%', padding: '13px', background: '#1D2567',
                  border: 'none', borderRadius: '10px', fontWeight: 700,
                  fontSize: '14px', color: '#ffffff', cursor: 'pointer',
                  fontFamily: 'DM Sans, sans-serif',
                }}>
                  {loading ? 'Sending...' : 'Send Reset Link'}
                </button>
              </form>
              <div style={{ textAlign: 'center', marginTop: '16px' }}>
                <button onClick={() => setShowForgot(false)} style={{
                  background: 'none', border: 'none', fontSize: '12px',
                  color: '#6b7280', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif',
                }}>
                  ← Back to sign in
                </button>
              </div>
            </>
          )}
        </div>

        <div style={{ padding: '0 32px 20px', textAlign: 'center', fontSize: '11px', color: '#9ca3af' }}>
          Access is by invitation only.
          <br />Contact JesterLloyd.Bautista@cshs.org for access.
        </div>
      </div>
    </div>
  );
}
