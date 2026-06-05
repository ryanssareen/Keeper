"use client";

import { useActionState } from "react";
import { signUp, type AuthState } from "@/lib/auth/actions";
import s from "@/app/auth.module.css";

export function SignupForm(): React.ReactElement {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(signUp, undefined);

  return (
    <form className={s.stack} action={formAction}>
      {state?.error ? <p className={s.error}>{state.error}</p> : null}
      {state?.notice ? <p className={s.notice}>{state.notice}</p> : null}

      <div>
        <label className="field-label" htmlFor="name">Name</label>
        <input className="field" id="name" name="name" type="text" placeholder="Ryan Sareen" autoComplete="name" required />
      </div>
      <div>
        <label className="field-label" htmlFor="email">Email</label>
        <input className="field" id="email" name="email" type="email" placeholder="you@example.com" autoComplete="email" required />
      </div>
      <div>
        <label className="field-label" htmlFor="password">Password</label>
        <input className="field" id="password" name="password" type="password" placeholder="At least 8 characters" autoComplete="new-password" minLength={8} required />
        <p className="field-hint">Use 8+ characters with a mix of letters and numbers.</p>
      </div>
      <label className={`${s.checkboxRow} ${s.agree}`}>
        <input type="checkbox" required />
        <span>
          I agree to Keeper&apos;s <a href="#">Terms</a> and <a href="#">Privacy Policy</a>. We only
          watch the trips you ask us to.
        </span>
      </label>
      <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={pending} style={{ marginTop: 4 }}>
        {pending ? "Creating account…" : "Create account"}
      </button>
    </form>
  );
}
