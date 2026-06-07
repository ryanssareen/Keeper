import s from "./trips.module.css";

/** Route-level shell shown instantly on navigation while the page's data resolves. */
export default function TripsLoading(): React.ReactElement {
  return (
    <div className={s.page} aria-busy="true">
      <header className={s.tripHead}>
        <span className={s.who}>Your trip</span>
        <h1>Loading your trip…</h1>
      </header>
    </div>
  );
}
