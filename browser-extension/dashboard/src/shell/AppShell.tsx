import { Outlet } from "react-router-dom";

import "./shell.css";

import { NavRail } from "./NavRail";
import { AdvisoryToast } from "../components/AdvisoryToast";

/**
 * Two-column app frame: persistent NavRail + content slot. Pages own
 * their own topbar (crumb/search/dots) because the breadcrumb varies.
 */
export function AppShell() {
  return (
    <div className="app-frame">
      <NavRail />
      <main className="app-content">
        <Outlet />
      </main>
      {/* SW 가 브로드캐스트하는 advisory 토스트를 대시보드 화면에 직접 렌더. */}
      <AdvisoryToast />
    </div>
  );
}
