import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import "./advisory-toast.css";

/**
 * 대시보드 인앱 토스트(advisory).
 *
 * content-script 토스트는 `chrome-extension://` 페이지(대시보드 자신)에는 못 뜬다
 * (Chrome 이 확장 페이지에 content-script 주입을 금지). 그래서 SW 가 `DAMBI_TOAST`
 * 를 `chrome.runtime` 으로도 브로드캐스트하면, 여기서 받아 대시보드 화면 우상단에
 * 같은 카드로 직접 렌더한다. **보이는 탭만** 렌더(background 탭은 무시)해서, 일반
 * 웹페이지에서 content-script 토스트가 뜰 때 숨은 대시보드가 중복으로 띄우지 않게 한다.
 *
 * 표시 전용 — 결정/실행 액션 없음. 버튼은 닫기 / 내역 보기(history 이동)뿐.
 */

type Sev = "fail" | "warn" | "safe";

interface ToastData {
  fail?: number;
  warn?: number;
  /** 실제 위반 사유(라이브 verdict). 없으면 시나리오 기본 카피. */
  body?: string;
  /** 흐린 컨텍스트 줄("백그라운드 모니터링 · Ethereum Mainnet"). */
  context?: string;
}
interface ToastMessage {
  type?: unknown;
  scenario?: unknown;
  data?: unknown;
}
type Shown = { scenario: string; data: ToastData } | null;

const ASSET = (p: string): string => {
  const rt = (globalThis as { chrome?: { runtime?: { getURL?: (p: string) => string } } })
    .chrome?.runtime;
  return rt?.getURL ? rt.getURL(p) : p;
};

function metaFor(scenario: string, data: ToastData): {
  sev: Sev;
  title: string;
  time: string;
  ctx: string;
} {
  const fail = data.fail ?? 0;
  if (scenario === "summary") {
    return {
      sev: fail > 0 ? "fail" : "warn",
      title: "이번 주 Dambi 요약",
      time: "지난 7일",
      ctx: data.context ?? "백그라운드 모니터링 · 지난 7일",
    };
  }
  if (scenario === "approval") {
    return {
      sev: "fail",
      title: "승인 권한이 위험해졌어요",
      time: "지금",
      ctx: data.context ?? "백그라운드 모니터링",
    };
  }
  return {
    sev: "warn",
    title: "의심 거래가 감지됐어요",
    time: "방금",
    ctx: data.context ?? "백그라운드 모니터링",
  };
}

function BodyText({ scenario, data }: { scenario: string; data: ToastData }) {
  if (data.body) return <>{data.body}</>;
  if (scenario === "summary") {
    return (
      <>
        이번 주 위험 <b>{data.fail ?? 0}건</b>을 차단하고{" "}
        <b>{data.warn ?? 0}건</b>은 검토를 권했어요.
      </>
    );
  }
  if (scenario === "approval") {
    return (
      <>
        방금 한 토큰 <b>무제한 승인</b>이 위험 컨트랙트로 표시됐어요.
      </>
    );
  }
  return <>상호작용한 주소가 위험 목록과 일치해요.</>;
}

export function AdvisoryToast() {
  const [shown, setShown] = useState<Shown>(null);
  const navigate = useNavigate();

  // SW 브로드캐스트 수신 → 보이는 탭일 때만 표시.
  useEffect(() => {
    const rt = (
      globalThis as {
        chrome?: {
          runtime?: {
            onMessage?: {
              addListener: (cb: (m: unknown) => void) => void;
              removeListener: (cb: (m: unknown) => void) => void;
            };
          };
        };
      }
    ).chrome?.runtime;
    const onMessage = rt?.onMessage;
    if (!onMessage) return;
    const handler = (raw: unknown): void => {
      const m = raw as ToastMessage | null;
      if (!m || m.type !== "DAMBI_TOAST") return;
      if (document.visibilityState !== "visible") return;
      const data = (m.data && typeof m.data === "object" ? m.data : {}) as ToastData;
      setShown({
        scenario: typeof m.scenario === "string" ? m.scenario : "tx",
        data,
      });
    };
    onMessage.addListener(handler);
    return () => onMessage.removeListener(handler);
  }, []);

  // 8초 후 자동 사라짐(새 토스트가 오면 타이머 리셋).
  useEffect(() => {
    if (!shown) return;
    const t = window.setTimeout(() => setShown(null), 8000);
    return () => window.clearTimeout(t);
  }, [shown]);

  if (!shown) return null;
  const { sev, title, time, ctx } = metaFor(shown.scenario, shown.data);
  const mascot = ASSET(`picture/state-${sev}.png`);
  const paw = ASSET(sev === "fail" ? "picture/paw-navy.png" : "picture/paw-gold.png");

  return (
    <div className="dat-host" role="status" aria-live="polite">
      <div className={`dat-card ${sev}`}>
        <div className="dat-main">
          <div className="dat-icon">
            <img src={mascot} alt="" />
            <span className="dat-paw">
              <img src={paw} alt="" />
            </span>
          </div>
          <div className="dat-content">
            <div className="dat-top">
              <span className="dat-app">Dambi</span>
              <span className="dat-time">{time}</span>
            </div>
            <div className="dat-title">{title}</div>
            <div className="dat-text">
              <BodyText scenario={shown.scenario} data={shown.data} />
            </div>
            <div className="dat-ctx">{ctx}</div>
          </div>
        </div>
        <div className="dat-actions">
          <button type="button" onClick={() => setShown(null)}>
            닫기
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => {
              setShown(null);
              navigate("/history");
            }}
          >
            내역 보기
          </button>
        </div>
      </div>
    </div>
  );
}
