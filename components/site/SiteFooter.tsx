import Link from "next/link";
import { Logo } from "./Logo";

/** Full marketing footer (four-column) used on the landing page. */
export function SiteFooter(): React.ReactElement {
  return (
    <footer className="site">
      <div className="k-container">
        <div className="foot-grid">
          <div className="foot-brand">
            <Logo />
            <p>
              It catches your trip falling apart before you do — and tells you what to do about it.
            </p>
          </div>
          <div className="foot-col">
            <h6>Product</h6>
            <Link href="/features">Features</Link>
            <Link href="/#how">How it works</Link>
            <Link href="/dashboard">Dashboard</Link>
          </div>
          <div className="foot-col">
            <h6>Company</h6>
            <Link href="/contact">Contact</Link>
            <Link href="/">About</Link>
          </div>
          <div className="foot-col">
            <h6>Legal</h6>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
          </div>
        </div>
        <div className="foot-bottom">
          <p>© 2026 Keeper. Detect and advise — never auto-fix.</p>
          <p className="mono">v1 · walking skeleton</p>
        </div>
      </div>
    </footer>
  );
}

/** Compact single-row footer used on the features + contact pages. */
export function SiteFooterCompact(): React.ReactElement {
  return (
    <footer className="site-compact">
      <div className="k-container foot-inner">
        <p>© 2026 Keeper. Detect and advise — never auto-fix.</p>
        <div className="foot-links">
          <Link href="/">Home</Link>
          <Link href="/features">Features</Link>
          <Link href="/login">Log in</Link>
          <Link href="/signup">Sign up</Link>
        </div>
      </div>
    </footer>
  );
}
