import { describe, it, expect } from "vitest";
import { friendlyAuthError } from "@/lib/auth/errors";

// The account-creation bug was a raw Supabase string ("User already registered") shown verbatim.
// These assert the user-facing copy for every case the auth flows surface, by error code AND by the
// raw message text (Supabase is inconsistent about which it populates across versions).
describe("friendlyAuthError", () => {
  it("turns a duplicate-signup error into 'already exists' guidance (by code)", () => {
    expect(friendlyAuthError({ code: "user_already_exists" })).toBe(
      "An account with this email already exists. Log in instead.",
    );
  });

  it("turns a duplicate-signup error into 'already exists' guidance (by message)", () => {
    expect(friendlyAuthError({ message: "User already registered" })).toBe(
      "An account with this email already exists. Log in instead.",
    );
  });

  it("explains a bad login without leaking which field was wrong", () => {
    expect(friendlyAuthError({ message: "Invalid login credentials" })).toBe(
      "That email or password is incorrect.",
    );
    expect(friendlyAuthError({ code: "invalid_credentials" })).toBe(
      "That email or password is incorrect.",
    );
  });

  it("tells an unconfirmed user to check their inbox", () => {
    expect(friendlyAuthError({ code: "email_not_confirmed" })).toBe(
      "Confirm your email first — check your inbox for the link.",
    );
  });

  it("asks rate-limited users to wait", () => {
    expect(friendlyAuthError({ code: "over_email_send_rate_limit" })).toBe(
      "Too many attempts just now. Wait a minute, then try again.",
    );
    expect(friendlyAuthError({ message: "email rate limit exceeded" })).toBe(
      "Too many attempts just now. Wait a minute, then try again.",
    );
  });

  it("passes through a weak-password message so the rule is visible", () => {
    expect(friendlyAuthError({ message: "Password should be at least 8 characters" })).toBe(
      "Password should be at least 8 characters",
    );
  });

  it("falls back to a generic message for unknown errors", () => {
    expect(friendlyAuthError({ code: "some_new_thing" })).toBe("Something went wrong. Please try again.");
    expect(friendlyAuthError({})).toBe("Something went wrong. Please try again.");
  });
});
