import s from "./itinerary.module.css";

export default function Loading(): React.ReactElement {
  return (
    <div className={s.page} style={{ padding: "30px 0" }}>
      <div className={s.skel} style={{ height: 32, width: 240 }} />
      <div className={s.skel} />
      <div className={s.skel} />
      <div className={s.skel} />
    </div>
  );
}
