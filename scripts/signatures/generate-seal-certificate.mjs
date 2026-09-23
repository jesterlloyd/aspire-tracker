// scripts/signatures/generate-seal-certificate.mjs
//
// SIGNATURES-PHASE2: makes ASPIRE Intelligence's own self-signed document-seal certificate
// (Owner, 2026-09-23) as a password-protected PKCS#12, for the env_p12 seal provider.
//
//   node scripts/signatures/generate-seal-certificate.mjs [outDir]
//
// Writes <outDir>/aspire-seal.p12 and prints the two values to put in Vercel's server
// environment (never in the repository or the database):
//   SIG_SEAL_P12_BASE64      the file, base64
//   SIG_SEAL_P12_PASSPHRASE  a random passphrase
// A self-signed seal proves the PDF was not changed after sealing; Adobe will call the
// signer "not trusted" until a trusted (AATL) certificate replaces it through
// sig_settings.seal_provider. RSA 3072, SHA-256, valid 5 years.
import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import forge from 'node-forge'

const outDir = process.argv[2] || '.'
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 3072 })
const key = forge.pki.privateKeyFromPem(privateKey.export({ type: 'pkcs1', format: 'pem' }))
const pub = forge.pki.publicKeyFromPem(publicKey.export({ type: 'spki', format: 'pem' }))

const cert = forge.pki.createCertificate()
cert.publicKey = pub
cert.serialNumber = '01' + randomBytes(15).toString('hex')
cert.validity.notBefore = new Date()
cert.validity.notAfter = new Date(Date.now() + 5 * 365 * 24 * 3600 * 1000)
const attrs = [
  { name: 'commonName', value: 'ASPIRE Intelligence Document Seal' },
  { name: 'organizationName', value: 'ASPIRE Intelligence' },
  { name: 'countryName', value: 'US' },
]
cert.setSubject(attrs)
cert.setIssuer(attrs)
cert.setExtensions([
  { name: 'basicConstraints', cA: false, critical: true },
  { name: 'keyUsage', digitalSignature: true, nonRepudiation: true, critical: true },
  // id-kp-documentSigning (RFC 9336) and Microsoft Document Signing.
  { name: 'extKeyUsage', '1.3.6.1.5.5.7.3.36': true, '1.3.6.1.4.1.311.10.3.12': true },
  { name: 'subjectKeyIdentifier' },
])
cert.sign(key, forge.md.sha256.create())

const passphrase = randomBytes(24).toString('base64url')
const p12 = forge.pkcs12.toPkcs12Asn1(key, [cert], passphrase, { algorithm: 'aes256', friendlyName: 'ASPIRE Intelligence Document Seal' })
const der = forge.asn1.toDer(p12).getBytes()
mkdirSync(outDir, { recursive: true })
const file = join(outDir, 'aspire-seal.p12')
writeFileSync(file, Buffer.from(der, 'binary'))
const fp = forge.md.sha256.create().update(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes()).digest().toHex()
console.log(`Wrote ${file}`)
console.log(`Certificate SHA-256 fingerprint: ${fp}`)
console.log('SIG_SEAL_P12_BASE64=' + forge.util.encode64(der))
console.log('SIG_SEAL_P12_PASSPHRASE=' + passphrase)
