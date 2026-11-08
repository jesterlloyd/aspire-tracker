# Draft: request to Legal and IT for e-signature approval

**To:** [Legal contact], [IT Security contact]
**Cc:** [Director, Brawerman Nursing Institute]
**Subject:** Review request: electronic signatures in ASPIRE Intelligence

Hello [Names],

I am requesting your review before I turn on electronic signatures in ASPIRE Intelligence, the platform I use to run ASPIRE. The feature is built and is switched off in production. It stays off until I have your answer.

**What it would be used for**

- ASPIRE staff sending program documents to students for signature, such as acknowledgments and onboarding forms.
- Affiliated schools' clinical coordinators sending their own documents to their own students through the Academic Partner portal. A school can reach only students enrolled through that school.
- The signed copy is filed on the student's record in ASPIRE and emailed to every party.

**How it works**

- **Documents:** PDF uploads only. The sender places signature, initial, date and text fields.
- **Signer identity:** each signer receives a personal emailed link. Opening it sends a 6-digit code to the same address (valid 10 minutes, 5 attempts), which opens a 2-hour signing session. Staff signers sign inside the app under their own sign-in. There is no SMS.
- **Consent:** the signer accepts an electronic records and signature disclosure before signing. The current text (v1.0) is a draft written for your review.
- **Sealing:** on completion the PDF is flattened, a certificate of completion page is added, and the file is sealed with a digital signature. Today the seal uses a self-signed ASPIRE certificate, so a PDF reader shows the document as sealed but the certificate as not from a trusted authority. The design allows a trusted (AATL) certificate held in a key vault to be added without code changes.
- **Timestamps:** each seal carries two RFC 3161 timestamps from DigiCert's public timestamp service. Only a hash of the document is sent, never the document.
- **Audit trail:** every event (sent, viewed, code verified, signed, declined, voided, sealed) is written to a log that the database chains by hash and refuses to edit or delete.
- **Hosting:** data is stored in Supabase (US West, Oregon), the app runs on Vercel, and email goes through Resend. Documents sit in a private storage bucket and open only through signed, short-lived links.

**What I am asking**

Legal:
1. Is the v1.0 disclosure acceptable, and what changes are needed?
2. Which document types may be signed this way, and which must stay with an existing Cedars-Sinai process?
3. May affiliated schools use it for their own documents with their own students, or should that stay limited to ASPIRE staff?

IT:
1. Is the self-signed seal acceptable for internal and school use, or should I obtain a trusted certificate first?
2. Do you have requirements for key storage, retention of signed documents and audit logs, or a security review before go-live?

I can walk either team through the feature in 20 minutes and share the full technical description. Thank you for your help.

Kind regards,

Jester Lloyd Bautista, PhD, MSN, RN, NPD-BC, CCRN, SCRN
Nursing Professional Development Practitioner
Geri and Richard Brawerman Nursing Institute, Cedars-Sinai
