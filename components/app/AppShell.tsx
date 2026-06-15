import Link from "next/link";
import { Logo } from "@/components/site/Logo";
import { signOut } from "@/lib/auth/actions";
import s from "./appShell.module.css";

const SettingsIcon = () => (
  <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
    <path d="M9 11.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" stroke="currentColor" strokeWidth="1.3" />
    <path d="M14.5 9c0-.4 0-.7-.1-1l1.4-1.1-1.5-2.6-1.7.7a5.5 5.5 0 0 0-1.7-1l-.3-1.8H7.4l-.3 1.8c-.6.2-1.2.6-1.7 1l-1.7-.7L2.2 6.9 3.6 8a5.6 5.6 0 0 0 0 2L2.2 11.1l1.5 2.6 1.7-.7c.5.4 1.1.8 1.7 1l.3 1.8h3.2l.3-1.8c.6-.2 1.2-.6 1.7-1l1.7.7 1.5-2.6L14.4 10c.1-.3.1-.6.1-1Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
  </svg>
);

const SignOutIcon = () => (
  <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
    <path d="M7 15.5H4a1.5 1.5 0 0 1-1.5-1.5V4A1.5 1.5 0 0 1 4 2.5h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    <path d="M11 12.5 14.5 9 11 5.5M14 9H6.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export interface ShellUser {
  name: string;
  email: string;
}

/** Initial for the avatar tile — first letter of the name, else the email, else "K". */
function initial(user: ShellUser): string {
  const src = user.name || user.email || "K";
  return src.trim().charAt(0).toUpperCase() || "K";
}

/**
 * Post-auth app frame: the fixed left rail (brand, a caller-provided middle slot, account foot with
 * sign-out) plus the scrolling main column (sticky header + content). Dashboard and settings both
 * compose this; only `railMiddle` and `header` differ between them.
 */
export function AppShell({
  user,
  railMiddle,
  header,
  headerActions,
  children,
}: {
  user: ShellUser;
  railMiddle: React.ReactNode;
  header: React.ReactNode;
  headerActions?: React.ReactNode;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className={s.app}>
      <aside className={s.rail}>
        <div className={s.railTop}>
          <Logo href="/dashboard" />
          <Link className={s.iconBtn} href="/settings" title="Settings" aria-label="Settings">
            <SettingsIcon />
          </Link>
        </div>

        <div className={s.railMiddle}>{railMiddle}</div>

        <div className={s.railFoot}>
          <Link className={s.acct} href="/settings">
            <span className={s.avatar}>{initial(user)}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span className={s.nm} style={{ display: "block" }}>{user.name || "Your account"}</span>
              <span className={s.em} style={{ display: "block" }}>{user.email}</span>
            </span>
          </Link>
          <form action={signOut}>
            <button className={s.signout} type="submit" title="Sign out" aria-label="Sign out">
              <SignOutIcon />
            </button>
          </form>
        </div>
      </aside>

      <main className={s.main}>
        {/* Mobile-only top bar. The left rail (which holds settings + sign-out) is display:none below
            860px, so without this there is no way to reach settings or log out on a phone. */}
        <div className={s.mobileBar}>
          <Logo href="/dashboard" />
          <div className={s.mobileBarActions}>
            <Link className={s.iconBtn} href="/settings" title="Settings" aria-label="Settings">
              <SettingsIcon />
            </Link>
            <form action={signOut}>
              <button className={s.signout} type="submit" title="Sign out" aria-label="Sign out">
                <SignOutIcon />
              </button>
            </form>
          </div>
        </div>
        <div className={s.mainHead}>
          <div className={s.crumbs}>{header}</div>
          {headerActions ? <div className={s.headActions}>{headerActions}</div> : null}
        </div>
        {children}
      </main>
    </div>
  );
}

/** "+ New watch" call-to-action for the dashboard rail. */
export function RailNewButton(): React.ReactElement {
  return (
    <div className={s.railNew}>
      <Link className={s.btnNew} href="/onboarding">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
          <path d="M8 3.5v9M3.5 8h9" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        New watch
      </Link>
    </div>
  );
}

/** Settings rail nav. */
export function SettingsNav(): React.ReactElement {
  return (
    <>
      <RailNewButton />
      <nav className={s.navList}>
        <Link className={s.navLink} href="/dashboard">
          <svg width="17" height="17" viewBox="0 0 18 18" fill="none"><rect x="2.5" y="2.5" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4" /><rect x="2.5" y="10.5" width="6" height="5" rx="1.5" stroke="currentColor" strokeWidth="1.4" /><rect x="10.5" y="2.5" width="5" height="5" rx="1.5" stroke="currentColor" strokeWidth="1.4" /><rect x="10.5" y="9.5" width="5" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4" /></svg>
          Watches
        </Link>
        <Link className={`${s.navLink} ${s.active}`} href="/settings">
          <SettingsIcon />
          Settings
        </Link>
      </nav>
    </>
  );
}
