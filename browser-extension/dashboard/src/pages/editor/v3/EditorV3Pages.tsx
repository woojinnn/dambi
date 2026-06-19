/**
 * 정책 관리 2 (v3) — 새 에디터 프론트를 통째로 임베드 + 실제 백엔드 연동.
 *
 * 목록/워크스페이스는 프로토타입(iframe, store.js가 실제 ps2 메시징)을 띄운다.
 * 정책 상세 편집은 프로토타입이 skeleton.model 을 기대하지만 실제 def는 ir 만
 * 가지므로, iframe에서 정책을 누르면 postMessage로 부모에 알리고 부모가 대시보드의
 * 실제 에디터(/editor/:id = EditorDetailPageV2, ir 지원)를 연다.
 */
import { useEffect } from "react";
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

function EmbeddedEditor() {
  // 계정(user_id)이 바뀌면 iframe을 리마운트해 store를 새 계정으로 다시 로드한다
  // (재로그인 후 옛 계정 데이터가 남던 문제 방지).
  const { user } = useAuth();
  return (
    <iframe
      key={user?.user_id ?? "anon"}
      src={SRC}
      title="Policy Editor v3"
      style={{ width: "100%", height: "calc(100vh - 56px)", border: "none", display: "block" }}
    />
  );
}

/** iframe → 부모 브리지: 정책 상세 열기 요청을 받아 실제 에디터로 이동. */
function useOpenPolicyBridge() {
  const navigate = useNavigate();
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { source?: string; type?: string; to?: string; state?: unknown } | null;
      if (d && d.source === "dambi-editor-v3" && d.type === "open-policy" && typeof d.to === "string") {
        // state(newPolicy seed)가 있으면 라우터 state 로 함께 넘긴다 — 새 정책 생성 시
        // EditorDetailPageV2 가 location.state.newPolicy 로 시드하기 때문.
        navigate(d.to, d.state ? { state: d.state } : undefined);
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [navigate]);
}

export function EditorV3ListPage() {
  useOpenPolicyBridge();
  useWalletLabelBridge();
  return <EmbeddedEditor />;
}

export function EditorV3DetailPage() {
  // 프로토타입이 내부 해시 라우팅으로 목록/상세를 처리하므로 동일 임베드를 띄운다.
  useOpenPolicyBridge();
  useWalletLabelBridge();
  return <EmbeddedEditor />;
}
