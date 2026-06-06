"use client";

import { useActionState } from "react";
import { resetPassword, type AuthState } from "@/lib/auth/actions";
import s from "@/app/auth.module.css";

/**
 * Step 2 of the forgot-password flow: set the new password. Rendered only when the recovery session
 * is live (the page gates on it), so on success the action signs the user straight into /dashboard.
 */
export function ResetPasswordForm(): React.ReactElement {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(resetPassword, undefined);

  return (
    <form className={s.stack} action={formAction}>
      {state?.error ? <p className={s.error}>{state.error}</p> : null}

      <div>
        <label className="field-label" htmlFor="password">New password</label>
        <input className="field" id="password" name="password" type="password" placeholder="At least 8 characters" autoComplete="new-password" minLength={8} required />
        <p className="field-hint">Use 8+ characters with a mix of letters and numbers.</p>
      </div>
      <div>
        <label className="field-label" htmlFor="confirmPassword">Confirm new password</label>
        <input className="field" id="confirmPassword" name="confirmPassword" type="password" placeholder="Re-enter your password" autoComplete="new-password" minLength={8} required />
      </div>
      <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={pending}>
        {pending ? "Saving…" : "Set new password"}
      </button>
    </form>
  );
}
