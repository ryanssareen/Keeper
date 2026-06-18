"use client";
import { useState } from "react";
import Link from "next/link";

/**
 * Mobile menu for the marketing nav. Below the desktop breakpoint the inline `.nav-links` / `.nav-cta`
 * are hidden (they don't fit), so without this the nav would lose Features / How / Contact and the auth
 * actions entirely. A hamburger toggles a panel carrying all of them.
 */
export function SiteNavMobile(): React.ReactElement {
  const [open, setOpen] = useState(false);
  const close = (): void => setOpen(false);

  return (
    <div className="nav-mobile">
      <button
        type="button"
        className="nav-burger"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
          {open ? (
            <path d="M5 5l12 12M17 5 5 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          ) : (
            <path d="M3 6h16M3 11h16M3 16h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          )}
        </svg>
      </button>

      {open ? (
        <>
          <button type="button" className="nav-scrim" aria-label="Close menu" onClick={close} />
          <div className="nav-panel" role="menu">
            <Link href="/features" onClick={close}>Features</Link>
            <Link href="/#how" onClick={close}>How it works</Link>
            <Link href="/contact" onClick={close}>Contact</Link>
            <div className="nav-panel-cta">
              <Link className="btn btn-ghost" href="/login" onClick={close}>Log in</Link>
              <Link className="btn btn-primary" href="/signup" onClick={close}>Start watching</Link>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
