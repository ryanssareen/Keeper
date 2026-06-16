"use client";
import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { saveOnboarding, type OnboardingAnswers } from "@/lib/onboarding/actions";
import { DestinationField } from "@/components/app/DestinationField";
import { airportLabel, type Airport } from "@/lib/places/types";
import s from "@/app/onboarding/onboarding.module.css";

const DOTS = [0, 1, 2, 3, 4];

type Answers = OnboardingAnswers;

const DEFAULTS: Answers = {
  trip: "", party: "2 people", dest: "", country: "", code: "", startDate: "", endDate: "",
  flight: "", flightNo: "", flightDate: "", seat: "", hotel: "", hotelName: "", hotelIn: "", hotelOut: "",
};

const cx = (...c: Array<string | false | undefined>): string => c.filter(Boolean).join(" ");

/* --------------------------------------------------------------- validation
 * Where + when are mandatory (a trip can't be monitored without a place and a date range), and saying a
 * flight or hotel is "Booked" makes its details mandatory too — the "Yes, but tell me nothing" hole the
 * old wizard allowed. Each step's Continue/Save is gated on the relevant predicate below. */
const datesOk = (a: Answers): boolean =>
  Boolean(a.dest && a.code && a.startDate && a.endDate) && a.endDate >= a.startDate;
const flightOk = (a: Answers): boolean => a.flight !== "Booked" || Boolean(a.flightNo && a.flightDate);
const hotelOk = (a: Answers): boolean => a.hotel !== "Booked" || Boolean(a.hotelName && a.hotelIn && a.hotelOut);
const allOk = (a: Answers): boolean => datesOk(a) && flightOk(a) && hotelOk(a);

export function OnboardingWizard({
  initialAnswers,
  initialStep,
  initialCompleted,
}: {
  initialAnswers?: Partial<Answers>;
  initialStep?: number;
  initialCompleted?: boolean;
}): React.ReactElement {
  const router = useRouter();
  const [answers, setAnswers] = useState<Answers>({ ...DEFAULTS, ...initialAnswers });
  const [showCustom, setShowCustom] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const customRef = useRef<HTMLInputElement>(null);
  const answersRef = useRef(answers);

  // A finished trip re-opens straight into an editable summary (every field at once) — never the
  // conversational stepper from question one. An in-progress trip resumes at the step the user left off
  // (clamped off the terminal recap). Both honor "take me to where I was", not "start over".
  const editing = Boolean(initialCompleted);
  const [step, setStep] = useState(initialStep != null && initialStep < 5 ? initialStep : 0);

  const set = (patch: Partial<Answers>) =>
    setAnswers((a) => {
      const next = { ...a, ...patch };
      answersRef.current = next;
      return next;
    });

  const chooseDest = (a: Airport | null) =>
    a ? set({ dest: a.city, country: a.country, code: a.code }) : set({ dest: "", country: "", code: "" });

  // Intermediate step changes autosave progress in the background (best-effort); the final submit re-sends
  // the complete answers and is the authoritative write we await and verify.
  const go = useCallback((i: number) => {
    setStep(i);
    window.scrollTo({ top: 0, behavior: "instant" });
    saveOnboarding(answersRef.current, i, false).catch(() => {});
  }, []);

  /** Persist the complete trip (completed=true). Returns whether it stuck so callers can route on success. */
  const persist = useCallback(async (): Promise<boolean> => {
    setSubmitting(true);
    setError(null);
    try {
      const { ok } = await saveOnboarding(answersRef.current, 5, true);
      if (!ok) {
        setError("We couldn’t save your trip. Check your connection and try again.");
        return false;
      }
      return true;
    } catch {
      setError("Something went wrong saving your trip. Please try again.");
      return false;
    } finally {
      setSubmitting(false);
    }
  }, []);

  const submit = useCallback(async () => {
    if (await persist()) {
      setStep(5);
      window.scrollTo({ top: 0, behavior: "instant" });
    }
  }, [persist]);

  const saveEdits = useCallback(async () => {
    if (await persist()) router.push("/trips");
  }, [persist, router]);

  const pickTrip = (value: string) => { set({ trip: value }); window.setTimeout(() => go(1), 360); };
  const pickParty = (value: string) => { setShowCustom(false); set({ party: value }); window.setTimeout(() => go(2), 360); };
  const toggleCustom = () => { setShowCustom(true); window.setTimeout(() => customRef.current?.focus(), 0); };
  const setCustom = (raw: string) => { const n = parseInt(raw, 10); if (n > 0) set({ party: `${n} ${n === 1 ? "person" : "people"}` }); };

  const destLabel = answers.dest && answers.country ? airportLabel({ city: answers.dest, country: answers.country }) : "";

  // ------------------------------------------------------------- edit summary
  if (editing) {
    return (
      <div className={s.obWrap}>
        <div className={s.editHead}>
          <span className={s.qWho}>Edit trip</span>
          <h1>Your trip details</h1>
          <p className={s.editLede}>Change anything and save — you won’t have to walk through the questions again.</p>
        </div>

        <section className={s.editCard}>
          <span className={s.editLabel}>Where &amp; when</span>
          <DestinationField initialLabel={destLabel} onChoose={chooseDest} inputId="editDest" />
          <DateRange answers={answers} set={set} />
        </section>

        <section className={s.editCard}>
          <span className={s.editLabel}>Travelers</span>
          <PartySelect answers={answers} set={set} />
        </section>

        <FlightSection answers={answers} set={set} />
        <HotelSection answers={answers} set={set} />

        {error ? <p className={s.obError} role="alert" style={{ paddingLeft: 0 }}>{error}</p> : null}
        <div className={s.obActions} style={{ paddingLeft: 0 }}>
          <Link className={cx("btn btn-ghost btn-lg", s.btnBack)} href="/trips">Cancel</Link>
          <button
            type="button" className="btn btn-primary btn-lg" style={{ flex: 1 }}
            onClick={saveEdits} disabled={submitting || !allOk(answers)} aria-busy={submitting}
          >
            {submitting ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    );
  }

  // ----------------------------------------------------------------- stepper
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

      {/* Step 3 — destination + dates (both mandatory) */}
      <section className={cx(s.obStep, step === 2 && s.active)}>
        <QHead title="Where and when are you going?" />
        <p className={s.qLede}>Pick your destination and the dates you travel — both are needed so Keeper can watch the trip.</p>
        <div className={s.searchBlock}>
          <DestinationField initialLabel={destLabel} onChoose={chooseDest} />
          <div style={{ marginTop: 16 }}>
            <DateRange answers={answers} set={set} />
          </div>
        </div>
        <div className={s.obActions}>
          <button type="button" className={cx("btn btn-ghost btn-lg", s.btnBack)} onClick={() => go(1)}>Back</button>
          <button type="button" className="btn btn-primary btn-lg" style={{ flex: 1 }} disabled={!datesOk(answers)} onClick={() => go(3)}>Continue</button>
        </div>
      </section>

      {/* Step 4 — flight */}
      <section className={cx(s.obStep, step === 3 && s.active)}>
        <QHead title="Do you have a flight booked?" />
        <p className={s.qLede}>If you do, add the flight number and date so we can keep your times live. No pressure if not.</p>
        <FlightSection answers={answers} set={set} />
        <div className={s.obActions}>
          <button type="button" className={cx("btn btn-ghost btn-lg", s.btnBack)} onClick={() => go(2)}>Back</button>
          <button type="button" className="btn btn-primary btn-lg" style={{ flex: 1 }} disabled={!flightOk(answers)} onClick={() => go(4)}>Continue</button>
        </div>
      </section>

      {/* Step 5 — hotel */}
      <section className={cx(s.obStep, step === 4 && s.active)}>
        <QHead title="Do you have a hotel booking?" />
        <p className={s.qLede}>We&apos;ll store your reservation and check-in details next to everything else.</p>
        <HotelSection answers={answers} set={set} />
        <p className={s.obNote}>Hotel integrations are coming soon — for now we&apos;ll keep your details organized.</p>
        {error ? <p className={s.obError} role="alert">{error}</p> : null}
        <div className={s.obActions}>
          <button type="button" className={cx("btn btn-ghost btn-lg", s.btnBack)} onClick={() => go(3)} disabled={submitting}>Back</button>
          <button type="button" className="btn btn-primary btn-lg" style={{ flex: 1 }} onClick={submit} disabled={submitting || !allOk(answers)} aria-busy={submitting}>
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
            <div className={s.recapCell}><dt>Dates</dt><dd>{fmtRange(answers.startDate, answers.endDate)}</dd></div>
            <div className={s.recapCell}><dt>Travelers</dt><dd>{answers.party}</dd></div>
            <div className={s.recapCell}><dt>Flight</dt><dd>{recapFlight(answers)}</dd></div>
            <div className={s.recapCell}><dt>Hotel</dt><dd>{recapHotel(answers)}</dd></div>
          </dl>
        </div>
        <div className={cx(s.obActions, s.confirmActions)}>
          <Link className="btn btn-primary btn-lg btn-block" href="/trips">Open my trip</Link>
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ sections */

function DateRange({ answers, set }: { answers: Answers; set: (p: Partial<Answers>) => void }): React.ReactElement {
  return (
    <div className={s.twoCol}>
      <div>
        <label className="field-label" htmlFor="tStart">When do you go?</label>
        <input
          className="field" id="tStart" type="date" value={answers.startDate}
          onChange={(e) => {
            const v = e.target.value;
            // Keep the range coherent: a return date now before the new start is cleared.
            set({ startDate: v, ...(answers.endDate && answers.endDate < v ? { endDate: "" } : {}) });
          }}
        />
      </div>
      <div>
        <label className="field-label" htmlFor="tEnd">When do you leave?</label>
        <input
          className="field" id="tEnd" type="date" value={answers.endDate}
          min={answers.startDate || undefined}
          onChange={(e) => set({ endDate: e.target.value })}
        />
      </div>
    </div>
  );
}

function FlightSection({ answers, set }: { answers: Answers; set: (p: Partial<Answers>) => void }): React.ReactElement {
  const booked = answers.flight === "Booked";
  const incomplete = booked && !flightOk(answers);
  return (
    <>
      <div className={cx(s.opts, s.three)}>
        <Opt stack icon={<PlaneIcon />} title="Yes" sub="It's booked" selected={booked} onClick={() => set({ flight: "Booked" })} />
        <Opt stack icon={<ClockIcon />} title="No" sub="Not yet" selected={answers.flight === "Not yet"} onClick={() => set({ flight: "Not yet" })} />
        <Opt stack icon={<QuestionIcon />} title="Still deciding" sub="Weighing options" selected={answers.flight === "Still deciding"} onClick={() => set({ flight: "Still deciding" })} />
      </div>
      <div className={cx(s.detailReveal, booked && s.show)}>
        <div className={s.revealCard}>
          <span className={s.rcLabel}><PlaneIcon size={14} />Your flight <em className={s.req}>· required</em></span>
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
            <label className="field-label" htmlFor="fSeat">Seat(s) <span className="field-hint" style={{ display: "inline" }}>· optional</span></label>
            <input className="field mono" id="fSeat" placeholder="e.g. 14A, 14B" value={answers.seat ?? ""} onChange={(e) => set({ seat: e.target.value })} />
          </div>
          {incomplete ? <p className={s.req}>Add the flight number and departure date to continue.</p> : null}
        </div>
      </div>
    </>
  );
}

function HotelSection({ answers, set }: { answers: Answers; set: (p: Partial<Answers>) => void }): React.ReactElement {
  const booked = answers.hotel === "Booked";
  const incomplete = booked && !hotelOk(answers);
  return (
    <>
      <div className={cx(s.opts, s.three)}>
        <Opt stack icon={<HotelIcon />} title="Yes" sub="It's booked" selected={booked} onClick={() => set({ hotel: "Booked" })} />
        <Opt stack icon={<ClockIcon />} title="No" sub="Not yet" selected={answers.hotel === "Not yet"} onClick={() => set({ hotel: "Not yet" })} />
        <Opt stack icon={<SearchSmallIcon />} title="Looking" sub="Help me find one" selected={answers.hotel === "Looking for one"} onClick={() => set({ hotel: "Looking for one" })} />
      </div>
      <div className={cx(s.detailReveal, booked && s.show)}>
        <div className={s.revealCard}>
          <span className={s.rcLabel}><HotelIcon size={14} />Your stay <em className={s.req}>· required</em></span>
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
              <input className="field" id="hOut" type="date" value={answers.hotelOut} min={answers.hotelIn || undefined} onChange={(e) => set({ hotelOut: e.target.value })} />
            </div>
          </div>
          {incomplete ? <p className={s.req}>Add the hotel name and check-in / check-out dates to continue.</p> : null}
        </div>
      </div>
    </>
  );
}

const PARTY_PRESETS = ["Solo", "2 people", "Family", "Group"] as const;

function PartySelect({ answers, set }: { answers: Answers; set: (p: Partial<Answers>) => void }): React.ReactElement {
  const options = PARTY_PRESETS.includes(answers.party as (typeof PARTY_PRESETS)[number])
    ? PARTY_PRESETS
    : ([...PARTY_PRESETS, answers.party] as const);
  return (
    <select className="field" aria-label="Travelers" value={answers.party} onChange={(e) => set({ party: e.target.value })}>
      {options.map((p) => <option key={p} value={p}>{p}</option>)}
    </select>
  );
}

/* -------------------------------------------------------------------- recap helpers */

function fmtRange(start?: string, end?: string): string {
  if (start && end) return `${start} → ${end}`;
  return start || end || "—";
}
function recapFlight(a: Answers): string {
  return a.flight === "Booked" && a.flightNo ? `Booked · ${a.flightNo}` : a.flight || "Not added";
}
function recapHotel(a: Answers): string {
  return a.hotel === "Booked" && a.hotelName ? `Booked · ${a.hotelName}` : a.hotel || "Not added";
}

/* -------------------------------------------------------------------- presentational */

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
