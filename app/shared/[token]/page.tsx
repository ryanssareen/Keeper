import type { Metadata } from "next";
import Link from "next/link";
import { loadSharedStatus } from "@/lib/share/queries";
import { Logo } from "@/components/site/Logo";
import { SharedStatus } from "@/components/app/SharedStatus";
import s from "./shared.module.css";

export const metadata: Metadata = { title: "Trip status · Keeper" };

export default async function SharedPage({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<React.ReactElement> {
  const { token } = await params;
  const status = await loadSharedStatus(token);

  return (
    <div className={s.page}>
      <div className={s.nav}>
        <Logo href="/" />
      </div>

      <main className={s.content}>
        {status ? (
          <SharedStatus status={status} />
        ) : (
          <div className={s.inactive}>
            <div className={s.inactiveRing}>
              <svg width="22" height="22" viewBox="0 0 20 20" fill="none">
                <path d="M10 6v5M10 14h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </div>
            <h1>This link isn&apos;t active</h1>
            <p>The traveler may have turned off sharing, or this link has expired.</p>
            <Link href="/" className={s.homeLink}>Go to Keeper →</Link>
          </div>
        )}
      </main>
    </div>
  );
}
