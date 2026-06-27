import Browser from "webextension-polyfill";
import { Identifier } from "@lib/identifier";
import { handleDashboardRequest, isDashboardRequest } from "./dashboard/api";
import { handleManifestRequest, isManifestRequest } from "./manifests/handlers";
import { hydrateManifests } from "./manifests/hydrate";
import { migrateAdapterLoaderStorageKey } from "./manifests/adapter-loader-storage-migration";
import { migrateDambiRenameStorageKeys } from "./manifests/dambi-rename-storage-migration";
import { detectPendingMigrations } from "./manifests/migration-detector";
import { cleanupLegacyKeys } from "./policy-store/seed";
import {
  handlePs2Request,
  isPs2Request,
  provisionFromWalletSync,
  reconcileFromWalletSync,
  removeWalletFromSync,
  type Ps2Request,
} from "./policy-store/api";
import { decideMessage } from "./orchestrator";
import {
  ensureLoaded as ensureNotifySettings,
  shouldDesktop,
  shouldRibbon,
  type NotifySeverity,
} from "./notify-settings";
import { markBadgeSeen, refreshBadge } from "./mascot-badge";
import { reportExecutionOutcome } from "./execution-report";
import {
  ensureDefaultV3BundlesInstalled,
  getInstalledV3BundleCount,
  v3BundleBootCompleted,
} from "./v3-bundle-loader";
import {
  isExecutionReport,
  RequestType,
  type Message,
  type MessageResponse,
} from "@lib/types";
import {
  clearTokens,
  fetchMe,
  listWallets,
  listWalletSummaries,
  addWallet,
  updateWallet,
  deleteWallet,
  setTokens,
  normalizeWalletAddress as normalizeServerWalletAddress,
  setOnSessionExpired,
  resetSessionExpiredGuard,
  startGoogleLogin,
  type Me,
  type WalletId,
  type WalletSummary,
  type AddWalletResp,
} from "./dambi-auth";
import {
  declarativeRouteRequestV3,
  estToPolicyText,
  evaluateActionV2,
  policyTextToEst,
  runDiagnosisProbesV2,
  simulatePolicySequence,
  simulateStep,
  testPolicyText,
  validatePolicyText,
  type DeclarativeRouteRequestV3Input,
  type DeclarativeRouteRequestV3Result,
  type EvaluateActionV2InputDto,
  type VerdictDto,
  type SimulateStepInput,
  type SimulateStepOutput,
} from "./wasm-bridge";
import {
  clearExecutionReports,
  countExecutionReports,
  listExecutionReports,
  type ExecutionReportFilter,
} from "./execution-report-storage";
import {
  clearVerdicts,
  countVerdicts,
  exportVerdictsAsCsv,
  listVerdicts,
  setVerdictDecision as setStoredVerdictDecision,
  type VerdictFilter,
} from "./verdict-storage";
import {
  clearStateDeltas,
  getStateDelta,
  type StateDeltaRow,
} from "./state-delta-storage";
import {
  getDiagnosisContext,
  type DiagnosisContextRow,
} from "./diagnosis-context-storage";

const WALLET_ACTION_TYPES = new Set<string>([
  RequestType.TRANSACTION,
  RequestType.TYPED_SIGNATURE,
  RequestType.UNTYPED_SIGNATURE,
  // Without this, the SW silently drops venue-order messages (no verdict ever
  // posts back) and the fetch hook times out → the order would slip through.
  RequestType.VENUE_ORDER,
]);

console.log("Dambi SW alive at", new Date().toISOString());

// SW boot sequence: serialize the install stages so they don't race each other
// (parallel calls would clobber the WASM engine state). Listeners are installed
// synchronously below so the SW can queue messages while warmup is in flight.
//
// `bootReady` gates auth handlers so token reads cannot race the storage
// migrations that run inside `bootSequence`. The `.catch` keeps the promise
// non-rejecting — a stalled stage must not brick the auth handlers.
export const bootReady: Promise<void> = bootSequence().catch((err) => {
  console.warn("[Dambi] boot sequence failed:", err);
});

async function listWalletsAndProvision(reason: string): Promise<WalletId[]> {
  const wallets = await listWallets();
  // 정책 스토리지 v2 동기화 훅: 서버 지갑 "전체 목록"과 맞춘다 — 새 지갑은
  // defaults로 프로비저닝하고, 목록에 없는(=다른 화면에서 삭제된) 지갑은
  // 스토어에서 제거한다. 실패해도 지갑 목록 응답이나 로그인/current-user
  // sync는 막지 않는다.
  try {
    await reconcileFromWalletSync(wallets.map((w) => w.address));
  } catch (err) {
    console.warn(`[Dambi] ps2 wallet sync failed (${reason}):`, err);
  }
  return wallets;
}

async function bootSequence(): Promise<void> {
  // Storage-key migration from previous branded key prefixes to `dambi_*`.
  // Runs first so all subsequent reads see the correct keys.
  // Chrome.storage only — no WASM dependency.
  try {
    await migrateDambiRenameStorageKeys();
  } catch (err) {
    console.warn("[Dambi] rename storage migration failed:", err);
  }

  // Run the migration detector before the install passes: it strips v0 policy ids
  // out of `policy-selection:enabled-ids` and disables them so the rest of the
  // enabled set stays installable. If the install ran first, enriched-schema
  // validation would reject every v0 policy and the whole install would error.
  // Idempotent — re-running after a manual rewrite is safe.
  try {
    await detectPendingMigrations();
  } catch (err) {
    console.warn("[Dambi] migration auto-detect failed:", err);
  }

  // Storage-key migration for the adapter-loader (one-time, idempotent). Runs
  // before any install path so bundle storage is at the expected key.
  try {
    await migrateAdapterLoaderStorageKey();
  } catch (err) {
    console.warn("[Dambi] adapter-loader storage migration failed:", err);
  }

  // 구(v1) routing의 `registry:adapter-bundles` 키를 제거한다 (일회성; 부재 시 무시).
  try {
    await Browser.storage.local.remove("registry:adapter-bundles");
  } catch {
    // ignore
  }

  // 구(v1) 정책 키(`dashboard:policies/sets`, `policy-selection:*`, `migration:*`)를
  // 제거한다. ps2:* 시드는 첫 resolve/프로비저닝 호출에서 lazy하게 일어난다.
  try {
    await cleanupLegacyKeys();
  } catch (err) {
    console.warn("[Dambi] legacy policy-storage cleanup failed:", err);
  }

  // Hydrate the manifest-driven schema on SW boot. On a cold start this restores
  // any previously-installed manifests from storage back into WASM.
  try {
    await hydrateManifests();
  } catch (err) {
    console.warn("[Dambi] manifest hydration failed:", err);
  }

  // Install default v3 decoder bundles so the simulator has something to look up
  // without a registry round-trip. Runs after hydrateManifests to avoid leaving
  // the engine in a half-installed state on per-bundle errors.
  try {
    const v3Count = await ensureDefaultV3BundlesInstalled();
    console.log(`[Dambi] v3 default bundles installed (${v3Count})`);
  } catch (err) {
    console.warn("[Dambi] v3 default bundle install failed:", err);
  }

  // 부팅 시 마스코트 배지를 최근 24h verdict 카운트로 1회 동기화한다. SW 가
  // 재시작되면 chrome.action 상태가 기본(safe)으로 돌아가므로 복원이 필요.
  try {
    await refreshBadge();
  } catch (err) {
    console.warn("[Dambi] mascot badge initial refresh failed:", err);
  }
}

Browser.runtime.onConnect.addListener((port) => {
  if (port.name !== Identifier.CONTENT_SCRIPT) return;

  port.onMessage.addListener((message: Message) => {
    void handleMessage(message, port);
  });
});

async function handleMessage(
  message: Message,
  port: Browser.Runtime.Port,
): Promise<void> {
  // Advisory messages: log only, no verdict.
  if (message.data.type === "raw-transaction-advisory") {
    console.warn("[Dambi] raw-tx advisory", message.data);
    return;
  }
  if (message.data.type === "provider-frozen-warning") {
    console.error("[Dambi] provider frozen", message.data);
    return;
  }

  if (isExecutionReport(message)) {
    await reportExecutionOutcome(message.data);
    return;
  }

  // Skip messages that aren't wallet actions. The proxy is injected into every
  // iframe so third-party widget probes (e.g. bot challenges) can arrive; treating
  // them as policy verdicts would pop spurious "Blocked" modals.
  if (!WALLET_ACTION_TYPES.has(message.data.type)) {
    return;
  }

  const { ok } = await decideMessage(message, {
    onAwaitingUser: () => {
      try {
        port.postMessage({
          requestId: message.requestId,
          kind: "awaiting-user",
        });
      } catch {
        /* dApp tab gone */
      }
    },
    // 라이브 위험 verdict → OS 데스크톱 알림 + 인페이지 토스트("상단 리본 배너")
    // 병행(둘 다 표시 전용). desk/ribbon 설정으로 각각 게이팅된다. 이 콜백은
    // 라이브 호출부인 여기서만 주입되므로 시뮬레이션 경로에선 발사되지 않는다.
    onRiskyVerdict: ({ scenario, severity, title, message, chainId, address }) => {
      // 컨텍스트 줄: "백그라운드 모니터링 · <네트워크 or 주소>" — 목업의 흐린 줄.
      const net = chainName(chainId);
      const tail = net ?? (address ? shortAddr(address) : null);
      const context = tail ? `백그라운드 모니터링 · ${tail}` : "백그라운드 모니터링";
      void pushDesktopNotification(scenario, severity, undefined, {
        title,
        message,
        contextMessage: context,
      });
      // 토스트도 같은 사유·컨텍스트로 — OS 알림과 1:1.
      void pushToastToActiveTab(scenario, {
        ...(message ? { body: message } : {}),
        context,
      });
    },
  });
  if (!message.data.bypassed) {
    const response: MessageResponse = {
      requestId: message.requestId,
      data: ok,
    };
    try {
      port.postMessage(response);
    } catch {
      /* dApp tab gone */
    }
  }
}

interface DambiAuthStatusRequest {
  type: "dambi-auth-status";
}
interface DambiAuthSignInRequest {
  type: "dambi-auth-sign-in";
}
interface DambiAuthSignOutRequest {
  type: "dambi-auth-sign-out";
}
/** Dashboard → SW token mirror. The dashboard's OAuth flow lands tokens in
 *  page `localStorage`; the SW reads tokens from `chrome.storage.local`.
 *  Without this sync the SW thinks the user is signed out even after a
 *  successful dashboard sign-in, and `recordSimulationOnServer` returns
 *  silently at its `hasToken` guard — leaving the HistoryPage's state-diff
 *  panel permanently empty. The dashboard calls this after every
 *  `fetchMe()` that resolves to a real user, so the sync is idempotent. A
 *  `null/null` pair is a dashboard-initiated clear. */
interface DambiAuthSyncTokensRequest {
  type: "dambi-auth-sync-tokens";
  access: string | null;
  refresh: string | null;
}
interface DambiListWalletsRequest {
  type: "dambi-list-wallets";
}
/** Wallet 관리 — 팝업이 서버(GET/POST/PATCH/DELETE /wallets)를 단일 소스로
 *  쓰도록 SW 가 대리한다. 대시보드도 같은 서버를 읽어 일관성 유지. */
interface DambiListWalletSummariesRequest {
  type: "dambi-list-wallet-summaries";
}
interface DambiAddWalletRequest {
  type: "dambi-add-wallet";
  address: string;
  label?: string;
}
interface DambiUpdateWalletRequest {
  type: "dambi-update-wallet";
  address: string;
  label?: string;
}
interface DambiDeleteWalletRequest {
  type: "dambi-delete-wallet";
  address: string;
}
/** ⑤ 주간 요약 토스트 수동 트리거 (advisory 표시 전용 — 결정 채널 아님).
 *  tabId: 팝업이 자기 활성 탭 id 를 함께 보냄 → 토스트를 그 탭에 정확히 띄움. */
interface WeeklySummaryRequest {
  type: "DAMBI_WEEKLY_SUMMARY";
  tabId?: number;
}
/** ② 마스코트 배지 — 팝업 열림 = 알람 확인. 발바닥/카운트를 초기화한다. */
interface BadgeSeenRequest {
  type: "DAMBI_BADGE_SEEN";
}
/** apps/web Editor + Simulation pages route Cedar through the
 *  service worker rather than bundling wasm themselves. Three
 *  request variants map 1-1 to the new exports in
 *  `crates/policy-engine-wasm/src/cedar_exports.rs`. */
interface CedarValidateRequest {
  type: "cedar-validate";
  text: string;
}
interface CedarTestRequest {
  type: "cedar-test";
  text: string;
  // Pre-serialized JSON of `CedarRequestInput` so the wasm boundary
  // stays string-in / string-out and the FE doesn't have to know
  // the rust dto shape exactly.
  request_json: string;
}
interface CedarSimulateRequest {
  type: "cedar-simulate";
  steps_json: string;
  policies_json: string;
}
interface RunDiagnosisProbesRequest {
  type: "run-diagnosis-probes";
  input_json: string;
}
interface CedarTextToEstRequest {
  type: "cedar-text-to-est";
  text: string;
}
interface CedarEstToTextRequest {
  type: "cedar-est-to-text";
  // Pre-serialized EST JSON (a single policy's EST object).
  est_json: string;
}
/** Simulation page: one (state, action, ctx) → (delta, next_state).
 *  Dashboard owns the per-tx loop; SW just forwards to the wasm bridge.
 *  Contract: `crates/policy-engine-wasm/src/sim_step_exports.rs`. */
interface SimStepRequest {
  type: "sim-step";
  input: SimulateStepInput;
}
/** Simulation page: decode a raw tx (chain_id, to, calldata, …) into the
 *  typed `Action[]` tree the v3 route engine emits. Same wasm entry the SW
 *  orchestrator uses for live wallet flows — exposed here so the dashboard
 *  can drive the same decode → simulate pipeline from user-pasted calldata. */
interface SimDecodeRequest {
  type: "sim-decode";
  input: DeclarativeRouteRequestV3Input;
}
/** Simulation page: evaluate one (action, meta, tx, bundles, results) →
 *  `VerdictDto`. Pairs with `sim-step` so the dashboard's per-tx loop can
 *  compute BOTH the post-state AND the policy verdict at every step.
 *  Contract: `crates/policy-engine-wasm/src/action_eval_exports.rs`. */
interface SimEvaluateRequest {
  type: "sim-evaluate";
  input: EvaluateActionV2InputDto;
}
/** Simulation page: how many default v3 decoder bundles did this SW
 *  lifetime manage to install at boot? The probe surfaces a warning when
 *  this returns 0 (the decoder will return `Unknown` for everything in
 *  that case). Returns `{count, bootCompleted}` — `bootCompleted = false`
 *  means the install pass is still in-flight; the probe shows "warming up"
 *  instead of "no bundles". */
interface SimV3BundleCountRequest {
  type: "sim-v3-bundle-count";
}
interface ExecutionReportsListRequest {
  type: "execution-reports:list";
  opts?: ExecutionReportFilter;
}
interface ExecutionReportsCountRequest {
  type: "execution-reports:count";
  opts?: ExecutionReportFilter;
}
interface ExecutionReportsClearRequest {
  type: "execution-reports:clear";
}
interface VerdictsListRequest {
  type: "verdicts:list";
  opts?: VerdictFilter;
}
interface VerdictsCountRequest {
  type: "verdicts:count";
  opts?: VerdictFilter;
}
interface VerdictsSetDecisionRequest {
  type: "verdicts:set-decision";
  id: string;
  decision: "trusted" | "cancelled";
}
interface VerdictsExportCsvRequest {
  type: "verdicts:export-csv";
  opts?: VerdictFilter;
}
interface VerdictsClearRequest {
  type: "verdicts:clear";
}
/** HistoryPage detail panel: fetch the state-delta row that a verdict's
 *  `delta_id` points at. Returns `null` for missing ids (legacy rows or
 *  decisions whose `recordSimulationOnServer` couldn't reach the policy
 *  server). */
interface StateDeltasGetRequest {
  type: "state-deltas:get";
  id: string;
}
interface StateDeltasClearRequest {
  type: "state-deltas:clear";
}
/** HistoryPage / confirm-popup denial diagnosis: fetch the captured context
 *  (action + materialized enrichment results) a deny's `delta_id` points at, so
 *  the dashboard can re-run "which clause blocked this" against the real
 *  context. `null` for non-deny / legacy rows. */
interface DiagnosisContextGetRequest {
  type: "diagnosis-context:get";
  id: string;
}
type PopupRequest =
  | DambiAuthStatusRequest
  | DambiAuthSignInRequest
  | DambiAuthSignOutRequest
  | DambiAuthSyncTokensRequest
  | DambiListWalletsRequest
  | DambiListWalletSummariesRequest
  | DambiAddWalletRequest
  | DambiUpdateWalletRequest
  | DambiDeleteWalletRequest
  | WeeklySummaryRequest
  | BadgeSeenRequest
  | CedarValidateRequest
  | CedarTestRequest
  | CedarSimulateRequest
  | RunDiagnosisProbesRequest
  | CedarTextToEstRequest
  | CedarEstToTextRequest
  | SimStepRequest
  | SimDecodeRequest
  | SimEvaluateRequest
  | SimV3BundleCountRequest
  | ExecutionReportsListRequest
  | ExecutionReportsCountRequest
  | ExecutionReportsClearRequest
  | VerdictsListRequest
  | VerdictsCountRequest
  | VerdictsSetDecisionRequest
  | VerdictsExportCsvRequest
  | VerdictsClearRequest
  | StateDeltasGetRequest
  | StateDeltasClearRequest
  | DiagnosisContextGetRequest
  | Ps2Request;

// webextension-polyfill's listener type accepts `true | void | Promise<any>`,
// not `boolean`. Returning `undefined` (bare `return;`) closes the channel
// just like a literal `false` would — do not "fix" it back to `return false`.
/**
 * ⑤ advisory 토스트를 현재 활성 탭의 content-script 로 push.
 * "현재 보고 있는 탭 하나"에만 — tabs.query({active,lastFocusedWindow}).
 * content-script 가 없는 페이지(chrome:// 등)면 sendMessage 가 reject 되므로
 * 조용히 무시(best-effort). 결정 채널 아님 — 표시 전용.
 */
/** chainId(숫자/hex) → 사람이 읽는 네트워크 이름. 미지원 체인이면 "체인 N",
 *  값이 없으면 null(컨텍스트 줄에서 생략). */
function chainName(id: number | string | undefined): string | null {
  if (id === undefined || id === null) return null;
  const n =
    typeof id === "string"
      ? parseInt(id, id.toLowerCase().startsWith("0x") ? 16 : 10)
      : id;
  if (!Number.isFinite(n)) return null;
  const names: Record<number, string> = {
    1: "Ethereum Mainnet",
    10: "Optimism",
    56: "BNB Chain",
    137: "Polygon",
    8453: "Base",
    42161: "Arbitrum One",
    43114: "Avalanche",
    11155111: "Sepolia",
  };
  return names[n] ?? `체인 ${n}`;
}

/** 0x주소 → "0x7a3f…9c21" 축약(컨텍스트 줄용). 모양이 아니면 그대로 반환. */
function shortAddr(addr: string): string {
  return /^0x[0-9a-fA-F]{8,}$/.test(addr)
    ? `${addr.slice(0, 6)}…${addr.slice(-4)}`
    : addr;
}

async function pushToastToActiveTab(
  scenario: string,
  data?: { fail?: number; warn?: number; body?: string; context?: string },
  force = false,
  tabId?: number,
): Promise<void> {
  // force=false 면 "상단 리본 배너"(ribbon) 설정을 존중. 수동 트리거(주간요약
  // 버튼)는 force=true 로 게이팅을 건너뛴다(사용자가 직접 눌렀으므로).
  if (!force) {
    await ensureNotifySettings();
    if (!shouldRibbon()) return;
  }
  // tabId 가 명시되면 그 탭으로(팝업이 활성 탭 id 를 직접 넘김 — 팝업이 떠
  // 있을 때 lastFocusedWindow 가 팝업 창을 가리켜 어긋나는 문제 회피).
  // 없으면(라이브 verdict) 활성 탭으로 폴백.
  let target = tabId;
  if (target === undefined) {
    try {
      const tabs = await Browser.tabs.query({
        active: true,
        lastFocusedWindow: true,
      });
      target = tabs[0]?.id;
    } catch {
      /* tabs 조회 실패 */
    }
  }
  if (target === undefined) return;

  const msg = { type: "DAMBI_TOAST", scenario, ...(data ? { data } : {}) };
  try {
    await Browser.tabs.sendMessage(target, msg);
  } catch {
    // content-script 가 없거나(제한 페이지) 끊겼다(확장 리로드 후 그 탭을 아직
    // 새로고침 안 함). 후자는 흔하므로 content-script 를 즉석 주입한 뒤 재시도해
    // 자동 복구한다 — 사용자가 페이지를 새로고침할 필요가 없게. chrome:// 같은
    // 제한 페이지는 주입도 실패하므로 조용히 스킵.
    try {
      await Browser.scripting.executeScript({
        target: { tabId: target },
        files: ["js/content-scripts/dambi-advisory.js"],
      });
      await Browser.tabs.sendMessage(target, msg);
    } catch {
      /* 주입 불가(제한 페이지 등) — 조용히 스킵 */
    }
  }
}

/**
 * ⑤ advisory OS 데스크톱 알림 — 인페이지 토스트(pushToastToActiveTab)와 **함께** 발사.
 * 표시 전용(결정 채널 아님): 버튼은 "무시"(그냥 닫기) / "확인하기"(대시보드 열기)
 * 두 개뿐이고, 권한취소 같은 결정·실행 액션은 절대 넣지 않는다(핸드오프 §보안).
 * 시나리오별 카피는 advisory content-script 의 toastSpec(dambi-advisory.ts)과 1-1.
 * notifications 권한/지원이 없으면 조용히 무시(best-effort) — 토스트는 그대로 뜬다.
 */
async function pushDesktopNotification(
  scenario: string,
  sev: NotifySeverity,
  data?: { fail?: number; warn?: number },
  override?: {
    title?: string | undefined;
    message?: string | undefined;
    contextMessage?: string | undefined;
  },
  force = false,
): Promise<void> {
  // force=false 면 데스크톱 알림 강도(desk) 설정을 존중. summary 는 desk="all"
  // 에서만, fail/warn 은 단계별, system(세션만료)은 항상. 수동 트리거는 force=true.
  if (!force) {
    await ensureNotifySettings();
    if (!shouldDesktop(sev)) return;
  }
  const fail = data?.fail ?? 0;
  const warn = data?.warn ?? 0;

  let title: string;
  let message: string;
  let iconFile: string;

  switch (scenario) {
    case "summary":
      title = "이번 주 Dambi 요약";
      message = `이번 주 위험 ${fail}건을 차단하고 ${warn}건은 검토를 권했어요.`;
      iconFile =
        fail > 0 ? "picture/state-fail-128.png" : "picture/state-warn-128.png";
      break;
    case "approval":
      title = "승인 권한이 위험해졌어요";
      message = "방금 한 토큰 무제한 승인이 위험 컨트랙트로 표시됐어요.";
      iconFile = "picture/state-fail-128.png";
      break;
    case "session-expired":
      title = "Dambi 로그인이 만료됐어요";
      message =
        "보호를 계속 받으려면 다시 로그인하세요. 확인하기를 눌러 대시보드를 여세요.";
      iconFile = "picture/state-warn-128.png";
      break;
    case "tx":
    default:
      title = "의심 거래가 감지됐어요";
      message = "상호작용한 주소가 위험 목록과 일치해요.";
      iconFile = "picture/state-warn-128.png";
      break;
  }

  // 실시간 위험 verdict 등 시나리오 기본 카피 대신 실제 내용(위반 주소·사유)을
  // 넣고 싶을 때 override. 아이콘은 시나리오 기준 유지. summary 호출은 override
  // 미전달 → 기존 동작 그대로.
  if (override?.title) title = override.title;
  if (override?.message) message = override.message;

  // `buttons` 는 Chrome 전용 확장 필드라 webextension-polyfill 의 공통
  // CreateNotificationOptions 타입엔 없다(Firefox 미지원). Chrome 런타임은
  // 지원하므로 spread 로 얹고 타입만 우회한다. Firefox 에선 무시되어 본체
  // 클릭(onClicked)만 동작 — advisory 표시 전용이라 기능 저하 없음.
  // 버튼 0 = 무시(닫기만), 1 = 확인하기(대시보드 열기). onButtonClicked 에서 분기.
  // contextMessage = macOS/Chrome 알림의 세 번째 흐린 줄("백그라운드 모니터링 ·
  // Ethereum Mainnet" 등). 있으면 추가해 인페이지 토스트의 mn-ctx 와 1:1.
  const options = {
    type: "basic",
    iconUrl: Browser.runtime.getURL(iconFile),
    title,
    message,
    ...(override?.contextMessage
      ? { contextMessage: override.contextMessage }
      : {}),
    buttons: [{ title: "무시" }, { title: "확인하기" }],
  } as Browser.Notifications.CreateNotificationOptions;

  try {
    await Browser.notifications.create(options);
  } catch {
    /* notifications 미지원/권한 없음 — 조용히 스킵 */
  }
}

/** ⑤ 알림 본체/버튼 클릭 시 대시보드(확장 옵션 페이지)를 새 탭으로 연다.
 *  popup 의 openDashboard()와 동일 경로 — options.html 은 SW 토큰을 mirror 해
 *  자동 로그인된다. 표시 전용 — 결정 메시지를 발신하지 않는다. */
function openDashboardFromNotification(): void {
  void Browser.tabs
    .create({ url: Browser.runtime.getURL("options.html") })
    .catch(() => {
      /* best-effort */
    });
}

// 알림 본체 클릭 → "확인하기"와 동일하게 대시보드 열기.
Browser.notifications.onClicked.addListener((notificationId: string) => {
  openDashboardFromNotification();
  void Browser.notifications.clear(notificationId);
});

// 버튼 클릭 → 0:무시(닫기만), 1:확인하기(대시보드 열기).
Browser.notifications.onButtonClicked.addListener(
  (notificationId: string, buttonIndex: number) => {
    if (buttonIndex === 1) openDashboardFromNotification();
    void Browser.notifications.clear(notificationId);
  },
);

// 세션 만료(refresh 실패로 로그아웃 전환) → 표시 전용 데스크톱 알림.
// auth client(저수준)가 index 를 직접 import 하면 순환이라 콜백 주입으로 연결.
// "확인하기"/본체 클릭 → 대시보드 열기(= 재로그인 도착지). 전환당 1회만(가드는
// client 쪽). 모듈 로드 시 1회 등록.
setOnSessionExpired(() => {
  // 보호가 멈췄다는 안전·시스템 통지 — desk 설정과 무관하게 항상 표시(sev="system").
  void pushDesktopNotification("session-expired", "system");
});

/**
 * ⑤ 주간 요약 — 최근 7일 verdict 카운트를 인페이지 토스트 + OS 알림으로 표시.
 * force=true(팝업 "이번 주 요약 보기" 버튼)면 설정 게이팅을 무시하고 항상 표시,
 * force=false(주 1회 alarm)면 ribbon(토스트)·desk=all(OS) 설정을 존중한다.
 */
async function runWeeklySummary(force: boolean, tabId?: number) {
  const counts = await countVerdicts({ range: "7d" });
  const data = { fail: counts.fail, warn: counts.warn };
  await pushToastToActiveTab("summary", data, force, tabId);
  await pushDesktopNotification("summary", "summary", data, undefined, force);
  return counts;
}

// ⑤ 주간 요약 자동화 — 주 1회(10080분) alarm. 설치/브라우저 시작 시 없을 때만
// 생성(이미 있으면 get 으로 확인해 타이머 리셋 회피). 발사 시 force=false 로
// 설정 게이팅(ribbon·desk=all)을 존중. alarms 권한/지원 없으면 조용히 스킵.
const WEEKLY_SUMMARY_ALARM = "dambi-weekly-summary";
async function ensureWeeklySummaryAlarm(): Promise<void> {
  try {
    const existing = await Browser.alarms.get(WEEKLY_SUMMARY_ALARM);
    if (!existing) {
      await Browser.alarms.create(WEEKLY_SUMMARY_ALARM, {
        periodInMinutes: 10080,
      });
    }
  } catch {
    /* alarms 미지원/권한 없음 — best-effort */
  }
}
Browser.runtime.onInstalled.addListener(() => {
  void ensureWeeklySummaryAlarm();
});
Browser.runtime.onStartup.addListener(() => {
  void ensureWeeklySummaryAlarm();
});
Browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === WEEKLY_SUMMARY_ALARM) void runWeeklySummary(false);
});

Browser.runtime.onMessage.addListener(
  (message: unknown, _sender, sendResponse: (r: unknown) => void) => {
    const req = message as Partial<PopupRequest> | null;
    if (!req || typeof req !== "object") return;

    // 정책 스토리지 v2 — ps2:* 패밀리는 단일 디스패처로. 핸들러별 분기 대신
    // api.ts의 switch가 메시지 모양을 ops로 위임한다(쓰기는 전부 mutate 큐).
    if (isPs2Request(req)) {
      void bootReady
        .then(() => handlePs2Request(req))
        .then((data) => sendResponse({ ok: true, data: data ?? null }))
        .catch((err: unknown) =>
          sendResponse({
            ok: false,
            error: { kind: "ps2_failed", message: String(err) },
          }),
        );
      return true;
    }

    // ⑤ 주간 요약 (수동 트리거 — 팝업 "이번 주 요약 보기"). 최근 7일 verdict
    // 카운트를 토스트 + OS 알림으로 표시한다. 사용자가 직접 눌렀으므로 force=true
    // 로 설정 게이팅을 건너뛴다. advisory 전용 — 서명 결정과 무관(표시만).
    if (req.type === "DAMBI_WEEKLY_SUMMARY") {
      void runWeeklySummary(true, req.tabId)
        .then((counts) => sendResponse({ ok: true, data: counts }))
        .catch((err: unknown) =>
          sendResponse({
            ok: false,
            error: { kind: "weekly_summary_failed", message: String(err) },
          }),
        );
      return true;
    }

    // ② 마스코트 배지 — 팝업이 열리면 보냄. 알람 확인 처리(발바닥 초기화).
    if (req.type === "DAMBI_BADGE_SEEN") {
      void markBadgeSeen()
        .then(() => sendResponse({ ok: true, data: null }))
        .catch((err: unknown) =>
          sendResponse({
            ok: false,
            error: { kind: "badge_seen_failed", message: String(err) },
          }),
        );
      return true;
    }

    // apps/web Cedar editor / simulation. Three message types, all
    // forwarded to policy-engine-wasm cedar_exports. Return value is
    // the raw JSON string the wasm produces — the FE parses.
    if (req.type === "cedar-validate") {
      void validatePolicyText((req as CedarValidateRequest).text)
        .then((json) => sendResponse({ ok: true, data: json }))
        .catch((err: unknown) =>
          sendResponse({
            ok: false,
            error: { kind: "cedar_validate_failed", message: String(err) },
          }),
        );
      return true;
    }
    if (req.type === "cedar-test") {
      const r = req as CedarTestRequest;
      void testPolicyText(r.text, r.request_json)
        .then((json) => sendResponse({ ok: true, data: json }))
        .catch((err: unknown) =>
          sendResponse({
            ok: false,
            error: { kind: "cedar_test_failed", message: String(err) },
          }),
        );
      return true;
    }
    if (req.type === "cedar-simulate") {
      const r = req as CedarSimulateRequest;
      void simulatePolicySequence(r.steps_json, r.policies_json)
        .then((json) => sendResponse({ ok: true, data: json }))
        .catch((err: unknown) =>
          sendResponse({
            ok: false,
            error: { kind: "cedar_simulate_failed", message: String(err) },
          }),
        );
      return true;
    }
    if (req.type === "run-diagnosis-probes") {
      void runDiagnosisProbesV2((req as RunDiagnosisProbesRequest).input_json)
        .then((json) => sendResponse({ ok: true, data: json }))
        .catch((err: unknown) =>
          sendResponse({
            ok: false,
            error: {
              kind: "run_diagnosis_probes_failed",
              message: String(err),
            },
          }),
        );
      return true;
    }
    if (req.type === "cedar-text-to-est") {
      void policyTextToEst((req as CedarTextToEstRequest).text)
        .then((json) => sendResponse({ ok: true, data: json }))
        .catch((err: unknown) =>
          sendResponse({
            ok: false,
            error: { kind: "cedar_text_to_est_failed", message: String(err) },
          }),
        );
      return true;
    }
    if (req.type === "cedar-est-to-text") {
      void estToPolicyText((req as CedarEstToTextRequest).est_json)
        .then((json) => sendResponse({ ok: true, data: json }))
        .catch((err: unknown) =>
          sendResponse({
            ok: false,
            error: { kind: "cedar_est_to_text_failed", message: String(err) },
          }),
        );
      return true;
    }
    if (req.type === "sim-step") {
      void simulateStep((req as SimStepRequest).input)
        .then((data: SimulateStepOutput) => sendResponse({ ok: true, data }))
        .catch((err: unknown) =>
          sendResponse({
            ok: false,
            error: { kind: "sim_step_failed", message: String(err) },
          }),
        );
      return true;
    }
    if (req.type === "sim-decode") {
      void declarativeRouteRequestV3((req as SimDecodeRequest).input)
        .then((data: DeclarativeRouteRequestV3Result) =>
          sendResponse({ ok: true, data }),
        )
        .catch((err: unknown) =>
          sendResponse({
            ok: false,
            error: { kind: "sim_decode_failed", message: String(err) },
          }),
        );
      return true;
    }
    if (req.type === "sim-evaluate") {
      void evaluateActionV2((req as SimEvaluateRequest).input)
        .then((data: VerdictDto) => sendResponse({ ok: true, data }))
        .catch((err: unknown) =>
          sendResponse({
            ok: false,
            error: { kind: "sim_evaluate_failed", message: String(err) },
          }),
        );
      return true;
    }
    if (req.type === "sim-v3-bundle-count") {
      sendResponse({
        ok: true,
        data: {
          count: getInstalledV3BundleCount(),
          bootCompleted: v3BundleBootCompleted(),
        },
      });
      return true;
    }

    const maybeDashboardReq: unknown = req;
    if (isDashboardRequest(maybeDashboardReq)) {
      const dashboardReq = maybeDashboardReq;
      void handleDashboardRequest(dashboardReq)
        .then((response) => {
          sendResponse(response);
          if (
            dashboardReq.type === "dashboard:set-current-user" &&
            response.ok
          ) {
            void bootReady
              .then(() => listWalletsAndProvision("current-user"))
              .catch((err: unknown) => {
                console.warn("[Dambi] wallet pre-provisioning failed:", err);
              });
          }
        })
        .catch((err: unknown) =>
          sendResponse({
            ok: false,
            error: { kind: "dashboard_failed", message: String(err) },
          }),
        );
      return true;
    }

    if (isManifestRequest(req)) {
      void handleManifestRequest(req)
        .then((response) => sendResponse(response))
        .catch((err: unknown) =>
          sendResponse({
            ok: false,
            error: { kind: "manifest_failed", message: String(err) },
          }),
        );
      return true;
    }

    if (req.type === "dambi-auth-status") {
      // Gate on boot so the storage-key migration finishes before the token read.
      void bootReady
        .then(() => fetchMe())
        .then((me: Me | null) => sendResponse({ ok: true, data: me }))
        .catch((err: unknown) =>
          sendResponse({
            ok: false,
            error: { kind: "dambi_auth_failed", message: String(err) },
          }),
        );
      return true;
    }

    if (req.type === "dambi-auth-sign-in") {
      // launchWebAuthFlow(interactive) 는 클릭의 user activation 이 살아있는 동안
      // "동기적으로" 호출해야 크롬이 OAuth 팝업을 연다. 예전처럼 bootReady/clearTokens
      // 를 먼저 await 하면 그 사이 제스처가 만료돼, 콜드 부팅한 SW 에서는 팝업이
      // 에러도 없이 "조용히" 안 뜬다(따뜻한 SW 는 bootReady 가 즉시 끝나 우연히 됐을
      // 뿐). 그래서 startGoogleLogin() 을 핸들러 진입 즉시(이 동기 턴에서) 호출해
      // 제스처를 소비한다.
      //
      // clearTokens() 도 같은 동기 턴에서 먼저 dispatch 한다: storage.remove 는
      // 곧바로 큐잉되어, OAuth 가 끝난 뒤에야 실행되는 startGoogleLogin 의 setTokens
      // 보다 항상 먼저 완료된다 → 이전 계정 토큰만 비우고, 새로 발급된 토큰은
      // 덮어쓰지 않는다(계정 전환 race 방지 의도는 그대로 유지).
      void clearTokens();
      const loginFlow = startGoogleLogin();
      void (async () => {
        try {
          await loginFlow;
          await bootReady;
          // 재로그인 성공 → 다음 만료에서 다시 알림 발사 가능하게 가드 해제.
          resetSessionExpiredGuard();
          const me = await fetchMe();
          sendResponse({ ok: true, data: me });
        } catch (err: unknown) {
          sendResponse({
            ok: false,
            error: { kind: "dambi_sign_in_failed", message: String(err) },
          });
        }
      })();
      return true;
    }

    if (req.type === "dambi-auth-sign-out") {
      void bootReady
        .then(() => clearTokens())
        .then(() => sendResponse({ ok: true, data: null }))
        .catch((err: unknown) =>
          sendResponse({
            ok: false,
            error: { kind: "dambi_sign_out_failed", message: String(err) },
          }),
        );
      return true;
    }

    if (req.type === "dambi-auth-sync-tokens") {
      const r = req as DambiAuthSyncTokensRequest;
      void bootReady
        .then(() => setTokens(r.access, r.refresh))
        .then(() => {
          // 유효 토큰 미러링(= 재로그인/세션 복원) 시 만료 가드 해제.
          if (r.access) resetSessionExpiredGuard();
          sendResponse({ ok: true, data: null });
        })
        .catch((err: unknown) =>
          sendResponse({
            ok: false,
            error: { kind: "dambi_sync_tokens_failed", message: String(err) },
          }),
        );
      return true;
    }

    if (req.type === "dambi-list-wallets") {
      void bootReady
        .then(() => listWalletsAndProvision("list-wallets"))
        .then((wallets: WalletId[]) =>
          sendResponse({ ok: true, data: wallets }),
        )
        .catch((err: unknown) =>
          sendResponse({
            ok: false,
            error: { kind: "dambi_list_wallets_failed", message: String(err) },
          }),
        );
      return true;
    }

    // 지갑 요약(라벨+잔액) — 서버 GET /dashboard/summary. 팝업이 별칭(label)을
    // 서버 단일 소스에서 읽는 경로.
    if (req.type === "dambi-list-wallet-summaries") {
      void bootReady
        .then(() => listWalletSummaries())
        .then((wallets: WalletSummary[]) =>
          sendResponse({ ok: true, data: wallets }),
        )
        .catch((err: unknown) =>
          sendResponse({
            ok: false,
            error: {
              kind: "dambi_list_wallet_summaries_failed",
              message: String(err),
            },
          }),
        );
      return true;
    }

    // 지갑 등록(POST /wallets). `chains` 를 명시해 "no chains configured" 400 을
    // 우회한다 — 서버 dambi-sync.toml 에 RPC 가 설정된 체인만(eth/arbitrum/base).
    // 미설정 체인을 포함하면 그 체인 native 조회 실패가 디스커버리 전체를
    // 중단시켜 잔액이 0 으로 남는다.
    if (req.type === "dambi-add-wallet") {
      const r = req as DambiAddWalletRequest;
      void bootReady
        .then(() => {
          const addBody: { address: string; chains: string[]; label?: string } =
            {
              address: normalizeServerWalletAddress(r.address),
              chains: ["eip155:1", "eip155:42161", "eip155:8453"],
            };
          if (r.label) addBody.label = r.label;
          return addWallet(addBody).then(async (resp) => {
            await provisionFromWalletSync([resp.wallet_id.address]);
            return resp;
          });
        })
        .then((resp: AddWalletResp) => sendResponse({ ok: true, data: resp }))
        .catch((err: unknown) =>
          sendResponse({
            ok: false,
            error: { kind: "dambi_add_wallet_failed", message: String(err) },
          }),
        );
      return true;
    }

    // 별칭 변경(PATCH /wallets/:addr) — 서버 라벨을 팝업과 동기화. 빈 문자열은
    // 라벨 제거(null)로 보낸다.
    if (req.type === "dambi-update-wallet") {
      const r = req as DambiUpdateWalletRequest;
      const patch: { label?: string | null } = {};
      if (r.label !== undefined) patch.label = r.label === "" ? null : r.label;
      void bootReady
        .then(() =>
          updateWallet(normalizeServerWalletAddress(r.address), patch),
        )
        .then(() => sendResponse({ ok: true, data: null }))
        .catch((err: unknown) =>
          sendResponse({
            ok: false,
            error: { kind: "dambi_update_wallet_failed", message: String(err) },
          }),
        );
      return true;
    }

    // 지갑 삭제(DELETE /wallets/:addr) — 서버에서 제거해 대시보드·팝업 일관성.
    if (req.type === "dambi-delete-wallet") {
      const r = req as DambiDeleteWalletRequest;
      void bootReady
        .then(() => deleteWallet(normalizeServerWalletAddress(r.address)))
        // 서버 삭제 성공 후 정책 스토어(ps2)에서도 즉시 제거 — 에디터(정책 관리)에
        // 삭제된 지갑이 남지 않게 한다. 실패해도 삭제 응답은 막지 않는다(다음
        // 전체 목록 sync가 reconcile로 정리).
        .then(() => removeWalletFromSync(r.address).catch(() => undefined))
        .then(() => sendResponse({ ok: true, data: null }))
        .catch((err: unknown) =>
          sendResponse({
            ok: false,
            error: { kind: "dambi_delete_wallet_failed", message: String(err) },
          }),
        );
      return true;
    }

    if (req.type === "execution-reports:list") {
      void listExecutionReports((req as ExecutionReportsListRequest).opts)
        .then((data) => sendResponse({ ok: true, data }))
        .catch((err: unknown) =>
          sendResponse({
            ok: false,
            error: {
              kind: "execution_reports_list_failed",
              message: String(err),
            },
          }),
        );
      return true;
    }

    if (req.type === "execution-reports:count") {
      void countExecutionReports((req as ExecutionReportsCountRequest).opts)
        .then((data) => sendResponse({ ok: true, data }))
        .catch((err: unknown) =>
          sendResponse({
            ok: false,
            error: {
              kind: "execution_reports_count_failed",
              message: String(err),
            },
          }),
        );
      return true;
    }

    if (req.type === "execution-reports:clear") {
      void clearExecutionReports()
        .then(() => sendResponse({ ok: true, data: { cleared: true } }))
        .catch((err: unknown) =>
          sendResponse({
            ok: false,
            error: {
              kind: "execution_reports_clear_failed",
              message: String(err),
            },
          }),
        );
      return true;
    }

    if (req.type === "verdicts:list") {
      void listVerdicts((req as VerdictsListRequest).opts)
        .then((data) => sendResponse({ ok: true, data }))
        .catch((err: unknown) =>
          sendResponse({
            ok: false,
            error: { kind: "verdicts_list_failed", message: String(err) },
          }),
        );
      return true;
    }

    if (req.type === "verdicts:count") {
      void countVerdicts((req as VerdictsCountRequest).opts)
        .then((data) => sendResponse({ ok: true, data }))
        .catch((err: unknown) =>
          sendResponse({
            ok: false,
            error: { kind: "verdicts_count_failed", message: String(err) },
          }),
        );
      return true;
    }

    if (req.type === "verdicts:set-decision") {
      const r = req as VerdictsSetDecisionRequest;
      if (
        typeof r.id !== "string" ||
        (r.decision !== "trusted" && r.decision !== "cancelled")
      ) {
        sendResponse({
          ok: false,
          error: {
            kind: "invalid_request",
            message: "id and decision are required",
          },
        });
        return true;
      }
      void setStoredVerdictDecision(r.id, r.decision)
        .then((updated) => sendResponse({ ok: true, data: { updated } }))
        .catch((err: unknown) =>
          sendResponse({
            ok: false,
            error: {
              kind: "verdicts_set_decision_failed",
              message: String(err),
            },
          }),
        );
      return true;
    }

    if (req.type === "verdicts:export-csv") {
      void exportVerdictsAsCsv((req as VerdictsExportCsvRequest).opts)
        .then((csv) => sendResponse({ ok: true, data: { csv } }))
        .catch((err: unknown) =>
          sendResponse({
            ok: false,
            error: { kind: "verdicts_export_failed", message: String(err) },
          }),
        );
      return true;
    }

    if (req.type === "verdicts:clear") {
      void clearVerdicts()
        .then(() => sendResponse({ ok: true, data: { cleared: true } }))
        .catch((err: unknown) =>
          sendResponse({
            ok: false,
            error: { kind: "verdicts_clear_failed", message: String(err) },
          }),
        );
      return true;
    }

    if (req.type === "state-deltas:get") {
      void getStateDelta((req as StateDeltasGetRequest).id)
        .then((row: StateDeltaRow | null) =>
          sendResponse({ ok: true, data: row }),
        )
        .catch((err: unknown) =>
          sendResponse({
            ok: false,
            error: { kind: "state_deltas_get_failed", message: String(err) },
          }),
        );
      return true;
    }
    if (req.type === "diagnosis-context:get") {
      void getDiagnosisContext((req as DiagnosisContextGetRequest).id)
        .then((row: DiagnosisContextRow | null) =>
          sendResponse({ ok: true, data: row }),
        )
        .catch((err: unknown) =>
          sendResponse({
            ok: false,
            error: {
              kind: "diagnosis_context_get_failed",
              message: String(err),
            },
          }),
        );
      return true;
    }

    if (req.type === "state-deltas:clear") {
      void clearStateDeltas()
        .then(() => sendResponse({ ok: true, data: { cleared: true } }))
        .catch((err: unknown) =>
          sendResponse({
            ok: false,
            error: { kind: "state_deltas_clear_failed", message: String(err) },
          }),
        );
      return true;
    }

    return;
  },
);
