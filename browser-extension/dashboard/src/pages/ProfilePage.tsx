import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trans, useTranslation } from "react-i18next";

import {
  deleteListing,
  deleteWallet,
  listListings,
  listWallets,
  normalizeServerBaseUrl,
  pickI18n,
} from "../server-api";
import { deleteDef, deletePackage, getOverview, UNCATEGORIZED_PKG } from "../server-api/policy-store";
import { getSettings, putOpenaiKey } from "../server-api/settings";
import { useAuth } from "../hooks/useAuth";
import { Topbar } from "../shell/Topbar";

import "./profile.css";

/**
 * `/profile` — account page. Three concerns:
 *  1. Identity + sign out.
 *  2. Posts this account published to the market (view / open).
 *  3. Settings (moved here from the old /settings page): server environment +
 *     language.
 *  4. Reset switches: wipe this account's wallets / policies.
 */
const LISTINGS_PAGE_SIZE = 8;

// ── Settings (server environment + language) ───────────────────────────────
// Runtime override written to BOTH localStorage (dashboard) and
// chrome.storage.local (service worker) under one key — points the whole
// extension at a server URL without a rebuild.
const SERVER_URL_KEY = "dambi_server_url";
const SERVER_PRESETS = [
  { labelKey: "settings.presetLocal", url: "http://127.0.0.1:8788" },
  { labelKey: "settings.presetProd", url: "https://dambi-policy.duckdns.org" },
];
const LANGUAGES: Array<{ code: "ko" | "en"; labelKey: string }> = [
  { code: "ko", labelKey: "settings.languageKo" },
  { code: "en", labelKey: "settings.languageEn" },
];

type ChromeStorageLocal = {
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
};
/** Service-worker storage, only present when running as an extension page. */
function swStorage(): ChromeStorageLocal | undefined {
  return (globalThis as { chrome?: { storage?: { local?: ChromeStorageLocal } } }).chrome
    ?.storage?.local;
}

export function ProfilePage() {
  const { t, i18n } = useTranslation("common");
  const ko = i18n.language.startsWith("ko");
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user, logout } = useAuth();

  const myListingsQ = useQuery({
    queryKey: ["my-listings", user?.user_id],
    queryFn: () => listListings({ publisher_id: user!.user_id, limit: 100 }),
    enabled: !!user?.user_id,
  });
  const walletsQ = useQuery({ queryKey: ["wallets"], queryFn: listWallets });
  const overviewQ = useQuery({ queryKey: ["ps2-overview"], queryFn: getOverview });

  const walletCount = walletsQ.data?.length ?? 0;
  const policyCount = overviewQ.data ? Object.keys(overviewQ.data.library.defs).length : 0;
  const setCount = overviewQ.data
    ? Object.keys(overviewQ.data.library.packages).filter((id) => id !== UNCATEGORIZED_PKG).length
    : 0;

  const [banner, setBanner] = useState<string | null>(null);

  // 서버 환경 설정 (구 /settings 에서 이전).
  const [serverUrl, setServerUrl] = useState(
    () => normalizeServerBaseUrl(window.localStorage.getItem(SERVER_URL_KEY)) ?? "",
  );
  const [serverSaved, setServerSaved] = useState(false);
  const saveServerUrl = () => {
    const rawUrl = serverUrl.trim();
    const url = normalizeServerBaseUrl(rawUrl);
    if (rawUrl && !url) {
      setServerSaved(false);
      setBanner(t("settings.invalidServerUrl"));
      return;
    }
    if (url) window.localStorage.setItem(SERVER_URL_KEY, url);
    else window.localStorage.removeItem(SERVER_URL_KEY);
    const sw = swStorage();
    if (sw) {
      if (url) void sw.set({ [SERVER_URL_KEY]: url });
      else void sw.remove(SERVER_URL_KEY);
    }
    setServerUrl(url ?? "");
    setServerSaved(true);
  };

  // OpenAI API 키 — 이 브라우저(localStorage)에만 저장(LLM 정책 생성에 사용).
  // 서버로 전송되지 않고, 여기선 "설정됨" 여부만 본다.
  const settingsQ = useQuery({
    queryKey: ["app-settings", user?.user_id],
    queryFn: getSettings,
    enabled: !!user?.user_id,
  });
  const [openaiKey, setOpenaiKey] = useState("");
  const saveOpenaiMut = useMutation({
    mutationFn: (key: string) => putOpenaiKey(key),
    onSuccess: () => {
      setOpenaiKey("");
      void qc.invalidateQueries({ queryKey: ["app-settings"] });
    },
    onError: (e: unknown) =>
      setBanner(t("settings.openaiSaveError", { error: e instanceof Error ? e.message : String(e) })),
  });

  // 올린 게시물 — 정책/패키지 탭 + 페이지네이션.
  const [listTab, setListTab] = useState<"policy" | "set">("policy");
  const [listPage, setListPage] = useState(1);
  const allListings = myListingsQ.data ?? [];
  const listingPolicyCount = allListings.filter((l) => l.kind === "policy").length;
  const listingSetCount = allListings.filter((l) => l.kind === "set").length;
  const tabListings = allListings.filter((l) =>
    listTab === "set" ? l.kind === "set" : l.kind === "policy",
  );
  const listPageCount = Math.max(1, Math.ceil(tabListings.length / LISTINGS_PAGE_SIZE));
  const listPageSafe = Math.min(listPage, listPageCount);
  const shownListings = tabListings.slice(
    (listPageSafe - 1) * LISTINGS_PAGE_SIZE,
    listPageSafe * LISTINGS_PAGE_SIZE,
  );
  const switchTab = (tab: "policy" | "set") => {
    setListTab(tab);
    setListPage(1);
  };

  const resetWalletsMut = useMutation({
    mutationFn: async () => {
      const wallets = walletsQ.data ?? [];
      for (const w of wallets) await deleteWallet(w.address);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["wallets"] });
      setBanner(t("profile.resetWalletsDone"));
    },
    onError: (e) => setBanner(t("profile.resetWalletsFailed", { error: String(e) })),
  });

  const resetPoliciesMut = useMutation({
    mutationFn: async () => {
      const snap = overviewQ.data;
      if (!snap) return;
      // 정의 삭제가 바인딩을 cascade하고, 패키지 삭제는 미분류로 해체한다.
      // 기본 안전팩(builtin)은 보호 대상 — 건너뛴다(ops.ts가 삭제를 막기도 한다).
      for (const [id, def] of Object.entries(snap.library.defs)) {
        if (def.source === "builtin") continue;
        await deleteDef(id);
      }
      for (const [id, pkg] of Object.entries(snap.library.packages)) {
        if (id === UNCATEGORIZED_PKG || pkg.source === "builtin") continue;
        await deletePackage(id);
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["ps2-overview"] });
      setBanner(t("profile.resetPoliciesDone"));
    },
    onError: (e) => setBanner(t("profile.resetPoliciesFailed", { error: String(e) })),
  });

  const deleteListingMut = useMutation({
    mutationFn: (listingId: string) => deleteListing(listingId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["my-listings"] });
      void qc.invalidateQueries({ queryKey: ["market-listings"] });
      setBanner(t("profile.deleteListingDone"));
    },
    onError: (e) => setBanner(t("profile.deleteListingFailed", { error: String(e) })),
  });

  const onLogout = () => {
    logout();
    navigate("/login", { replace: true });
  };

  const email = user?.email ?? "—";
  const initials = email.slice(0, 2).toUpperCase();

  return (
    <>
      <Topbar here={t("profile.title")} subtitle={t("profile.subtitle")} showSearch={false} />
      <div className="pp-body">
        {banner && <div className="pp-banner">{banner}</div>}

        {/* identity */}
        <section className="pp-card pp-identity">
          <span className="pp-av">{initials}</span>
          <div className="pp-id-meta">
            <div className="pp-email">{email}</div>
          </div>
          <button type="button" className="pp-btn ghost danger" onClick={onLogout}>
            {t("profile.signOut")}
          </button>
        </section>

        {/* published posts */}
        <section className="pp-card">
          <div className="pp-sec-head">
            <h2>{t("profile.myListings")}</h2>
            <span className="pp-count">{myListingsQ.data?.length ?? 0}</span>
          </div>
          {myListingsQ.isLoading && <div className="pp-muted">{t("loading")}</div>}
          {myListingsQ.data && myListingsQ.data.length === 0 && (
            <div className="pp-empty">{t("profile.noListings")}</div>
          )}
          {myListingsQ.data && myListingsQ.data.length > 0 && (
            <>
              <div className="pp-tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={listTab === "policy"}
                  className={`pp-tab${listTab === "policy" ? " on" : ""}`}
                  onClick={() => switchTab("policy")}
                >
                  {t("profile.tabPolicies")} <span className="pp-tab-n">{listingPolicyCount}</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={listTab === "set"}
                  className={`pp-tab${listTab === "set" ? " on" : ""}`}
                  onClick={() => switchTab("set")}
                >
                  {t("profile.tabPackages")} <span className="pp-tab-n">{listingSetCount}</span>
                </button>
              </div>
              {tabListings.length === 0 ? (
                <div className="pp-empty">{t("profile.noListings")}</div>
              ) : (
                <ul className="pp-listings">
                  {shownListings.map((l) => (
                    <li key={l.id} className="pp-listing-row">
                      <Link to={`/market/${encodeURIComponent(l.slug)}`} className="pp-listing">
                        <div className="pp-listing-main">
                          <span className="pp-listing-name">{pickI18n(l.display_name)}</span>
                          <span className="pp-listing-slug">{l.slug}</span>
                        </div>
                        <div className="pp-listing-stats">
                          <span title={t("profile.installCount")}>↓ {l.install_count}</span>
                          {l.current_version && <span className="pp-ver">{l.current_version}</span>}
                          <span className={`pp-status ${l.status}`}>{l.status}</span>
                        </div>
                      </Link>
                      <button
                        type="button"
                        className="pp-listing-del"
                        title={t("profile.deleteListingTitle")}
                        disabled={deleteListingMut.isPending}
                        onClick={() => {
                          if (
                            window.confirm(
                              t("profile.deleteListingConfirm", { name: pickI18n(l.display_name) }),
                            )
                          )
                            deleteListingMut.mutate(l.id);
                        }}
                      >
                        {t("delete")}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {listPageCount > 1 && (
                <ProfilePager page={listPageSafe} pageCount={listPageCount} onChange={setListPage} ko={ko} />
              )}
            </>
          )}
        </section>

        {/* settings — server environment */}
        <section className="pp-card">
          <div className="pp-sec-head">
            <h2>{t("settings.title")}</h2>
          </div>
          <p className="pp-muted">
            <Trans i18nKey="settings.desc" ns="common" components={{ code: <code /> }} />
          </p>
          <div className="pp-set-presets">
            {SERVER_PRESETS.map((p) => (
              <button
                key={p.url}
                type="button"
                className={`pp-set-preset${serverUrl === p.url ? " on" : ""}`}
                onClick={() => {
                  setServerUrl(p.url);
                  setServerSaved(false);
                }}
              >
                <div className="pp-set-preset-name">{t(p.labelKey)}</div>
                <code>{p.url}</code>
              </button>
            ))}
          </div>
          <input
            type="text"
            className="pp-set-input"
            value={serverUrl}
            placeholder={t("settings.urlPlaceholder")}
            onChange={(e) => {
              setServerUrl(e.target.value);
              setServerSaved(false);
            }}
          />
          <div className="pp-set-save">
            <button type="button" className="pp-btn" onClick={saveServerUrl}>
              {t("save")}
            </button>
            {serverSaved && (
              <span className="pp-muted">
                <Trans
                  i18nKey="settings.savedNote"
                  ns="common"
                  components={{ reload: <a onClick={() => window.location.reload()} className="pp-link" /> }}
                />
              </span>
            )}
          </div>
        </section>

        {/* settings — OpenAI API key (browser-local, used for LLM drafting) */}
        <section className="pp-card">
          <div className="pp-sec-head">
            <h2>{t("settings.openaiTitle")}</h2>
            {settingsQ.data?.openai_api_key_set && (
              <span className="pp-badge-ok">{t("settings.openaiStatusSet")}</span>
            )}
          </div>
          <p className="pp-muted">{t("settings.openaiDesc")}</p>
          <input
            type="password"
            className="pp-set-input"
            value={openaiKey}
            placeholder={
              settingsQ.data?.openai_api_key_set
                ? t("settings.openaiPlaceholderSet")
                : t("settings.openaiPlaceholder")
            }
            autoComplete="off"
            onChange={(e) => setOpenaiKey(e.target.value)}
          />
          <div className="pp-set-save">
            <button
              type="button"
              className="pp-btn"
              onClick={() => saveOpenaiMut.mutate(openaiKey.trim())}
              disabled={saveOpenaiMut.isPending || !openaiKey.trim()}
            >
              {saveOpenaiMut.isPending ? t("saving") : t("save")}
            </button>
            {settingsQ.data?.openai_api_key_set && (
              <button
                type="button"
                className="pp-btn ghost"
                onClick={() => saveOpenaiMut.mutate("")}
                disabled={saveOpenaiMut.isPending}
              >
                {t("settings.openaiClear")}
              </button>
            )}
            {saveOpenaiMut.isSuccess && (
              <span className="pp-muted">{t("settings.openaiSaved")}</span>
            )}
            {saveOpenaiMut.isError && (
              <span className="pp-err-inline">
                {t("settings.openaiSaveError", {
                  error:
                    saveOpenaiMut.error instanceof Error
                      ? saveOpenaiMut.error.message
                      : String(saveOpenaiMut.error),
                })}
              </span>
            )}
          </div>
        </section>

        {/* settings — language */}
        <section className="pp-card">
          <div className="pp-sec-head">
            <h2>{t("settings.languageTitle")}</h2>
          </div>
          <p className="pp-muted">{t("settings.languageDesc")}</p>
          <div className="pp-set-presets">
            {LANGUAGES.map((l) => (
              <button
                key={l.code}
                type="button"
                className={`pp-set-preset${i18n.language === l.code ? " on" : ""}`}
                onClick={() => void i18n.changeLanguage(l.code)}
              >
                <div className="pp-set-preset-name">{t(l.labelKey)}</div>
                <code>{l.code}</code>
              </button>
            ))}
          </div>
        </section>

        {/* reset switches */}
        <section className="pp-card">
          <div className="pp-sec-head">
            <h2>{t("profile.resetSection")}</h2>
          </div>
          <p className="pp-muted">{t("profile.resetDesc")}</p>

          <div className="pp-reset-row">
            <div className="pp-reset-info">
              <div className="pp-reset-title">{t("profile.resetWalletsTitle")}</div>
              <div className="pp-reset-sub">
                {t("profile.resetWalletsSub", { count: walletCount })}
              </div>
            </div>
            <button
              type="button"
              className="pp-btn danger"
              disabled={walletCount === 0 || resetWalletsMut.isPending}
              onClick={() => {
                if (
                  window.confirm(
                    t("profile.resetWalletsConfirm", { count: walletCount }),
                  )
                )
                  resetWalletsMut.mutate();
              }}
            >
              {resetWalletsMut.isPending ? t("profile.resetting") : t("profile.resetWalletsBtn")}
            </button>
          </div>

          <div className="pp-reset-row">
            <div className="pp-reset-info">
              <div className="pp-reset-title">{t("profile.resetPoliciesTitle")}</div>
              <div className="pp-reset-sub">
                {t("profile.resetPoliciesSub", { policyCount, setCount })}
              </div>
            </div>
            <button
              type="button"
              className="pp-btn danger"
              disabled={
                (policyCount === 0 && setCount === 0) || resetPoliciesMut.isPending
              }
              onClick={() => {
                if (
                  window.confirm(
                    t("profile.resetPoliciesConfirm", { policyCount, setCount }),
                  )
                )
                  resetPoliciesMut.mutate();
              }}
            >
              {resetPoliciesMut.isPending ? t("profile.resetting") : t("profile.resetPoliciesBtn")}
            </button>
          </div>
        </section>
      </div>
    </>
  );
}

/** 숫자 페이지네이션: 이전 · 1 2 3 … N · 다음 (MarketPage 패턴 미러). */
function ProfilePager({
  page,
  pageCount,
  onChange,
  ko,
}: {
  page: number;
  pageCount: number;
  onChange: (p: number) => void;
  ko: boolean;
}) {
  const nums: (number | "gap")[] = [];
  const lo = Math.max(2, page - 1);
  const hi = Math.min(pageCount - 1, page + 1);
  nums.push(1);
  if (lo > 2) nums.push("gap");
  for (let p = lo; p <= hi; p++) nums.push(p);
  if (hi < pageCount - 1) nums.push("gap");
  if (pageCount > 1) nums.push(pageCount);
  return (
    <nav className="pp-pager" aria-label={ko ? "페이지" : "pagination"}>
      <button type="button" className="pp-pager-nav" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        {ko ? "이전" : "Prev"}
      </button>
      {nums.map((n, i) =>
        n === "gap" ? (
          <span key={`gap-${i}`} className="pp-pager-gap">
            …
          </span>
        ) : (
          <button
            key={n}
            type="button"
            className={`pp-pager-num${n === page ? " on" : ""}`}
            aria-current={n === page ? "page" : undefined}
            onClick={() => onChange(n)}
          >
            {n}
          </button>
        ),
      )}
      <button
        type="button"
        className="pp-pager-nav"
        disabled={page >= pageCount}
        onClick={() => onChange(page + 1)}
      >
        {ko ? "다음" : "Next"}
      </button>
    </nav>
  );
}
