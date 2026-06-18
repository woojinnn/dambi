/* ────────────────────────────────────────────────────────────────────────
 * Policy store (ps2) — REAL backend. iframe은 chrome-extension:// 페이지라
 * chrome.runtime.sendMessage 로 서비스워커의 ps2:* 핸들러와 직접 통신한다.
 * (대시보드 server-api/extension-bridge.ts + policy-store.ts 와 동일 프로토콜)
 *
 * 컴포넌트는 PS.getOverview() 를 "동기"로 기대하므로(useOverview), 최신 스냅샷을
 * 로컬에 캐시하고 변경/외부 broadcast 때마다 재조회 후 구독자에게 알린다.
 * ──────────────────────────────────────────────────────────────────────── */
(function () {
  "use strict";

  const UNCATEGORIZED_PKG = "pkg::uncategorized";
  function isEffectiveOn(w, b) {
    return (w.packageEnabled[b.packageId] ?? true) && b.enabled;
  }

  // 첫 비동기 로드 전까지 컴포넌트가 안전하게 렌더되도록 빈 스냅샷.
  const EMPTY = { rev: 0, library: { defs: {}, packages: {} }, wallets: { byAddress: {} } };
  let snapshot = EMPTY;
  const subs = new Set();

  function runtime() {
    try {
      const c = globalThis.chrome;
      if (c && c.runtime && typeof c.runtime.sendMessage === "function") return c.runtime;
    } catch (e) {}
    return null;
  }

  // SW로 한 건 보내고 {ok,data} 봉투를 푼다.
  async function send(payload) {
    const rt = runtime();
    if (!rt) throw new Error("확장 컨텍스트가 아니에요 — ps2 메시지를 보낼 수 없어요(chrome.runtime 없음).");
    const resp = await rt.sendMessage(payload);
    if (!resp) throw new Error("확장에서 빈 응답");
    if (resp.ok) return resp.data;
    throw new Error((resp.error && resp.error.message) || "확장 오류");
  }

  function notify() {
    subs.forEach((cb) => {
      try {
        cb(snapshot);
      } catch (e) {
        console.error(e);
      }
    });
  }
  async function refresh() {
    try {
      const snap = await send({ type: "ps2:get-overview" });
      if (snap) {
        snapshot = snap;
        notify();
      }
    } catch (e) {
      console.error("[editor-v3] ps2 overview 조회 실패:", e);
    }
  }

  function subscribe(cb) {
    subs.add(cb);
    return () => subs.delete(cb);
  }
  function getOverview() {
    return snapshot;
  }

  // 변경 op: SW에 보내고 → 최신 overview 재조회 → 알림. send 결과(data)를 그대로 반환
  // (duplicateDef 처럼 새 id를 돌려주는 경우 포함).
  function mut(payload) {
    return send(payload).then(async (data) => {
      await refresh();
      return data;
    });
  }

  window.PS = {
    UNCATEGORIZED_PKG,
    isEffectiveOn,
    subscribe,
    getOverview,
    resetSeed() {
      return refresh();
    },
    putDef: (d) => mut({ type: "ps2:put-def", def: d }),
    deleteDef: (defId) => mut({ type: "ps2:delete-def", defId }),
    duplicateDef: (defId, packageId) =>
      mut({ type: "ps2:duplicate-def", defId, ...(packageId !== undefined ? { packageId } : {}) }),
    putPackage: (pkg) => mut({ type: "ps2:put-package", pkg }),
    deletePackage: (packageId) => mut({ type: "ps2:delete-package", packageId }),
    bindDef: (opts) => mut({ type: "ps2:bind", ...opts }),
    updateBinding: (opts) => mut({ type: "ps2:update-binding", ...opts }),
    removeBinding: (opts) => mut({ type: "ps2:remove-binding", ...opts }),
    removeWalletPackage: (opts) => mut({ type: "ps2:remove-wallet-package", ...opts }),
    putWalletPackage: (opts) => mut({ type: "ps2:put-wallet-package", ...opts }),
    putWalletFolder: (opts) => mut({ type: "ps2:put-wallet-folder", ...opts }),
    removeWalletFolder: (opts) => mut({ type: "ps2:remove-wallet-folder", ...opts }),
    setPackageEnabled: (opts) => mut({ type: "ps2:set-package-enabled", ...opts }),
  };

  // 초기 로드 + 외부 변경(다른 탭/홈/SW broadcast) 반영.
  refresh();
  try {
    const c = globalThis.chrome;
    if (c && c.storage && c.storage.onChanged) {
      c.storage.onChanged.addListener((changes, area) => {
        if (area === "local") refresh();
      });
    }
  } catch (e) {}
})();
