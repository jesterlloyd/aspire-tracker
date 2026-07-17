// lib/server/appUrl.js
//
// ASPIRE-DOMAIN-CANONICAL-1 - server-side base-URL resolution for outbound
// automated emails and public form links. Builds on the shared canonical
// constant (src/lib/appUrl.js) and adds two server-only concerns:
//   1. an env override (APP_BASE_URL / VITE_APP_URL) for staging control, and
//   2. request-aware resolution for NON-production deployments. Vercel preview
//      deployments must use their own forwarded host so that preview-token
//      links validate against the preview database (a preview token cannot
//      validate against production), and local dev keeps its localhost origin.
//      PRODUCTION always uses the canonical domain - that is the whole point of
//      this task: automated emails must link to aspireintelligence.app.

/* global process */
// `process` is the Node/Vercel serverless runtime global. The repo's flat ESLint
// config registers browser globals only, so server files reference `process`
// without a declared global; this file-scoped directive keeps THIS new module
// lint-clean without touching the shared eslint.config.js.

import { CANONICAL_APP_URL } from '../../src/lib/appUrl.js';

// `process` only exists in the Node/Vercel runtime. This module also gets
// pulled into the browser import graph (email preview shells rendered in the
// staff app call appUrl() at module scope), where a bare `process.env` read is
// a fatal ReferenceError in Vite dev. The guard keeps server behavior
// identical and lets the browser fall through to the canonical constant.
function env() {
  return (typeof process !== 'undefined' && process.env) ? process.env : {};
}

// Canonical base, honoring an explicit env override when one is configured.
// No trailing slash.
export function appBaseUrl() {
  const override = env().APP_BASE_URL || env().VITE_APP_URL;
  return (override || CANONICAL_APP_URL).replace(/\/+$/, '');
}

// Join a path onto the (env-aware) canonical base without double slashes.
export function appUrl(path = '') {
  const base = appBaseUrl();
  const suffix = String(path || '').replace(/^\/+/, '');
  return suffix ? `${base}/${suffix}` : base;
}

// Base URL for links inside an outbound email (and for same-deployment internal
// fetches). In PRODUCTION this is always the canonical/env base. In every other
// environment (Vercel preview, local dev) it uses the forwarded request host so
// preview-token links validate against the right deployment and local links
// stay on localhost. Header-less contexts (e.g. cron) fall back to the base.
export function emailBaseUrl(req) {
  if (env().VERCEL_ENV !== 'production') {
    const proto = req?.headers?.['x-forwarded-proto'] || 'https';
    const host = req?.headers?.['x-forwarded-host'] || req?.headers?.host;
    if (host) return `${proto}://${host}`;
  }
  return appBaseUrl();
}
