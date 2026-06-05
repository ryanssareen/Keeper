import Link from "next/link";
import type { Metadata } from "next";
import { Logo } from "@/components/site/Logo";
import { LoginForm } from "@/components/auth/LoginForm";
import s from "@/app/auth.module.css";

export const metadata: Metadata = { title: "Keeper — Log in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}): Promise<React.ReactElement> {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : undefined;
  const confirmError = params.error === "confirm";

  return (
    <div className={s.auth}>
      {/* form */}
      <div className={s.formSide}>
        <div className={s.top}>
          <Logo />
          <Link className={s.back} href="/">← Back home</Link>
        </div>
        <div className={s.body}>
          <h1>Welcome back</h1>
          <p className={s.sub}>Pick up your watches right where you left them.</p>
          <LoginForm next={next} confirmError={confirmError} />
          <p className={s.foot}>
            New to Keeper? <Link href="/signup">Create an account</Link>
          </p>
        </div>
        <div />
      </div>

      {/* brand */}
      <div className={s.brandSide}>
        <div className={s.brandQuote}>
          <span className="k-label">Keeper · live</span>
          <blockquote>While you read this, it&apos;s watching the joints of someone&apos;s trip.</blockquote>
        </div>
        <div className={s.mini}>
          <div className={s.miniTop}>
            <span className="k-label">watch · EK 9</span>
            <span className="pill pill-ok pill-dot">On track</span>
          </div>
          <h3>On track — comfortable</h3>
          <p>Comfortable slack to your 19:30 commitment. We&apos;re watching the flight for any cascade.</p>
          <div className={s.miniFacts}>
            <div className={s.mf}><span className="k-label">Slack</span><div className={s.v} style={{ color: "var(--emerald-200)" }}>+1h 12m</div></div>
            <div className={s.mf}><span className="k-label">Arrival</span><div className={s.v}>17:44</div></div>
            <div className={s.mf}><span className="k-label">Transit</span><div className={s.v}>38 min</div></div>
          </div>
        </div>
      </div>
    </div>
  );
}
