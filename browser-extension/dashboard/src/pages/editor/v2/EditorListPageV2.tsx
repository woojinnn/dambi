import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { subscribeToBroadcast } from "../../../server-api";
import { getOverview } from "../../../server-api/policy-store";
import { Editor2View } from "./Editor2View";
import { Topbar } from "../../../shell/Topbar";
import { NewPolicyChooser } from "./NewPolicyChooser";

import "./editor-v2.css";

interface ToastMsg {
  id: number;
  text: string;
}

/**
 * /editor — 정책 스토리지 v2의 대시보드 진입점.
 * 단일 화면: 지갑별 정책 v2 워크스페이스(왼쪽 라이브러리 뼈대 → 오른쪽 패키지
 * 카드 드래그 적용). 데이터는 ps2:get-overview 로 읽고 변이 후 invalidate 로 갱신.
 */
export function EditorListPageV2() {
  const { t } = useTranslation("editor");
  const qc = useQueryClient();

  const overviewQ = useQuery({ queryKey: ["ps2-overview"], queryFn: getOverview });

  useEffect(() => {
    const unsubscribe = subscribeToBroadcast((keys) => {
      const touched =
        keys.some((k) => k.startsWith("ps2:")) || keys.includes("dashboard:current-user-id");
      if (touched) void qc.invalidateQueries({ queryKey: ["ps2-overview"] });
    });
    return unsubscribe;
  }, [qc]);

  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const pushToast = (text: string) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((t) => [...t, { id, text }]);
    window.setTimeout(() => setToasts((t) => t.filter((m) => m.id !== id)), 2400);
  };

  const [chooserOpen, setChooserOpen] = useState(false);

  const snap = overviewQ.data ?? null;
  const defCount = snap ? Object.values(snap.library.defs).filter((d) => !d.hidden).length : null;
  const pkgCount = snap ? Object.keys(snap.library.packages).length : null;

  return (
    <>
      <Topbar
        here={t("nav.editor", { ns: "shell" })}
        subtitle={defCount === null ? "…" : t("list.subtitle", { defs: defCount, pkgs: pkgCount })}
      />

      <div className="ev2-body">
        {overviewQ.isLoading && <div className="ev2-status">{t("common:loading")}</div>}
        {overviewQ.isError && <div className="ev2-status">{t("list.storeReadError")}</div>}
        {snap && <Editor2View onToast={pushToast} onNewPolicy={() => setChooserOpen(true)} />}
      </div>

      <ToastStack toasts={toasts} />
      <NewPolicyChooser open={chooserOpen} onClose={() => setChooserOpen(false)} />
    </>
  );
}

function ToastStack({ toasts }: { toasts: ToastMsg[] }) {
  if (toasts.length === 0) return null;
  return (
    <div className="ev2-toaststack">
      {toasts.map((t) => (
        <div key={t.id} className="ev2-toast">
          {t.text}
        </div>
      ))}
    </div>
  );
}
