import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/supabase/server";
import { loadPreferences } from "@/lib/preferences/queries";
import { SettingsTabs } from "@/components/app/SettingsTabs";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Keeper — Settings" };

export default async function AppSettingsPage(): Promise<React.ReactElement> {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/settings");

  const prefs = await loadPreferences();
  const shellUser = {
    name: typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : "",
    email: user.email ?? "",
  };

  return <SettingsTabs user={shellUser} initialPrefs={prefs} />;
}
