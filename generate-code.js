

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
    /*
     * We no longer enforce a cooldown period for sending verification codes.
     * Previously we queried the `email_codes` table for existing unused codes
     * and prevented new codes from being sent until the prior code expired.
     * This logic has been removed so a new code is generated on every sign‑up attempt.
     */
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
    // Send the code via Resend
    const resendKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.FROM_EMAIL;
    if (!resendKey || !fromEmail) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Email configuration is missing' }),
      };
    }
    const emailRes = await fetch('https://api.resend.com/v1/emails', {
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
    if (!emailRes.ok) {
      const eText = await emailRes.text();
      return {
        statusCode: 500,
        body: JSON.stringify({ error: `Failed to send verification email: ${eText}` }),
      };
    }
    return {
      statusCode: 200,
      body: JSON.stringify({ success: true }),
    };
  } catch (error) {
    console.error('generate-code error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'An unexpected error occurred' }),
    };
  }
};