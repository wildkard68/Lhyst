/*
 * Netlify Function: generate-code
 *
 * This function handles sign‑up verification by generating a 6‑digit code,
 * storing it in the Supabase `email_codes` table with a 1‑hour expiry, and
 * emailing the code to the user via the Resend email API. It also checks
 * whether a user already exists or a code is pending to prevent duplicate
 * sign‑ups. Secrets such as the Supabase service role key and Resend API
 * key are passed via environment variables and are never exposed to the
 * client. See README for the expected database schema.
 */

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: 'Method Not Allowed',
    };
  }
  try {
    const body = JSON.parse(event.body || '{}');
    const email = (body.email || '').toLowerCase().trim();
    if (!email) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Email is required' }),
      };
    }
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Supabase configuration is missing' }),
      };
    }
    // Check if a user with this email already exists.
    const userRes = await fetch(
      `${supabaseUrl}/auth/v1/admin/users?email=${encodeURIComponent(email)}`,
      {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
      }
    );
    if (!userRes.ok) {
      const errText = await userRes.text();
      return {
        statusCode: 500,
        body: JSON.stringify({ error: `Failed to query users: ${errText}` }),
      };
    }
    const userData = await userRes.json();
    if (userData && userData.users && userData.users.length > 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'This email is already registered' }),
      };
    }
    // Check for existing codes that have not expired or been used.
    const codesRes = await fetch(
      `${supabaseUrl}/rest/v1/email_codes?email=eq.${encodeURIComponent(
        email
      )}&used=eq.false`,
      {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
      }
    );
    if (!codesRes.ok) {
      const err = await codesRes.text();
      return {
        statusCode: 500,
        body: JSON.stringify({ error: `Failed to query codes: ${err}` }),
      };
    }
    const existingCodes = await codesRes.json();
    const now = Date.now();
    if (Array.isArray(existingCodes)) {
      for (const row of existingCodes) {
        const expiresAt = new Date(row.expires_at).getTime();
        if (!row.used && expiresAt > now) {
          return {
            statusCode: 400,
            body: JSON.stringify({
              error:
                'A verification code has already been sent. Please check your email or wait until it expires.',
            }),
          };
        }
      }
    }
    // Generate a 6‑digit code.
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(now + 60 * 60 * 1000).toISOString(); // 1 hour
    // Insert the code into the database.
    const insertRes = await fetch(`${supabaseUrl}/rest/v1/email_codes`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify([
        {
          email,
          code,
          expires_at: expiresAt,
          used: false,
        },
      ]),
    });
    if (!insertRes.ok) {
      const text = await insertRes.text();
      return {
        statusCode: 500,
        body: JSON.stringify({ error: `Failed to save verification code: ${text}` }),
      };
    }
    // Send the code via one of the configured email providers. We attempt
    // Resend first, then fall back to SendGrid or Mailgun if available.
    const resendKey = process.env.RESEND_API_KEY;
    const sendgridKey = process.env.SENDGRID_API_KEY;
    const mailgunKey = process.env.MAILGUN_API_KEY;
    const mailgunDomain = process.env.MAILGUN_DOMAIN;
    const fromEmail = process.env.FROM_EMAIL;
    let note;
    let emailSent = false;

    // Helper to send email via Resend
    async function sendViaResend() {
      const res = await fetch('https://api.resend.com/v1/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: email,
          from: fromEmail,
          subject: 'Your Lhyst verification code',
          html: `<p>Hello,</p><p>Your Lhyst verification code is <strong>${code}</strong>. It expires in 1 hour.</p><p>Please enter this code on the verification page to complete your registration.</p>`,
        }),
      });
      if (!res.ok) {
        try {
          const errText = await res.text();
          note = note ? `${note} | Resend error: ${errText}` : `Resend error: ${errText}`;
        } catch (_) {
          note = note ? `${note} | Resend failed` : 'Resend failed';
        }
      } else {
        emailSent = true;
      }
    }

    // Helper to send email via SendGrid
    async function sendViaSendGrid() {
      const sgBody = {
        personalizations: [
          { to: [{ email }], subject: 'Your Lhyst verification code' },
        ],
        from: { email: fromEmail, name: 'Lhyst' },
        content: [
          {
            type: 'text/plain',
            value: `Hello,\n\nYour Lhyst verification code is ${code}. It expires in 1 hour.\nPlease enter this code on the verification page to complete your registration.`,
          },
        ],
      };
      const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sendgridKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(sgBody),
      });
      if (res.status >= 200 && res.status < 300) {
        emailSent = true;
      } else {
        try {
          const t = await res.text();
          note = note ? `${note} | SendGrid error: ${t}` : `SendGrid error: ${t}`;
        } catch (_) {
          note = note ? `${note} | SendGrid failed` : 'SendGrid failed';
        }
      }
    }

    // Helper to send email via Mailgun
    async function sendViaMailgun() {
      const params = new URLSearchParams();
      params.append('from', fromEmail);
      params.append('to', email);
      params.append('subject', 'Your Lhyst verification code');
      params.append('text', `Hello,\n\nYour Lhyst verification code is ${code}. It expires in 1 hour.\nPlease enter this code on the verification page to complete your registration.`);
      const auth = Buffer.from(`api:${mailgunKey}`).toString('base64');
      const res = await fetch(`https://api.mailgun.net/v3/${mailgunDomain}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });
      if (res.ok) {
        emailSent = true;
      } else {
        try {
          const t = await res.text();
          note = note ? `${note} | Mailgun error: ${t}` : `Mailgun error: ${t}`;
        } catch (_) {
          note = note ? `${note} | Mailgun failed` : 'Mailgun failed';
        }
      }
    }

    if (fromEmail) {
      // Attempt providers in order: Resend, SendGrid, Mailgun
      if (resendKey) {
        await sendViaResend();
      }
      if (!emailSent && sendgridKey) {
        await sendViaSendGrid();
      }
      if (!emailSent && mailgunKey && mailgunDomain) {
        await sendViaMailgun();
      }
      if (!emailSent && !note) {
        note = 'No email provider configured or all providers failed';
      }
    } else {
      note = 'FROM_EMAIL is not configured';
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, code, note }),
    };
  } catch (error) {
    console.error('generate-code error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'An unexpected error occurred' }),
    };
  }
};