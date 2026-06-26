import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { listFindings } from "../server-api";
import { useAuth } from "../hooks/useAuth";

/**
 * Persistent left nav. Hover/focus expands the rail 88→340px (CSS-driven);
 * leaving the rail (onMouseLeave) also closes the account popover.
 * Findings count drives the History badge — refetched every 30s.
 */
export function NavRail() {
  const { t } = useTranslation("shell");
  const navigate = useNavigate();
  // Full sign-out: clears BOTH localStorage and the SW-owned chrome.storage
  // token, messages the SW, and resets `user`. The server-api `logout` only
  // drops localStorage, so the next refresh re-hydrates the token from
  // chrome.storage and the user bounces straight back in.
  // 로그인된 계정은 useAuth().user 로 읽는다(재로그인 시 즉시 반영). 예전엔 별도
  // ["me"] 쿼리를 staleTime:Infinity 로 캐시해, 계정 전환 후에도 옛 계정이 떴다.
  const { logout, user } = useAuth();
  const findingsQ = useQuery({
    queryKey: ["findings", "unresolved-count"],
    queryFn: () => listFindings({ limit: 50 }),
    refetchInterval: 30_000,
  });
  const pendingCount = findingsQ.data?.filter((f) => f.user_decision === null).length ?? 0;

  const initials = (user?.email ?? "??").slice(0, 2).toUpperCase();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  const onSignOut = () => {
    setMenuOpen(false);
    logout();
    navigate("/login", { replace: true });
  };
  const onProfile = () => {
    setMenuOpen(false);
    navigate("/profile");
  };

  return (
    // onMouseLeave: 레일이 접힐 때(커서가 레일을 벗어날 때) 계정 팝오버도 함께 닫는다(spec §1/§5).
    <nav
      className="nav-rail"
      tabIndex={0}
      aria-label="Dambi global nav"
      onMouseLeave={() => setMenuOpen(false)}
    >
      <div className="nav-logo">
        <img className="mark" src="dambi-mark2.png" alt="" />
        <img className="word" src="dambi-text.png" alt="DAMBI" />
      </div>

      <div className="nav-divider" />

      <div className="nav-group">
        <RailItem to="/" end label={t("nav.home")} icon={<HomeIcon />} />
        {/* '정책 관리' = 새 에디터(/editor). 옛 레거시 에디터는 제거됨. */}
        <RailItem to="/editor" label={t("nav.editor")} icon={<EditorIcon />} activePrefixes={["/editor"]} />
        <RailItem to="/simulation" label={t("nav.simulation")} icon={<SimIcon />} />
        <RailItem to="/assets" label={t("nav.assets")} icon={<MonIcon />} />
        <RailItem to="/market" label={t("nav.market")} icon={<MarketIcon />} />
      </div>

      <div className="nav-divider" />

      <div className="nav-group">
        <RailItem
          to="/history"
          label={t("nav.history")}
          icon={<HistoryIcon />}
          badge={pendingCount > 0 ? String(pendingCount) : undefined}
          showDot={pendingCount > 0}
        />
      </div>

      <div className="nav-bottom" ref={menuRef}>
        {menuOpen && (
          <div className="nav-usermenu" role="menu">
            <button type="button" className="nav-usermenu-item" onClick={onProfile} role="menuitem">
              <ProfileIcon />
              {t("nav.profile")}
            </button>
            <div className="nav-usermenu-divider" role="separator" />
            <button type="button" className="nav-usermenu-item danger" onClick={onSignOut} role="menuitem">
              <SignOutIcon />
              {t("nav.signOut")}
            </button>
          </div>
        )}
        <button
          className={`nav-user${menuOpen ? " open" : ""}`}
          onClick={() => setMenuOpen((v) => !v)}
          title={t("nav.account")}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          <span className="av">{initials}</span>
          <div className="meta">
            <div className="nm">{user?.email ?? "—"}</div>
            <div className="em">{user?.user_id ?? ""}</div>
          </div>
          <span className="nav-user-caret"><CaretUpIcon /></span>
        </button>
      </div>
    </nav>
  );
}

interface RailItemProps {
  to: string;
  label: string;
  icon: React.ReactNode;
  end?: boolean;
  disabled?: boolean;
  badge?: string;
  showDot?: boolean;
  /** Extra path prefixes that should also mark this item active (e.g. the new
   *  '정책 관리' tab stays active while editing a policy on the legacy /editor route). */
  activePrefixes?: string[];
}

function RailItem({ to, label, icon, end, disabled, badge, showDot, activePrefixes }: RailItemProps) {
  const { t } = useTranslation("shell");
  const { pathname } = useLocation();
  const prefixActive = (activePrefixes ?? []).some((p) => pathname === p || pathname.startsWith(p + "/"));
  if (disabled) {
    return (
      <span className="nav-item disabled" title={t("nav.comingSoon")}>
        <span className="icon">{icon}</span>
        <span className="label">{label}</span>
      </span>
    );
  }
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) => `nav-item${isActive || prefixActive ? " active" : ""}`}
      onPointerUp={(event) => {
        event.currentTarget.blur();
      }}
    >
      <span className="icon">{icon}</span>
      <span className="label">{label}</span>
      {badge && <span className="badge">{badge}</span>}
      {showDot && !badge && <span className="dot-badge" />}
    </NavLink>
  );
}

// ── icons (stroked, 18×18) ──────────────────────────────────────────────
const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const HomeIcon = () => (
  <svg viewBox="0 0 24 24" {...stroke}>
    <path d="M3 11.5 12 4l9 7.5" />
    <path d="M5 10v10h14V10" />
  </svg>
);
const EditorIcon = () => (
  <svg viewBox="0 0 24 24" {...stroke}>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </svg>
);
const SimIcon = () => (
  <svg viewBox="0 0 24 24" {...stroke}>
    <circle cx="12" cy="12" r="9" />
    <path d="m10 8.5 5 3.5-5 3.5z" />
  </svg>
);
const MonIcon = () => (
  <svg viewBox="0 0 24 24" {...stroke}>
    <path d="M3 12h4l3 8 4-16 3 8h4" />
  </svg>
);
const HistoryIcon = () => (
  <svg viewBox="0 0 24 24" {...stroke}>
    <path d="M3 3v18h18" />
    <path d="m7 14 4-4 4 3 5-7" />
  </svg>
);
const MarketIcon = () => (
  <svg viewBox="0 0 24 24" {...stroke}>
    <path d="M3 8h18l-2 12H5z" />
    <path d="M8 8V5a4 4 0 0 1 8 0v3" />
  </svg>
);
const ProfileIcon = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" {...stroke}>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6" />
  </svg>
);
const SignOutIcon = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" {...stroke}>
    <path d="M15 4h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-3" />
    <path d="M10 8 6 12l4 4M6 12h11" />
  </svg>
);
const CaretUpIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" {...stroke}>
    <path d="m6 14 6-6 6 6" />
  </svg>
);
