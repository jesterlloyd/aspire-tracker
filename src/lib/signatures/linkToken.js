// src/lib/signatures/linkToken.js
// SIGNATURES-PHASE2: the shape of a signer's link token (43 base64url characters, an
// HMAC-SHA256). Shared by the public page and the server's pattern check.
export const LINK_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/
