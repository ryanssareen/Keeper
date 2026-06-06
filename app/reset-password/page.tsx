import Link from "next/link";
import type { Metadata } from "next";
import { Logo } from "@/components/site/Logo";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";
import { getCurrentUser } from "@/lib/supabase/server";
import s from "@/app/auth.module.css";

export const metadata: Metadata = { title: "Keeper — Set a new password" };

/**
 * Landing page for the recovery link. /auth/callback has already exchanged the recovery code for a
 * session by the time we render, so a present user means the link was valid; a missing user means it
 * was wrong or expired — we say so plainly and offer a fresh link rather than a dead form.
 */
export default async function ResetPasswordPage(): Promise<React.ReactElement> {
  const user = await getCurrentUser();

  return (
    <div className={s.auth}>
      {/* form */}
      <div className={s.formSide}>
        <div className={s.top}>
          <Logo />
          <Link className={s.back} href="/login">← Back to log in</Link>
        </div>
        <div className={s.body}>
          {user ? (
            <>
              <h1>Set a new password</h1>
              <p className={s.sub}>Choose a new password for {user.email}.</p>
              <ResetPasswordForm />
            </>
          ) : (
            <>
              <h1>Link expired</h1>
              <p className={s.sub}>This password-reset link is invalid or has already been used.</p>
              <div className={s.stack}>
                <Link className="btn btn-primary btn-lg btn-block" href="/forgot-password">
                  Request a new link
                </Link>
              </div>
            </>
          )}
          <p className={s.foot}>
            Remembered it? <Link href="/login">Log in</Link>
          </p>
        </div>
        <div />
      </div>

      {/* brand */}
      <div className={s.brandSide}>
        <div className={s.brandQuote}>
          <span className="k-label">Keeper · secure</span>
          <blockquote>One more step and your account is yours again.</blockquote>
        </div>
      </div>
    </div>
  );
}
