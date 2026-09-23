// lib/server/signatures/sealProvider.js
//
// SIGNATURES-PHASE2: which certificate signs a seal, chosen by SETTINGS, never by code
// (Owner, 2026-09-23). sig_settings.seal_provider names a provider; the provider knows
// where its key lives. The sealing code only ever asks a provider two things:
//
//   certificates()          -> the signing certificate first, then its chain (forge certs)
//   signDigest(sha256Bytes) -> an RSASSA-PKCS1-v1_5 signature over that SHA-256 digest
//
// That second call is the whole seam. A local PKCS#12 signs in process; a cloud key vault
// signs the same 32 bytes remotely, so its private key never leaves the vault. Adding an
// AATL document-signing certificate held in Azure Key Vault, AWS KMS or Google Cloud KMS is
// a new entry in PROVIDERS plus a settings change, and nothing that seals has to change.
//
// Secrets never live in the database: sig_settings.seal_provider_config holds only
// non-secret coordinates (a vault URI, a key name); credentials come from the environment.

import forge from 'node-forge'

const OID_SHA256 = '2.16.840.1.101.3.4.2.1'

// DigestInfo for SHA-256, then PKCS#1 v1.5: exactly what a key vault's
// "RSASSA_PKCS1_V1_5_SHA_256 sign digest" does server-side.
function digestInfo(sha256Bytes) {
  const { asn1 } = forge
  return asn1.toDer(asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(OID_SHA256).getBytes()),
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, ''),
    ]),
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, sha256Bytes),
  ])).getBytes()
}

/** A provider from an in-memory PKCS#12 (base64) and its passphrase. */
export function p12Provider({ p12Base64, passphrase, label = 'ASPIRE seal certificate' }) {
  if (!p12Base64) throw new SealConfigError('The seal certificate is not configured (SIG_SEAL_P12_BASE64).')
  const der = forge.util.decode64(p12Base64)
  const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(der), passphrase || '')
  const keyBag = (p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || [])[0]
    || (p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] || [])[0]
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || []
  if (!keyBag?.key || !certBags.length) throw new SealConfigError('The seal certificate file has no key or no certificate.')
  const key = keyBag.key
  // The signing certificate is the one whose public key matches the private key.
  const certs = certBags.map(b => b.cert)
  const signing = certs.find(c => c.publicKey.n.equals(key.n)) || certs[0]
  const chain = [signing, ...certs.filter(c => c !== signing)]
  return {
    name: 'env_p12',
    label,
    certificates: async () => chain,
    signDigest: async (sha256Bytes) => {
      // emsa-pkcs1-v1_5 over a prebuilt DigestInfo: forge's sign() with a null scheme
      // pads the given bytes as-is (RSASSA-PKCS1-v1_5 block type 1).
      return key.sign({ algorithm: 'sha256', digest: () => forge.util.createBuffer(sha256Bytes) }, 'RSASSA-PKCS1-V1_5')
    },
    _digestInfo: digestInfo,
  }
}

export class SealConfigError extends Error {
  constructor(message) { super(message); this.name = 'SealConfigError'; this.code = 'seal_not_configured' }
}

// The registry. A key-vault provider is added here; its credentials come from the
// environment and its coordinates from settings.seal_provider_config.
const PROVIDERS = {
  env_p12: (_config, env) => p12Provider({
    p12Base64: env.SIG_SEAL_P12_BASE64, passphrase: env.SIG_SEAL_P12_PASSPHRASE,
  }),
  // azure_key_vault: (config, env) => azureKeyVaultProvider({ vaultUri: config.vault_uri, keyName: config.key_name, certificatePem: ..., credentials: env }),
  // aws_kms:         (config, env) => awsKmsProvider({ keyId: config.key_id, region: config.region, certificatePem: ..., credentials: env }),
}

export const knownProviders = () => Object.keys(PROVIDERS)

/** The provider the organization's settings name. Throws SealConfigError when it cannot. */
export function sealProviderFor(settings, env = process.env) {
  const name = settings?.seal_provider || 'env_p12'
  const make = PROVIDERS[name]
  if (!make) throw new SealConfigError(`Unknown seal provider "${name}". Known: ${knownProviders().join(', ')}.`)
  return make(settings?.seal_provider_config || {}, env)
}
