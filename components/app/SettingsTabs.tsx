"use client";

import { useActionState, useState, useTransition } from "react";
import { subscribePush } from "@/lib/push/client";
import { signOut, updateProfile, updatePassword, type AuthState } from "@/lib/auth/actions";
import { savePreferences } from "@/lib/preferences/actions";
import {
  THEMES, ACCENTS, type Theme, type Accent, type Preferences,
  DEFAULT_PREFERENCES,
} from "@/lib/preferences/preferences";
import type { ShellUser } from "./AppShell";
import s from "@/app/settings/settings.module.css";

type Tab = "appearance" | "notifs" | "account" | "devices" | "advanced";
const TABS: { id: Tab; label: string }[] = [
  { id: "appearance", label: "Appearance" },
  { id: "notifs", label: "Notifications" },
  { id: "account", label: "Account" },
  { id: "devices", label: "Devices" },
  { id: "advanced", label: "Advanced" },
];

const Glyph = ({ ring = "#a1a1aa" }: { ring?: string }) => (
  <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="8" r="1.6" fill="#fff" />
    <path d="M8 4.2a3.8 3.8 0 0 1 3.8 3.8" stroke="#fff" strokeWidth="1.3" strokeLinecap="round" />
    <path d="M8 1.7a6.3 6.3 0 0 1 6.3 6.3" stroke={ring} strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);

const Switch = ({ defaultChecked, disabled }: { defaultChecked?: boolean; disabled?: boolean }) => (
  <label className={s.sw}>
    <input type="checkbox" defaultChecked={defaultChecked} disabled={disabled} />
    <span className={s.slider} />
  </label>
);

export function SettingsTabs({
  user,
  initialPrefs,
}: {
  user: ShellUser;
  initialPrefs?: Preferences;
}): React.ReactElement {
  const [tab, setTab] = useState<Tab>("appearance");
  const initial = (user.name || user.email || "K").trim().charAt(0).toUpperCase();
  const prefs = initialPrefs ?? DEFAULT_PREFERENCES;

  return (
    <div className={s.wrap}>
      <div className={s.pageH}>
        <h1>Settings</h1>
        <p>Manage appearance, notifications, your account, and installed devices.</p>
      </div>

      <div className={s.tabs}>
        {TABS.map((t) => (
          <button key={t.id} className={`${s.tab} ${tab === t.id ? s.active : ""}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "appearance" ? <AppearancePanel initialTheme={prefs.theme} initialAccent={prefs.accent} /> : null}
      {tab === "notifs" ? <NotifsPanel /> : null}
      {tab === "account" ? <AccountPanel user={user} initial={initial} /> : null}
      {tab === "devices" ? <DevicesPanel /> : null}
      {tab === "advanced" ? <AdvancedPanel /> : null}
    </div>
  );
}

/* ----------------------------------------------------------- appearance */

const ACCENT_COLORS: Record<Accent, { label: string; hex: string }> = {
  emerald: { label: "Emerald", hex: "#10b981" },
  teal:    { label: "Teal",    hex: "#14b8a6" },
  indigo:  { label: "Indigo",  hex: "#6366f1" },
  violet:  { label: "Violet",  hex: "#8b5cf6" },
};

function AppearancePanel({
  initialTheme,
  initialAccent,
}: {
  initialTheme: Theme;
  initialAccent: Accent;
}): React.ReactElement {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [accent, setAccent] = useState<Accent>(initialAccent);
  const [, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  function applyTheme(t: Theme) {
    setTheme(t);
    document.documentElement.setAttribute("data-theme", t);
  }

  function applyAccent(a: Accent) {
    setAccent(a);
    document.documentElement.setAttribute("data-accent", a);
  }

  function handleSave() {
    setSaved(false);
    startTransition(() => {
      void savePreferences({ theme, accent }).then(() => setSaved(true));
    });
  }

  return (
    <section className={s.panel}>
      <div className={s.group}>
        <div className={s.groupHead}><h2>Theme</h2><p>Choose between light and dark.</p></div>
        <div className={s.groupBody}>
          <div className={s.themeRow}>
            {THEMES.map((t) => (
              <button
                key={t}
                className={`${s.themeBtn} ${theme === t ? s.themeBtnActive : ""}`}
                onClick={() => applyTheme(t)}
              >
                <span className={`${s.themeSwatch} ${t === "dark" ? s.swatchDark : s.swatchLight}`} />
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className={s.group}>
        <div className={s.groupHead}><h2>Accent colour</h2><p>Colours the OK/on-track state and interactive elements.</p></div>
        <div className={s.groupBody}>
          <div className={s.accentRow}>
            {ACCENTS.map((a) => (
              <button
                key={a}
                className={`${s.accentBtn} ${accent === a ? s.accentBtnActive : ""}`}
                onClick={() => applyAccent(a)}
                title={ACCENT_COLORS[a].label}
              >
                <span className={s.accentDot} style={{ background: ACCENT_COLORS[a].hex }} />
                {ACCENT_COLORS[a].label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className={s.groupBody} style={{ paddingTop: 0 }}>
        <button className="btn btn-primary" onClick={handleSave}>
          {saved ? "Saved" : "Save preferences"}
        </button>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- notifs */

function NotifsPanel(): React.ReactElement {
  const [push, setPush] = useState<"idle" | "working" | "subscribed" | "denied" | "error" | "unsupported">("idle");

  async function enable() {
    setPush("working");
    setPush(await subscribePush());
  }

  return (
    <section className={s.panel}>
      <div className={s.install}>
        <span className={s.ph}><Glyph /></span>
        <div className={s.it}>
          <b>{push === "subscribed" ? "Push notifications are on" : "Get the catch on this device"}</b>
          <p>This device will receive a catch the moment a watch breaks. Add Keeper to your Home Screen on iPhone to keep push reliable.</p>
          {push === "denied" ? <p style={{ color: "var(--amber-200)" }}>Notifications are blocked — enable them in your browser settings.</p> : null}
          {push === "unsupported" ? <p style={{ color: "var(--amber-200)" }}>Add Keeper to your Home Screen first — iOS only delivers push to installed apps.</p> : null}
          {push === "error" ? <p style={{ color: "var(--amber-200)" }}>Couldn’t enable notifications — try again.</p> : null}
        </div>
        <button className={`btn ${s.btnLight}`} onClick={enable} disabled={push === "working" || push === "subscribed"}>
          {push === "subscribed" ? "Enabled" : push === "working" ? "Enabling…" : "Enable"}
        </button>
      </div>

      <div className={s.group} style={{ marginTop: 20 }}>
        <div className={s.groupHead}><h2>What Keeper sends</h2><p>Keeper is silent by default. These control which transitions earn a push.</p></div>
        <SetRow title="Catches — predicted miss" body="The core alert: a downstream commitment is now predicted to miss. Always recommended." control={<Switch defaultChecked disabled />} />
        <SetRow title="At-risk warnings" body="Slack is thinning but not yet negative. An earlier, softer heads-up." control={<Switch defaultChecked />} />
        <SetRow title="All-clear / recovered" body="A previously at-risk watch is comfortable again." control={<Switch defaultChecked />} />
        <SetRow title="Can’t-confirm notices" body="When the flight feed goes stale, Keeper tells you it can’t confirm — instead of guessing." control={<Switch />} />
      </div>

      <div className={s.group}>
        <div className={s.groupHead}><h2>Timing &amp; channel</h2></div>
        <div className={s.groupBody}>
          <div className={s.two}>
            <div>
              <label className="field-label">Minimum lead time to alert</label>
              <select className="field" defaultValue="30"><option value="0">As early as possible</option><option value="30">At least 30 min of lead</option><option value="60">At least 1 hour of lead</option></select>
            </div>
            <div>
              <label className="field-label">Quiet hours</label>
              <select className="field" defaultValue="never"><option value="never">Never silence catches</option><option value="night">Silence 23:00 – 07:00</option></select>
            </div>
          </div>
          <SetRow title="Email backup" body="Also email me the catch if a push isn’t acknowledged within 5 minutes." control={<Switch defaultChecked />} bare />
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- account */

function AccountPanel({ user, initial }: { user: ShellUser; initial: string }): React.ReactElement {
  const [profileState, profileAction, savingProfile] = useActionState<AuthState, FormData>(updateProfile, undefined);
  const [pwState, pwAction, savingPw] = useActionState<AuthState, FormData>(updatePassword, undefined);

  return (
    <section className={s.panel}>
      <div className={s.group}>
        <div className={s.groupHead}><h2>Profile</h2></div>
        <form className={s.groupBody} action={profileAction}>
          <div className={s.avBlock}>
            <span className={s.avLg}>{initial}</span>
            <div>
              <p className="field-hint">Your initial is used as your avatar.</p>
            </div>
          </div>
          {profileState?.error ? <p className={s.error}>{profileState.error}</p> : null}
          {profileState?.notice ? <p className={s.notice}>{profileState.notice}</p> : null}
          <div className={s.two}>
            <div><label className="field-label">Name</label><input className="field" name="name" defaultValue={user.name} placeholder="Your name" /></div>
            <div><label className="field-label">Email</label><input className="field" type="email" defaultValue={user.email} disabled /></div>
          </div>
          <div><button className="btn btn-primary" type="submit" disabled={savingProfile}>{savingProfile ? "Saving…" : "Save changes"}</button></div>
        </form>
      </div>

      <div className={s.group}>
        <div className={s.groupHead}><h2>Password</h2><p>Change the password used for email sign-in.</p></div>
        <form className={s.groupBody} action={pwAction}>
          {pwState?.error ? <p className={s.error}>{pwState.error}</p> : null}
          {pwState?.notice ? <p className={s.notice}>{pwState.notice}</p> : null}
          <div className={s.two}>
            <div><label className="field-label">New password</label><input className="field" type="password" name="newPassword" placeholder="At least 8 characters" autoComplete="new-password" /></div>
            <div><label className="field-label">Confirm new password</label><input className="field" type="password" name="confirmPassword" placeholder="Repeat it" autoComplete="new-password" /></div>
          </div>
          <div><button className="btn btn-secondary" type="submit" disabled={savingPw}>{savingPw ? "Updating…" : "Update password"}</button></div>
        </form>
      </div>

      <div className={`${s.group} ${s.danger}`}>
        <div className={s.groupHead}><h2>Danger zone</h2></div>
        <div className={s.setRow}>
          <div className="sl"><b>Log out</b><p>Sign out of Keeper on this device.</p></div>
          <form action={signOut}><button className="btn btn-secondary btn-sm" type="submit">Log out</button></form>
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- devices */

function DevicesPanel(): React.ReactElement {
  return (
    <section className={s.panel}>
      <div className={s.group}>
        <div className={s.groupHead}><h2>Installed &amp; subscribed devices</h2><p>Each device that’s accepted push gets the catch. This device’s subscription is managed from the Notifications tab.</p></div>
        <div className={s.setRow}>
          <div className="sl" style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span className="badge" style={{ background: "var(--emerald-50)", color: "var(--emerald-700)" }}>THIS DEVICE</span>
            <div><b>This browser</b><p>Enable push from the Notifications tab to receive catches here.</p></div>
          </div>
        </div>
      </div>
      <div className={s.install}>
        <span className={s.ph}>
          <svg width="20" height="20" viewBox="0 0 18 18" fill="none"><rect x="5" y="2" width="8" height="14" rx="2" stroke="#a1a1aa" strokeWidth="1.3" /><path d="M8 13.5h2" stroke="#a1a1aa" strokeWidth="1.3" strokeLinecap="round" /></svg>
        </span>
        <div className={s.it}><b>Add Keeper to a new device</b><p>Open Keeper on the device, then Add to Home Screen. Push only reaches installed apps on iOS.</p></div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------- advanced */

function AdvancedPanel(): React.ReactElement {
  return (
    <section className={s.panel}>
      <div className={s.group}>
        <div className={s.groupHead}><h2>Engine behavior</h2><p>How conservative Keeper is when it predicts a miss.</p></div>
        <SetRow title="Honesty mode" body="Never assert a miss from stale data — show “can’t confirm” instead. Strongly recommended." control={<Switch defaultChecked />} />
        <SetRow title="Pad live drive times" body="Add a buffer to live routing during peak traffic windows." control={<Switch defaultChecked />} />
      </div>
      <div className={s.group}>
        <div className={s.groupHead}><h2>Data &amp; calibration</h2></div>
        <SetRow title="Share outcomes to improve predictions" body="Your “made it / missed it” self-reports feed Keeper’s calibration corpus. Anonymized." control={<Switch defaultChecked />} />
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------- shared */

function SetRow({ title, body, control, bare }: { title: string; body: string; control: React.ReactNode; bare?: boolean }): React.ReactElement {
  return (
    <div className={s.setRow} style={bare ? { border: "1px solid var(--border)", borderRadius: 13, background: "var(--bg-subtle)" } : undefined}>
      <div className="sl"><b>{title}</b><p>{body}</p></div>
      {control}
    </div>
  );
}
