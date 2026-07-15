// ASPIRE-STUDENT-HOME: pure derivation of the Student Portal Documents card
// statuses (ID Badge and Certificate of Completion). No React, no I/O.
//
// These functions decide ONLY what status to show. The actual files are never
// referenced here: badges have no server-side artifact at all (they are printed
// by staff from a client-side canvas tool, tracked by the students.badge_created
// flag), and certificates are generated on demand behind an authenticated
// endpoint. Nothing here exposes a storage path, a bucket, or a student id.

// ── ID Badge ─────────────────────────────────────────────────────────────────
// There is no downloadable badge FILE anywhere in the backend (see
// src/lib/badgeGenerator.js: staff-only, client-side PNG generation; the
// physical Cedars-Sinai ID badge is issued off-platform). So the badge is NEVER
// 'available' for download here; we only reflect where the student is in the
// process using the reliable students.badge_created flag plus their status.
//
// Returns { state, label, detail, downloadable: false }. State is one of
// 'created' | 'processing' | 'not_yet'. downloadable is always false, so the
// Documents card never renders an active Download Badge button.
const BADGE_ACTIVE_STATUSES = new Set(['Placed', 'Active Rotation', 'Completed'])

export function deriveBadgeStatus({ badgeCreated, status } = {}) {
  if (badgeCreated === true) {
    return {
      state: 'created',
      label: 'Created',
      detail: 'Your Cedars-Sinai ID badge has been created by the ASPIRE team.',
      downloadable: false,
    }
  }
  if (BADGE_ACTIVE_STATUSES.has(status)) {
    return {
      state: 'processing',
      label: 'Processing',
      detail: 'Your Cedars-Sinai ID badge is being prepared by the ASPIRE team.',
      downloadable: false,
    }
  }
  return {
    state: 'not_yet',
    label: 'Not yet available',
    detail: 'Your ID badge will be available after your placement is confirmed.',
    downloadable: false,
  }
}

// ── Certificate of Completion ────────────────────────────────────────────────
// A certificate row exists ONLY once it has been issued and unlocked (see the
// certificates table: certificate_unlocked_at is NOT NULL). Its presence, with
// certificate_unlocked_at, is the eligibility signal. When absent, we explain
// the real unmet condition using status and post-rotation evaluation state.
//
// Returns { state, label, downloadable, number, year, unlockedAt, lockedReason }.
// State is one of 'available' | 'eligible' | 'locked' | 'unavailable'.
// downloadable is true ONLY when state is 'available'.
export function deriveCertificateStatus({ certificate, status, evaluations = [] } = {}) {
  if (certificate && certificate.certificate_unlocked_at && certificate.certificate_number) {
    return {
      state: 'available',
      label: 'Available',
      downloadable: true,
      number: certificate.certificate_number,
      year: certificate.certificate_year || null,
      unlockedAt: certificate.certificate_unlocked_at,
      lockedReason: null,
    }
  }

  const base = { state: 'locked', label: 'Locked', downloadable: false, number: null, year: null, unlockedAt: null }

  // Off-ramp statuses: no certificate applies.
  if (status === 'Declined' || status === 'Not Proceeding') {
    return { ...base, state: 'unavailable', label: 'Unavailable', lockedReason: 'A certificate is not available for your current status.' }
  }

  // Rotation not complete yet: the certificate unlocks after rotation completion.
  if (status !== 'Completed') {
    return { ...base, lockedReason: 'Your certificate unlocks after your rotation is complete.' }
  }

  // Rotation complete: the gate is the post-rotation evaluation. If one is still
  // open (not completed), that is the real unmet condition.
  const postRotationOpen = (evaluations || []).some(
    e => e && e.timepoint === 'post_rotation' && e.status !== 'completed'
  )
  if (postRotationOpen) {
    return { ...base, lockedReason: 'Complete your post-rotation survey to unlock your certificate.' }
  }

  // Rotation complete and no open post-rotation evaluation, but the certificate
  // row is not present yet: it is being finalized.
  return { ...base, state: 'eligible', label: 'Processing', lockedReason: 'Your certificate is being finalized.' }
}
