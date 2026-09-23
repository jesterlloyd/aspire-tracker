// lib/server/signatures/timestamp.js
//
// SIGNATURES-PHASE2: RFC 3161 trusted timestamps (Owner, 2026-09-23: every seal carries one,
// from a free public timestamp authority whose URL is in sig_settings).
//
// What is sent: only a SHA-256 hash of the seal's signature value, never the document.
// What comes back: a TimeStampToken, itself a CMS SignedData made by the authority, that
// binds that hash to the authority's clock. It is embedded in the seal as the
// signatureTimeStampToken unsigned attribute (OID 1.2.840.113549.1.9.16.2.14), which is
// where Adobe and every PAdES validator look for it.
//
// requestTimestamp() never guesses: a refused, malformed or mismatched reply throws, and
// the caller leaves the request unsealed for the maintenance cron to retry.

import forge from 'node-forge'
import { Buffer } from 'node:buffer'

const { asn1 } = forge
const OID_SHA256 = '2.16.840.1.101.3.4.2.1'
const OID_TST_INFO = '1.2.840.113549.1.9.16.1.4'
export const OID_SIGNATURE_TIMESTAMP_TOKEN = '1.2.840.113549.1.9.16.2.14'

const u = asn1.Class.UNIVERSAL
const T = asn1.Type

function intAsn1(bytes) {
  // Positive INTEGER from raw bytes (a leading 0x00 keeps the sign bit clear).
  const b = bytes.charCodeAt(0) & 0x80 ? '\x00' + bytes : bytes
  return asn1.create(u, T.INTEGER, false, b)
}

/** DER TimeStampReq for a SHA-256 imprint, with a random nonce and certReq TRUE. */
export function buildTimestampRequest(sha256Bytes, nonceBytes = forge.random.getBytesSync(8)) {
  const req = asn1.create(u, T.SEQUENCE, true, [
    asn1.create(u, T.INTEGER, false, asn1.integerToDer(1).getBytes()),
    asn1.create(u, T.SEQUENCE, true, [
      asn1.create(u, T.SEQUENCE, true, [
        asn1.create(u, T.OID, false, asn1.oidToDer(OID_SHA256).getBytes()),
        asn1.create(u, T.NULL, false, ''),
      ]),
      asn1.create(u, T.OCTETSTRING, false, sha256Bytes),
    ]),
    intAsn1(nonceBytes),
    asn1.create(u, T.BOOLEAN, false, '\xff'),
  ])
  return { der: asn1.toDer(req).getBytes(), nonce: nonceBytes }
}

const bytesToBigHex = (b) => forge.util.bytesToHex(b).replace(/^0+/, '') || '0'

/**
 * Parse a TimeStampResp. Returns { token (asn1 ContentInfo), tokenDer, genTime, serial,
 * policy, imprint, nonce }.
 */
export function parseTimestampResponse(derBytes) {
  const resp = asn1.fromDer(derBytes)
  const statusInfo = resp.value[0]
  const status = asn1.derToInteger(statusInfo.value[0].value)
  if (status !== 0 && status !== 1) {
    const text = statusInfo.value[1]?.value?.map(v => v.value).join(' ') || ''
    throw new Error(`Timestamp authority refused the request (status ${status}${text ? `: ${text}` : ''})`)
  }
  const token = resp.value[1]
  if (!token) throw new Error('Timestamp authority returned no token')
  // ContentInfo { contentType, [0] SignedData { version, digestAlgs, encapContentInfo { eContentType, [0] OCTET STRING } } }
  const signedData = token.value[1].value[0]
  const encap = signedData.value[2]
  const eContentType = asn1.derToOid(encap.value[0].value)
  if (eContentType !== OID_TST_INFO) throw new Error('Timestamp token is not a TSTInfo')
  const octets = encap.value[1].value[0]
  const tstDer = typeof octets.value === 'string' ? octets.value : octets.value.map(p => p.value).join('')
  const tst = asn1.fromDer(tstDer)
  const policy = asn1.derToOid(tst.value[1].value)
  const imprint = tst.value[2].value[1].value
  const serial = bytesToBigHex(tst.value[3].value)
  const genTimeRaw = tst.value[4].value
  const genTime = asn1.generalizedTimeToDate(genTimeRaw).toISOString()
  let nonce = null
  for (const part of tst.value.slice(5)) if (part.type === T.INTEGER && part.tagClass === u) nonce = part.value
  return { token, tokenDer: asn1.toDer(token).getBytes(), genTime, serial, policy, imprint, nonce }
}

/**
 * Ask the authority to timestamp `signatureValueBytes` (binary string). Verifies the
 * reply's imprint and nonce match what was asked.
 */
export async function requestTimestamp(tsaUrl, signatureValueBytes, { fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  const md = forge.md.sha256.create()
  md.update(signatureValueBytes)
  const imprint = md.digest().getBytes()
  const { der, nonce } = buildTimestampRequest(imprint)
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  let res
  try {
    res = await fetchImpl(tsaUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/timestamp-query', Accept: 'application/timestamp-reply' },
      body: Buffer.from(der, 'binary'),
      signal: ctl.signal,
    })
  } finally { clearTimeout(timer) }
  if (!res.ok) throw new Error(`Timestamp authority answered HTTP ${res.status}`)
  const body = Buffer.from(await res.arrayBuffer()).toString('binary')
  const parsed = parseTimestampResponse(body)
  if (parsed.imprint !== imprint) throw new Error('Timestamp token covers a different hash')
  if (parsed.nonce && bytesToBigHex(parsed.nonce) !== bytesToBigHex(nonce)) throw new Error('Timestamp nonce mismatch')
  return parsed
}

/** Pull the timestamp back out of an embedded token (for verification and the certificate). */
export function readTimestampToken(tokenAsn1) {
  return parseTimestampResponse(asn1.toDer(asn1.create(u, T.SEQUENCE, true, [
    asn1.create(u, T.SEQUENCE, true, [asn1.create(u, T.INTEGER, false, asn1.integerToDer(0).getBytes())]),
    tokenAsn1,
  ])).getBytes())
}
