import Link from "next/link";
import type { Metadata } from "next";
import { SiteNav } from "@/components/site/SiteNav";
import { SiteFooter } from "@/components/site/SiteFooter";
import s from "./landing.module.css";

export const metadata: Metadata = {
  title: "Keeper — Your whole trip, in one calm place",
  description:
    "Plan your days, keep every booking and document together, and stay ahead of your flight — without juggling a dozen apps and group chats.",
};

export default function LandingPage(): React.ReactElement {
  return (
    <>
      <SiteNav />

      {/* HERO */}
      <section className={s.hero}>
        <div className={`k-container ${s.heroGrid}`}>
          <div>
            <span className="k-eyebrow">Trip planning &amp; organization</span>
            <h1>
              Your whole trip, in <em>one calm place.</em>
            </h1>
            <p className={s.heroSub}>
              Plan your days, keep every booking and document together, and know exactly where things
              stand — without juggling a dozen apps and group chats.
            </p>
            <div className={s.heroActions}>
              <Link className="btn btn-primary btn-lg" href="/signup">
                Plan your next trip
              </Link>
              <Link className="btn btn-secondary btn-lg" href="/features">
                See how it works
              </Link>
            </div>
            <div className={s.heroNote}>
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                <path d="M13.5 4.5 6 12 2.5 8.5" stroke="#10b981" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              No card to start · works on every device · plans, bookings, and docs in one spot
            </div>
          </div>

          {/* product mock: a calm, organized trip */}
          <div className={s.mock}>
            <div className={s.floatPill}>
              <svg className={s.ring} viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="9" stroke="#bbf7d0" strokeWidth="3" />
                <path d="m8.5 12 2.3 2.3L15.5 9.5" stroke="#10b981" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <div className={s.t}>
                <b>Flight on time</b>
                <span>EK 9 · LGW</span>
              </div>
            </div>
            <div className={s.mockCard}>
              <div className={s.mockTop}>
                <span className="k-label">Keeper · your trip</span>
                <span className="pill pill-ok pill-dot">On track</span>
              </div>
              <div className={s.mockBody}>
                <div className={s.mockRoute}>
                  Tokyo <span className={s.arrow}>·</span> 6 days
                </div>
                <div className={s.mockWhen}>
                  Day 2 · <b>today&apos;s plan</b>
                </div>

                <div className={s.planList}>
                  <div className={s.planRow}><span>Morning</span><b>Senso-ji &amp; Asakusa</b></div>
                  <div className={s.planRow}><span>Afternoon</span><b>teamLab Planets</b></div>
                  <div className={s.planRow}><span>Evening</span><b>Dinner in Shinjuku</b></div>
                </div>

                <div className={s.mockFacts}>
                  <div className={s.cell}>
                    <span className="k-label">Bookings</span>
                    <div className={s.v}>4 saved</div>
                  </div>
                  <div className={s.cell}>
                    <span className="k-label">Documents</span>
                    <div className={s.v}>7 filed</div>
                  </div>
                  <div className={s.cell}>
                    <span className="k-label">Flight</span>
                    <div className={s.v} style={{ color: "#059669" }}>On time</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* LOGO STRIP */}
      <div className={`${s.strip} k-container`}>
        <p>Built for the one person who holds the whole trip together</p>
        <div className={s.stripRow}>
          <span>Family organizers</span>
          <span>Frequent flyers</span>
          <span>Group trip leads</span>
          <span>Business travelers</span>
        </div>
      </div>

      {/* PROBLEM / ONE PLACE */}
      <section className={`${s.block} ${s.blockTinted}`}>
        <div className="k-container">
          <div className={s.blockHead}>
            <span className={`k-eyebrow ${s.sectionTag}`}>Why Keeper</span>
            <h2>Your trip lives in a dozen places. Keeper brings it into one.</h2>
            <p>
              Flights in one app, the hotel in another, tickets buried in your inbox, the plan in a group
              chat. Keeper holds the whole trip — bookings, documents, and a real day-by-day plan — in a
              single calm place, and keeps a quiet eye on your flight so you&apos;re not the last to know.
            </p>
          </div>
          <div className={s.cascade}>
            <div className={s.cascItem}>
              <span className="k-label">Itinerary</span>
              <h5>A real day plan</h5>
              <p>A relaxed, realistic day-by-day plan you can tweak — grouped morning, afternoon, evening.</p>
            </div>
            <div className={s.cascItem}>
              <span className="k-label">Bookings</span>
              <h5>Flights &amp; hotels</h5>
              <p>Your flight and stay, with the details that matter, instead of scattered across apps.</p>
            </div>
            <div className={s.cascItem}>
              <span className="k-label">Documents</span>
              <h5>Everything filed</h5>
              <p>Passports, tickets, and confirmations — uploaded and organized by type, ready when you need them.</p>
            </div>
            <div className={s.cascItem}>
              <span className="k-label">Flight status</span>
              <h5>A quiet heads-up</h5>
              <p>Keeper watches your flight and tells you if the time moves — calmly, not a feed of noise.</p>
            </div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className={s.block} id="how">
        <div className="k-container">
          <div className={s.blockHead}>
            <span className={`k-eyebrow ${s.sectionTag}`}>How Keeper works</span>
            <h2>Set it up once. Travel with everything in hand.</h2>
            <p>A few minutes to add your trip, and Keeper turns it into a plan and a tidy home for the rest.</p>
          </div>
          <div className={s.steps}>
            <div className={s.step}>
              <span className={s.num}>01 / SET UP</span>
              <h4>Add your trip</h4>
              <p>
                Where you&apos;re going and when, who&apos;s coming, and any flights or hotels you&apos;ve
                already booked. It takes a couple of minutes.
              </p>
            </div>
            <div className={s.step}>
              <span className={s.num}>02 / PLAN</span>
              <h4>Plan your days</h4>
              <p>
                Keeper builds a relaxed, real day-by-day itinerary — a few well-chosen places a day, every
                one a real spot on the map. Refine it however you like.
              </p>
            </div>
            <div className={s.step}>
              <span className={s.num}>03 / KEEP</span>
              <h4>Keep it together</h4>
              <p>
                Every booking and document in one place — and a quiet heads-up if your flight time changes,
                so nothing catches you off guard.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section className={`${s.block} ${s.blockTinted}`}>
        <div className="k-container">
          <div className={s.blockHead}>
            <span className={`k-eyebrow ${s.sectionTag}`}>What you get</span>
            <h2>Everything for the trip, in one calm place.</h2>
          </div>
          <div className={s.features}>
            <Feat
              icon={<><path d="M3 5h14M3 10h14M3 15h9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></>}
              title="A real day-by-day plan"
              body="A relaxed, realistic itinerary grouped into morning, afternoon, and evening — every stop a real, mappable place, not a packed checklist."
            />
            <Feat
              icon={<><path d="M10 2.5 4 5v4c0 3.7 2.5 6.5 6 8 3.5-1.5 6-4.3 6-8V5l-6-2.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /><path d="m7.5 10 1.8 1.8L13 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></>}
              title="Every booking in one place"
              body="Your flight and hotel and the details that matter, together — instead of scattered across a dozen apps and email threads."
            />
            <Feat
              icon={<><path d="M5 3h7l3 3v11H5V3Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /><path d="M12 3v3h3M7.5 11h5M7.5 13.5h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></>}
              title="Documents, filed"
              body="Upload passports, tickets, and confirmations — organized by type and ready the moment you need them."
            />
            <Feat
              icon={<><circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.4" /><path d="M10 6v4l2.5 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></>}
              title="Calm flight awareness"
              body="Keeper keeps an eye on your flight and gives you a quiet heads-up if the time changes — no doom-scrolling, no constant pings."
            />
            <Feat
              icon={<><circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.4" /><path d="M2.5 10h15M10 2.5c2 2.3 2 12.7 0 15M10 2.5c-2 2.3-2 12.7 0 15" stroke="currentColor" strokeWidth="1.4" /></>}
              title="Works everywhere"
              body="Cross-platform from day one. Install it to your home screen and your whole trip is a tap away, on any device."
            />
            <Feat
              icon={<><path d="M10 2.5 4 5v4c0 3.7 2.5 6.5 6 8 3.5-1.5 6-4.3 6-8V5l-6-2.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></>}
              title="Yours, and private"
              body="Your trip and your documents are yours. No selling your data, no spam — just a calm place that's on your side."
            />
          </div>
        </div>
      </section>

      {/* QUOTE */}
      <section className={s.block}>
        <div className="k-container">
          <div className={s.quoteBlock}>
            <span className="k-label">Why it exists</span>
            <blockquote>
              &quot;The hard part was never storing a booking. It was being the one person everyone leans
              on to keep the whole trip straight.&quot;
            </blockquote>
            <div className={s.who}>
              <span className={s.av}>R</span>
              <div>
                <b>Ryan S.</b>
                <span>Founder, Keeper</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className={s.final}>
        <div className="k-container">
          <h2>Get your next trip organized.</h2>
          <p>One calm place for the plan, the bookings, and the docs.</p>
          <div className={s.heroActions}>
            <Link className="btn btn-primary btn-lg" href="/signup">
              Plan your next trip
            </Link>
            <Link className="btn btn-secondary btn-lg" href="/contact">
              Talk to us
            </Link>
          </div>
        </div>
      </section>

      <SiteFooter />
    </>
  );
}

function Feat({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }): React.ReactElement {
  return (
    <div className={s.feat}>
      <div className={s.ic}>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          {icon}
        </svg>
      </div>
      <h4>{title}</h4>
      <p>{body}</p>
    </div>
  );
}
