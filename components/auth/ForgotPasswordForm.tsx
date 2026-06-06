"use client";

import { useActionState } from "react";
import { requestPasswordReset, type AuthState } from "@/lib/auth/actions";
import s from "@/app/auth.module.css";

/**
 * Step 1 of the forgot-password flow: collect the email and ask Supabase to send a recovery link.
 * The action always returns a neutral notice (no email enumeration), which we render in place of the
 * form fields once sent so the user has a single clear next step: check their inbox.
 */
export function ForgotPasswordForm(): React.ReactElement {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(requestPasswordReset, undefined);

  if (state?.notice) {
    return (
      <div className={s.stack}>
        <p className={s.notice}>{state.notice}</p>
      </div>
    );
  }

  return (
    <form className={s.stack} action={formAction}>
      {state?.error ? <p className={s.error}>{state.error}</p> : null}

      <div>
        <label className="field-label" htmlFor="email">Email</label>
        <input className="field" id="email" name="email" type="email" placeholder="you@example.com" autoComplete="email" required />
      </div>
      <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={pending}>
        {pending ? "Sending…" : "Send reset link"}
      </button>
    </form>
  );
}
