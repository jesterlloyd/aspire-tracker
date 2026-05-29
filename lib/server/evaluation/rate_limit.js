import crypto from 'node:crypto';

const EVALUATION_RATE_LIMIT_PEPPER = process.env.EVALUATION_RATE_LIMIT_PEPPER;

if (!EVALUATION_RATE_LIMIT_PEPPER) {
  throw new Error('Missing required environment variable: EVALUATION_RATE_LIMIT_PEPPER');
}

export function extractClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded && typeof forwarded === 'string') {
    const first = forwarded.split(',')[0];
    if (first) return first.trim().toLowerCase();
  }
  const remote = req.socket?.remoteAddress;
  if (remote && typeof remote === 'string') {
    return remote.trim().toLowerCase();
  }
  return 'unknown';
}

export function bucketKey(prefix, ip) {
  const hmacHex = crypto
    .createHmac('sha256', EVALUATION_RATE_LIMIT_PEPPER)
    .update(ip)
    .digest('hex');
  return `${prefix}:${hmacHex}`;
}
