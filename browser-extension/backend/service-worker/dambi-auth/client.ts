/**
 * Thin fetch wrapper for the Dambi (Rust) policy-rpc server,
 * service-worker edition.
 *
 * Mirrors `browser-extension/dashboard/src/server-api/client.ts` but:
 * - Reads the JWT from `tokenStore` (chrome.storage) instead of
 *   `localStorage` (which doesn't exist in a service worker).
 * - Doesn't carry the dashboard's `urlWithTokenQuery` SSE helper —
 *   the extension never opens SSE.
 *
 * The server URL comes from `DAMBI_SERVER_URL` at build time
 * (webpack DefinePlugin) and can be swapped at runtime via
 * `chrome.storage.local["dambi_server_url"]` — the service-worker
 * mirror of the dashboard's `localStorage["dambi_server_url"]`
 * override. Falls back to the deployed Dambi server.
 */

import { getAccessToken, getRefreshToken, setTokens } from "./tokenStore";

declare const DAMBI_SERVER_URL: string | undefined;

const CURRENT_PRODUCTION_BASE = "https://dambi-policy.duckdns.org";
const LEGACY_PRODUCTION_BASES = new Map([
  ["https://pasu-policy.duckdns.org", CURRENT_PRODUCTION_BASE],
]);
const URL_SCHEME_RE = /^[a-z][a-z\d+.-]*:/i;
const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

const RAW_BUILD_BASE_URL =
  (typeof DAMBI_SERVER_URL !== "undefined" && DAMBI_SERVER_URL) ||
  CURRENT_PRODUCTION_BASE;

function parseHttpUrl(input: string): URL | null {
  try {
    const url = new URL(input);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

function canonicalOrigin(url: URL): string {
  return LEGACY_PRODUCTION_BASES.get(url.origin) ?? url.origin;
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

function trustedOriginForUrl(url: URL, trustedBase = RAW_BUILD_BASE_URL): string | null {
  const origin = canonicalOrigin(url);
  const trustedUrl = parseHttpUrl(trustedBase);
  const trustedOrigin = trustedUrl ? canonicalOrigin(trustedUrl) : CURRENT_PRODUCTION_BASE;
  if (origin === CURRENT_PRODUCTION_BASE || origin === trustedOrigin) return origin;
  if (isLoopbackHost(url.hostname)) return origin;
  return null;
}

function normalizeRequestToken(value: string | null, label: string): string | null {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 16_384 ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error(`${label} must be a non-empty token string`);
  }
  return value;
}

export function normalizeServerBaseUrl(
  input: string | null | undefined,
  trustedBase = RAW_BUILD_BASE_URL,
): string | null {
  const trimmed = input?.trim();
  if (!trimmed) return null;
  const url = parseHttpUrl(trimmed);
  if (!url) return null;
  if (url.pathname !== "" && url.pathname !== "/") return null;
  if (url.search || url.hash) return null;
  return trustedOriginForUrl(url, trustedBase);
}

/** Build-time default (webpack DefinePlugin → `DAMBI_SERVER_URL`). */
const BUILD_BASE_URL =
  normalizeServerBaseUrl(RAW_BUILD_BASE_URL, RAW_BUILD_BASE_URL) ??
  CURRENT_PRODUCTION_BASE;

function resolveRequestUrl(path: string): string {
  const absolute = parseHttpUrl(path);
  if (!absolute) {
    if (URL_SCHEME_RE.test(path)) {
      throw new Error("Refusing to send request to unsupported server URL scheme");
    }
    return `${getServerBaseUrl()}${path}`;
  }
  const trustedOrigin = trustedOriginForUrl(absolute);
  if (!trustedOrigin) {
    throw new Error("Refusing to send authenticated request to untrusted server URL");
  }
  return `${trustedOrigin}${absolute.pathname}${absolute.search}`;
}

/** Runtime override key — mirrors the dashboard's
 * `localStorage["dambi_server_url"]`, in `chrome.storage.local`
 * (service workers have no `localStorage`). */
const SERVER_URL_KEY = "dambi_server_url";

let runtimeBaseUrl: string | null = null;

/** Current server base URL: runtime override (chrome.storage) if set,
 * else the build-time default. Prefer this over `SERVER_BASE_URL` for
 * anything that must respect a live server swap. */
export function getServerBaseUrl(): string {
  return runtimeBaseUrl || BUILD_BASE_URL;
}

/** Back-compat snapshot of the base URL at import time. */
export const SERVER_BASE_URL = BUILD_BASE_URL;

// Load any runtime override once at SW startup, then keep it live.
if (typeof chrome !== "undefined" && chrome.storage?.local) {
  void chrome.storage.local.get(SERVER_URL_KEY).then((r) => {
    const v = r[SERVER_URL_KEY];
    runtimeBaseUrl = normalizeServerBaseUrl(typeof v === "string" ? v : null);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[SERVER_URL_KEY]) {
      const v = changes[SERVER_URL_KEY].newValue;
      runtimeBaseUrl = normalizeServerBaseUrl(typeof v === "string" ? v : null);
    }
  });
}

/**
 * 세션 만료(로그인 상태였는데 refresh 실패로 로그아웃 전환) 시 한 번 호출되는
 * 표시 전용 콜백. 실제 알림은 index.ts 가 소유 — 저수준 auth 가 index 를 직접
 * import 하면 순환이 되므로 콜백 주입으로 푼다(위험 verdict 알림과 동일 패턴).
 * 동시 401 다발로 refreshAccessToken 이 여러 번 불려도 `notifiedExpired` 가드로
 * 로그인→로그아웃 전환당 1회만 발사한다. 재로그인(setTokens 로 토큰 복원) 시
 * 가드가 풀려 다음 만료에서 다시 발사된다.
 */
let onSessionExpired: (() => void) | null = null;
let notifiedExpired = false;

export function setOnSessionExpired(cb: (() => void) | null): void {
  onSessionExpired = cb;
}

/** 토큰이 다시 세팅되면(재로그인/리프레시 성공) 만료 가드를 푼다. */
export function resetSessionExpiredGuard(): void {
  notifiedExpired = false;
}

export class ServerError extends Error {
  public readonly status: number;
  public readonly body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = "ServerError";
    this.status = status;
    this.body = body;
  }
  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  token?: string | null;
  noAuth?: boolean;
  signal?: AbortSignal;
}

interface RefreshResponse {
  access_token: string;
  refresh_token?: string;
}

async function refreshAccessToken(): Promise<string | null> {
  const refresh = await getRefreshToken();
  if (!refresh) return null;
  const res = await fetch(`${getServerBaseUrl()}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refresh }),
  });
  if (!res.ok) {
    await setTokens(null, null);
    // 로그인 상태였는데(refresh 토큰이 있었으므로 여기까지 옴) 갱신 실패 →
    // 세션 만료. 전환당 1회만 표시 전용 알림 발사. fire-and-forget.
    if (!notifiedExpired) {
      notifiedExpired = true;
      try {
        onSessionExpired?.();
      } catch {
        /* advisory 전용 — 알림 실패가 auth 흐름에 영향 주지 않게 */
      }
    }
    return null;
  }
  const body = (await res.json()) as RefreshResponse;
  try {
    await setTokens(body.access_token, body.refresh_token ?? refresh);
  } catch {
    await setTokens(null, null);
    if (!notifiedExpired) {
      notifiedExpired = true;
      try {
        onSessionExpired?.();
      } catch {
        /* advisory 전용 — 알림 실패가 auth 흐름에 영향 주지 않게 */
      }
    }
    return null;
  }
  // 갱신 성공 → 다음 만료에서 다시 알릴 수 있게 가드 해제.
  notifiedExpired = false;
  return body.access_token;
}

/** Core request primitive. Returns parsed JSON. Throws `ServerError`. */
export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const url = resolveRequestUrl(path);
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";

  if (!opts.noAuth) {
    const token =
      opts.token === undefined
        ? await getAccessToken()
        : normalizeRequestToken(opts.token, "request access token");
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }

  const init: RequestInit = {
    method: opts.method ?? "GET",
    headers,
  };
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
  if (opts.signal !== undefined) init.signal = opts.signal;
  const res = await fetch(url, init);

  if (res.status === 401 && !opts.noAuth) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      headers["Authorization"] = `Bearer ${refreshed}`;
      const retry = await fetch(url, { ...init, headers });
      return parseResponse<T>(retry);
    }
  }
  return parseResponse<T>(res);
}

async function parseResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    throw new ServerError(res.status, `${res.status} ${res.statusText}`, body);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ---------- typed helpers ----------

export interface Me {
  user_id: string;
  email: string;
}

export interface WalletId {
  address: string;
  chains: string[];
}

export function normalizeWalletAddress(value: unknown): string {
  if (typeof value !== "string" || !EVM_ADDRESS_RE.test(value)) {
    throw new Error("wallet address must be an EVM address");
  }
  return value.toLowerCase();
}

/** `GET /auth/me` — current user (or `null` if no token / 401). */
export async function fetchMe(): Promise<Me | null> {
  if (!(await getAccessToken())) return null;
  try {
    return await request<Me>("/auth/me");
  } catch (e) {
    if (e instanceof ServerError && e.isUnauthorized) return null;
    throw e;
  }
}

/** `GET /wallets` — user's tracked wallets (address + chains only; no label). */
export async function listWallets(): Promise<WalletId[]> {
  return request<WalletId[]>("/wallets");
}

/** One wallet row from `GET /dashboard/summary` — includes the human label
 *  (nickname) and portfolio total, which `GET /wallets` does NOT return. */
export interface WalletSummary {
  address: string;
  label: string | null;
  total_usd?: string;
}
interface DashboardSummaryDto {
  wallets: WalletSummary[];
}
/** `GET /dashboard/summary` — wallets WITH label. Used by the popup so the
 *  nickname has a single source of truth (the server), matching the dashboard. */
export async function listWalletSummaries(): Promise<WalletSummary[]> {
  const d = await request<DashboardSummaryDto>("/dashboard/summary");
  return Array.isArray(d?.wallets) ? d.wallets : [];
}

/** `PATCH /wallets/:address` — update label (nickname). `label: null` clears. */
export async function updateWallet(
  address: string,
  patch: { label?: string | null },
): Promise<void> {
  await request<void>(`/wallets/${normalizeWalletAddress(address)}`, {
    method: "PATCH",
    body: {
      ...(patch.label !== undefined ? { label: patch.label } : {}),
    },
  });
}

/** `DELETE /wallets/:address` — soft delete (archive) the wallet. */
export async function deleteWallet(address: string): Promise<void> {
  await request<void>(`/wallets/${normalizeWalletAddress(address)}`, { method: "DELETE" });
}

export interface AddWalletBody {
  /** 0x address (case-insensitive). */
  address: string;
  /** CAIP-2 list (e.g. `["eip155:1"]`). Omit to track every configured chain. */
  chains?: string[];
  label?: string;
}
export interface AddWalletResp {
  wallet_id: WalletId;
  synced: boolean;
  discovered: number;
  error?: string;
}

/** `POST /wallets` — start tracking a new wallet for the authenticated user.
 *  On failure, surface the server's reason text (ServerError.body) so callers
 *  can see WHY (e.g. "no chains configured", "invalid address") instead of a
 *  bare "400 Bad Request". */
export async function addWallet(body: AddWalletBody): Promise<AddWalletResp> {
  try {
    return await request<AddWalletResp>("/wallets", {
      method: "POST",
      body: {
        address: normalizeWalletAddress(body.address),
        ...(body.chains !== undefined ? { chains: body.chains } : {}),
        ...(body.label !== undefined ? { label: body.label } : {}),
      },
    });
  } catch (e) {
    if (e instanceof ServerError) {
      const reason =
        typeof e.body === "string"
          ? e.body
          : e.body && typeof e.body === "object"
            ? JSON.stringify(e.body)
            : "";
      throw new Error(`${e.message}${reason ? " — " + reason : ""}`);
    }
    throw e;
  }
}

/**
 * `POST /evaluate` — simulate the given action envelopes against the
 * authenticated user's wallet state. The new Rust server persists the
 * resulting delta so the dashboard sees the history; the SW still runs
 * WASM Cedar for the actual verdict.
 *
 * Returns the server's `policyRequest` (state_before / deltas /
 * state_after) and `diagnostics`. Errors are surfaced as `ServerError`.
 *
 * Wire shape mirrors `crates/policy-server/server/src/dto.rs`. Types are
 * kept loose (`Record<string, unknown>`) because the action / context
 * payloads are opaque to the SW — only the server (and WASM Cedar)
 * needs to interpret them.
 */
export interface EvaluateRequestDto {
  wallet_id: WalletId;
  envelopes: ReadonlyArray<Record<string, unknown>>;
  eval_context: Record<string, unknown>;
  call_specs?: ReadonlyArray<Record<string, unknown>>;
}

export interface EvaluateResponseDto {
  policyRequest: Record<string, unknown>;
  diagnostics?: ReadonlyArray<Record<string, unknown>>;
}

export async function evaluate(req: EvaluateRequestDto): Promise<EvaluateResponseDto> {
  return request<EvaluateResponseDto>("/evaluate", {
    method: "POST",
    body: req,
  });
}

/**
 * `POST /wallets/:address/permits` body — a decoded off-chain permit/permit2
 * signature. Mirrors the server's `IngestPermitReq` tagged union
 * (`crates/policy-server/server/src/write_handlers.rs`). Decoded params only;
 * the raw EIP-712 signature is intentionally NOT sent (less sensitive — the
 * reconciler needs nonce/deadline, not the sig).
 */
export type IngestPermitReq =
  | {
      kind: "eip2612";
      token: string;
      spender: string;
      amount: string;
      deadline: number;
      nonce: string;
      chain_id: string;
    }
  | {
      kind: "permit2_allowance";
      token: string;
      spender: string;
      amount: string;
      expires_at: number;
      sig_deadline: number;
      nonce_word: string;
      nonce_bit: number;
      chain_id: string;
    }
  | {
      kind: "permit2_transfer";
      token: string;
      owner: string;
      spender: string;
      amount: string;
      sig_deadline: number;
      nonce_word: string;
      nonce_bit: number;
      witness_type?: string | null;
      chain_id: string;
    };

export interface IngestPermitResp {
  pending_ids: string[];
}

/**
 * `POST /wallets/:address/permits` — record a signed permit/permit2 the
 * extension just observed, so the server tracks it as a `PendingTx` (and the
 * sync reconciler later closes its lifecycle). Best-effort at the call site;
 * errors surface as `ServerError` for the caller to swallow.
 */
export async function ingestPermit(
  address: string,
  req: IngestPermitReq,
): Promise<IngestPermitResp> {
  return request<IngestPermitResp>(`/wallets/${normalizeWalletAddress(address)}/permits`, {
    method: "POST",
    body: req,
  });
}
