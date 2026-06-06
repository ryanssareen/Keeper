import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/supabase/server";
import { AppShell, SettingsNav } from "@/components/app/AppShell";
import { SettingsTabs } from "@/components/app/SettingsTabs";

export const metadata: Metadata = { title: "Keeper — Settings" };

/** Post-auth settings (proxy-gated). Reads the live session for the profile + account panels. */
export default async function SettingsPage(): Promise<React.ReactElement> {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/settings");

  const shellUser = {
    name: typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : "",
    email: user.email ?? "",
  };

  return (
    <AppShell
      user={shellUser}
      railMiddle={<SettingsNav />}
      header={
        <>
          <span>Settings</span>
        </>
      }
    >
      <SettingsTabs user={shellUser} />
    </AppShell>
  );
}
