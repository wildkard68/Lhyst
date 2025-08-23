/*
 * Netlify serverless function to create a Stripe Checkout session for subscriptions.
 *
 * This function accepts a JSON payload specifying a plan type (either
 * `monthly` or `yearly`) and returns a Checkout session URL. It uses the
 * secret Stripe API key stored in the environment (STRIPE_SECRET_KEY) to
 * communicate with the Stripe REST API directly via fetch instead of
 * requiring the stripe npm package. Each call builds a price on the fly
 * using price_data rather than relying on pre‑defined Price IDs. A
 * 14‑day trial period is configured through the `subscription_data`
 * parameter.
 */

// Use the built‑in fetch API available in modern Node runtimes. Netlify
// functions run on Node 18+ which exposes a global fetch implementation,
// so we do not need to include an external dependency like node-fetch.

exports.handler = async (event) => {
  try {
    // Only allow POST requests
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    // Parse the incoming request body
    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch (err) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
    }

    const { plan: selectedPlan = 'basic', frequency = 'monthly' } = body;
    /*
     * Determine the Stripe Price ID based on the selected plan and billing frequency.
     * Price IDs are stored in environment variables as follows:
     *   - PRICE_BASIC_MONTHLY
     *   - PRICE_BASIC_YEARLY
     *   - PRICE_PRO_MONTHLY
     *   - PRICE_PRO_YEARLY
     */
    let priceId;
    if (selectedPlan === 'pro' && frequency === 'yearly') {
      priceId = process.env.PRICE_PRO_YEARLY;
    } else if (selectedPlan === 'pro' && frequency === 'monthly') {
      priceId = process.env.PRICE_PRO_MONTHLY;
    } else if (selectedPlan === 'basic' && frequency === 'yearly') {
      priceId = process.env.PRICE_BASIC_YEARLY;
    } else {
      priceId = process.env.PRICE_BASIC_MONTHLY;
    }
    if (!priceId) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Stripe price configuration is missing' }) };
    }
    // Build form data for the Stripe Checkout session request
    const params = new URLSearchParams();
    params.append('payment_method_types[]', 'card');
    // Use the pre‑defined price instead of constructing one on the fly
    params.append('line_items[0][price]', priceId);
    params.append('line_items[0][quantity]', '1');
    params.append('mode', 'subscription');
    params.append('subscription_data[trial_period_days]', '14');
    // Include selected plan in success URL for front‑end logic
    params.append('success_url', `https://lhystlog.com/#/success?session_id={CHECKOUT_SESSION_ID}&plan=${selectedPlan}`);
    params.append('cancel_url', 'https://lhystlog.com/#/cancel');

    // Call the Stripe Checkout API
    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params
    });

    const data = await response.json();
    if (!response.ok) {
      // Pass through any error from Stripe
      return { statusCode: response.status, body: JSON.stringify(data) };
    }

    // Return the Checkout session URL
    return {
      statusCode: 200,
      body: JSON.stringify({ url: data.url, id: data.id })
    };
  } catch (error) {
    console.error('Error creating checkout session:', error);
    return { statusCode: 500, body: JSON.stringify({ error: 'Internal Server Error' }) };
  }
};