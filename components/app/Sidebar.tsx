"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import s from "./commandCenter.module.css";

/* ----------------------------------------------------------------- icons */
const I = {
  today: (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M3 9l7-6 7 6M5 7.5V17h10V7.5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" /></svg>
  ),
  itinerary: (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><rect x="3" y="4" width="14" height="13" rx="2.5" stroke="currentColor" strokeWidth="1.5" /><path d="M3 8h14M7 2.5v3M13 2.5v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
  ),
  bookings: (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M3 11l14-5-4.5 9.5-2.2-4.8L3 11Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
  ),
  alerts: (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M10 3a4 4 0 0 0-4 4c0 4-1.6 5-1.6 5h11.2S14 11 14 7a4 4 0 0 0-4-4Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /><path d="M8.5 16a1.5 1.5 0 0 0 3 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
  ),
  checklist: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M4 9.5 7 12.5 14 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /><rect x="2.5" y="2.5" width="13" height="13" rx="3" stroke="currentColor" strokeWidth="1.3" /></svg>
  ),
  shared: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="6.5" cy="6" r="2.2" stroke="currentColor" strokeWidth="1.3" /><circle cx="12" cy="7.5" r="1.8" stroke="currentColor" strokeWidth="1.3" /><path d="M2.5 15c0-2.2 1.8-3.6 4-3.6s4 1.4 4 3.6M11 15c0-1.6.8-2.8 2.4-3.1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
  ),
  chevron: (
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none"><path d="M7.5 5l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
  ),
  caret: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M5 7l3 3 3-3M5 4.5l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
  ),
};

type NavItem = { href: string; label: string; icon: React.ReactNode; badge?: boolean };
const MAIN: NavItem[] = [
  { href: "/today", label: "Today", icon: I.today },
  { href: "/itinerary", label: "Itinerary", icon: I.itinerary },
  { href: "/bookings", label: "Bookings", icon: I.bookings },
  { href: "/alerts", label: "Alerts", icon: I.alerts, badge: true },
];
const TRIP: NavItem[] = [
  { href: "/checklist", label: "Checklist", icon: I.checklist },
  { href: "/settings", label: "Shared with family", icon: I.shared },
];

export interface SidebarUser {
  name: string;
  email: string;
  initial: string;
  plan: string;
}

export function Sidebar({
  user,
  tripLabel,
  alertCount,
  open,
  onNavigate,
}: {
  user: SidebarUser;
  tripLabel: string;
  alertCount: number;
  open: boolean;
  onNavigate: () => void;
}): React.ReactElement {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

  const renderItem = (it: NavItem) => (
    <Link
      key={it.label}
      href={it.href}
      className={`${s.ni} ${isActive(it.href) ? s.on : ""}`}
      onClick={onNavigate}
    >
      {it.icon}
      {it.label}
      {it.badge && alertCount > 0 ? <span className={s.ct}>{alertCount}</span> : null}
    </Link>
  );

  return (
    <aside className={`${s.side} ${open ? s.open : ""}`}>
      <div className={s.brand}>
        <span className={s.brandTile}>
          <svg width="17" height="17" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="1.6" fill="var(--bg)" />
            <path d="M8 4.2a3.8 3.8 0 0 1 3.8 3.8" stroke="var(--bg)" strokeWidth="1.3" strokeLinecap="round" />
            <path d="M8 1.7a6.3 6.3 0 0 1 6.3 6.3" stroke="var(--text-faint)" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </span>
        <b>Keeper</b>
      </div>

      <Link href="/bookings" className={s.tripswitch} onClick={onNavigate}>
        <span className={s.tx} />
        <span className={s.tn}>
          <span className={s.k}>Active trip</span>
          <b>{tripLabel}</b>
        </span>
        <span style={{ color: "var(--text-faint)" }}>{I.caret}</span>
      </Link>

      <nav className={s.nav}>
        {MAIN.map(renderItem)}
        <div className={s.sep} />
        <div className={s.gl}>Trip</div>
        {TRIP.map(renderItem)}
      </nav>

      <Link href="/settings" className={s.userbox} onClick={onNavigate}>
        <span className={s.ava}>{user.initial}</span>
        <span className={s.un}>
          <b>{user.name || "Your account"}</b>
          <span>{user.plan}</span>
        </span>
        <span style={{ color: "var(--text-faint)" }}>{I.chevron}</span>
      </Link>
    </aside>
  );
}
