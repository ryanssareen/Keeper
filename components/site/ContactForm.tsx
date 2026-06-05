"use client";

import { useState } from "react";
import Link from "next/link";
import s from "@/app/contact/contact.module.css";

const TOPICS = ["A trip that broke", "How it works", "Billing", "Partnership", "Something else"];
const URGENCIES = [
  "Not urgent — whenever you can",
  "Soon — within a day",
  "Urgent — a watch is firing now",
];

export function ContactForm(): React.ReactElement {
  const [topic, setTopic] = useState(TOPICS[0]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [urgency, setUrgency] = useState(URGENCIES[0]);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, name: name.trim(), email: email.trim(), urgency, message: message.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Couldn’t send your message — try again.");
        return;
      }
      setSent(true);
    } catch {
      setError("Network error — try again.");
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <div className={s.formCard}>
        <div className={s.sent}>
          <div className={s.okRing}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M20 6 9 17l-5-5" stroke="#059669" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
          <h3>Message sent</h3>
          <p>Thanks — we’ve got it. A human will reply to your email shortly. If it’s urgent, we’re already on it.</p>
          <Link className="btn btn-secondary" href="/" style={{ marginTop: 20 }}>Back to home</Link>
        </div>
      </div>
    );
  }

  return (
    <div className={s.formCard}>
      <h2>Send a message</h2>
      <p className={s.fcSub}>We typically reply within one business day.</p>
      <form className={s.cform} onSubmit={submit}>
        <div>
          <label className="field-label">What’s this about?</label>
          <div className={s.topics}>
            {TOPICS.map((t) => (
              <button type="button" key={t} className={`${s.topic} ${topic === t ? s.sel : ""}`} onClick={() => setTopic(t)}>
                {t}
              </button>
            ))}
          </div>
        </div>
        <div className={s.two}>
          <div><label className="field-label" htmlFor="cn">Name</label><input className="field" id="cn" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" required /></div>
          <div><label className="field-label" htmlFor="ce">Email</label><input className="field" id="ce" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required /></div>
        </div>
        <div>
          <label className="field-label" htmlFor="cu">Urgency</label>
          <select className="field" id="cu" value={urgency} onChange={(e) => setUrgency(e.target.value)}>
            {URGENCIES.map((u) => <option key={u}>{u}</option>)}
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="cm">Message</label>
          <textarea className="field" id="cm" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Tell us what happened, or what you’re trying to do…" required />
        </div>
        {error ? <p className={s.error}>{error}</p> : null}
        <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={sending}>
          {sending ? "Sending…" : "Send message"}
        </button>
      </form>
    </div>
  );
}
