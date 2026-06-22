/**
 * Thin fetch wrapper for the policy-rpc server (policy-server).
 *
 * Responsibilities:
 * - Prepend the server base URL (configurable; defaults to the deployed server).
 * - Attach `Authorization: Bearer <jwt>` automatically when a token is
 *   stored.
 * - Throw structured `ServerError` on non-2xx so callers can match on
 *   status (e.g. trigger re-login on 401).
 * - Stay tiny and dependency-free — no axios, no React.
 */

import { normalizeAuthToken } from "./auth-token";

const CURRENT_PRODUCTION_BASE = "https://dambi-policy.duckdns.org";
const LEGACY_PRODUCTION_BASES = new Map([
  ["https://pasu-policy.duckdns.org", CURRENT_PRODUCTION_BASE],
]);
const URL_SCHEME_RE = /^[a-z][a-z\d+.-]*:/i;

const RAW_DEFAULT_BASE = import.meta.env.VITE_DAMBI_SERVER_URL || CURRENT_PRODUCTION_BASE;
const DEFAULT_BASE =
  normalizeServerBaseUrl(RAW_DEFAULT_BASE, RAW_DEFAULT_BASE) ?? CURRENT_PRODUCTION_BASE;

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

function trustedOriginForUrl(url: URL, trustedBase = RAW_DEFAULT_BASE): string | null {
  const origin = canonicalOrigin(url);
  const trustedUrl = parseHttpUrl(trustedBase);
  const trustedOrigin = trustedUrl ? canonicalOrigin(trustedUrl) : CURRENT_PRODUCTION_BASE;
  if (origin === CURRENT_PRODUCTION_BASE || origin === trustedOrigin) return origin;
  if (isLoopbackHost(url.hostname)) return origin;
  return null;
}

export function normalizeServerBaseUrl(
  input: string | null | undefined,
  trustedBase = RAW_DEFAULT_BASE,
): string | null {
  const trimmed = input?.trim();
  if (!trimmed) return null;
  const url = parseHttpUrl(trimmed);
  if (!url) return null;
  if (url.pathname !== "" && url.pathname !== "/") return null;
  if (url.search || url.hash) return null;
  return trustedOriginForUrl(url, trustedBase);
}

function resolveRequestUrl(path: string): string {
  const absolute = parseHttpUrl(path);
  if (!absolute) {
    if (URL_SCHEME_RE.test(path)) {
      throw new Error("Refusing to send request to unsupported server URL scheme");
    }
    return `${SERVER_BASE_URL}${path}`;
  }
  const trustedOrigin = trustedOriginForUrl(absolute);
  if (!trustedOrigin) {
    throw new Error("Refusing to send authenticated request to untrusted server URL");
  }
  return `${trustedOrigin}${absolute.pathname}${absolute.search}`;
}

/** Resolve the server URL — env > localStorage > default. Read once at
 * import time; we don't expect users to swap servers mid-session. */
function resolveBaseUrl(): string {
  if (typeof window !== "undefined") {
    const stored = window.localStorage.getItem("dambi_server_url");
    const normalized = normalizeServerBaseUrl(stored);
    if (normalized) return normalized;
  }
  return DEFAULT_BASE;
}

export const SERVER_BASE_URL = resolveBaseUrl();

const TOKEN_KEY = "dambi_jwt";
const REFRESH_KEY = "dambi_jwt_refresh";

/** Persisted access token. Returns `null` when the user is logged out. */
export function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  const token = window.localStorage.getItem(TOKEN_KEY);
  try {
    return normalizeAuthToken(token, "stored access token");
  } catch {
    window.localStorage.removeItem(TOKEN_KEY);
    return null;
  }
}

export function getStoredRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  const token = window.localStorage.getItem(REFRESH_KEY);
  try {
    return normalizeAuthToken(token, "stored refresh token");
  } catch {
    window.localStorage.removeItem(REFRESH_KEY);
    return null;
  }
}

export function setStoredToken(token: string | null): void {
  if (typeof window === "undefined") return;
  if (token === null) window.localStorage.removeItem(TOKEN_KEY);
  else window.localStorage.setItem(TOKEN_KEY, normalizeAuthToken(token, "access token")!);
}

export function setStoredRefreshToken(token: string | null): void {
  if (typeof window === "undefined") return;
  if (token === null) window.localStorage.removeItem(REFRESH_KEY);
  else window.localStorage.setItem(REFRESH_KEY, normalizeAuthToken(token, "refresh token")!);
}

/** Error surfaced by every server-api call on non-2xx. */
export class ServerError extends Error {
  public readonly status: number;
  public readonly body: unknown;

  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = "ServerError";
    this.status = status;
    this.body = body;
  }

  /** Convenience predicate — most callers re-trigger login on 401. */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

/** Options for `request()`. `body` is JSON-stringified for you. */
export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  /** Override the stored token (e.g. during login when nothing is persisted yet). */
  token?: string | null;
  /** Skip the `Authorization` header entirely (for `/auth/google` style routes). */
  noAuth?: boolean;
  signal?: AbortSignal;
}

interface RefreshResponse {
  access_token: string;
  refresh_token?: string;
}

type TokenRefreshObserver = (
  access: string | null,
  refresh: string | null,
) => void | Promise<void>;

let tokenRefreshObserver: TokenRefreshObserver | null = null;

export function setTokenRefreshObserver(
  observer: TokenRefreshObserver | null,
): void {
  tokenRefreshObserver = observer;
}

function notifyTokenRefresh(access: string | null, refresh: string | null): void {
  const observer = tokenRefreshObserver;
  if (!observer) return;
  try {
    void Promise.resolve(observer(access, refresh)).catch((err: unknown) => {
      console.warn("[Dambi] token refresh observer failed:", err);
    });
  } catch (err) {
    console.warn("[Dambi] token refresh observer failed:", err);
  }
}

function clearStoredTokensAndNotify(): void {
  setStoredToken(null);
  setStoredRefreshToken(null);
  notifyTokenRefresh(null, null);
}

async function refreshAccessToken(): Promise<string | null> {
  const refresh = getStoredRefreshToken();
  if (!refresh) return null;
  const res = await fetch(`${SERVER_BASE_URL}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refresh }),
  });
  if (!res.ok) {
    clearStoredTokensAndNotify();
    return null;
  }
  const body = (await res.json()) as RefreshResponse;
  try {
    const access = normalizeAuthToken(body.access_token, "refreshed access token")!;
    const nextRefresh =
      body.refresh_token === undefined
        ? refresh
        : normalizeAuthToken(body.refresh_token, "refreshed refresh token");
    setStoredToken(access);
    setStoredRefreshToken(nextRefresh);
    notifyTokenRefresh(access, nextRefresh);
    return access;
  } catch {
    clearStoredTokensAndNotify();
    return null;
  }
}

/** Core request primitive. Returns parsed JSON. Throws `ServerError`. */
export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const url = resolveRequestUrl(path);
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";

  if (!opts.noAuth) {
    const token =
      opts.token === undefined
        ? getStoredToken()
        : normalizeAuthToken(opts.token, "request access token");
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });

  if (res.status === 401 && !opts.noAuth) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      headers["Authorization"] = `Bearer ${refreshed}`;
      const retry = await fetch(url, {
        method: opts.method ?? "GET",
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: opts.signal,
      });
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
  // 204 No Content
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
