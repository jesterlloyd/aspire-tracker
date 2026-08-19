// Accept the two request encodings used by the certificate endpoint:
// existing JSON clients and the browser-native form POST used to avoid blob:
// downloads in Cedars-Sinai Island. The reusable token remains in the POST
// body in both cases and is never moved into the URL.
export function parseCertificateDownloadBody(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') throw new Error('invalid_body');

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid_body');
    return parsed;
  } catch (error) {
    if (error?.message === 'invalid_body') throw error;
    const params = new URLSearchParams(raw);
    return { token: params.get('token') };
  }
}
