"use client";

import { useActionState } from "react";
import { signIn, type AuthState } from "@/lib/auth/actions";
import { GoogleButton } from "@/components/auth/GoogleButton";
import s from "@/app/auth.module.css";

const ERROR_COPY: Record<string, string> = {
  confirm: "That confirmation link was invalid or expired. Try logging in.",
  oauth: "Google sign-in didn’t complete. Please try again.",
};

export function LoginForm({ next, errorKind }: { next?: string; errorKind?: string }): React.ReactElement {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(signIn, undefined);
  const paramError = errorKind ? ERROR_COPY[errorKind] : undefined;

  return (
    <>
      <div className={s.oauth}>
        <GoogleButton next={next} />
      </div>
      <div className={s.or}><span>or</span></div>

      <form className={s.stack} action={formAction}>
        {next ? <input type="hidden" name="next" value={next} /> : null}

        {paramError ? <p className={s.error}>{paramError}</p> : null}
        {state?.error ? <p className={s.error}>{state.error}</p> : null}
        {state?.notice ? <p className={s.notice}>{state.notice}</p> : null}

        <div>
          <label className="field-label" htmlFor="email">Email</label>
          <input className="field" id="email" name="email" type="email" placeholder="you@example.com" autoComplete="email" required />
        </div>
        <div>
          <div className={s.rowBetween}>
            <label className="field-label" htmlFor="password" style={{ margin: 0 }}>Password</label>
            <a href="#">Forgot?</a>
          </div>
          <input className="field" id="password" name="password" type="password" placeholder="••••••••" autoComplete="current-password" required />
        </div>
        <label className={s.checkboxRow}>
          <input type="checkbox" defaultChecked /> Keep me signed in on this device
        </label>
        <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={pending}>
          {pending ? "Logging in…" : "Log in"}
        </button>
      </form>
    </>
  );
}
