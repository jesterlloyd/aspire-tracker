// src/lib/notifications/handwrittenSignature.js
//
// AUTO-SIGNATURE-GIF-1 - Jester's handwritten GIF signature for automated/cron templates. Originally
// a narrow selection, but adoption grew template by template; as of SIGNATURE-PARITY-1 (2026-08-27)
// EVERY shared-path notification template uses it (birthday greeting and cohort access retirement
// were the last typed holdouts). The shared aspireSystemSignature (typed-only) still exists for the
// evaluation/survey secure-link senders. The output mirrors the midpoint-check-in signature exactly:
// the same existing public asset, rendered 160x60, placed between the closing line and the typed
// signature block.
//
// Asset is NOT created or edited here; it is referenced by its existing public URL.

import { appUrl } from '../appUrl.js';

const NAVY   = '#1d2567';
const RAVEN  = '#191919';
const CS_RED = '#dc1e34';
const JESTER_SIGNATURE_GIF = appUrl('/signature-jester.gif');

// Returns: closing line + handwritten GIF + typed name/credentials/role/institute/contact block.
// The typed block mirrors aspireSystemSignature; only the GIF insertion is unique to these templates.
export function aspireHandwrittenSignature(closing = 'Kind regards,') {
  return `
<p style="margin:24px 0 6px;font-size:14px;color:${RAVEN};">${closing}</p>
<img src="${JESTER_SIGNATURE_GIF}" alt="Jester Lloyd Bautista" width="160" height="60" style="display:block;width:160px;max-width:160px;height:auto;border:0;margin:6px 0 0;" />
<p style="margin:0;font-size:14px;color:${RAVEN};line-height:1.6;">
  <strong style="color:${CS_RED};">Jester Lloyd Bautista, PhD, MSN, RN, NPD-BC, CCRN, SCRN</strong>
  <span style="display:block;">Nursing Professional Development Practitioner</span>
  <span style="display:block;">Geri &amp; Richard Brawerman Nursing Institute</span>
  <span style="display:block;margin-top:2px;"><a href="mailto:jesterlloyd.bautista@cshs.org" style="color:${NAVY};text-decoration:none;">jesterlloyd.bautista@cshs.org</a> | Office: 310-248-8964</span>
</p>`;
}
