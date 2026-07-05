// src/lib/buildInfo.js
//
// ASPIRE-GENERAL-SETTINGS-1 - safe, already-public app/build metadata for the
// Settings → General → About sub-section. Reads ONLY build-time public vars
// (the VITE_BUILD_* values are inlined by vite.config.js at build time and are
// NOT secret) plus the canonical URL constant. It intentionally exposes NO
// secrets, NO private env (no Supabase keys/URLs, no API keys), and makes NO
// network/API calls. When the build vars are not injected (local dev), they
// read 'development' / 'dev'; BUILD_TIME is null on deployments built before
// this field existed, so consumers must treat it as optional.
import { CANONICAL_APP_URL } from './appUrl.js';

export const APP_NAME = 'ASPIRE Intelligence';

export const APP_DESCRIPTION =
  'Workspace for managing ASPIRE: cohorts, student profiles, interviews, rotations, and outreach.';

// Canonical public URL of the app (single source of truth: src/lib/appUrl.js).
export const CANONICAL_URL = CANONICAL_APP_URL;

// Build-time vars (vite.config.js, from Vercel's VERCEL_ENV / VERCEL_GIT_COMMIT_SHA).
export const BUILD_ENV = import.meta.env.VITE_BUILD_ENV || 'development';
export const BUILD_SHA = import.meta.env.VITE_BUILD_SHA || 'dev';
export const BUILD_TIME = import.meta.env.VITE_BUILD_TIME || null; // ISO string or null

// Human-readable label for a build environment value.
export function environmentLabel(env = BUILD_ENV) {
  const map = { production: 'Production', preview: 'Preview', development: 'Development' };
  return map[env] || env;
}

// Format an ISO build timestamp for display (local time, concise). Returns null
// when no timestamp is available so callers can omit the row entirely.
export function formatBuildTime(iso = BUILD_TIME) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}
