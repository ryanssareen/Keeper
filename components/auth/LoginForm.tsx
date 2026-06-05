"use client";

import { useActionState } from "react";
import { signIn, type AuthState } from "@/lib/auth/actions";
import s from "@/app/auth.module.css";

export function LoginForm({ next, confirmError }: { next?: string; confirmError?: boolean }): React.ReactElement {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(signIn, undefined);

  return (
    <form className={s.stack} action={formAction}>
      {next ? <input type="hidden" name="next" value={next} /> : null}

      {confirmError ? (
        <p className={s.error}>That confirmation link was invalid or expired. Try logging in.</p>
      ) : null}
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
  );
}
