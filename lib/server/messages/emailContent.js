// lib/server/messages/emailContent.js
//
// ASPIRE MESSAGES, PHASE 2 (STAGE B): pure email builder for a Messages
// notification. Reuses the shared ASPIRE shell and safe primitives. The email
// contains ONLY: the sender display name, the conversation subject, the category
// (when present), a notice that a new message is available, and a secure
// "View message in ASPIRE" CTA to an authenticated route. It never contains the
// message body, a preview, a snippet, quoted text, a token, or recipient-
// sensitive context in the URL.

import { aspireEmailShell, aspireSystemSignature, ASPIRE_NOREPLY_LINE } from '../email/aspireShell.js';
import { renderEmailHeading, renderEmailButton, renderEmailNote, escapeHtml } from '../email/emailPrimitives.js';
import { appUrl } from '../appUrl.js';

// Authenticated app routes for the CTA. No conversation id or token is placed in
// the URL; the destination is a login-gated workspace route. Phase 3 may deep
// link within the authenticated app.
const CTA_ROUTE_BY_KIND = {
  portal_user: '/portal',
  assigned_staff: '/messages',
  shared_inbox: '/messages',
};

export function ctaPathForKind(recipientKind) {
  return CTA_ROUTE_BY_KIND[recipientKind] || '/login';
}

// Returns { subject, html, text, ctaPath }. All interpolations are escaped.
export function buildMessageNotificationEmail({
  senderDisplayName = 'The ASPIRE Team',
  conversationSubject = '',
  category = null,
  recipientKind = 'portal_user',
  ctaPath = null,
} = {}) {
  const path = ctaPath || ctaPathForKind(recipientKind);
  const ctaUrl = appUrl(path);
  const safeSender = escapeHtml(senderDisplayName);
  const safeSubject = escapeHtml(conversationSubject);
  const safeCategory = category ? escapeHtml(category) : null;

  const subject = conversationSubject
    ? `New message in ASPIRE Messages: ${conversationSubject}`
    : 'New message in ASPIRE Messages';

  const detailRows = [
    `<p style="margin:0 0 6px;"><strong>Subject:</strong> ${safeSubject}</p>`,
    safeCategory ? `<p style="margin:0 0 6px;"><strong>Category:</strong> ${safeCategory}</p>` : '',
  ].join('');

  const body = [
    renderEmailHeading({ level: 2, text: 'You have a new message' }),
    `<p style="margin:0 0 12px;">${safeSender} sent you a message in ASPIRE Messages.</p>`,
    detailRows,
    renderEmailNote({
      title: 'A new message is available',
      body: 'For your privacy, the message itself is not included in this email. Sign in to ASPIRE to read and reply.',
      tone: 'info',
    }),
    renderEmailButton({ label: 'View message in ASPIRE', url: ctaUrl, variant: 'primary' }),
    aspireSystemSignature('Thank you,'),
  ].join('\n');

  const html = aspireEmailShell({
    body,
    preheader: 'A new message is available in ASPIRE Messages.',
    footerNote: ASPIRE_NOREPLY_LINE,
  });

  const textLines = [
    'You have a new message in ASPIRE Messages.',
    `${senderDisplayName} sent you a message.`,
    conversationSubject ? `Subject: ${conversationSubject}` : '',
    category ? `Category: ${category}` : '',
    'For your privacy, the message itself is not included in this email.',
    `View it in ASPIRE: ${ctaUrl}`,
  ].filter(Boolean);

  return { subject, html, text: textLines.join('\n'), ctaPath: path };
}
