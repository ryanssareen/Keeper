import Link from "next/link";
import type { Metadata } from "next";
import { Logo } from "@/components/site/Logo";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";
import s from "@/app/auth.module.css";

export const metadata: Metadata = { title: "Keeper — Reset your password" };

export default function ForgotPasswordPage(): React.ReactElement {
  return (
    <div className={s.auth}>
      {/* form */}
      <div className={s.formSide}>
        <div className={s.top}>
          <Logo />
          <Link className={s.back} href="/login">← Back to log in</Link>
        </div>
        <div className={s.body}>
          <h1>Reset your password</h1>
          <p className={s.sub}>Enter the email you signed up with and we&apos;ll send a link to set a new password.</p>
          <ForgotPasswordForm />
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
          <blockquote>A fresh password, and you&apos;re back to watching the joints of your trips.</blockquote>
        </div>
      </div>
    </div>
  );
}
