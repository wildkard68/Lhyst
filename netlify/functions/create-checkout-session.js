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

    const plan = body.plan === 'yearly' ? 'yearly' : 'monthly';

    // Determine the recurring interval and amount (in cents). The yearly plan
    // applies a $1 discount per month (i.e. $8.99/month when billed yearly).
    let interval = 'month';
    let amount = 999; // $9.99 in cents
    if (plan === 'yearly') {
      interval = 'year';
      // 12 months * $8.99 = $107.88; convert dollars to cents
      amount = Math.round(8.99 * 12 * 100);
    }

    // Build form data for the Stripe Checkout session request
    const params = new URLSearchParams();
    // Accept card payments
    params.append('payment_method_types[]', 'card');
    // Define the line item and price data
    params.append('line_items[0][price_data][currency]', 'usd');
    params.append('line_items[0][price_data][product_data][name]', 'Lhyst Subscription');
    params.append('line_items[0][price_data][recurring][interval]', interval);
    params.append('line_items[0][price_data][unit_amount]', amount.toString());
    params.append('line_items[0][quantity]', '1');
    // Subscription mode to create a recurring subscription
    params.append('mode', 'subscription');
    // Configure a 14‑day trial period
    params.append('subscription_data[trial_period_days]', '14');
    // Success and cancel URLs – include the session ID token in the success URL
    params.append('success_url', 'https://lhystlog.com/#/success?session_id={CHECKOUT_SESSION_ID}');
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