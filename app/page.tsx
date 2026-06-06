import Link from "next/link";
import type { Metadata } from "next";
import { SiteNav } from "@/components/site/SiteNav";
import { SiteFooter } from "@/components/site/SiteFooter";
import s from "./landing.module.css";

export const metadata: Metadata = {
  title: "Keeper — It catches your trip falling apart before you do",
  description:
    "When a flight slips, the transfer, the check-in window, and tonight's dinner are all silently wrong. Keeper sees the collision — and tells you what to do.",
};

const Arrow = () => (
  <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
    <path d="M4 11h13m0 0-5-5m5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export default function LandingPage(): React.ReactElement {
  return (
    <>
      <SiteNav />

      {/* HERO */}
      <section className={s.hero}>
        <div className={`k-container ${s.heroGrid}`}>
          <div>
            <span className="k-eyebrow">Trip-state reconciliation</span>
            <h1>
              It catches your trip falling{" "}apart <em>before you do.</em>
            </h1>
            <p className={s.heroSub}>
              When a flight slips, the transfer, the check-in window, and tonight&apos;s dinner are
              all silently wrong. Keeper sees the collision — and tells you what to do.
            </p>
            <div className={s.heroActions}>
              <Link className="btn btn-primary btn-lg" href="/signup">
                Watch your next trip
              </Link>
              <Link className="btn btn-secondary btn-lg" href="/features">
                See how it works
              </Link>
            </div>
            <div className={s.heroNote}>
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                <path d="M13.5 4.5 6 12 2.5 8.5" stroke="#10b981" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              No card to start · works on every device · one notification, not a feed
            </div>
          </div>

          {/* product mock: an at-risk catch */}
          <div className={s.mock}>
            <div className={s.floatPill}>
              <svg className={s.ring} viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="9" stroke="#fde68a" strokeWidth="3" />
                <path d="M12 3a9 9 0 0 1 8.5 6.1" stroke="#f59e0b" strokeWidth="3" strokeLinecap="round" />
              </svg>
              <div className={s.t}>
                <b>Caught 41 min early</b>
                <span>EK 9 · LGW</span>
              </div>
            </div>
            <div className={s.mockCard}>
              <div className={s.mockTop}>
                <span className="k-label">Keeper · watch</span>
                <span className="pill pill-risk pill-dot">At risk</span>
              </div>
              <div className={s.mockBody}>
                <div className={s.mockRoute}>
                  EK 9 <span className={s.arrow}>→</span> Trafalgar Sq
                </div>
                <div className={s.mockWhen}>
                  Be there by <b>19:30</b> · Europe/London
                </div>

                <div className={s.alert}>
                  <div className={s.alertHead}>
                    <span className="pill pill-solid-risk pill-dot">Cascade detected</span>
                  </div>
                  <h4>Your flight is now 90 min late — you&apos;ll miss the 19:30 dinner.</h4>
                  <p>
                    Projected arrival at the venue is 19:52 with your 15-min margin. That&apos;s a
                    22-minute miss.
                  </p>
                  <div className={s.alertAdvice}>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ marginTop: 2, flex: "0 0 auto" }}>
                      <path d="M8 1.5 9.6 6h4.4l-3.6 2.6 1.4 4.4L8 10.4 4.2 13l1.4-4.4L2 6h4.4L8 1.5Z" stroke="#d97706" strokeWidth="1.2" strokeLinejoin="round" />
                    </svg>
                    <div>
                      <span className="k-label">Do this now</span>
                      <p>Call the venue to push the table to 20:15, or pre-order so the kitchen holds.</p>
                    </div>
                  </div>
                </div>

                <div className={s.mockFacts}>
                  <div className={s.cell}>
                    <span className="k-label">Airport → place</span>
                    <div className={s.v}>38 min</div>
                  </div>
                  <div className={s.cell}>
                    <span className="k-label">Slack</span>
                    <div className={s.v} style={{ color: "var(--red-600)" }}>−22 min</div>
                  </div>
                  <div className={s.cell}>
                    <span className="k-label">Lead time</span>
                    <div className={s.v}>41 min</div>
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

      {/* PROBLEM / CASCADE */}
      <section className={`${s.block} ${s.blockTinted}`}>
        <div className="k-container">
          <div className={s.blockHead}>
            <span className={`k-eyebrow ${s.sectionTag}`}>The cascade problem</span>
            <h2>One delay doesn&apos;t break one thing. It breaks everything downstream.</h2>
            <p>
              Your booking apps each know their own piece. None of them know that a 90-minute slip
              just invalidated the next three. Keeper models the whole trip as one connected chain —
              and watches the joints.
            </p>
          </div>
          <div className={s.cascade}>
            <div className={`${s.cascItem} ${s.trigger}`}>
              <span className={`${s.cascState} pill pill-risk`}>+90 min</span>
              <span className="k-label">Flight</span>
              <h5>EK 9 delayed</h5>
              <p>Departure slips ninety minutes out of Dubai.</p>
              <span className={s.cascArrow}><Arrow /></span>
            </div>
            <div className={`${s.cascItem} ${s.broken}`}>
              <span className={`${s.cascState} pill pill-miss`}>Missed</span>
              <span className="k-label">Transfer</span>
              <h5>Airport car</h5>
              <p>Pickup booked for the old arrival time — driver gone.</p>
              <span className={s.cascArrow}><Arrow /></span>
            </div>
            <div className={`${s.cascItem} ${s.broken}`}>
              <span className={`${s.cascState} pill pill-miss`}>At risk</span>
              <span className="k-label">Hotel</span>
              <h5>Check-in window</h5>
              <p>Front desk holds the room only until 22:00.</p>
              <span className={s.cascArrow}><Arrow /></span>
            </div>
            <div className={`${s.cascItem} ${s.broken}`}>
              <span className={`${s.cascState} pill pill-miss`}>Missed</span>
              <span className="k-label">Dinner</span>
              <h5>19:30 reservation</h5>
              <p>The table everyone planned the evening around.</p>
            </div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className={s.block} id="how">
        <div className="k-container">
          <div className={s.blockHead}>
            <span className={`k-eyebrow ${s.sectionTag}`}>How Keeper works</span>
            <h2>Detect and advise — not auto-fix.</h2>
            <p>
              You stay in control. Keeper does the watching and the math, then hands you the one move
              that matters, while there&apos;s still time to make it.
            </p>
          </div>
          <div className={s.steps}>
            <div className={s.step}>
              <span className={s.num}>01 / MODEL</span>
              <h4>Add a flight and what it feeds</h4>
              <p>
                Point Keeper at a flight and the commitment downstream of it — a reservation, a
                check-in, a connection. It resolves both to a real time and place.
              </p>
            </div>
            <div className={s.step}>
              <span className={s.num}>02 / RECONCILE</span>
              <h4>We watch the joint, live</h4>
              <p>
                As the flight moves, Keeper re-runs the collision: arrival + transit + your margin
                against the deadline. The moment slack goes negative, it&apos;s a catch.
              </p>
            </div>
            <div className={s.step}>
              <span className={s.num}>03 / ADVISE</span>
              <h4>One alert, with the move</h4>
              <p>
                Not &quot;your flight is delayed&quot; — every app says that. Keeper tells you{" "}
                <em>what broke downstream</em> and the specific action to save it.
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
            <h2>A calm cockpit for an anxious moment.</h2>
          </div>
          <div className={s.features}>
            <Feat
              icon={<><path d="M10 2.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15Z" stroke="currentColor" strokeWidth="1.4" /><path d="M10 6v4l2.5 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></>}
              title="Live collision checks"
              body="Arrival, drive time, and your margin re-collided against the deadline on every flight update — not on a timer."
            />
            <Feat
              icon={<><path d="M10 2.5 4 5v4c0 3.7 2.5 6.5 6 8 3.5-1.5 6-4.3 6-8V5l-6-2.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /><path d="m7.5 10 1.8 1.8L13 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></>}
              title="One notification, not a feed"
              body="Keeper stays silent until something actually breaks. When it speaks, it's because you need to act."
            />
            <Feat
              icon={<><rect x="3" y="3" width="14" height="14" rx="3" stroke="currentColor" strokeWidth="1.4" /><path d="M7 10h6M10 7v6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></>}
              title="The move, spelled out"
              body="Every alert names the broken item and the recommended fix — who to call, what to push, how much slack you've got."
            />
            <Feat
              icon={<><path d="M3 16V8l7-5 7 5v8" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /><path d="M8 16v-4h4v4" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></>}
              title="A dashboard that never lies"
              body="Even if a push slips past your device, the watch page is a complete record — every alert, delivered or not."
            />
            <Feat
              icon={<><circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.4" /><path d="M10 5v5l3 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></>}
              title="Works everywhere"
              body="Cross-platform from day one — where the flight-tracker apps won't go. Install it to your home screen and forget it's there."
            />
            <Feat
              icon={<><path d="M4 10h12M10 4v12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /><circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.4" /></>}
              title="Honest about uncertainty"
              body="When the feed is stale, Keeper says &quot;can't confirm&quot; instead of crying wolf. It never asserts a miss from missing data."
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
              &quot;The pain was never storing the booking. It was being the one person everyone leans
              on when it breaks.&quot;
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
          <h2>Stop reconciling your trip under pressure.</h2>
          <p>Let Keeper hold the chain. You hold the trip.</p>
          <div className={s.heroActions}>
            <Link className="btn btn-primary btn-lg" href="/signup">
              Watch your next trip
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
