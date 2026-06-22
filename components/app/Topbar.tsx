"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { savePreferences } from "@/lib/preferences/actions";
import type { Theme } from "@/lib/preferences/preferences";
import s from "./commandCenter.module.css";

export type TopbarTitle = { kick: string; title: string };

const SunIcon = (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="3.6" stroke="currentColor" strokeWidth="1.5" /><path d="M9 1.5v2M9 14.5v2M1.5 9h2M14.5 9h2M3.7 3.7l1.4 1.4M12.9 12.9l1.4 1.4M3.7 14.3l1.4-1.4M12.9 5.1l1.4-1.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
);
const MoonIcon = (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M15.5 10.5A6.5 6.5 0 0 1 7.5 2.5a6.5 6.5 0 1 0 8 8Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
);

export function Topbar({
  titles,
  hasAlert,
  initialTheme,
  onMenu,
}: {
  titles: Record<string, TopbarTitle>;
  hasAlert: boolean;
  initialTheme: Theme;
  onMenu: () => void;
}): React.ReactElement {
  const pathname = usePathname();
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [, startTransition] = useTransition();

  // Longest-prefix match so /itinerary, /bookings/x, etc. all resolve to their view title.
  const key =
    Object.keys(titles)
      .filter((k) => pathname === k || pathname.startsWith(k))
      .sort((a, b) => b.length - a.length)[0] ?? "/today";
  const t = titles[key] ?? { kick: "Keeper", title: "Keeper" };

  function toggleTheme() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    // Optimistic, instant: flip the attribute the whole token system reads.
    document.documentElement.setAttribute("data-theme", next);
    startTransition(() => {
      void savePreferences({ theme: next });
    });
  }

  return (
    <div className={s.topbar}>
      <button className={`${s.ibtn} ${s.hamburger}`} onClick={onMenu} aria-label="Open menu" title="Menu">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M3 5h12M3 9h12M3 13h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
      </button>
      <div className={s.tt}>
        <span className={s.k}>{t.kick}</span>
        <h1>{t.title}</h1>
      </div>
      <div className={s.grow} />
      <div className={s.search}>
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4" /><path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
        Search this trip
      </div>
      <button className={s.ibtn} onClick={toggleTheme} title="Toggle theme" aria-label="Toggle theme">
        {theme === "dark" ? MoonIcon : SunIcon}
      </button>
      <Link className={s.ibtn} href="?catch=1" title="Alerts" aria-label="Alerts" scroll={false}>
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M10 3a4 4 0 0 0-4 4c0 4-1.6 5-1.6 5h11.2S14 11 14 7a4 4 0 0 0-4-4Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /><path d="M8.5 16a1.5 1.5 0 0 0 3 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        {hasAlert ? <span className={s.dot} /> : null}
      </Link>
    </div>
  );
}
