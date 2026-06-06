import Link from "next/link";
import type { Metadata } from "next";
import { Logo } from "@/components/site/Logo";
import { SignupForm } from "@/components/auth/SignupForm";
import s from "@/app/auth.module.css";

export const metadata: Metadata = { title: "Keeper — Create your account" };

export default function SignupPage(): React.ReactElement {
  return (
    <div className={`${s.auth} ${s.signup}`}>
      {/* form */}
      <div className={s.formSide}>
        <div className={s.top}>
          <Logo />
          <Link className={s.back} href="/login">Have an account? Log in</Link>
        </div>
        <div className={s.body}>
          <h1>Create your account</h1>
          <p className={s.sub}>Free until Keeper catches something. No card to start.</p>
          <SignupForm />
          <p className={s.foot}>
            Already watching? <Link href="/login">Log in</Link>
          </p>
        </div>
        <div />
      </div>

      {/* brand */}
      <div className={s.brandSide}>
        <div className={s.brandHead}>
          <span className="k-label">Get started</span>
          <h2>Hand Keeper the chain. You hold the trip.</h2>
        </div>
        <div className={s.valueList}>
          <div className={s.vrow}>
            <span className={s.vic}>
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M9 2.5 3.5 5v4c0 3.4 2.3 6 5.5 7.5C12.2 15 14.5 12.4 14.5 9V5L9 2.5Z" stroke="#a1a1aa" strokeWidth="1.3" strokeLinejoin="round" /><path d="m6.6 9 1.7 1.7L11.6 7" stroke="#10b981" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </span>
            <div className={s.vt}><b>One notification, not a feed</b><span>Silent until something breaks. When it speaks, you act.</span></div>
          </div>
          <div className={s.vrow}>
            <span className={s.vic}>
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="6.5" stroke="#a1a1aa" strokeWidth="1.3" /><path d="M9 5.5V9l2.5 1.5" stroke="#a1a1aa" strokeWidth="1.3" strokeLinecap="round" /></svg>
            </span>
            <div className={s.vt}><b>Caught while there&apos;s still lead time</b><span>The collision is detected before the flight even lands.</span></div>
          </div>
          <div className={s.vrow}>
            <span className={s.vic}>
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M3 15V7l6-4 6 4v8" stroke="#a1a1aa" strokeWidth="1.3" strokeLinejoin="round" /><path d="M7 15v-3.5h4V15" stroke="#a1a1aa" strokeWidth="1.3" strokeLinejoin="round" /></svg>
            </span>
            <div className={s.vt}><b>A record that never lies</b><span>Every alert lives on your dashboard — delivered or not.</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}
