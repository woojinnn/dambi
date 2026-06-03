/**
 * editor-v9 — Blockly Workspace mount, IR-backed.
 *
 * Replaces the prototype's direct workspace→cedar string conversion with the
 * cedar/blocks PolicyIR pipeline:
 *
 *   Workspace ──workspaceToIR──▶ PolicyIR[] ──blocksToText──▶ Cedar text
 *                                      │
 *                                      └─ validateIR()       (gates onChange)
 *
 * StrictMode-safe: React 18 dev mounts effects twice. We guard with
 * `wsRef.current` so the second pass re-uses the first inject.
 *
 * Phase A scope: the IR is only filled out for the skeleton block set
 * (policy_hat / scope_all / action_scope_all / cond_when / expr_lit_bool).
 * `blocksToText` therefore round-trips through the wasm bridge for the
 * trivially-shaped Cedar these blocks emit; later phases extend the renderer
 * with no Workspace changes required.
 */

import * as Blockly from "blockly";
import * as En from "blockly/msg/en";
import { useEffect, useMemo, useRef, useState } from "react";

import { registerBlocks } from "./blocks/register";
import { blocksToText } from "./bridge";
import { workspaceToIR } from "./mapping/workspaceToIR";
import { validateIR, type EditorError } from "./errors";
import { buildToolbox } from "./toolbox/build";
import { BLOCK_TYPES } from "./mapping/block-types";

Blockly.setLocale(En as unknown as Record<string, string>);

export interface WorkspaceV9Props {
  initialJson?: object | null;
  policyName?: string;
  locale?: "ko" | "en";
  onChange?: (next: { cedarText: string; json: object; errors: EditorError[] }) => void;
}

export function WorkspaceV9({
  initialJson,
  policyName = "untitled",
  locale = "ko",
  onChange,
}: WorkspaceV9Props) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<Blockly.WorkspaceSvg | null>(null);
  const [cedarText, setCedarText] = useState("");
  const [errors, setErrors] = useState<EditorError[]>([]);
  const [bridgeError, setBridgeError] = useState<string | null>(null);

  const toolbox = useMemo(() => buildToolbox(locale), [locale]);

  useEffect(() => {
    if (!mountRef.current) return;
    if (wsRef.current) return; // StrictMode 2nd mount — already inited.

    try {
      registerBlocks();
    } catch (e) {
      setBridgeError(`registerBlocks failed: ${String(e)}`);
      return;
    }

    let ws: Blockly.WorkspaceSvg;
    try {
      ws = Blockly.inject(mountRef.current, {
        toolbox: toolbox as unknown as Blockly.utils.toolbox.ToolboxDefinition,
        trashcan: true,
        scrollbars: true,
        zoom: { controls: true, wheel: true, startScale: 0.9, minScale: 0.4, maxScale: 2 },
        grid: { spacing: 20, length: 3, colour: "#E5E6E3", snap: true },
      });
    } catch (e) {
      setBridgeError(`Blockly.inject failed: ${String(e)}`);
      return;
    }
    wsRef.current = ws;

    // Seed: prefer a serialized workspace JSON when supplied (Phase D will
    // pass one parsed from the policy's stored tree). Otherwise drop a single
    // empty policy_hat so the user has something to grab.
    try {
      if (initialJson) {
        Blockly.serialization.workspaces.load(initialJson, ws);
      } else {
        const hat = ws.newBlock(BLOCK_TYPES.policy_hat);
        hat.initSvg();
        hat.render();
        hat.moveBy(50, 30);
      }
    } catch (e) {
      console.warn("[v9] workspace seed failed", e);
    }

    const recompute = async () => {
      // L2 — structural validation while building IR.
      const errs: EditorError[] = [];
      const policies = workspaceToIR(ws, errs);
      const head = policies[0] ?? null;
      const validated = validateIR(head, errs);

      // Capture early so an outstanding bridge call never overwrites a more
      // recent edit's state.
      const wsJson = Blockly.serialization.workspaces.save(ws);

      if (!validated.ok || !validated.ir) {
        setCedarText("");
        setErrors(validated.errors);
        setBridgeError(null);
        onChange?.({ cedarText: "", json: wsJson, errors: validated.errors });
        return;
      }

      // L3/L4 — IR→EST→Cedar via wasm bridge. blocksToEst throws on holes
      // (Phase E); est_json_to_policy_text throws on engine reject.
      try {
        const text = await blocksToText(validated.ir);
        setCedarText(text);
        setErrors([]);
        setBridgeError(null);
        onChange?.({ cedarText: text, json: wsJson, errors: [] });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setBridgeError(msg);
        setCedarText("");
        onChange?.({ cedarText: "", json: wsJson, errors: [{ kind: "cedar", message: msg }] });
      }
    };

    let debounce: ReturnType<typeof setTimeout> | null = null;
    const listener = (event: Blockly.Events.Abstract) => {
      if (event.isUiEvent) return;
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => void recompute(), 250);
    };
    ws.addChangeListener(listener);
    // Initial pass without debounce so the meta-row sees the seeded text.
    void recompute();

    requestAnimationFrame(() => Blockly.svgResize(ws));

    return () => {
      if (debounce) clearTimeout(debounce);
      ws.removeChangeListener(listener);
      ws.dispose();
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onResize = () => {
      if (wsRef.current) Blockly.svgResize(wsRef.current);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // `policyName` is kept in props for caller-compat (used by Phase D once
  // textToBlocks → workspace seeding lands). Touch it so tsc doesn't warn.
  void policyName;

  const errorCount = errors.length + (bridgeError ? 1 : 0);

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      height: "calc(100vh - 200px)",
      minHeight: 600,
      width: "100%",
    }}>
      <div style={{
        padding: "6px 12px",
        background: "var(--surface, #fff)",
        borderBottom: "1px solid var(--hairline-soft, #E5E6E3)",
        fontFamily: "var(--ff-mono, monospace)",
        fontSize: 11,
        color: "var(--slate-500, #475569)",
        display: "flex",
        gap: 12,
        alignItems: "center",
      }}>
        <span>Blockly v9 · 좌측 카테고리에서 블록을 끌어다 정책 트리에 붙이세요</span>
        {errorCount > 0 && (
          <span style={{ color: "var(--fail-700, #7F4740)" }}>
            ⚠ {errorCount}개 문제
          </span>
        )}
      </div>

      <div
        ref={mountRef}
        style={{
          flex: 1,
          width: "100%",
          minHeight: 500,
          height: 500,
          position: "relative",
          background: "#fafbfa",
        }}
      />

      <details style={{ background: "var(--fog-200, #fafaf9)", borderTop: "1px solid var(--hairline-soft, #E5E6E3)" }}>
        <summary style={{ padding: "6px 12px", cursor: "pointer", fontSize: 12, color: "var(--slate-500, #475569)" }}>
          Cedar 미리보기 ({cedarText.split("\n").length} 줄) {errorCount > 0 && `· ${errorCount}개 문제`}
        </summary>
        {errors.length > 0 && (
          <ul style={{ margin: 0, padding: "6px 24px", fontSize: 12, color: "var(--fail-700, #7F4740)" }}>
            {errors.map((e, i) => (
              <li key={i}>{e.message}</li>
            ))}
          </ul>
        )}
        {bridgeError && (
          <div style={{ padding: "6px 12px", fontSize: 12, color: "var(--fail-700, #7F4740)" }}>
            Cedar 변환 실패: {bridgeError}
          </div>
        )}
        <pre style={{
          margin: 0, padding: 12, fontSize: 12,
          fontFamily: "var(--ff-mono, monospace)",
          maxHeight: 200, overflow: "auto",
          background: "var(--fog-100, #fcfcfc)",
        }}>
          {cedarText || (errorCount > 0 ? "" : "(빈 정책)")}
        </pre>
      </details>
    </div>
  );
}
