// ASPIRE-STUDENT-HOME: pure derivation of the Student Portal Documents card
// statuses (ID Badge and Certificate of Completion). No React, no I/O.
//
// These functions decide ONLY what status to show. The actual files are never
// referenced here: badges have no server-side artifact at all (they are printed
// by staff from a client-side canvas tool, tracked by the students.badge_created
// flag), and certificates are generated on demand behind an authenticated
// endpoint. Nothing here exposes a storage path, a bucket, or a student id.

// ── ID Badge ─────────────────────────────────────────────────────────────────
// There is still no badge FILE anywhere in the backend. STUDENT-BADGE-1 (Owner decision,
// 2026-09-05): once staff mark the badge created, the Student Portal renders the badge in the
// student's own browser with the same generator staff use (src/lib/badgeGenerator.js: public
// templates + the student's OWN signed headshot + their rotation window). So 'downloadable' is
// true for the created state and means "render it here", never "fetch a stored file". The
// physical Cedars-Sinai badge is still issued off-platform.
//
// Returns { state, label, detail, downloadable }. State is one of
// 'created' | 'processing' | 'not_yet'; downloadable is true only for 'created'.
const BADGE_ACTIVE_STATUSES = new Set(['Placed', 'Active Rotation', 'Completed'])

export function deriveBadgeStatus({ badgeCreated, status } = {}) {
  if (badgeCreated === true) {
    return {
      state: 'created',
      label: 'Created',
      detail: 'Your Cedars-Sinai ID badge has been created by the ASPIRE team. You can preview it and save a copy below.',
      downloadable: true,
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
