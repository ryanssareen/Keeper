"use client";

import { useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import type { CatchModel } from "@/lib/alerts/catch";
import s from "./catchModal.module.css";

/**
 * The live catch modal. Open state lives in the URL (?catch=1) so any view can trigger it with a plain
 * link and the back button closes it. `model` is the most-at-risk watch's catch derivation (or null →
 * an "all clear" reassurance). Read-only by design: Keeper advises, it does not act on the booking.
 */
export function CatchModal({ model }: { model: CatchModel | null }): React.ReactElement | null {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const open = params.get("catch") === "1";

  const close = useCallback(() => {
    const next = new URLSearchParams(params);
    next.delete("catch");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [params, pathname, router]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open) return null;

  const closeBtn = (
    <button className={s.x} onClick={close} aria-label="Close">
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
    </button>
  );

  // Nothing at risk → reassuring all-clear card.
  if (!model) {
    return (
      <div className={s.scrim} onClick={(e) => e.target === e.currentTarget && close()}>
        <div className={s.modal} role="dialog" aria-modal="true">
          <div className={s.mh}>
            <span className={`${s.live} ${s.ok}`}><span className={s.b} />All clear</span>
            {closeBtn}
          </div>
          <div className={s.clearWrap}>
            <span className={s.clearRing}>
              <svg width="26" height="26" viewBox="0 0 20 20" fill="none"><path d="M5 10.5 8.5 14 15 6" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </span>
            <h1>Nothing needs you.</h1>
            <p>Keeper is watching your flight and downstream plans. You&apos;ll hear from us the moment something moves.</p>
          </div>
          <div className={s.mfoot}>
            <Link className={s.primary} href="/alerts" onClick={close}>View alert history</Link>
            <span className={s.sp} />
            <button className={s.ghost} onClick={close}>Close</button>
          </div>
        </div>
      </div>
    );
  }

  const negative = model.marginMinutes !== null && model.marginMinutes < 0;
  const marginLabel =
    model.marginMinutes === null ? "—" : `${model.marginMinutes > 0 ? "+" : ""}${model.marginMinutes}m`;

  return (
    <div className={s.scrim} onClick={(e) => e.target === e.currentTarget && close()}>
      <div className={s.modal} role="dialog" aria-modal="true">
        <div className={s.mh}>
          <span className={s.live}><span className={s.b} />Live · cascade detected</span>
          {closeBtn}
        </div>
        <div className={s.mb}>
          <h1>{model.headline}</h1>
          <p className={s.exp}>{model.explanation}</p>
          <div className={s.collide}>
            <div className={`${s.cnode} ${s.warn}`}><span className={s.dot} /><span className={s.k}>Flight</span><span className={s.v}>{model.flightNode}</span></div>
            <div className={`${s.cnode} ${s.warn}`}><span className={s.dot} /><span className={s.k}>Transfer</span><span className={s.v}>{model.transferNode}</span></div>
            <div className={`${s.cnode} ${s.miss}`}><span className={s.dot} /><span className={s.k}>{model.placeLabel}</span><span className={s.v}>{model.commitmentNode}</span></div>
          </div>
          <dl className={s.cmetrics}>
            <div><dt>Arrive by</dt><dd>{model.arriveByLabel}</dd></div>
            <div><dt>Commitment</dt><dd>{model.commitmentLabel}</dd></div>
            <div><dt>Margin</dt><dd className={negative ? s.bad : ""}>{marginLabel}</dd></div>
          </dl>
        </div>
        <div className={s.action}>
          <span className={s.k}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 1.5l1.8 3.9 4.2.5-3.1 2.9.8 4.2L8 11.3 4.3 13l.8-4.2L2 5.9l4.2-.5L8 1.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></svg>
            Do this now
          </span>
          <p>{model.action}</p>
        </div>
        <div className={s.mfoot}>
          <Link className={s.primary} href={`/alerts`} onClick={close}>Review in Alerts</Link>
          <button className={s.ghost} onClick={close}>I&apos;ve handled it</button>
          <span className={s.sp} />
          <button className={s.ghost} onClick={close}>Snooze</button>
        </div>
      </div>
    </div>
  );
}
