import { Resend } from 'resend';

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.RESEND_API_KEY) {
    return res.status(500).json({
      error: 'RESEND_API_KEY environment variable is not set',
    });
  }

  const resend = new Resend(process.env.RESEND_API_KEY);

  try {
    const result = await resend.emails.send({
      from: 'ASPIRE Intelligence <noreply@aspire-program.com>',
      reply_to: 'JesterLloyd.Bautista@cshs.org',
      to: ['jesterlloyd.bautista@cshs.org'],
      subject: 'ASPIRE Intelligence: Resend test email',
      html: `
        <div style="font-family: -apple-system, sans-serif; max-width: 560px; margin: 0 auto;">
          <h2 style="color: #1D2567;">Resend is working ✓</h2>
          <p>This is a test email from ASPIRE Intelligence.</p>
          <p>If you're reading this in your inbox, Resend is correctly configured and the booking notification flow will work.</p>
          <p style="color: #6B7280; font-size: 13px; margin-top: 24px;">
            Sent at ${new Date().toLocaleString()}<br/>
            From: api/test-resend.js<br/>
            Environment: ${process.env.VERCEL_ENV || 'local'}
          </p>
        </div>
      `,
    });

    return res.status(200).json({ success: true, result });
  } catch (err) {
    console.error('[test-resend] error:', err);
    return res.status(500).json({ error: err.message || 'Unknown error' });
  }
}
