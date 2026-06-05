"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { subscribePush, getDeviceId } from "@/lib/push/client";
import { upsertWatchToken } from "@/lib/storage/watchTokens";
import s from "@/app/onboarding/onboarding.module.css";

type ArmedWatch = {
  watchId: string;
  token: string;
  state: string;
  placeLabel: string;
  zone: string;
  transitMinutes: number;
  slackMinutes: number | null;
};

const Mark = () => (
  <svg width="17" height="17" viewBox="0 0 16 16" fill="none">
    <path d="M13.5 4.5 6 12 2.5 8.5" stroke="#10b981" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const Glyph = ({ ring = "#71717a" }: { ring?: string }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="8" r="1.6" fill="#fff" />
    <path d="M8 4.2a3.8 3.8 0 0 1 3.8 3.8" stroke="#fff" strokeWidth="1.3" strokeLinecap="round" />
    <path d="M8 1.7a6.3 6.3 0 0 1 6.3 6.3" stroke={ring} strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);

export function OnboardingWizard(): React.ReactElement {
  const [step, setStep] = useState(0);
  const [flightNumber, setFlightNumber] = useState("");
  const [flightDate, setFlightDate] = useState("");
  const [placeQuery, setPlaceQuery] = useState("");
  const [commitmentLocal, setCommitmentLocal] = useState("");
  const [marginMinutes, setMarginMinutes] = useState("15");
  const [contact, setContact] = useState("");
  const [reschedulable, setReschedulable] = useState(true);

  const [arming, setArming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [armed, setArmed] = useState<ArmedWatch | null>(null);
  const [pushStatus, setPushStatus] = useState<"idle" | "working" | "subscribed" | "denied" | "error" | "unsupported">("idle");

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  function goFlight() {
    if (!flightNumber.trim() || !flightDate) {
      setError("Enter the flight number and date.");
      return;
    }
    setError(null);
    setStep(1);
  }

  async function armNow() {
    if (!placeQuery.trim() || !commitmentLocal) {
      setError("Tell us where you need to be and by when.");
      return;
    }
    setArming(true);
    setError(null);
    try {
      const res = await fetch("/api/watch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId: getDeviceId(),
          flightNumber: flightNumber.trim().toUpperCase(),
          flightDate,
          placeQuery: placeQuery.trim(),
          commitmentLocal,
          reschedulable,
          marginMinutes: Number(marginMinutes) || 15,
          contact: contact.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn’t arm the watch.");
        return;
      }
      localStorage.setItem(
        "keeper-watches",
        upsertWatchToken(localStorage.getItem("keeper-watches"), data.watchId, data.token),
      );
      setArmed(data);
      setStep(2);
    } catch {
      setError("Network error — try again.");
    } finally {
      setArming(false);
    }
  }

  async function enableNotifs() {
    setPushStatus("working");
    const result = await subscribePush();
    setPushStatus(result);
    if (result === "subscribed") setTimeout(() => setStep(3), 600);
  }

  return (
    <div className={s.obWrap}>
      <div className={s.stepsBar}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={`${s.sdot} ${i < step ? s.done : i === step ? s.active : ""}`}>
            <span className={s.fill} />
          </div>
        ))}
      </div>

      {/* Step 1: flight */}
      {step === 0 ? (
        <section className={s.obStep}>
          <span className={s.stepLabel}>Step 1 of 4 · The flight</span>
          <h1>What flight are we watching?</h1>
          <p className={s.lede}>This is the thing that moves. When it slips, Keeper re-checks everything you’ve hung off it.</p>
          <div className={s.cardForm}>
            <div className={s.two}>
              <div>
                <label className="field-label" htmlFor="fn">Flight number</label>
                <input className="field mono" id="fn" placeholder="EK 9" value={flightNumber} onChange={(e) => setFlightNumber(e.target.value)} />
              </div>
              <div>
                <label className="field-label" htmlFor="fd">Flight date</label>
                <input className="field" id="fd" type="date" value={flightDate} onChange={(e) => setFlightDate(e.target.value)} />
              </div>
            </div>
            <p className="field-hint" style={{ marginTop: -6 }}>We’ll resolve the route, the live arrival airport, and the gate-to-door time automatically.</p>
          </div>
          {error ? <p className={s.err}>{error}</p> : null}
          <div className={s.obActions}>
            <button className="btn btn-primary btn-lg" style={{ flex: 1 }} onClick={goFlight}>Continue</button>
          </div>
        </section>
      ) : null}

      {/* Step 2: commitment */}
      {step === 1 ? (
        <section className={s.obStep}>
          <span className={s.stepLabel}>Step 2 of 4 · The commitment</span>
          <h1>What’s downstream of it?</h1>
          <p className={s.lede}>The one thing that has to happen after you land. Resolve it to a place and a time, and the engine can collide-check it.</p>
          <div className={s.cardForm}>
            <div>
              <label className="field-label" htmlFor="pl">Where do you need to be?</label>
              <input className="field" id="pl" placeholder="Trafalgar Square, London" value={placeQuery} onChange={(e) => setPlaceQuery(e.target.value)} />
            </div>
            <div className={s.two}>
              <div>
                <label className="field-label" htmlFor="by">By when (local)</label>
                <input className="field" id="by" type="datetime-local" value={commitmentLocal} onChange={(e) => setCommitmentLocal(e.target.value)} />
              </div>
              <div>
                <label className="field-label" htmlFor="mg">Arrival margin</label>
                <select className="field" id="mg" value={marginMinutes} onChange={(e) => setMarginMinutes(e.target.value)}>
                  <option value="10">10 minutes</option>
                  <option value="15">15 minutes</option>
                  <option value="30">30 minutes</option>
                  <option value="45">45 minutes</option>
                  <option value="60">1 hour</option>
                </select>
              </div>
            </div>
            <div>
              <label className="field-label" htmlFor="ct">Who to contact if it slips <span style={{ color: "var(--text-faint)", fontWeight: 400 }}>(optional)</span></label>
              <input className="field" id="ct" placeholder="The venue" value={contact} onChange={(e) => setContact(e.target.value)} />
            </div>
            <div className={s.toggleRow}>
              <div className={s.tl}><b>This commitment can be moved</b><p>Reschedulable items get gentler advice — push, don’t panic.</p></div>
              <label className={s.sw}><input type="checkbox" checked={reschedulable} onChange={(e) => setReschedulable(e.target.checked)} /><span className={s.slider} /></label>
            </div>
          </div>
          {error ? <p className={s.err}>{error}</p> : null}
          <div className={s.obActions}>
            <button className="btn btn-ghost btn-lg" onClick={() => { setError(null); setStep(0); }}>Back</button>
            <button className="btn btn-primary btn-lg" style={{ flex: 1 }} onClick={armNow} disabled={arming}>
              {arming ? "Arming…" : "Arm watch"}
            </button>
          </div>
        </section>
      ) : null}

      {/* Step 3: notifications */}
      {step === 2 ? (
        <section className={s.obStep}>
          <span className={s.stepLabel}>Step 3 of 4 · Get the catch</span>
          <h1>Turn on the one notification that matters.</h1>
          <p className={s.lede}>Keeper stays silent until something breaks. Enable notifications so the catch reaches you in time to act.</p>
          <div className={s.notifCard}>
            <div className={s.notifPreview}>
              <div className={s.npToast}>
                <span className={s.ai}><Glyph ring="#a1a1aa" /></span>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center" }}><span className={s.nm}>Keeper</span><span className={s.tm}>now</span></div>
                  <div className={s.bd}><b>Heads up — predicted to miss dinner.</b> EK 9 is 90 min late. Push the table to 20:15. 41 min lead.</div>
                </div>
              </div>
            </div>
            <div className={s.perks}>
              <div className={s.perk}><Mark />One alert per break — never a stream of noise</div>
              <div className={s.perk}><Mark />Delivered the moment slack goes negative</div>
              <div className={s.perk}><Mark />Mirrored on your dashboard if a push ever slips</div>
            </div>
            <button className="btn btn-primary btn-lg btn-block" style={{ marginTop: 22 }} onClick={enableNotifs} disabled={pushStatus === "working" || pushStatus === "subscribed"}>
              {pushStatus === "subscribed" ? "Notifications on" : pushStatus === "working" ? "Enabling…" : "Enable notifications"}
            </button>
            {pushStatus === "denied" ? <p className="field-hint" style={{ textAlign: "center", marginTop: 10, color: "var(--amber-600)" }}>Notifications are blocked. Enable them for this site in your browser settings.</p> : null}
            {pushStatus === "unsupported" ? <p className="field-hint" style={{ textAlign: "center", marginTop: 10 }}>On iPhone, add Keeper to your Home Screen first — push only reaches installed apps.</p> : null}
            {pushStatus === "error" ? <p className="field-hint" style={{ textAlign: "center", marginTop: 10, color: "var(--red-600)" }}>Couldn’t enable notifications — you can do it later in Settings.</p> : null}
          </div>
          <div className={s.obActions}>
            <button className="btn btn-secondary btn-lg" style={{ flex: 1 }} onClick={() => setStep(3)}>I’ll do this later</button>
          </div>
        </section>
      ) : null}

      {/* Step 4: confirm */}
      {step === 3 ? (
        <section className={s.obStep}>
          <div className={s.confirmHero}>
            <div className={s.confirmRing}><svg width="30" height="30" viewBox="0 0 24 24" fill="none"><path d="M20 6 9 17l-5-5" stroke="#059669" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></div>
            <span className={s.stepLabel}>Watch armed</span>
            <h1 style={{ marginTop: 10 }}>You’re covered. Go enjoy the trip.</h1>
            <p className={s.lede} style={{ maxWidth: "36ch", marginInline: "auto" }}>
              Keeper is watching {armed?.placeLabel ? `for your arrival at ${armed.placeLabel}` : "your trip"}. We’ll only reach out if something breaks.
            </p>
          </div>
          {armed ? (
            <div className={s.armedCard}>
              <div className={s.armedTop}><span className="k-label">Keeper · watch</span><span className="pill pill-ok pill-dot">Armed</span></div>
              <div className={s.armedBody}>
                <div className={s.armedRoute}>{flightNumber.toUpperCase()} <span className={s.arr}>→</span> {armed.placeLabel}</div>
                <div className={s.armedWhen}>Watching against your <b>{commitmentLocal.replace("T", " ")}</b> commitment · {armed.zone}</div>
                <div className={s.armedFacts}>
                  <div className={s.f}><span className="k-label">Slack</span><div className={s.v} style={{ color: (armed.slackMinutes ?? 0) < 0 ? "var(--red-600)" : "var(--emerald-600)" }}>{fmtSlack(armed.slackMinutes)}</div></div>
                  <div className={s.f}><span className="k-label">Airport → place</span><div className={s.v}>{armed.transitMinutes} min</div></div>
                  <div className={s.f}><span className="k-label">Margin</span><div className={s.v}>{marginMinutes} min</div></div>
                </div>
              </div>
            </div>
          ) : null}
          <div className={s.obActions}>
            <Link className="btn btn-primary btn-lg" style={{ flex: 1 }} href="/dashboard">Go to dashboard</Link>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function fmtSlack(min: number | null): string {
  if (min === null) return "—";
  const sign = min < 0 ? "−" : "+";
  const abs = Math.abs(min);
  if (abs >= 60) return `${sign}${Math.floor(abs / 60)}h ${abs % 60}m`;
  return `${sign}${abs}m`;
}
