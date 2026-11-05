// RN-LICENSE-PREFIX-1 (Owner, 2026-11-05): the Transition Form's license box reads "RN-" and
// takes the number after it, so three alumni no longer write "RN95478438", "#RN95472188" and
// "95480034" for the same thing. The stored value is the DIGITS the person typed (an older
// revision stored whatever was typed, prefix and all, so a reader normalizes before it prints);
// every surface prints the number through rnLicenseText, as "RN-95478438".
//
// Pure, shared by the form, the server's canonicalization and every reader.

export const RN_LICENSE_PREFIX = 'RN-'
const MAX_DIGITS = 12

/** The number alone: a typed or stored "RN", "RN-", "#" or space before it is dropped. */
export function rnLicenseDigits(value) {
  const s = String(value ?? '').trim().toUpperCase().replace(/^[#\s]*RN[\s-]*/, '')
  return s.replace(/\D/g, '').slice(0, MAX_DIGITS)
}

/** The number as every surface prints it, or '' when there is none. */
export function rnLicenseText(value) {
  const d = rnLicenseDigits(value)
  return d ? `${RN_LICENSE_PREFIX}${d}` : ''
}
