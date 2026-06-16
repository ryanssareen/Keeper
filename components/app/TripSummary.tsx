import type { OnboardingAnswers } from "@/lib/onboarding/actions";
import s from "./tripSummary.module.css";

/**
 * Post-onboarding trip view. The wizard saves the trip to the `onboarding` table, but the dashboard
 * is watch-centric and used to ignore it — so finishing onboarding dropped the user on a "No watches
 * yet" dead-end that looped back to /onboarding. This renders the trip the user just set up so the
 * flow actually lands somewhere, mirroring the wizard's confirmation recap.
 */
export function TripSummary({ answers }: { answers: Partial<OnboardingAnswers> }): React.ReactElement {
  const dest = answers.dest || "Your trip";
  const flight =
    answers.flight === "Booked" && answers.flightNo
      ? `Booked · ${answers.flightNo}`
      : answers.flight || "Not added";
  const hotel =
    answers.hotel === "Booked" && answers.hotelName
      ? `Booked · ${answers.hotelName}`
      : answers.hotel || "Not added";

  const showFlight = answers.flight === "Booked" && (answers.flightNo || answers.flightDate);
  const showStay = answers.hotel === "Booked" && (answers.hotelName || answers.hotelIn);
  const dates =
    answers.startDate && answers.endDate
      ? `${answers.startDate} → ${answers.endDate}`
      : answers.startDate || answers.endDate || "—";

  return (
    <div className={s.wrap}>
      <div className={s.head}>
        <span className={s.who}>Your trip</span>
        <h1>{dest}{answers.country ? `, ${answers.country}` : ""}</h1>
        <p>Everything you told us is saved here. Add bookings, documents, and plans any time.</p>
      </div>

      <dl className={s.grid}>
        <div className={s.cell}><dt>Dates</dt><dd>{dates}</dd></div>
        <div className={s.cell}><dt>Travelers</dt><dd>{answers.party || "—"}</dd></div>
        <div className={s.cell}><dt>Destination</dt><dd>{answers.code || "—"}</dd></div>
        <div className={s.cell}><dt>Flight</dt><dd>{flight}</dd></div>
        <div className={s.cell}><dt>Hotel</dt><dd>{hotel}</dd></div>
      </dl>

      {showFlight ? (
        <div className={s.detail}>
          <span className={s.detailLabel}>Flight</span>
          <div className={s.detailRow}>
            {answers.flightNo ? <span className={s.mono}>{answers.flightNo}</span> : null}
            {answers.flightDate ? <span>{answers.flightDate}</span> : null}
          </div>
        </div>
      ) : null}

      {showStay ? (
        <div className={s.detail}>
          <span className={s.detailLabel}>Stay</span>
          <div className={s.detailRow}>
            {answers.hotelName ? <span>{answers.hotelName}</span> : null}
            {answers.hotelIn ? (
              <span>{answers.hotelIn}{answers.hotelOut ? ` → ${answers.hotelOut}` : ""}</span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
