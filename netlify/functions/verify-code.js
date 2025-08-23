/*
 * Netlify Function: verify-code
 *
 * This function verifies a one‑time verification code sent to a user's email
 * during account creation. It checks that the code exists, hasn't expired,
 * and hasn't been used. Upon successful verification, it marks the code as
 * used, creates the user via the Supabase admin API, and inserts/updates a
 * row in the `profiles` table with the selected plan and trial expiry. The
 * user's email is automatically confirmed. The function requires the
 * Supabase service role key so it should never be exposed to the client.
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
    const code = (body.code || '').trim();
    const password = body.password || '';
    const plan = body.plan || 'basic';
    if (!email || !code || !password) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Email, code and password are required' }),
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
    // Fetch matching code row
    const codesRes = await fetch(
      `${supabaseUrl}/rest/v1/email_codes?email=eq.${encodeURIComponent(
        email
      )}&code=eq.${encodeURIComponent(code)}&used=eq.false`,
      {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
      }
    );
    if (!codesRes.ok) {
      const t = await codesRes.text();
      return {
        statusCode: 500,
        body: JSON.stringify({ error: `Failed to verify code: ${t}` }),
      };
    }
    const codes = await codesRes.json();
    if (!Array.isArray(codes) || codes.length === 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid or expired verification code' }),
      };
    }
    const codeRow = codes[0];
    const now = Date.now();
    const expiryTime = new Date(codeRow.expires_at).getTime();
    if (expiryTime < now) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Verification code has expired' }),
      };
    }
    // Mark the code as used
    const markRes = await fetch(
      `${supabaseUrl}/rest/v1/email_codes?email=eq.${encodeURIComponent(
        email
      )}&code=eq.${encodeURIComponent(code)}`,
      {
        method: 'PATCH',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ used: true }),
      }
    );
    if (!markRes.ok) {
      const t2 = await markRes.text();
      return {
        statusCode: 500,
        body: JSON.stringify({ error: `Failed to mark code as used: ${t2}` }),
      };
    }
    // Create the user if not already present.
    const createRes = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password, email_confirm: true }),
    });
    let userId;
    if (!createRes.ok) {
      // If user already exists, that's fine; just fetch their ID.
      const listRes = await fetch(
        `${supabaseUrl}/auth/v1/admin/users?email=${encodeURIComponent(email)}`,
        {
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
          },
        }
      );
      const listData = await listRes.json();
      if (listData && listData.users && listData.users.length > 0) {
        userId = listData.users[0].id;
      } else {
        // Could not fetch existing user; return error
        const tex = await createRes.text();
        return {
          statusCode: 400,
          body: JSON.stringify({ error: `Failed to create user: ${tex}` }),
        };
      }
    } else {
      const created = await createRes.json();
      userId = created && created.id ? created.id : (created.user && created.user.id);
    }
    // Upsert profile with plan and trial information. The `profiles` table stores
    // minimal subscription details. We omit fields that aren't defined in the
    // table schema (such as plan_start_at and email_confirmed) to avoid
    // PostgREST errors when the columns don't exist. The trial end date is
    // calculated as 14 days from now. If a row already exists for this user,
    // PostgREST will merge the new values due to the `Prefer` header.
    const trialEnd = new Date(now + 14 * 24 * 60 * 60 * 1000).toISOString();
    await fetch(`${supabaseUrl}/rest/v1/profiles`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify([
        {
          id: userId,
          plan: plan,
          trial_end_at: trialEnd,
        },
      ]),
    });
    return {
      statusCode: 200,
      body: JSON.stringify({ success: true }),
    };
  } catch (error) {
    console.error('verify-code error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'An unexpected error occurred' }),
    };
  }
};