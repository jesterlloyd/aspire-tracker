// lib/server/staffNotifications/config.js
//
// PHASE 2C: staff-notification email worker configuration. Reuses the verified sender and the
// retry/claim constants already used by the messages delivery worker, so the two behave
// identically and share one mail identity.

import {
  MESSAGE_FROM, MESSAGE_REPLY_TO, MAX_ATTEMPTS, CLAIM_BATCH_LIMIT, CLAIM_STALE_SECONDS,
} from '../messages/config.js'

// Verified Resend sender; public reply identity is aspire@cshs.org (same as messages).
export const STAFF_NOTIFICATION_FROM = MESSAGE_FROM
export const STAFF_NOTIFICATION_REPLY_TO = MESSAGE_REPLY_TO

export { MAX_ATTEMPTS, CLAIM_BATCH_LIMIT, CLAIM_STALE_SECONDS }
