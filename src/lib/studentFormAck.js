// src/lib/studentFormAck.js
//
// STUDENT-FORM-INFORMATION-ACKNOWLEDGMENT: shared copy + version for the Student Information Use
// Acknowledgment on /student-form. Imported by BOTH the form (display) and the intake endpoint
// (server-stamped version) so the stored version always matches the wording shown.
//
// This is a product-level information NOTICE — NOT FERPA consent, NOT a release of educational
// records. Do not introduce "consent" or FERPA language here.
//
// Bump STUDENT_FORM_ACK_VERSION whenever the wording changes.
export const STUDENT_FORM_ACK_VERSION = '2026-06-v1'

export const STUDENT_FORM_ACK_TITLE = 'Student Information Use Acknowledgment'

export const STUDENT_FORM_ACK_BODY = [
  'The information you provide in this form will be used by the ASPIRE Program team and authorized program partners to support your participation in the ASPIRE Program. This includes placement coordination, onboarding, program communication, and general program administration.',
  'Your information may include details related to your education and student records, and it will be handled with care and used only for purposes connected to your ASPIRE participation.',
]

export const STUDENT_FORM_ACK_CHECKBOX_LABEL =
  'I acknowledge that I have read and understand how my information will be used.'

export const STUDENT_FORM_ACK_TYPED_NAME_TEXT =
  'By typing your full name below, you confirm that you have reviewed and understand this acknowledgment.'

export const STUDENT_FORM_ACK_FIELD_LABEL = 'Full Name'

export const STUDENT_FORM_ACK_HELPER_TEXT = 'Type your name as your acknowledgment.'
