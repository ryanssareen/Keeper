"use client";

import { useState } from "react";
import { Sidebar, type SidebarUser } from "./Sidebar";
import { Topbar, type TopbarTitle } from "./Topbar";
import { CatchModal } from "./CatchModal";
import type { CatchModel } from "@/lib/alerts/catch";
import type { Theme } from "@/lib/preferences/preferences";
import s from "./commandCenter.module.css";

/**
 * The post-auth command-center frame. Rendered once by the (app) route-group layout and persists across
 * view navigations (the sidebar/topbar don't re-mount). Server views render into `children`. Only the
 * mobile-drawer open state and the optimistic theme toggle live client-side here.
 */
export function AppChrome({
  user,
  tripLabel,
  alertCount,
  titles,
  catchModel,
  initialTheme,
  children,
}: {
  user: SidebarUser;
  tripLabel: string;
  alertCount: number;
  titles: Record<string, TopbarTitle>;
  catchModel: CatchModel | null;
  initialTheme: Theme;
  children: React.ReactNode;
}): React.ReactElement {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className={s.app}>
      <button
        className={`${s.scrim2} ${drawerOpen ? s.open : ""}`}
        aria-label="Close menu"
        onClick={() => setDrawerOpen(false)}
      />
      <Sidebar
        user={user}
        tripLabel={tripLabel}
        alertCount={alertCount}
        open={drawerOpen}
        onNavigate={() => setDrawerOpen(false)}
      />
      <div className={s.main}>
        <Topbar
          titles={titles}
          hasAlert={catchModel !== null}
          initialTheme={initialTheme}
          onMenu={() => setDrawerOpen(true)}
        />
        <div className={s.content}>{children}</div>
      </div>
      <CatchModal model={catchModel} />
    </div>
  );
}
