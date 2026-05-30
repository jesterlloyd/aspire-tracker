import crypto from 'node:crypto';

const EVALUATION_TOKEN_PEPPER = process.env.EVALUATION_TOKEN_PEPPER;

if (!EVALUATION_TOKEN_PEPPER) {
  throw new Error('Missing required environment variable: EVALUATION_TOKEN_PEPPER');
}

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const TOKEN_BYTES = 32;

export function generateToken() {
  const raw = crypto.randomBytes(TOKEN_BYTES).toString('base64url');
  const hash = hashToken(raw);
  const prefix = hashPrefixOf(hash);
  return { raw, hash, hashPrefix: prefix };
}

export function hashToken(rawToken) {
  return crypto
    .createHmac('sha256', EVALUATION_TOKEN_PEPPER)
    .update(rawToken)
    .digest('hex');
}

export function hashPrefixOf(hash) {
  return hash.slice(0, 8);
}

export function isWellFormedRawToken(value) {
  return typeof value === 'string' && BASE64URL_PATTERN.test(value);
}
