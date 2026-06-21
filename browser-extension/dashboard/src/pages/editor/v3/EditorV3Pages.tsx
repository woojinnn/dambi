/**
 * 정책 관리 2 (v3) — 새 에디터 프론트를 통째로 임베드 + 실제 백엔드 연동.
 *
 * 목록/워크스페이스는 프로토타입(iframe, store.js가 실제 ps2 메시징)을 띄운다.
 * 정책 상세 편집은 프로토타입이 skeleton.model 을 기대하지만 실제 def는 ir 만
 * 가지므로, iframe에서 정책을 누르면 postMessage로 부모에 알리고 부모가 대시보드의
 * 실제 에디터(/editor/:id = EditorDetailPageV2, ir 지원)를 연다.
 */
import { useEffect, useRef, type RefObject } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { useAuth } from "../../../hooks/useAuth";
import { getDashboardSummary } from "../../../server-api/dashboard";

/** 지갑 라벨(별명)을 localStorage에 기록 — iframe(같은 origin)이 읽어 주소 대신
 *  별명을 보여준다. ps2 스냅샷엔 라벨이 없어 대시보드 요약에서 가져온다. */
function useWalletLabelBridge() {
  const q = useQuery({ queryKey: ["dashboard-summary"], queryFn: getDashboardSummary });
  useEffect(() => {
    if (!q.data) return;
    const map: Record<string, string> = {};
    for (const w of q.data.wallets ?? []) if (w.label) map[w.address.toLowerCase()] = w.label;
    try {
      localStorage.setItem("dambi_wallet_labels", JSON.stringify(map));
    } catch {
      /* ignore */
    }
  }, [q.data]);
}

// 빌드 base("./")에 맞춘 정적 자산 경로 — 확장/dev 둘 다에서 동작.
const SRC = `${import.meta.env.BASE_URL}editor-v3/Editor.html`;

type EditorOpenState = {
  newPolicy: {
    method: "form" | "cedar";
    cedarText: string;
    displayName: string;
    initialTab?: "form" | "cedar" | "llm";
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function isEditorOpenMessage(value: unknown): value is { to: string; state?: unknown } {
  if (!value || typeof value !== "object") return false;
  const d = value as { source?: unknown; type?: unknown; to?: unknown };
  return (
    d.source === "dambi-editor-v3" &&
    d.type === "open-policy" &&
    typeof d.to === "string"
  );
}

function sanitizeEditorState(value: unknown): EditorOpenState | undefined {
  if (!isRecord(value) || !isRecord(value.newPolicy)) return undefined;
  const p = value.newPolicy;
  if (p.method !== "form" && p.method !== "cedar") return undefined;
  if (typeof p.cedarText !== "string" || typeof p.displayName !== "string") return undefined;
  const state: EditorOpenState = {
    newPolicy: {
      method: p.method,
      cedarText: p.cedarText,
      displayName: p.displayName,
    },
  };
  if (p.initialTab === "form" || p.initialTab === "cedar" || p.initialTab === "llm") {
    state.newPolicy.initialTab = p.initialTab;
  }
  return state;
}

function isAllowedEditorRoute(to: string): boolean {
  if (!to.startsWith("/editor/")) return false;
  try {
    const parsed = new URL(to, window.location.origin);
    return (
      parsed.origin === window.location.origin &&
      parsed.pathname.startsWith("/editor/") &&
      parsed.pathname.length > "/editor/".length
    );
  } catch {
    return false;
  }
}

function EmbeddedEditor({ iframeRef }: { iframeRef: RefObject<HTMLIFrameElement> }) {
  // 계정(user_id)이 바뀌면 iframe을 리마운트해 store를 새 계정으로 다시 로드한다
  // (재로그인 후 옛 계정 데이터가 남던 문제 방지).
  const { user } = useAuth();
  return (
    <iframe
      ref={iframeRef}
      key={user?.user_id ?? "anon"}
      src={SRC}
      title="Policy Editor v3"
      style={{ width: "100%", height: "calc(100vh - 56px)", border: "none", display: "block" }}
    />
  );
}

/** iframe → 부모 브리지: 정책 상세 열기 요청을 받아 실제 에디터로 이동. */
function useOpenPolicyBridge(iframeRef: RefObject<HTMLIFrameElement>) {
  const navigate = useNavigate();
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if (e.source !== iframeRef.current?.contentWindow) return;
      if (!isEditorOpenMessage(e.data)) return;
      if (!isAllowedEditorRoute(e.data.to)) return;
      const state = sanitizeEditorState(e.data.state);
      if (state) navigate(e.data.to, { state });
      else navigate(e.data.to); // 예: "/editor/<id>?wallet=..&binding=.." → 실제 EditorDetailPageV2
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [iframeRef, navigate]);
}

export function EditorV3ListPage() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  useOpenPolicyBridge(iframeRef);
  useWalletLabelBridge();
  return <EmbeddedEditor iframeRef={iframeRef} />;
}

export function EditorV3DetailPage() {
  // 프로토타입이 내부 해시 라우팅으로 목록/상세를 처리하므로 동일 임베드를 띄운다.
  const iframeRef = useRef<HTMLIFrameElement>(null);
  useOpenPolicyBridge(iframeRef);
  useWalletLabelBridge();
  return <EmbeddedEditor iframeRef={iframeRef} />;
}
