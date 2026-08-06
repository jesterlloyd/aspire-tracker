// KEITH-P1: contact-detail redaction applied to extracted resume text BEFORE it
// is sent for inference.
//
// The skill needs a resume's substance - clinical placements, employment,
// education, certifications, stated goals - and none of its contact block. This
// removes emails, phone numbers, URLs, and street addresses, replacing each with
// a typed placeholder so the model can still see that a contact block existed
// (and therefore not mistake the redaction for a gap in the resume) without
// receiving the values.
//
// Deliberately conservative in one direction: it over-redacts rather than
// under-redacts. A stray number that looks like a phone number is redacted; the
// cost is a slightly poorer question, and the alternative cost is leaking a
// student's mobile number into a prompt.
//
// This runs AFTER extraction and BEFORE truncation, so a resume whose contact
// block is long does not consume the character budget with redacted values.

export const PLACEHOLDERS = Object.freeze({
  email: '[email redacted]',
  phone: '[phone redacted]',
  url: '[url redacted]',
  address: '[address redacted]',
});

// Order matters: email before URL (an email is not a URL but shares characters),
// and both before phone (a phone pattern can appear inside a long digit run).
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>()[\]]+/gi;
// North American formats: 555-123-4567, (555) 123-4567, 555.123.4567,
// +1 555 123 4567, 5551234567.
const PHONE_RE = /(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}\b/g;
// A street address line: number + street words + a type suffix. Requires the
// suffix so "12 years of experience" and "3 units" are not redacted.
// Horizontal whitespace ONLY ([ \t], never \s): \s crosses newlines, which let a
// phone number's trailing digits on one line join the next line's street number
// into a single bogus "address" match and swallow the phone.
const ADDRESS_RE = new RegExp(
  String.raw`\b\d{1,6}[ \t]+(?:[A-Za-z0-9.'-]+[ \t]+){0,4}` +
  String.raw`(?:Street|St|Avenue|Ave|Boulevard|Blvd|Road|Rd|Drive|Dr|Lane|Ln|Court|Ct|Circle|Cir|Way|Place|Pl|Terrace|Ter|Parkway|Pkwy|Highway|Hwy|Suite|Ste|Apt|Unit)\b\.?`,
  'gi',
);

/**
 * Redact contact details from resume text.
 * Returns { text, counts } so the invocation audit can record WHAT was redacted
 * (as counts) without ever recording the values themselves.
 */
export function redactContactDetails(input) {
  let text = String(input || '');
  const counts = { email: 0, phone: 0, url: 0, address: 0 };

  text = text.replace(EMAIL_RE, () => { counts.email++; return PLACEHOLDERS.email; });
  text = text.replace(URL_RE, () => { counts.url++; return PLACEHOLDERS.url; });
  text = text.replace(PHONE_RE, () => { counts.phone++; return PLACEHOLDERS.phone; });
  text = text.replace(ADDRESS_RE, () => { counts.address++; return PLACEHOLDERS.address; });

  return { text, counts };
}

/** True when any contact detail survives. Used as a test/assertion guard. */
export function hasUnredactedContact(text) {
  const s = String(text || '');
  // Re-run against fresh regexes: the module-level ones are stateful (/g).
  return new RegExp(EMAIL_RE.source).test(s)
    || new RegExp(PHONE_RE.source).test(s)
    || new RegExp(URL_RE.source, 'i').test(s);
}

/**
 * Head-weighted truncation to a character budget. Resumes lead with the most
 * identifying and most recent experience, so the head is what the questions
 * should be grounded in. Truncation is announced in-band so the model knows the
 * document continued rather than inferring the student's history simply ended.
 */
export function truncateForInference(text, maxChars = 12000) {
  const s = String(text || '');
  if (s.length <= maxChars) return { text: s, truncated: false };
  return {
    text: `${s.slice(0, maxChars)}\n\n[resume truncated for length; later sections not shown]`,
    truncated: true,
  };
}
