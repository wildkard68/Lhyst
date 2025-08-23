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

    /*
     * Determine the subscription pricing based on the selected plan and billing
     * frequency. The client should provide two properties:
     *   - plan: "basic" or "pro"
     *   - frequency: "monthly" or "yearly"
     *
     * Basic plans cost $9.99 per month. Pro plans cost 1.5× the Basic price.
     * Yearly billing applies a 10% discount to the equivalent annual total.
     */
    const selectedPlan = body.plan === 'pro' ? 'pro' : 'basic';
    const frequency = body.frequency === 'yearly' ? 'yearly' : 'monthly';

    // Set the base monthly price in dollars for the selected plan
    const baseMonthlyPrice = selectedPlan === 'pro' ? 9.99 * 1.5 : 9.99;

    let interval = 'month';
    let amountInCents;
    if (frequency === 'yearly') {
      interval = 'year';
      const yearlyTotal = baseMonthlyPrice * 12 * 0.9; // 10% discount on yearly total
      amountInCents = Math.round(yearlyTotal * 100);
    } else {
      amountInCents = Math.round(baseMonthlyPrice * 100);
    }

    // Build form data for the Stripe Checkout session request
    const params = new URLSearchParams();
    params.append('payment_method_types[]', 'card');
    params.append('line_items[0][price_data][currency]', 'usd');
    params.append('line_items[0][price_data][product_data][name]', `Lhyst Subscription – ${selectedPlan === 'pro' ? 'Pro' : 'Basic'}`);
    params.append('line_items[0][price_data][recurring][interval]', interval);
    params.append('line_items[0][price_data][unit_amount]', amountInCents.toString());
    params.append('line_items[0][quantity]', '1');
    params.append('mode', 'subscription');
    params.append('subscription_data[trial_period_days]', '14');
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
      return { statusCode: response.status, body: JSON.stringify(data) };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ url: data.url, id: data.id })
    };
  } catch (error) {
    console.error('Error creating checkout session:', error);
    return { statusCode: 500, body: JSON.stringify({ error: 'Internal Server Error' }) };
  }
};