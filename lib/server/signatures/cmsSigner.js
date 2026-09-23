// lib/server/signatures/cmsSigner.js
//
// SIGNATURES-PHASE2: the CMS (PKCS#7 detached) signature that seals a finished PDF, built
// for @signpdf/signpdf. Two things make it ours rather than @signpdf's stock P12 signer:
//
//   1. The private key is never handed to this code. It asks a seal provider
//      (sealProvider.js) to sign one SHA-256 digest. node-forge signs synchronously and a
//      key vault answers asynchronously, so the SignedData is built twice: once to learn
//      the exact digest of the signed attributes, then, with the provider's signature in
//      hand and the signing time pinned, again for real. Same attributes, same digest.
//   2. An RFC 3161 timestamp token from the settings' authority is added as the
//      signatureTimeStampToken unsigned attribute, over the signature value. node-forge's
//      own unauthenticated-attribute path is broken (it pushes onto `.values`), so the
//      attribute is appended to the SignerInfo ASN.1 directly.
//
// sign() resolves to the DER bytes @signpdf embeds in /Contents, and leaves what it did in
// `this.result` for the audit log and the certificate of completion.

import forge from 'node-forge'
import { Signer } from '@signpdf/utils'
import { requestTimestamp, OID_SIGNATURE_TIMESTAMP_TOKEN } from './timestamp.js'
import { Buffer } from 'node:buffer'

const { asn1, pki } = forge

export class AspireCmsSigner extends Signer {
  constructor({ provider, tsaUrl, tsaName = '', fetchImpl, requireTimestamp = true } = {}) {
    super()
    this.provider = provider
    this.tsaUrl = tsaUrl
    this.tsaName = tsaName
    this.fetchImpl = fetchImpl
    this.requireTimestamp = requireTimestamp
    this.result = null
  }

  async sign(pdfBuffer, signingTime = undefined) {
    const certs = await this.provider.certificates()
    const time = signingTime || new Date()
    const content = Buffer.isBuffer(pdfBuffer) ? pdfBuffer.toString('binary') : String(pdfBuffer)

    const build = (key) => {
      const p7 = forge.pkcs7.createSignedData()
      p7.content = forge.util.createBuffer(content)
      for (const c of certs) p7.addCertificate(c)
      p7.addSigner({
        key, certificate: certs[0], digestAlgorithm: pki.oids.sha256,
        authenticatedAttributes: [
          { type: pki.oids.contentType, value: pki.oids.data },
          { type: pki.oids.messageDigest },
          { type: pki.oids.signingTime, value: time },
        ],
      })
      p7.sign({ detached: true })
      return p7
    }

    // Pass 1: learn the digest of the signed attributes.
    let digest = null
    build({ sign: (md) => { digest = md.digest().getBytes(); return '' } })
    if (!digest) throw new Error('Could not compute the digest to seal')
    // The provider signs it (in process, or in a key vault).
    const signature = await this.provider.signDigest(digest)
    // Pass 2: the real SignedData, with that signature.
    const p7 = build({ sign: () => signature })

    const root = p7.toAsn1()
    const signedData = root.value[1].value[0]
    const signerInfos = signedData.value[signedData.value.length - 1]
    const signerInfo = signerInfos.value[0]
    const encryptedDigest = [...signerInfo.value].reverse()
      .find(v => v.tagClass === asn1.Class.UNIVERSAL && v.type === asn1.Type.OCTETSTRING)

    let timestamp = null
    if (this.tsaUrl) {
      try {
        const ts = await requestTimestamp(this.tsaUrl, encryptedDigest.value, { fetchImpl: this.fetchImpl })
        signerInfo.value.push(asn1.create(asn1.Class.CONTEXT_SPECIFIC, 1, true, [
          asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
            asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(OID_SIGNATURE_TIMESTAMP_TOKEN).getBytes()),
            asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, [ts.token]),
          ]),
        ]))
        timestamp = { gen_time: ts.genTime, serial: ts.serial, policy: ts.policy, tsa_url: this.tsaUrl, tsa_name: this.tsaName }
      } catch (err) {
        if (this.requireTimestamp) throw new TimestampError(err.message)
      }
    } else if (this.requireTimestamp) {
      throw new TimestampError('No timestamp authority is configured.')
    }

    const signer = certs[0]
    this.result = {
      signing_time: time.toISOString(),
      certificate: {
        subject: signer.subject.getField('CN')?.value || '',
        issuer: signer.issuer.getField('CN')?.value || '',
        serial: signer.serialNumber,
        not_after: signer.validity.notAfter.toISOString(),
        self_signed: signer.isIssuer(signer),
      },
      provider: this.provider.name,
      timestamp,
    }
    return Buffer.from(asn1.toDer(root).getBytes(), 'binary')
  }
}

export class TimestampError extends Error {
  constructor(message) { super(`Trusted timestamp failed: ${message}`); this.name = 'TimestampError'; this.code = 'timestamp_failed' }
}
