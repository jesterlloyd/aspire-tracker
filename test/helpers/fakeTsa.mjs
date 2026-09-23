// test/helpers/fakeTsa.mjs
//
// A local RFC 3161 timestamp authority for tests: answers a TimeStampReq with a real
// TimeStampResp whose token is a CMS SignedData over a TSTInfo that echoes the request's
// imprint and nonce, signed by a throwaway certificate. Lets the seal's timestamp path
// run end to end with no network. Also makes a throwaway seal certificate (PKCS#12).

import forge from 'node-forge'

const { asn1, pki } = forge
const u = asn1.Class.UNIVERSAL, T = asn1.Type
const OID_TST = '1.2.840.113549.1.9.16.1.4'

function selfSigned(cn, keyBits = 2048) {
  const keys = pki.rsa.generateKeyPair(keyBits)
  const cert = pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = '0' + Math.floor(Math.random() * 1e12).toString(16)
  cert.validity.notBefore = new Date(Date.now() - 60000)
  cert.validity.notAfter = new Date(Date.now() + 365 * 86400000)
  const attrs = [{ name: 'commonName', value: cn }]
  cert.setSubject(attrs); cert.setIssuer(attrs)
  cert.sign(keys.privateKey, forge.md.sha256.create())
  return { key: keys.privateKey, cert }
}

export function makeTestSealP12(passphrase = 'test-pass') {
  const { key, cert } = selfSigned('ASPIRE Test Seal')
  const p12 = forge.pkcs12.toPkcs12Asn1(key, [cert], passphrase, { algorithm: '3des' })
  return { p12Base64: forge.util.encode64(asn1.toDer(p12).getBytes()), passphrase }
}

export function fakeTsa() {
  const tsa = selfSigned('Fake Test TSA')
  let serial = 1000
  const calls = []
  const fetchImpl = async (_url, { body }) => {
    const req = asn1.fromDer(Buffer.from(body).toString('binary'))
    const imprint = req.value[1]
    const nonce = req.value.find(v => v.tagClass === u && v.type === T.INTEGER && v !== req.value[0])
    calls.push(imprint.value[1].value)
    const tst = asn1.create(u, T.SEQUENCE, true, [
      asn1.create(u, T.INTEGER, false, asn1.integerToDer(1).getBytes()),
      asn1.create(u, T.OID, false, asn1.oidToDer('1.2.3.4.5').getBytes()),
      imprint,
      asn1.create(u, T.INTEGER, false, asn1.integerToDer(serial++).getBytes()),
      asn1.create(u, T.GENERALIZEDTIME, false, asn1.dateToGeneralizedTime(new Date())),
      ...(nonce ? [nonce] : []),
    ])
    const p7 = forge.pkcs7.createSignedData()
    p7.content = forge.util.createBuffer(asn1.toDer(tst).getBytes())
    p7.addCertificate(tsa.cert)
    p7.addSigner({ key: tsa.key, certificate: tsa.cert, digestAlgorithm: pki.oids.sha256,
      authenticatedAttributes: [{ type: pki.oids.contentType, value: OID_TST }, { type: pki.oids.messageDigest }, { type: pki.oids.signingTime, value: new Date() }] })
    p7.sign()
    const token = p7.toAsn1()
    token.value[1].value[0].value[2].value[0] = asn1.create(u, T.OID, false, asn1.oidToDer(OID_TST).getBytes())
    const resp = asn1.create(u, T.SEQUENCE, true, [
      asn1.create(u, T.SEQUENCE, true, [asn1.create(u, T.INTEGER, false, asn1.integerToDer(0).getBytes())]),
      token,
    ])
    const bytes = Buffer.from(asn1.toDer(resp).getBytes(), 'binary')
    return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) }
  }
  return { fetchImpl, calls }
}
