import Link from "next/link";
import { Logo } from "./Logo";
import { SiteNavMobile } from "./SiteNavMobile";

type NavKey = "features" | "how" | "contact";

/** Sticky, blurred marketing top nav. `active` highlights the current section. */
export function SiteNav({ active }: { active?: NavKey }): React.ReactElement {
  return (
    <header className="nav">
      <div className="k-container nav-inner">
        <Logo />
        <nav className="nav-links">
          <Link href="/features" className={active === "features" ? "active" : undefined}>
            Features
          </Link>
          <Link href="/#how" className={active === "how" ? "active" : undefined}>
            How it works
          </Link>
          <Link href="/contact" className={active === "contact" ? "active" : undefined}>
            Contact
          </Link>
        </nav>
        <div className="nav-cta">
          <Link className="btn btn-ghost" href="/login">
            Log in
          </Link>
          <Link className="btn btn-primary" href="/signup">
            Start watching
          </Link>
        </div>
        <SiteNavMobile />
      </div>
    </header>
  );
}
