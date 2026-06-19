import Link from "next/link";
import type { Metadata } from "next";
import { SiteNav } from "@/components/site/SiteNav";
import { SiteFooterCompact } from "@/components/site/SiteFooter";
import s from "./features.module.css";

export const metadata: Metadata = {
  title: "Keeper — Features",
  description:
    "How Keeper organizes your whole trip: bookings and documents in one place, a real day-by-day plan, and calm flight awareness.",
};

const Check = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
    <path d="M13.5 4.5 6 12 2.5 8.5" stroke="#10b981" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const YesMark = () => (
  <svg width="18" height="18" viewBox="0 0 16 16" fill="none" className={s.yes}>
    <path d="M13.5 4.5 6 12 2.5 8.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const NoMark = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={s.no}>
    <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

const PartialMark = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ color: "var(--amber-500)" }}>
    <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" />
    <path d="M8 5v3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const COMPARE: { capability: string; tracker: "yes" | "no" | "partial" }[] = [
  { capability: "Tracks your flight status", tracker: "yes" },
  { capability: "Holds your whole trip — bookings & documents", tracker: "no" },
  { capability: "Builds a real day-by-day plan", tracker: "no" },
  { capability: "Flags when a connection or check-in gets tight", tracker: "no" },
  { capability: "Works across every platform", tracker: "partial" },
];

export default function FeaturesPage(): React.ReactElement {
  return (
    <>
      <SiteNav active="features" />

      <section className={s.pageHero}>
        <div className="k-container">
          <span className="k-eyebrow">Inside the product</span>
          <h1>One place for your whole trip.</h1>
          <p>
            Keeper turns your flights, hotels, and plans into a single organized trip — a real
            day-by-day itinerary, your documents on hand, and a quiet eye on your flight so the timings
            never catch you off guard.
          </p>
        </div>
      </section>

      <div className={`k-container ${s.pillars}`}>
        {/* Pillar 1: ingestion */}
        <div className={`${s.pillar} ${s.flip}`}>
          <div className={s.pillarCopy}>
            <span className={s.num}>Layer 01 · Your trip</span>
            <h2>Everything in one place</h2>
            <p>
              Keeper turns flights, hotels, and reservations into one organized trip — each saved with a
              real <b>time and place</b>, alongside your documents, so nothing lives in a different app or
              an old email thread.
            </p>
            <ul>
              <li><Check />Flight tracking as the acquisition hook and first connector</li>
              <li><Check />Hotel-confirmation parsing from your own emails</li>
              <li><Check />Manually-added reservations with a place &amp; deadline</li>
            </ul>
          </div>
          <div className={s.panel}>
            <span className="k-label" style={{ marginBottom: 14, display: "block" }}>Modeled trip items</span>
            <div className={s.ingest}>
              <span className={s.chip}><span className={s.d} style={{ background: "var(--emerald-500)" }} />EK 9 · DXB → LGW</span>
              <span className={s.chip}><span className={s.d} style={{ background: "var(--emerald-500)" }} />Airport car · 18:40</span>
              <span className={s.chip}><span className={s.d} style={{ background: "var(--amber-500)" }} />Hotel check-in · ≤ 22:00</span>
              <span className={s.chip}><span className={s.d} style={{ background: "var(--red-500)" }} />Dinner · Trafalgar Sq · 19:30</span>
              <span className={s.chip}><span className={s.d} style={{ background: "var(--zinc-300)" }} />+ Add item</span>
            </div>
            <div className={s.notif} style={{ marginTop: 16, boxShadow: "none", background: "var(--bg)" }}>
              <div className={s.meta} style={{ width: "100%" }}>
                <span className="k-label" style={{ margin: 0 }}>Resolved</span>
                <span className={s.tm} style={{ marginLeft: "auto", color: "var(--emerald-600)" }}>4 / 4 to time + place</span>
              </div>
            </div>
          </div>
        </div>

        {/* Pillar 2: reconciliation engine */}
        <div className={s.pillar}>
          <div className={s.pillarCopy}>
            <span className={s.num}>Layer 02 · Flight watch</span>
            <h2>Calm flight awareness</h2>
            <p>
              Keeper keeps a quiet eye on your flight and how its timing affects the rest of your day —
              and gives you a calm heads-up if a connection or check-in starts to look tight. No feed of
              noise, no doom-scrolling.
            </p>
            <ul>
              <li><Check />Live flight status, checked as it changes — not on a timer</li>
              <li><Check />A nudge when a connection or check-in window gets tight</li>
              <li><Check />Never cries wolf from stale data — it says &quot;can&apos;t confirm&quot;</li>
            </ul>
          </div>
          <div className={`${s.panel} ${s.panelEng}`}>
            <span className="k-label" style={{ marginBottom: 14, display: "block", color: "var(--zinc-500)" }}>Collision check · EK 9</span>
            <div className={s.engRow}><span className={s.lab}>Arrival</span><span className={s.val}>21:14 LGW</span><span className={s.tag} style={{ background: "#3f1d1d", color: "#fca5a5" }}>+90 min</span></div>
            <div className={s.engRow}><span className={s.lab}>Transit</span><span className={s.val}>38 min drive</span><span className={s.tag} style={{ background: "var(--zinc-800)", color: "var(--zinc-400)" }}>live route</span></div>
            <div className={s.engRow}><span className={s.lab}>Margin</span><span className={s.val}>15 min buffer</span><span className={s.tag} style={{ background: "var(--zinc-800)", color: "var(--zinc-400)" }}>manual</span></div>
            <div className={s.engRow}><span className={s.lab}>Deadline</span><span className={s.val}>19:30 dinner</span><span className={s.tag} style={{ background: "var(--zinc-800)", color: "var(--zinc-400)" }}>fixed</span></div>
            <div className={s.engResult}><span className={s.t}>Heads-up — dinner is tight</span><span className={s.n}>−22 min</span></div>
          </div>
        </div>

        {/* Pillar 3: concierge surface */}
        <div className={`${s.pillar} ${s.flip}`}>
          <div className={s.pillarCopy}>
            <span className={s.num}>Layer 03 · Output</span>
            <h2>The day-of heads-up</h2>
            <p>
              A nudge only helps if it reaches you in time. Keeper sends one calm push — naming what&apos;s
              tight and a suggested move — and mirrors it on a dashboard that stays accurate even if a
              notification slips.
            </p>
            <ul>
              <li><Check />Push/FCM alerts — silent until something actually breaks</li>
              <li><Check />A unified dashboard of every ingested item and catch</li>
              <li><Check />A shareable status view — family is the audience, not the editor</li>
            </ul>
          </div>
          <div className={s.panel}>
            <span className="k-label" style={{ marginBottom: 14, display: "block" }}>Lock screen</span>
            <div className={s.notif}>
              <div className={s.appIc}>
                <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="1.6" fill="#fff" /><path d="M8 4.2a3.8 3.8 0 0 1 3.8 3.8" stroke="#fff" strokeWidth="1.3" strokeLinecap="round" /><path d="M8 1.7a6.3 6.3 0 0 1 6.3 6.3" stroke="#a1a1aa" strokeWidth="1.3" strokeLinecap="round" /></svg>
              </div>
              <div style={{ flex: 1 }}>
                <div className={s.meta}><span className={s.nm}>Keeper</span><span className={s.tm}>now</span></div>
                <div className={s.body}><b>Heads up — your 19:30 dinner is getting tight.</b> EK 9 is running 90 min late. You could push the table to 20:15 to be safe. 41 min of lead.</div>
              </div>
            </div>
            <div className={s.notif} style={{ marginTop: 12, opacity: 0.6, boxShadow: "var(--shadow-sm)" }}>
              <div className={s.appIc} style={{ background: "var(--zinc-200)" }}>
                <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="1.6" fill="#52525b" /><path d="M8 4.2a3.8 3.8 0 0 1 3.8 3.8" stroke="#52525b" strokeWidth="1.3" strokeLinecap="round" /></svg>
              </div>
              <div style={{ flex: 1 }}>
                <div className={s.meta}><span className={s.nm}>Keeper</span><span className={s.tm}>2h ago</span></div>
                <div className={s.body}>On track — comfortable slack to your 19:30 dinner.</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* comparison */}
      <section className={s.compareSection}>
        <div className="k-container">
          <div className={s.compareIntro}>
            <span className="k-eyebrow">Why not just a flight tracker?</span>
            <h2>A tracker watches one flight. Keeper holds your whole trip — and keeps an eye on the timing.</h2>
          </div>
          <div className={s.compare}>
            <div className={`${s.compareRow} ${s.compareHead}`}>
              <div>Capability</div>
              <div>Flight tracker</div>
              <div className={s.keeperCol}>Keeper</div>
            </div>
            {COMPARE.map((row) => (
              <div className={s.compareRow} key={row.capability}>
                <div className={s.lbl}>{row.capability}</div>
                <div>{row.tracker === "yes" ? <YesMark /> : row.tracker === "partial" ? <PartialMark /> : <NoMark />}</div>
                <div className={s.keeperCol}><YesMark /></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={s.final}>
        <div className="k-container">
          <h2>Get your next trip organized.</h2>
          <p>Set it up in a couple of minutes. No card required.</p>
          <div className={s.acts}>
            <Link className="btn btn-primary btn-lg" href="/signup">Plan your next trip</Link>
            <Link className="btn btn-secondary btn-lg" href="/dashboard">See your dashboard</Link>
          </div>
        </div>
      </section>

      <SiteFooterCompact />
    </>
  );
}
