import { z } from "zod";
import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

/**
 * POST /api/contact — deliver a contact-form message via Brevo over SMTP (smtp-relay.brevo.com).
 *
 * SMTP (not the v3 REST API) so it authenticates with Brevo's SMTP key (xsmtpsib-…). Cross-cutting
 * protection lives in the proxy: cross-origin POSTs are rejected and this path is IP-rate-limited
 * BEFORE the handler runs. Here we validate, escape all user content into the HTML body (no
 * injection), and send. The sender must be a verified Brevo sender (BREVO_SENDER_EMAIL); replies go
 * to the submitter via replyTo.
 *
 * Forced to the Node.js runtime: nodemailer opens a TCP/TLS socket, which the edge runtime can't.
 */
export const runtime = "nodejs";

const ContactBody = z.object({
  topic: z.string().min(1).max(80),
  name: z.string().min(1).max(100),
  email: z.string().email().max(200),
  urgency: z.string().min(1).max(80),
  message: z.string().min(1).max(5000),
});

const RECIPIENTS = ["ryanssareen@gmail.com", "ryansareen6@gmail.com"];

let cachedTransport: Transporter | null = null;

/** Lazily build the Brevo SMTP transport, or null when no SMTP key is configured. */
function getTransport(): Transporter | null {
  if (cachedTransport) return cachedTransport;
  const pass = process.env.BREVO_SMTP_KEY ?? process.env.BREVO_API_KEY;
  const user = process.env.BREVO_SMTP_LOGIN ?? process.env.BREVO_SENDER_EMAIL ?? "ryansareen6@gmail.com";
  if (!pass) return null;
  cachedTransport = nodemailer.createTransport({
    host: process.env.BREVO_SMTP_HOST ?? "smtp-relay.brevo.com",
    port: Number(process.env.BREVO_SMTP_PORT ?? 587),
    secure: false, // STARTTLS on 587
    auth: { user, pass },
  });
  return cachedTransport;
}

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

  const transport = getTransport();
  if (!transport) {
    return Response.json(
      { error: "Email isn’t configured yet. Please email us directly in the meantime." },
      { status: 503 },
    );
  }
  const from = process.env.BREVO_SENDER_EMAIL ?? "ryansareen6@gmail.com";

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
    await transport.sendMail({
      from: { name: "Keeper Contact", address: from },
      to: RECIPIENTS,
      replyTo: { name, address: email },
      subject,
      html,
      text,
    });
  } catch (e) {
    console.error("Brevo SMTP send failed:", e instanceof Error ? e.message : e);
    return Response.json({ error: "Couldn’t send your message — please try again." }, { status: 502 });
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
