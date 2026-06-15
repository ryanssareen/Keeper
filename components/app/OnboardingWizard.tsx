"use client";
import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { saveOnboarding, type OnboardingAnswers } from "@/lib/onboarding/actions";
import s from "@/app/onboarding/onboarding.module.css";

const DOTS = [0, 1, 2, 3, 4];

type Answers = OnboardingAnswers;

const DEFAULTS: Answers = {
  trip: "", party: "2 people", dest: "Lisbon", country: "Portugal", code: "LIS",
  flight: "", flightNo: "", flightDate: "", seat: "", hotel: "", hotelName: "", hotelIn: "", hotelOut: "",
};

type City = { city: string; country: string; code: string };

const CITIES: City[] = [
  { city: "Lisbon", country: "Portugal", code: "LIS" },
  { city: "London", country: "United Kingdom", code: "LHR" },
  { city: "Los Angeles", country: "United States", code: "LAX" },
  { city: "Tokyo", country: "Japan", code: "HND" },
  { city: "Toronto", country: "Canada", code: "YYZ" },
  { city: "Barcelona", country: "Spain", code: "BCN" },
  { city: "Bangkok", country: "Thailand", code: "BKK" },
  { city: "Berlin", country: "Germany", code: "BER" },
  { city: "Mexico City", country: "Mexico", code: "MEX" },
  { city: "Marrakesh", country: "Morocco", code: "RAK" },
  { city: "Cape Town", country: "South Africa", code: "CPT" },
  { city: "Copenhagen", country: "Denmark", code: "CPH" },
  { city: "New York", country: "United States", code: "JFK" },
  { city: "Paris", country: "France", code: "CDG" },
  { city: "Porto", country: "Portugal", code: "OPO" },
  { city: "Rome", country: "Italy", code: "FCO" },
  { city: "Reykjavik", country: "Iceland", code: "KEF" },
  { city: "Singapore", country: "Singapore", code: "SIN" },
  { city: "Sydney", country: "Australia", code: "SYD" },
  { city: "Seoul", country: "South Korea", code: "ICN" },
  { city: "Istanbul", country: "Turkey", code: "IST" },
  { city: "Amsterdam", country: "Netherlands", code: "AMS" },
  { city: "Athens", country: "Greece", code: "ATH" },
  { city: "Buenos Aires", country: "Argentina", code: "EZE" },
];

const cx = (...c: Array<string | false | undefined>): string => c.filter(Boolean).join(" ");

export function OnboardingWizard({
  initialAnswers,
  initialStep,
}: {
  initialAnswers?: Partial<Answers>;
  initialStep?: number;
}): React.ReactElement {
  // Re-enter at the first question, never on the terminal "All set" recap (step 5). A finished trip
  // saves step 5, so without this clamp clicking "New watch" / "Edit trip" dropped the user straight
  // onto the old confirmation screen — it never asked "where are you going" again. Their previous
  // answers are still preloaded (initialAnswers), so step 0 lets them review and change everything.
  const [step, setStep] = useState(initialStep != null && initialStep < 5 ? initialStep : 0);
  const [answers, setAnswers] = useState<Answers>({ ...DEFAULTS, ...initialAnswers });
  const [showCustom, setShowCustom] = useState(false);
  const [destQuery, setDestQuery] = useState(
    initialAnswers?.dest && initialAnswers?.country
      ? `${initialAnswers.dest}, ${initialAnswers.country}`
      : "",
  );
  const [suggestions, setSuggestions] = useState<City[]>([]);
  const [cursor, setCursor] = useState(-1);
  const [destChosen, setDestChosen] = useState(Boolean(initialAnswers?.dest));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const customRef = useRef<HTMLInputElement>(null);
  const answersRef = useRef(answers);

  // Intermediate step changes autosave progress in the background — best-effort, since the final
  // submit re-sends the complete answers and is the authoritative write we actually verify.
  const go = useCallback((i: number) => {
    setStep(i);
    window.scrollTo({ top: 0, behavior: "instant" });
    saveOnboarding(answersRef.current, i, false).catch(() => {});
  }, []);

  // Final submission. Unlike `go`, this AWAITS the save and only advances to the success screen when
  // the row actually persisted — so a failed write can no longer masquerade as "All set". A loading
  // state covers the round-trip and any failure is surfaced for the user to retry.
  const submit = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      const { ok } = await saveOnboarding(answersRef.current, 5, true);
      if (!ok) {
        setError("We couldn’t save your trip. Check your connection and try again.");
        return;
      }
      setStep(5);
      window.scrollTo({ top: 0, behavior: "instant" });
    } catch {
      setError("Something went wrong saving your trip. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }, []);

  const set = (patch: Partial<Answers>) =>
    setAnswers((a) => {
      const next = { ...a, ...patch };
      answersRef.current = next;
      return next;
    });

  const pickTrip = (value: string) => { set({ trip: value }); window.setTimeout(() => go(1), 360); };
  const pickParty = (value: string) => { setShowCustom(false); set({ party: value }); window.setTimeout(() => go(2), 360); };
  const toggleCustom = () => { setShowCustom(true); window.setTimeout(() => customRef.current?.focus(), 0); };
  const setCustom = (raw: string) => { const n = parseInt(raw, 10); if (n > 0) set({ party: `${n} ${n === 1 ? "person" : "people"}` }); };

  const filterDest = (value: string) => {
    setDestQuery(value);
    const q = value.trim().toLowerCase();
    if (!q) { setSuggestions([]); setCursor(-1); return; }
    setSuggestions(
      CITIES.filter(
        (c) => c.city.toLowerCase().startsWith(q) || c.country.toLowerCase().startsWith(q) || c.code.toLowerCase() === q,
      ).slice(0, 6),
    );
    setCursor(-1);
  };

  const chooseDest = (c: City) => {
    set({ dest: c.city, country: c.country, code: c.code });
    setDestQuery(`${c.city}, ${c.country}`);
    setSuggestions([]); setDestChosen(true);
  };

  const destKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!suggestions.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor((i) => Math.min(i + 1, suggestions.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (cursor >= 0) chooseDest(suggestions[cursor]!); }
  };

  const recapFlight = answers.flight === "Booked" && answers.flightNo
    ? `Booked · ${answers.flightNo}`
    : answers.flight || "Not added";
  const recapHotel = answers.hotel === "Booked" && answers.hotelName
    ? `Booked · ${answers.hotelName}`
    : answers.hotel || "Not added";

  return (
    <div className={s.obWrap}>
      <div className={s.stepsBar}>
        {DOTS.map((i) => (
          <div key={i} className={cx(s.sdot, i === step && s.active, i < step && s.done)}>
            <span className={s.fill} />
          </div>
        ))}
      </div>

      {/* Step 1 — trip intent */}
      <section className={cx(s.obStep, step === 0 && s.active)}>
        <QHead title="Hi! Do you have any trips coming up?" />
        <p className={s.qLede}>We&apos;ll help you keep every booking, document, and plan in one calm place.</p>
        <div className={cx(s.opts, s.two)}>
          <Opt icon={<PlaneIcon />} title="Yes, I do" sub="Let's set it up together" selected={answers.trip === "Yes"} onClick={() => pickTrip("Yes")} />
          <Opt icon={<CompassIcon />} title="No, just exploring" sub="Show me around first" selected={answers.trip === "Just exploring"} onClick={() => pickTrip("Just exploring")} />
        </div>
      </section>

      {/* Step 2 — party size */}
      <section className={cx(s.obStep, step === 1 && s.active)}>
        <QHead title="How many people are going?" />
        <p className={s.qLede}>This shapes your checklist and how we organize documents for everyone.</p>
        <div className={cx(s.opts, s.three)}>
          {(["Solo", "2 people", "Family", "Group"] as const).map((label, i) => (
            <Opt
              key={label}
              title={label}
              sub={["Just me", "A pair", "With kids", "Friends / team"][i]!}
              selected={!showCustom && answers.party === label}
              onClick={() => pickParty(label)}
            />
          ))}
          <Opt title="Custom number" sub="Tell us exactly" selected={showCustom} onClick={toggleCustom} style={{ gridColumn: "span 2" }} />
        </div>
        <div className={cx(s.customWrap, showCustom && s.show)}>
          <div className={s.opts} style={{ marginTop: 14 }}>
            <div>
              <label className="field-label" htmlFor="customNum">How many travelers?</label>
              <input
                ref={customRef} className="field" id="customNum" type="number" min={1} max={40}
                placeholder="e.g. 7"
                onInput={(e) => setCustom(e.currentTarget.value)}
              />
            </div>
          </div>
        </div>
        <div className={s.obActions}>
          <button type="button" className={cx("btn btn-ghost btn-lg", s.btnBack)} onClick={() => go(0)}>Back</button>
          <button type="button" className="btn btn-primary btn-lg" style={{ flex: 1 }} onClick={() => go(2)}>Continue</button>
        </div>
      </section>

      {/* Step 3 — destination */}
      <section className={cx(s.obStep, step === 2 && s.active)}>
        <QHead title="Where are you going?" />
        <p className={s.qLede}>Start typing a city and pick from the list. We&apos;ll tailor recommendations to it.</p>
        <div className={s.searchBlock}>
          <div className={s.searchField}>
            <span className={s.mag}><MagIcon /></span>
            <input
              className={s.searchInput} type="text" autoComplete="off"
              placeholder="Search a destination…" value={destQuery}
              onChange={(e) => filterDest(e.target.value)}
              onFocus={(e) => filterDest(e.target.value)}
              onKeyDown={destKey}
            />
          </div>
          <div className={cx(s.suggest, suggestions.length > 0 && s.show)}>
            {suggestions.map((c, i) => (
              <div
                key={c.code}
                className={cx(s.sg, cursor === i && s.cur)}
                onMouseDown={(e) => { e.preventDefault(); chooseDest(c); }}
              >
                <span className={s.pin}><PinIcon /></span>
                <div>
                  <div className={s.city}>{c.city}</div>
                  <div className={s.country}>{c.country}</div>
                </div>
                <span className={s.code}>{c.code}</span>
              </div>
            ))}
          </div>
          <div className={s.popRow}>
            <span className={s.pl}>Popular right now</span>
            {[
              { city: "Lisbon", country: "Portugal", code: "LIS" },
              { city: "Tokyo", country: "Japan", code: "HND" },
              { city: "Mexico City", country: "Mexico", code: "MEX" },
              { city: "Barcelona", country: "Spain", code: "BCN" },
              { city: "Cape Town", country: "South Africa", code: "CPT" },
            ].map((c) => (
              <button key={c.code} type="button" className={s.chip} onClick={() => chooseDest(c)}>{c.city}</button>
            ))}
          </div>
        </div>
        <div className={s.obActions}>
          <button type="button" className={cx("btn btn-ghost btn-lg", s.btnBack)} onClick={() => go(1)}>Back</button>
          <button type="button" className="btn btn-primary btn-lg" style={{ flex: 1 }} disabled={!destChosen} onClick={() => go(3)}>Continue</button>
        </div>
      </section>

      {/* Step 4 — flight */}
      <section className={cx(s.obStep, step === 3 && s.active)}>
        <QHead title="Do you have a flight booked?" />
        <p className={s.qLede}>If you do, add the flight number and we&apos;ll keep your times handy. No pressure if not.</p>
        <div className={cx(s.opts, s.three)}>
          <Opt stack icon={<PlaneIcon />} title="Yes" sub="It's booked" selected={answers.flight === "Booked"} onClick={() => set({ flight: "Booked" })} />
          <Opt stack icon={<ClockIcon />} title="No" sub="Not yet" selected={answers.flight === "Not yet"} onClick={() => set({ flight: "Not yet" })} />
          <Opt stack icon={<QuestionIcon />} title="Still deciding" sub="Weighing options" selected={answers.flight === "Still deciding"} onClick={() => set({ flight: "Still deciding" })} />
        </div>
        <div className={cx(s.detailReveal, answers.flight === "Booked" && s.show)}>
          <div className={s.revealCard}>
            <span className={s.rcLabel}><PlaneIcon size={14} />Your flight</span>
            <div className={s.twoCol}>
              <div>
                <label className="field-label" htmlFor="fNo">Flight number</label>
                <input className="field mono" id="fNo" placeholder="e.g. TP 209" value={answers.flightNo} onChange={(e) => set({ flightNo: e.target.value })} />
              </div>
              <div>
                <label className="field-label" htmlFor="fDate">Departure date</label>
                <input className="field" id="fDate" type="date" value={answers.flightDate} onChange={(e) => set({ flightDate: e.target.value })} />
              </div>
            </div>
            <div>
              <label className="field-label" htmlFor="fSeat">Seat(s)</label>
              <input className="field mono" id="fSeat" placeholder="e.g. 14A, 14B" value={answers.seat} onChange={(e) => set({ seat: e.target.value })} />
            </div>
          </div>
        </div>
        <div className={s.obActions}>
          <button type="button" className={cx("btn btn-ghost btn-lg", s.btnBack)} onClick={() => go(2)}>Back</button>
          <button type="button" className="btn btn-primary btn-lg" style={{ flex: 1 }} onClick={() => go(4)}>Continue</button>
        </div>
      </section>

      {/* Step 5 — hotel */}
      <section className={cx(s.obStep, step === 4 && s.active)}>
        <QHead title="Do you have a hotel booking?" />
        <p className={s.qLede}>We&apos;ll store your reservation and check-in details next to everything else.</p>
        <div className={cx(s.opts, s.three)}>
          <Opt stack icon={<HotelIcon />} title="Yes" sub="It's booked" selected={answers.hotel === "Booked"} onClick={() => set({ hotel: "Booked" })} />
          <Opt stack icon={<ClockIcon />} title="No" sub="Not yet" selected={answers.hotel === "Not yet"} onClick={() => set({ hotel: "Not yet" })} />
          <Opt stack icon={<SearchSmallIcon />} title="Looking" sub="Help me find one" selected={answers.hotel === "Looking for one"} onClick={() => set({ hotel: "Looking for one" })} />
        </div>
        <div className={cx(s.detailReveal, answers.hotel === "Booked" && s.show)}>
          <div className={s.revealCard}>
            <span className={s.rcLabel}><HotelIcon size={14} />Your stay</span>
            <div>
              <label className="field-label" htmlFor="hName">Hotel name</label>
              <input className="field" id="hName" placeholder="e.g. Alfama Terrace" value={answers.hotelName} onChange={(e) => set({ hotelName: e.target.value })} />
            </div>
            <div className={s.twoCol}>
              <div>
                <label className="field-label" htmlFor="hIn">Check-in</label>
                <input className="field" id="hIn" type="date" value={answers.hotelIn} onChange={(e) => set({ hotelIn: e.target.value })} />
              </div>
              <div>
                <label className="field-label" htmlFor="hOut">Check-out</label>
                <input className="field" id="hOut" type="date" value={answers.hotelOut} onChange={(e) => set({ hotelOut: e.target.value })} />
              </div>
            </div>
          </div>
        </div>
        <p className={s.obNote}>Hotel integrations are coming soon — for now we&apos;ll keep your details organized.</p>
        {error ? <p className={s.obError} role="alert">{error}</p> : null}
        <div className={s.obActions}>
          <button type="button" className={cx("btn btn-ghost btn-lg", s.btnBack)} onClick={() => go(3)} disabled={submitting}>Back</button>
          <button type="button" className="btn btn-primary btn-lg" style={{ flex: 1 }} onClick={submit} disabled={submitting} aria-busy={submitting}>
            {submitting ? "Saving your trip…" : "Continue"}
          </button>
        </div>
      </section>

      {/* Confirm */}
      <section className={cx(s.obStep, step === 5 && s.active)}>
        <div className={s.confirmHero}>
          <div className={s.confirmRing}>
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
              <path d="M20 6 9 17l-5-5" stroke="#059669" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <span className={s.qWho}>All set</span>
          <h1>Your trip to {answers.dest} is ready</h1>
          <p>Everything lives in one place now. You can add bookings, documents, and plans any time.</p>
        </div>
        <div className={s.recap}>
          <div className={s.recapTop}>
            <span className={s.recapDest}>{answers.dest}, {answers.country}</span>
            <span className="pill pill-ok pill-dot">On track</span>
          </div>
          <dl className={s.recapGrid}>
            <div className={s.recapCell}><dt>Travelers</dt><dd>{answers.party}</dd></div>
            <div className={s.recapCell}><dt>Destination</dt><dd>{answers.code}</dd></div>
            <div className={s.recapCell}><dt>Flight</dt><dd>{recapFlight}</dd></div>
            <div className={s.recapCell}><dt>Hotel</dt><dd>{recapHotel}</dd></div>
          </dl>
        </div>
        <div className={cx(s.obActions, s.confirmActions)}>
          <Link className="btn btn-primary btn-lg btn-block" href="/trips">Open my trip</Link>
        </div>
      </section>
    </div>
  );
}

function QHead({ title }: { title: string }): React.ReactElement {
  return (
    <div className={s.qHead}>
      <span className={s.qAvatar} aria-hidden><KeeperGlyph /></span>
      <div>
        <span className={s.qWho}>Keeper</span>
        <h1>{title}</h1>
      </div>
    </div>
  );
}

function Opt({ title, sub, selected, onClick, icon, stack, style }: {
  title: string; sub: string; selected: boolean; onClick: () => void;
  icon?: React.ReactNode; stack?: boolean; style?: React.CSSProperties;
}): React.ReactElement {
  return (
    <button type="button" className={cx(s.opt, stack && s.stack, selected && s.sel)} style={style} onClick={onClick}>
      {icon ? <span className={s.oIco}>{icon}</span> : null}
      <span className={s.oTxt}><b>{title}</b><span>{sub}</span></span>
      <span className={s.oCheck}>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
          <path d="M13.5 4.5 6 12 2.5 8.5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </button>
  );
}

const KeeperGlyph = (): React.ReactElement => (
  <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="8" r="1.6" fill="#fff" />
    <path d="M8 4.2a3.8 3.8 0 0 1 3.8 3.8" stroke="#fff" strokeWidth="1.3" strokeLinecap="round" />
    <path d="M8 1.7a6.3 6.3 0 0 1 6.3 6.3" stroke="#a1a1aa" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);

const PlaneIcon = ({ size = 20 }: { size?: number }): React.ReactElement => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
    <path d="M3 11l14-5-4.5 9.5-2.2-4.8L3 11Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
  </svg>
);

const CompassIcon = (): React.ReactElement => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
    <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.4" />
    <path d="M10 3v2M10 15v2M3 10h2M15 10h2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    <circle cx="10" cy="10" r="1.4" fill="currentColor" />
  </svg>
);

const ClockIcon = (): React.ReactElement => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
    <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.4" />
    <path d="M10 6v4l2.5 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const QuestionIcon = (): React.ReactElement => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
    <path d="M7 8a3 3 0 1 1 4 2.8c-.7.3-1 .8-1 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    <circle cx="10" cy="15" r="1" fill="currentColor" />
  </svg>
);

const HotelIcon = ({ size = 20 }: { size?: number }): React.ReactElement => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
    <path d="M3 16V6l7-3 7 3v10" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    <path d="M8 16v-4h4v4" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
  </svg>
);

const SearchSmallIcon = (): React.ReactElement => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
    <circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.4" />
    <path d="m13 13 3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);

const MagIcon = (): React.ReactElement => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
    <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.5" />
    <path d="m12.5 12.5 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const PinIcon = (): React.ReactElement => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M8 14s5-4.2 5-8A5 5 0 0 0 3 6c0 3.8 5 8 5 8Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    <circle cx="8" cy="6" r="1.6" stroke="currentColor" strokeWidth="1.3" />
  </svg>
);
