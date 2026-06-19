import type { Metadata } from "next";
import { SiteNav } from "@/components/site/SiteNav";
import { SiteFooterCompact } from "@/components/site/SiteFooter";
import { ContactForm } from "@/components/site/ContactForm";
import s from "./contact.module.css";

export const metadata: Metadata = {
  title: "Keeper — Contact",
  description: "Tell us about your trip — or what broke. A human reads every message.",
};

export default function ContactPage(): React.ReactElement {
  return (
    <>
      <SiteNav active="contact" />

      <div className={s.wrap}>
        <div className={`k-container ${s.grid}`}>
          <div className={s.lead}>
            <span className="k-eyebrow">We’re a small team</span>
            <h1>Tell us about your trip.</h1>
            <p>
              Whether you’re planning something big, evaluating Keeper for your travel, or have a
              question about how it works, a human reads every message.
            </p>

            <div className={s.channels}>
              <div className={s.channel}>
                <span className={s.cic}>
                  <svg width="19" height="19" viewBox="0 0 20 20" fill="none"><rect x="2.5" y="4" width="15" height="12" rx="2.5" stroke="currentColor" strokeWidth="1.4" /><path d="m3.5 5.5 6.5 5 6.5-5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </span>
                <div><b>Email support</b><p>For account and how-it-works questions.</p><a className={s.lk} href="mailto:ryanssareen@gmail.com">ryanssareen@gmail.com →</a></div>
              </div>
              <div className={s.channel}>
                <span className={s.cic}>
                  <svg width="19" height="19" viewBox="0 0 20 20" fill="none"><path d="M10 2.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15Z" stroke="currentColor" strokeWidth="1.4" /><path d="M10 6v4l2.5 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </span>
                <div><b>Mid-trip and urgent?</b><p>If a watch is firing and you need help right now, mark your message urgent — we triage those first.</p></div>
              </div>
              <div className={s.channel}>
                <span className={s.cic}>
                  <svg width="19" height="19" viewBox="0 0 20 20" fill="none"><path d="M4 16V5a1.5 1.5 0 0 1 1.5-1.5H10l1.5 2h3A1.5 1.5 0 0 1 16 7v9" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>
                </span>
                <div><b>Partnerships &amp; press</b><p>Connectors, write-access partners, and media.</p><a className={s.lk} href="mailto:ryansareen6@gmail.com">ryansareen6@gmail.com →</a></div>
              </div>
            </div>
          </div>

          <ContactForm />
        </div>
      </div>

      <SiteFooterCompact />
    </>
  );
}
