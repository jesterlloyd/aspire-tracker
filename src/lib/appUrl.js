// src/lib/appUrl.js
//
// ASPIRE-DOMAIN-CANONICAL-1 - single source of truth for the app's canonical
// public URL. Automated emails and public form links must point at the primary
// domain (aspireintelligence.app), NOT the legacy Vercel deployment URL
// (aspire-tracker.vercel.app), which now serves only as a deployment/redirect
// fallback and is not used to build user-facing links.
//
// This module is imported by BOTH the client bundle and server code (api/,
// lib/server), so it stays environment-agnostic: a plain constant with no
// import.meta or process.env read. Server code that needs an env override or a
// request-aware base (Vercel preview deployments) uses lib/server/appUrl.js,
// which builds on this constant.

// Canonical public origin. No trailing slash.
export const CANONICAL_APP_URL = 'https://aspireintelligence.app';

// Legacy Vercel deployment origin - retained only as a documented fallback /
// redirect target. Never used to build user-facing links.
export const LEGACY_APP_URL = 'https://aspire-tracker.vercel.app';

// Join a path onto the canonical base without producing double slashes.
//   appUrl()                 -> 'https://aspireintelligence.app'
//   appUrl('/student-form')  -> 'https://aspireintelligence.app/student-form'
//   appUrl('student-form')   -> 'https://aspireintelligence.app/student-form'
export function appUrl(path = '') {
  const base = CANONICAL_APP_URL.replace(/\/+$/, '');
  const suffix = String(path || '').replace(/^\/+/, '');
  return suffix ? `${base}/${suffix}` : base;
}
