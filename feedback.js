// netlify/functions/feedback.js
// Sends feedback email to the configured address using Resend, SendGrid, or Mailgun.
// Set one of these in Netlify env vars:
//   RESEND_API_KEY, FROM_EMAIL
//   SENDGRID_API_KEY, FROM_EMAIL
//   MAILGUN_API_KEY, MAILGUN_DOMAIN, FROM_EMAIL
// Request body JSON: { to, subject, body, from?, name? }

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }
    const data = JSON.parse(event.body || "{}");
    const to = data.to;
    const subject = "Feedback"; // enforce fixed subject
    const text = String(data.body || "").slice(0, 20000); // limit
    const replyTo = data.from || undefined;
    const reporter = data.name || undefined;

    if (!to || !text) {
      return { statusCode: 400, body: "Missing 'to' or 'body'." };
    }

    // Provider A: Resend
    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    const FROM_EMAIL = process.env.FROM_EMAIL || "no-reply@yourdomain.com";
    if (RESEND_API_KEY) {
      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: [to],
          subject,
          text,
          reply_to: replyTo ? [replyTo] : undefined,
        })
      });
      if (!resp.ok) {
        const t = await resp.text();
        return { statusCode: 500, body: "Resend error: " + t };
      }
      return { statusCode: 200, body: "Sent via Resend" };
    }

    // Provider B: SendGrid
    const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
    if (SENDGRID_API_KEY) {
      const sgBody = {
        personalizations: [{ to: [{ email: to }], subject }],
        from: { email: FROM_EMAIL, name: reporter || "Lhyst" },
        reply_to: replyTo ? { email: replyTo } : undefined,
        content: [{ type: "text/plain", value: text }]
      };
      const resp = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${SENDGRID_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(sgBody)
      });
      if (resp.status >= 200 && resp.status < 300) {
        return { statusCode: 200, body: "Sent via SendGrid" };
      } else {
        const t = await resp.text();
        return { statusCode: 500, body: "SendGrid error: " + t };
      }
    }

    // Provider C: Mailgun (REST API)
    const MAILGUN_API_KEY = process.env.MAILGUN_API_KEY;
    const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN;
    if (MAILGUN_API_KEY && MAILGUN_DOMAIN) {
      const form = new URLSearchParams();
      form.append("from", FROM_EMAIL);
      form.append("to", to);
      form.append("subject", subject);
      form.append("text", text);
      if (replyTo) form.append("h:Reply-To", replyTo);
      const resp = await fetch(`https://api.mailgun.net/v3/${MAILGUN_DOMAIN}/messages`, {
        method: "POST",
        headers: {
          "Authorization": "Basic " + Buffer.from("api:" + MAILGUN_API_KEY).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: form.toString()
      });
      if (!resp.ok) {
        const t = await resp.text();
        return { statusCode: 500, body: "Mailgun error: " + t };
      }
      return { statusCode: 200, body: "Sent via Mailgun" };
    }

    return { statusCode: 500, body: "No email provider configured. Set RESEND_API_KEY or SENDGRID_API_KEY or MAILGUN_API_KEY env var in Netlify." };
  } catch (err) {
    return { statusCode: 500, body: "Server error: " + (err && err.message || String(err)) };
  }
};
