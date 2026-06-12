/**
 * 게시 전 조건 트리 미리보기 — "어느 조건의 어느 값이 가려지는가"의 시각화.
 *
 * 폼 에디터와 같은 파이프라인(textToBlocks → irToForm)으로 만든 **읽기 전용**
 * 트리에, 비식별 칸(extractHoles 결과)을 배지로 표시한다. 배지 클릭 =
 * 비우기/공개 토글 — Step1의 행 토글과 같은 kept 상태를 공유한다.
 * 폼 비호환 정책(irToForm 실패)은 안내 문구로 폴백 — Cedar 원문이 그대로
 * 게시된다는 사실은 변하지 않는다.
 */
import { useEffect, useState } from "react";

import { textToBlocks } from "../../cedar";
import {
  irToForm,
  isGroupNode,
  KNOWN_ACTIONS,
  type FormCondition,
  type FormModel,
  type FormNode,
  type FormOp,
  type FormValue,
} from "../../cedar/form";
import { getGloss } from "../../editor-v9/gloss/paths";
import type { PublishHole } from "./publish-redact";

const OP_LABEL: Record<FormOp, string> = {
  "==": "=",
  "!=": "≠",
  "<": "<",
  "<=": "≤",
  ">": ">",
  ">=": "≥",
  contains: "포함",
  notContains: "포함 안 함",
  in: "∈",
  notIn: "∉",
};

function kindMatches(value: FormValue, kind: PublishHole["kind"]): boolean {
  if (kind === "address") {
    return (
      value.kind === "set" ||
      (value.kind === "string" && /^0x[0-9a-fA-F]{40}$/.test(value.value))
    );
  }
  return value.kind === "long" || value.kind === "decimal";
}

/**
 * 노드 순회 순서대로, 같은 fieldPath + 맞는 값 종류의 첫 미배정 hole을 leaf에
 * 배정한다 (computeShippedHoles의 claimed 패턴과 같은 사상 — 같은 path의
 * hole 여러 개가 출현 순서대로 서로 다른 leaf에 붙는다).
 */
export function holeAssignments(
  model: FormModel,
  holes: PublishHole[],
): Map<FormCondition, PublishHole> {
  const out = new Map<FormCondition, PublishHole>();
  const claimed = new Set<string>();
  const visit = (nodes: FormNode[]) => {
    for (const n of nodes) {
      if (isGroupNode(n)) {
        visit(n.conds);
        continue;
      }
      const h = holes.find(
        (x) => !claimed.has(x.key) && x.path === n.fieldPath && kindMatches(n.value, x.kind),
      );
      if (h) {
        claimed.add(h.key);
        out.set(n, h);
      }
    }
  };
  visit(model.when);
  visit(model.unless);
  return out;
}

function fieldLabel(path: string): string {
  return getGloss(path)?.ko ?? path.split(".").pop() ?? path;
}

function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function valueText(v: FormValue): string {
  switch (v.kind) {
    case "bool":
      return v.value ? "참" : "거짓";
    case "long":
      return String(v.value);
    case "decimal":
      return v.value;
    case "string":
      return /^0x[0-9a-fA-F]{40}$/.test(v.value) ? shortAddr(v.value) : v.value;
    case "set":
      return v.values.map((x) => (/^0x[0-9a-fA-F]{40}$/.test(x) ? shortAddr(x) : x)).join(", ");
    case "field":
      return fieldLabel(v.path);
  }
}

function triggerText(model: FormModel): string {
  if (model.trigger.kind === "any") return "모든 액션";
  const t = model.trigger;
  const known = KNOWN_ACTIONS.find((a) => a.entityType === t.entityType && a.id === t.id);
  return known?.label ?? t.id;
}

export function PublishPreviewTree(props: {
  cedarText: string;
  holes: PublishHole[];
  kept: Set<string>;
  onToggleKeep: (key: string) => void;
}) {
  const { cedarText, holes, kept, onToggleKeep } = props;
  const [model, setModel] = useState<FormModel | null | "loading">("loading");

  useEffect(() => {
    let alive = true;
    setModel("loading");
    textToBlocks(cedarText)
      .then((irs) => {
        if (!alive) return;
        const ir = irs[0];
        setModel(ir ? irToForm(ir) : null);
      })
      .catch(() => alive && setModel(null));
    return () => {
      alive = false;
    };
  }, [cedarText]);

  if (model === "loading") return <div className="pub-tree-muted">조건 불러오는 중…</div>;
  if (!model) {
    return (
      <div className="pub-tree-muted">
        폼 미리보기를 지원하지 않는 정책이에요 — Cedar 원문이 그대로 게시됩니다.
      </div>
    );
  }

  const assigned = holeAssignments(model, holes);

  const renderValue = (leaf: FormCondition) => {
    const h = assigned.get(leaf);
    if (!h) return <span className="pub-tree-val">{valueText(leaf.value)}</span>;
    const isKept = kept.has(h.key);
    return (
      <button
        type="button"
        className={`pub-tree-hole${isKept ? " public" : ""}`}
        title={
          isKept
            ? "이 값이 마켓에 그대로 공개됩니다 — 클릭해서 비우기"
            : `게시 시 비워지고 설치자가 채웁니다 (${h.paramName}) — 클릭해서 값 공개`
        }
        onClick={() => onToggleKeep(h.key)}
      >
        <span className={isKept ? "" : "strike"}>{valueText(leaf.value)}</span>
        <span className="tag">{isKept ? "공개" : h.paramName}</span>
      </button>
    );
  };

  const renderNodes = (nodes: FormNode[]) =>
    nodes.map((n, i) =>
      isGroupNode(n) ? (
        <div key={i} className="pub-tree-grouprow">
          {i > 0 && <span className="pub-tree-joiner">{n.joiner === "or" ? "또는" : "그리고"}</span>}
          <div className="pub-tree-group">{renderNodes(n.conds)}</div>
        </div>
      ) : (
        <div key={i} className="pub-tree-row">
          {i > 0 && <span className="pub-tree-joiner">{n.joiner === "or" ? "또는" : "그리고"}</span>}
          <span className="pub-tree-field">
            {fieldLabel(n.fieldPath)} <code>{n.fieldPath}</code>
          </span>
          <span className="pub-tree-op">{OP_LABEL[n.op]}</span>
          {renderValue(n)}
        </div>
      ),
    );

  return (
    <div className="pub-tree">
      <div className="pub-tree-sec">
        <span className="pub-tree-sech">대상</span>
        <span className="pub-tree-trigger">{triggerText(model)}</span>
      </div>
      {model.when.length > 0 && (
        <div className="pub-tree-sec">
          <span className="pub-tree-sech">조건</span>
          <div className="pub-tree-list">{renderNodes(model.when)}</div>
        </div>
      )}
      {model.unless.length > 0 && (
        <div className="pub-tree-sec">
          <span className="pub-tree-sech">단, 제외</span>
          <div className="pub-tree-list">{renderNodes(model.unless)}</div>
        </div>
      )}
    </div>
  );
}
