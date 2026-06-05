import { z } from "zod";

/**
 * POST /api/contact — deliver a contact-form message via Brevo's transactional email API.
 *
 * Cross-cutting protection lives in the proxy: cross-origin POSTs are rejected and this path is
 * IP-rate-limited BEFORE the handler runs, so a flood never reaches Brevo. Here we validate, escape
 * all user content into the HTML body (no injection), and send. The sender must be a verified Brevo
 * sender (BREVO_SENDER_EMAIL); replies go to the submitter via replyTo.
 */

const ContactBody = z.object({
  topic: z.string().min(1).max(80),
  name: z.string().min(1).max(100),
  email: z.string().email().max(200),
  urgency: z.string().min(1).max(80),
  message: z.string().min(1).max(5000),
});

const RECIPIENTS = ["ryanssareen@gmail.com", "ryansareen6@gmail.com"];

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = ContactBody.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Please fill in every field with a valid email." }, { status: 400 });
  }
  const { topic, name, email, urgency, message } = parsed.data;

  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    // Misconfiguration, not user error — don't pretend it sent.
    return Response.json(
      { error: "Email isn’t configured yet. Please email us directly in the meantime." },
      { status: 503 },
    );
  }
  const sender = process.env.BREVO_SENDER_EMAIL ?? "ryansareen6@gmail.com";

  const subject = `[Keeper] ${topic} — ${urgency}`;
  const html = `
    <h2 style="font:600 18px sans-serif;margin:0 0 12px">New Keeper contact message</h2>
    <table style="font:14px sans-serif;border-collapse:collapse">
      <tr><td style="padding:4px 12px 4px 0;color:#71717a">Topic</td><td>${esc(topic)}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#71717a">Urgency</td><td>${esc(urgency)}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#71717a">Name</td><td>${esc(name)}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#71717a">Email</td><td>${esc(email)}</td></tr>
    </table>
    <p style="font:14px sans-serif;white-space:pre-wrap;margin-top:16px;line-height:1.5">${esc(message)}</p>`;
  const text = `New Keeper contact message\n\nTopic: ${topic}\nUrgency: ${urgency}\nName: ${name}\nEmail: ${email}\n\n${message}`;

  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": apiKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: { name: "Keeper Contact", email: sender },
        to: RECIPIENTS.map((e) => ({ email: e })),
        replyTo: { email, name },
        subject,
        htmlContent: html,
        textContent: text,
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("Brevo send failed:", res.status, detail.slice(0, 300));
      return Response.json({ error: "Couldn’t send your message — please try again." }, { status: 502 });
    }
  } catch (e) {
    console.error("Brevo request error:", e instanceof Error ? e.message : e);
    return Response.json({ error: "Couldn’t reach our email provider — please try again." }, { status: 502 });
  }

  return Response.json({ ok: true }, { status: 200 });
}

/** Escape user content for safe interpolation into the HTML email body. */
function esc(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
