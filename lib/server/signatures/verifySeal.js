// lib/server/signatures/verifySeal.js
//
// SIGNATURES-PHASE2: checks a sealed PDF the way a PDF reader does, without trusting
// anything the sealing step reported. Used by the tests and by the staff "Verify seal"
// action. It answers four questions:
//   1. Do the signed byte ranges cover the whole file except the signature itself?
//      (Anything appended or edited after sealing breaks this or the digest.)
//   2. Does the SHA-256 of those ranges equal the signed messageDigest attribute?
//   3. Does the signer's certificate verify the signature over the signed attributes?
//   4. Is there an RFC 3161 timestamp, and does it cover this signature's value?
// It does not decide whether the signer's certificate is TRUSTED; that is the reader's
// trust store (a self-signed seal is valid but untrusted by design).

import forge from 'node-forge'
import { createHash } from 'node:crypto'
import { OID_SIGNATURE_TIMESTAMP_TOKEN, readTimestampToken } from './timestamp.js'
import { Buffer } from 'node:buffer'

const { asn1, pki } = forge

export function verifySealedPdf(pdfBuffer) {
  const pdf = Buffer.isBuffer(pdfBuffer) ? pdfBuffer : Buffer.from(pdfBuffer)
  const text = pdf.toString('latin1')
  const brMatch = [...text.matchAll(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g)].pop()
  if (!brMatch) return { valid: false, reason: 'No signature found' }
  const [a, b, c, d] = brMatch.slice(1, 5).map(Number)
  const coversWhole = a === 0 && c + d === pdf.length
  const hexStart = b + 1, hexEnd = c - 1
  const hex = text.slice(hexStart, hexEnd).replace(/(00)+$/, '')
  const der = Buffer.from(hex, 'hex').toString('binary')
  const root = asn1.fromDer(der)
  const msg = forge.pkcs7.messageFromAsn1(root)
  const signedContent = Buffer.concat([pdf.subarray(a, a + b), pdf.subarray(c, c + d)])
  const contentDigest = createHash('sha256').update(signedContent).digest('binary')

  const signedData = root.value[1].value[0]
  const signerInfo = signedData.value[signedData.value.length - 1].value[0]
  const authAttrs = signerInfo.value.find(v => v.tagClass === asn1.Class.CONTEXT_SPECIFIC && v.type === 0)
  let messageDigest = null, signingTime = null
  for (const attr of authAttrs.value) {
    const oid = asn1.derToOid(attr.value[0].value)
    const val = attr.value[1].value[0]
    if (oid === pki.oids.messageDigest) messageDigest = val.value
    if (oid === pki.oids.signingTime) signingTime = (val.type === asn1.Type.UTCTIME ? asn1.utcTimeToDate(val.value) : asn1.generalizedTimeToDate(val.value)).toISOString()
  }
  const digestMatches = messageDigest === contentDigest

  // The signature is over the DER of the SET OF signed attributes.
  const setOf = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, authAttrs.value)
  const md = forge.md.sha256.create(); md.update(asn1.toDer(setOf).getBytes())
  const encryptedDigest = [...signerInfo.value].reverse().find(v => v.tagClass === asn1.Class.UNIVERSAL && v.type === asn1.Type.OCTETSTRING)
  const cert = msg.certificates[0]
  let signatureValid
  try { signatureValid = cert.publicKey.verify(md.digest().getBytes(), encryptedDigest.value) } catch { signatureValid = false }

  let timestamp = null
  const unsigned = signerInfo.value.find(v => v.tagClass === asn1.Class.CONTEXT_SPECIFIC && v.type === 1)
  if (unsigned) {
    for (const attr of unsigned.value) {
      if (asn1.derToOid(attr.value[0].value) !== OID_SIGNATURE_TIMESTAMP_TOKEN) continue
      const ts = readTimestampToken(attr.value[1].value[0])
      const expected = forge.md.sha256.create().update(encryptedDigest.value).digest().getBytes()
      timestamp = { gen_time: ts.genTime, serial: ts.serial, policy: ts.policy, covers_signature: ts.imprint === expected }
    }
  }

  return {
    valid: coversWhole && digestMatches && signatureValid && (!timestamp || timestamp.covers_signature),
    coversWhole, digestMatches, signatureValid, signingTime, timestamp,
    signer: { subject: cert.subject.getField('CN')?.value || '', self_signed: cert.isIssuer(cert) },
    reason: !coversWhole ? 'The file was changed after it was sealed (bytes outside the signed range)'
      : !digestMatches ? 'The file was changed after it was sealed (digest mismatch)'
      : !signatureValid ? 'The seal signature does not verify'
      : (timestamp && !timestamp.covers_signature) ? 'The timestamp does not cover this seal' : null,
  }
}
