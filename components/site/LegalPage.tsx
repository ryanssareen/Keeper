import Link from "next/link";
import { SiteNav } from "@/components/site/SiteNav";
import { SiteFooterCompact } from "@/components/site/SiteFooter";
import s from "@/app/legal.module.css";

/** Grievance Officer / contact details, shown on both legal pages. */
export function GrievanceOfficer(): React.ReactElement {
  return (
    <div className={s.officer}>
      <span className="k-label">Grievance Officer</span>
      <div className="name">Rishi Sareen</div>
      <div className="role">Grievance Officer, Keeper</div>
      <div className="rows">
        <div>Email: <a href="mailto:rsareen@gmail.com">rsareen@gmail.com</a></div>
        <div>For privacy questions, data requests, or complaints about how Keeper handles your information.</div>
      </div>
    </div>
  );
}

/** Shared chrome for the privacy + terms documents: nav, centered prose, active TOC, footer. */
export function LegalPage({
  title,
  updated,
  lede,
  active,
  children,
}: {
  title: string;
  updated: string;
  lede: string;
  active: "privacy" | "terms";
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <>
      <SiteNav />
      <div className={s.wrap}>
        <div className={`k-container`}>
          <div className={s.doc}>
            <h1>{title}</h1>
            <p className={s.updated}>Last updated · {updated}</p>
            <p className={s.lede}>{lede}</p>
            <div className={s.toc}>
              <Link href="/privacy" className={active === "privacy" ? s.active : undefined}>Privacy Policy</Link>
              <Link href="/terms" className={active === "terms" ? s.active : undefined}>Terms of Service</Link>
            </div>
            <div className={s.body}>{children}</div>
          </div>
        </div>
      </div>
      <SiteFooterCompact />
    </>
  );
}
