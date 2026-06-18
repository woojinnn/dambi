import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import type { TFunction } from "i18next";

import {
  dashboardId,
  type PolicyMethod,
} from "../../../server-api";
import { getOverview } from "../../../server-api/policy-store";

import { CaretRightIcon, CheckIcon, ShieldIcon, XIcon } from "./icons";

/** Chooser entry. "llm" isn't a stored PolicyMethod — it opens the editor's LLM
 *  tab on a form-method draft. */
type ChooserKey = "form" | "cedar" | "llm";

interface CardDef {
  key: ChooserKey;
  accent: "cyan" | "sage" | "slate";
  title: string;
  summary: string;
  rec: string;
  pros: string[];
  cons: string[];
  preview: "form" | "cedar" | "llm";
  disabled?: boolean;
  disabledNote?: string;
}

/** 카드 문구는 호출 시점에 t()로 — 모듈 평가 시점엔 i18n이 없을 수 있다. */
function buildCards(t: TFunction): CardDef[] {
  return [
    {
      key: "cedar",
      accent: "slate",
      title: t("editor:chooser.cedar.title"),
      summary: t("editor:chooser.cedar.summary"),
      rec: t("editor:chooser.cedar.rec"),
      pros: [t("editor:chooser.cedar.pro1"), t("editor:chooser.cedar.pro2")],
      cons: [t("editor:chooser.cedar.con1"), t("editor:chooser.cedar.con2")],
      preview: "cedar",
    },
    {
      key: "form",
      accent: "cyan",
      title: t("editor:chooser.form.title"),
      summary: t("editor:chooser.form.summary"),
      rec: t("editor:chooser.form.rec"),
      pros: [
        t("editor:chooser.form.pro1"),
        t("editor:chooser.form.pro2"),
        t("editor:chooser.form.pro3"),
      ],
      cons: [t("editor:chooser.form.con1")],
      preview: "form",
    },
    {
      key: "llm",
      accent: "sage",
      title: t("editor:chooser.llm.title"),
      summary: t("editor:chooser.llm.summary"),
      rec: t("editor:chooser.llm.rec"),
      pros: [t("editor:chooser.llm.pro1"), t("editor:chooser.llm.pro2")],
      cons: [t("editor:chooser.llm.con1"), t("editor:chooser.llm.con2")],
      preview: "llm",
    },
  ];
}

/**
 * Minimal seed cedar so the draft validates on save. Real authoring
 * happens in the editor view; this body is replaced as soon as the
 * user types anything.
 */
function seedCedar(id: string): string {
  return `// @id("${id}")\nforbid (\n  principal,\n  action,\n  resource\n);`;
}

/** "새 정책" 이 이미 있으면 "새 정책 (1)", "새 정책 (2)" … 로 번호를 붙여 중복을
 *  피한다. 같은 이름이 여러 개 쌓여 구분이 안 되던 문제 해결. 첫 생성이면 base 그대로. */
function uniqueName(base: string, existing: Iterable<string>): string {
  const taken = new Set(existing);
  if (!taken.has(base)) return base;
  for (let i = 1; ; i++) {
    const candidate = `${base} (${i})`;
    if (!taken.has(candidate)) return candidate;
  }
}

interface ChooserProps {
  open: boolean;
  onClose: () => void;
}

export function NewPolicyChooser({ open, onClose }: ChooserProps) {
  const navigate = useNavigate();
  const { t } = useTranslation("editor");
  // 기존 정책 이름 목록(중복 회피용) — 리스트 페이지가 이미 캐시해 둔 쿼리를 공유.
  const overviewQ = useQuery({ queryKey: ["ps2-overview"], queryFn: getOverview });

  if (!open) return null;

  const cards = buildCards(t);

  // Do NOT persist here. We hand the editor an in-memory seed via navigation
  // state; nothing is written to storage until the user presses 저장. So a
  // policy the user abandons without saving simply never exists.
  const pick = (key: ChooserKey) => {
    // "llm" is not a stored method — it opens the editor's LLM tab on a
    // form-method draft (the LLM produces a form policy).
    const method: PolicyMethod = key === "cedar" ? "cedar" : "form";
    const initialTab = key === "llm" ? "llm" : undefined;
    const stamp = Date.now().toString(36);
    const slug = `new-${key}-${stamp}`;
    const id = dashboardId(slug);
    const existing = Object.values(overviewQ.data?.library.defs ?? {}).map((d) => d.displayName);
    const displayName = uniqueName(t("chooser.newPolicyName"), existing);
    onClose();
    navigate(`/editor/${encodeURIComponent(id)}`, {
      state: {
        newPolicy: { method, cedarText: seedCedar(slug), displayName, ...(initialTab ? { initialTab } : {}) },
      },
    });
  };

  return (
    <div className="ev2-modal-bd" role="dialog" aria-modal onClick={onClose}>
      <div className="ev2-mpc" onClick={(e) => e.stopPropagation()}>
        <div className="ev2-mpc-h">
          <div>
            <div className="t">{t("chooser.title")}</div>
            <div className="s">{t("chooser.subtitle")}</div>
          </div>
          <button
            type="button"
            className="ev2-mpc-x"
            onClick={onClose}
            aria-label={t("common:close")}
          >
            <XIcon />
          </button>
        </div>
        <div className="ev2-mpc-grid">
          {cards.map((c) => {
            const disabled = !!c.disabled;
            const cls = [
              "ev2-mpc-card",
              c.accent,
              c.disabled ? "is-disabled" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <button
                key={c.key}
                type="button"
                className={cls}
                disabled={disabled}
                onClick={() => pick(c.key)}
                title={c.disabled ? c.disabledNote : undefined}
              >
                <div className="ev2-mpc-card-top">
                  <span className="ev2-mpc-ic">
                    <ShieldIcon />
                  </span>
                  <span className="ev2-mpc-title">{c.title}</span>
                  {c.disabled && (
                    <span className="ev2-mpc-soon">{t("chooser.soon")}</span>
                  )}
                </div>
                <ChooserPreview kind={c.preview} />
                <div className="ev2-mpc-summary">{c.summary}</div>
                <div className="ev2-mpc-rec">
                  <span className="lbl">{t("chooser.recLabel")}</span>
                  {c.rec}
                </div>
                <div className="ev2-mpc-pc">
                  <ul className="pros">
                    {c.pros.map((p, i) => (
                      <li key={i}>
                        <CheckIcon />
                        {p}
                      </li>
                    ))}
                  </ul>
                  <ul className="cons">
                    {c.cons.map((p, i) => (
                      <li key={i}>
                        <XIcon />
                        {p}
                      </li>
                    ))}
                  </ul>
                </div>
                <span className="ev2-mpc-go">
                  {c.disabled ? c.disabledNote : t("chooser.start")}
                  {!c.disabled && <CaretRightIcon />}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ChooserPreview({ kind }: { kind: "form" | "cedar" | "llm" }) {
  if (kind === "llm") {
    return (
      <div className="ev2-mpc-prev llm">
        <div className="prompt">
          <span className="spark">✦</span>
          <span className="ln l1" />
          <span className="ln l2" />
        </div>
        <div className="arrow">↓</div>
        <div className="row">
          <span className="cap" />
          <span className="fld" />
          <span className="op">&gt;</span>
          <span className="val">150</span>
        </div>
      </div>
    );
  }
  if (kind === "form") {
    return (
      <div className="ev2-mpc-prev form">
        <div className="row">
          <span className="cap" />
          <span className="fld" />
          <span className="op">&gt;</span>
          <span className="val">150</span>
        </div>
        <div className="and">AND</div>
        <div className="row">
          <span className="cap" />
          <span className="fld w2" />
          <span className="op">≠</span>
          <span className="val ref">self</span>
        </div>
      </div>
    );
  }
  return (
    <div className="ev2-mpc-prev cedar">
      <div className="ln">
        <span className="g" />
        <span className="t kw" />
      </div>
      <div className="ln">
        <span className="g" />
        <span className="t" />
      </div>
      <div className="ln">
        <span className="g" />
        <span className="t guard" />
      </div>
      <div className="ln">
        <span className="g" />
        <span className="t s" />
      </div>
    </div>
  );
}
