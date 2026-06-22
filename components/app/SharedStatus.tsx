import type { SharedStatus as SharedStatusType } from "@/lib/share/share";
import type { WatchState } from "@/lib/engine/types";
import s from "./sharedStatus.module.css";

function stateTone(state: WatchState | null): "ok" | "risk" | "miss" | "neutral" {
  if (!state) return "neutral";
  if (["OK", "RECOVERED", "LANDED_CAPTURE"].includes(state)) return "ok";
  if (["AT_RISK", "DEGRADED"].includes(state)) return "risk";
  if (["MISS_PREDICTED", "DEFINITE_MISS", "CANCELLED"].includes(state)) return "miss";
  return "neutral";
}

export function SharedStatus({ status }: { status: SharedStatusType }): React.ReactElement {
  const tone = stateTone(status.state);

  return (
    <div className={s.card}>
      {/* Eyebrow */}
      <p className={s.lbl}>Live trip status · read-only</p>

      {/* Title */}
      <h2 className={s.title}>
        {status.ownerName}&apos;s trip{status.dest ? ` to ${status.dest}` : ""}
      </h2>

      {/* Big status block */}
      <div className={`${s.bigStatus} ${s[`bigStatus_${tone}`]}`}>
        <span className={`${s.ring} ${s[`ring_${tone}`]}`}>
          {tone === "ok" ? (
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M5 10.5 8.5 14 15 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : tone === "miss" ? (
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M10 7v4M10 14h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          ) : tone === "risk" ? (
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M10 6v5M10 14h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="10" cy="10" r="2" fill="currentColor" />
            </svg>
          )}
        </span>
        <h3 className={s.headline}>{status.headline}</h3>
        <p className={s.sub}>{status.sub}</p>
      </div>

      {/* Mini timeline */}
      {status.steps.length > 0 ? (
        <div className={s.timeline}>
          {status.steps.map((step, i) => (
            <div key={i} className={`${s.step} ${step.now ? s.stepNow : ""} ${step.done ? s.stepDone : ""}`}>
              <span className={s.stepDot}>
                {step.done ? (
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M2 5l2 2 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : null}
              </span>
              <div className={s.stepBody}>
                <span className={s.stepTitle}>{step.title}</span>
                {step.detail ? <span className={s.stepDetail}>{step.detail}</span> : null}
              </div>
              {step.when ? <span className={s.stepWhen}>{step.when}</span> : null}
            </div>
          ))}
        </div>
      ) : null}

      {/* Footer */}
      <p className={s.updated}>↻ Updated {status.updatedAt} · auto</p>
    </div>
  );
}
