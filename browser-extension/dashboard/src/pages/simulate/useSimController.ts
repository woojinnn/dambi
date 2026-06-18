/**
 * The /simulation wizard controller — owns ALL shared state + actions across
 * the 4 steps, so navigating back/forward keeps data. All source data is read
 * through the injected {@link SimProvider} (the live `realProvider`), so the
 * step UI never touches the backend directly.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { bindingKey, type SimData, type SimProvider } from "./provider";
import type {
  DenyView,
  PackageView,
  PolicyView,
  RunResult,
  TxRow,
  WalletStateView,
  WalletView,
  WizardStep,
} from "./types";

/** `Record<addr, string[]>` → `Record<addr, Set<string>>` (enabled-ids seed). */
function toSetMap(m: Record<string, string[]>): Record<string, Set<string>> {
  const out: Record<string, Set<string>> = {};
  for (const [addr, ids] of Object.entries(m)) out[addr] = new Set(ids);
  return out;
}

/** Which state widget(s) a policy concerns, inferred from its action + name.
 *  Approval/permit → 승인; perp/leverage → 포지션; swap/transfer/token → 토큰.
 *  Unclassifiable policies default to 토큰 (the broadest surface). */
function widgetsOfPolicy(p: PolicyView): string[] {
  const hay = `${p.action} ${p.name}`.toLowerCase();
  const out = new Set<string>();
  if (/approv|permit|allowance/.test(hay)) out.add("approvals");
  if (/perp|leverage|margin|position|hyperliquid|order/.test(hay)) out.add("positions");
  if (/swap|transfer|amm|erc20|send|token|bridge|burn|recipient/.test(hay)) out.add("tokens");
  if (out.size === 0) out.add("tokens");
  return [...out];
}

/** Tri-state for a package toggle (all on / some on / all off). */
export type PkgState = "on" | "partial" | "off";

export interface SimController {
  // ── wizard nav ──
  step: WizardStep;
  goTo: (s: WizardStep) => void;
  next: () => void;
  back: () => void;
  canAdvance: boolean;

  // ── step 1: wallets + state ──
  wallets: WalletView[];
  selected: Set<string>;
  toggleWallet: (addr: string) => void;
  chain: string;
  setChain: (c: string) => void;
  /** s0 state for each selected wallet, in selection order. */
  selectedStates: WalletStateView[];
  /** s0 state for EVERY wallet (the step-1 card grid shows all wallets). */
  statesByAddr: Record<string, WalletStateView>;

  // ── step 2: policies (managed PER WALLET) ──
  policies: PolicyView[];
  packages: PackageView[];
  /** The wallet whose policy on/off set step 2 is currently editing. Always
   *  one of the selected wallets. */
  activeWallet: string;
  setActiveWallet: (addr: string) => void;
  /** The active wallet's s0 state (drives the step-2 relevance aside). */
  activeState: WalletStateView | null;
  /** Effective policy ids (checkbox AND package gate) for the active wallet. */
  enabled: Set<string>;
  /** How many policies are effective for a given wallet (switcher chips). */
  enabledCount: (addr: string) => number;
  /** Whether a policy's checkbox is on within its package (per-binding). */
  isPolicyOn: (packageId: string, defId: string) => boolean;
  /** Flip one policy's checkbox within a package. */
  togglePolicy: (packageId: string, defId: string) => void;
  /** Flip a package's gate (on/off). Does not touch the checkboxes. */
  togglePackage: (id: string) => void;
  packageState: (id: string) => PkgState;
  /** Policies scoped to the active wallet (`walletAddress` === active). */
  walletRelatedPolicies: PolicyView[];
  /** Token symbols any enabled policy references (∅ = no token filter). */
  relevantTokens: Set<string>;
  isTokenRelevant: (symbol: string) => boolean;
  /** Protocols any enabled policy references (∅ = no protocol filter). */
  relevantProtocols: Set<string>;
  isProtocolRelevant: (protocol: string) => boolean;
  /** State categories (widgets) the enabled policies concern, by action/domain
   *  (approval policy → approvals; swap/transfer → tokens; perp → positions). */
  relevantWidgets: Set<string>;
  isWidgetRelevant: (key: string) => boolean;
  /** True when ≥1 policy is enabled — the state view then narrows to relevance. */
  hasRelevanceFilter: boolean;

  // ── step 3: tx queue ──
  txRows: TxRow[];
  setTxRows: (rows: TxRow[]) => void;
  addRow: () => void;
  /** 예시 트랜잭션 한 줄을 채워 넣는다(무제한 ERC-20 승인 — 기본 정책이 잡는 케이스). */
  addExampleRow: () => void;
  removeRow: (id: string) => void;
  updateRow: (id: string, patch: Partial<TxRow>) => void;

  // ── step 4: results ──
  run: () => void;
  running: boolean;
  result: RunResult | null;
  cursorIdx: number;
  setCursorIdx: (i: number) => void;
  /** Denies accumulated across steps 1..cursor (dedup by policy, earliest step). */
  cumulativeDenies: (cursor: number) => DenyView[];
}

export function useSimController(provider: SimProvider): SimController {
  const { t } = useTranslation("simulation");
  // Provider-sourced data: seeded synchronously from `initial()` (fixtures for
  // mock, empty shells for real) and refreshed async via `load()`.
  const init = useMemo<SimData>(() => provider.initial(), [provider]);
  const [data, setData] = useState<SimData>(init);
  useEffect(() => {
    let live = true;
    void provider.load().then((d) => {
      if (live) setData(d);
    });
    return () => {
      live = false;
    };
  }, [provider]);

  const [step, setStep] = useState<WizardStep>(1);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(init.wallets[0] ? [init.wallets[0].address] : []),
  );
  const [chain, setChain] = useState("eip155:1");
  // Per wallet, two INDEPENDENT axes (mirrors ps2): the policy checkbox set
  // (binding keys `pkgId::defId` that are checked) and the package-gate set
  // (package ids whose toggle is on). A policy is effective only when its
  // checkbox is on AND its package gate is on.
  const [checkedByWallet, setCheckedByWallet] = useState<Record<string, Set<string>>>(
    () => toSetMap(init.policyEnabledByWallet),
  );
  const [pkgOnByWallet, setPkgOnByWallet] = useState<Record<string, Set<string>>>(
    () => toSetMap(init.packageEnabledByWallet),
  );
  const [activeWalletRaw, setActiveWalletRaw] = useState<string>(init.wallets[0]?.address ?? "");
  const [txRows, setTxRowsState] = useState<TxRow[]>(init.txRows);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [cursorIdx, setCursorIdx] = useState(0);

  // First time real data arrives (initial() was empty), seed the user-mutable
  // selection / enabled-set / tx-queue from it. A mock provider seeds via the
  // synchronous initializers above, so this is a no-op there.
  const seededRef = useRef(init.wallets.length > 0);
  useEffect(() => {
    if (seededRef.current || data.wallets.length === 0) return;
    seededRef.current = true;
    setSelected(new Set([data.wallets[0].address]));
    setActiveWalletRaw(data.wallets[0].address);
    setCheckedByWallet(toSetMap(data.policyEnabledByWallet));
    setPkgOnByWallet(toSetMap(data.packageEnabledByWallet));
    setTxRowsState(data.txRows);
  }, [data]);

  // ── nav ──
  const goTo = useCallback((s: WizardStep) => setStep(s), []);
  const next = useCallback(() => setStep((s) => (s < 4 ? ((s + 1) as WizardStep) : s)), []);
  const back = useCallback(() => setStep((s) => (s > 1 ? ((s - 1) as WizardStep) : s)), []);
  const canAdvance = useMemo(() => {
    if (step === 1) return selected.size > 0;
    if (step === 3) return txRows.length > 0 && txRows.every((r) => r.fromWallet.trim() !== "");
    return true;
  }, [step, selected, txRows]);

  // ── step 1 ──
  const toggleWallet = useCallback((addr: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(addr)) n.delete(addr);
      else n.add(addr);
      return n;
    });
  }, []);
  const selectedStates = useMemo(
    () =>
      data.wallets
        .filter((w) => selected.has(w.address))
        .map((w) => data.statesByAddr[w.address])
        .filter(Boolean),
    [selected, data],
  );

  // ── step 2 (per-wallet policy on/off) ──
  // activeWallet is clamped to the current selection so it can never go stale
  // when wallets are toggled off in step 1.
  const activeWallet = useMemo(
    () => (selected.has(activeWalletRaw) ? activeWalletRaw : ([...selected][0] ?? activeWalletRaw)),
    [selected, activeWalletRaw],
  );
  const setActiveWallet = useCallback((addr: string) => setActiveWalletRaw(addr), []);

  // The active wallet's own packages (each wallet shows only its packages).
  const activePackages = useMemo(
    () => data.packagesByWallet[activeWallet] ?? [],
    [data.packagesByWallet, activeWallet],
  );

  // Enumerate a wallet's bindings = (package, policy) pairs from its packages.
  const bindingsOf = useCallback(
    (addr: string): { pkgId: string; defId: string }[] =>
      (data.packagesByWallet[addr] ?? []).flatMap((pkg) =>
        pkg.policyIds.map((defId) => ({ pkgId: pkg.id, defId })),
      ),
    [data.packagesByWallet],
  );
  // Effective = checkbox on AND package gate on (mirrors ps2 isEffectiveOn).
  const effectiveDefIds = useCallback(
    (addr: string): Set<string> => {
      const ch = checkedByWallet[addr] ?? new Set<string>();
      const pg = pkgOnByWallet[addr] ?? new Set<string>();
      const ids = new Set<string>();
      for (const { pkgId, defId } of bindingsOf(addr))
        if (pg.has(pkgId) && ch.has(bindingKey(pkgId, defId))) ids.add(defId);
      return ids;
    },
    [checkedByWallet, pkgOnByWallet, bindingsOf],
  );
  /** Effective policy DEFIDs of the active wallet (drives relevance + run). */
  const enabled = useMemo(() => effectiveDefIds(activeWallet), [effectiveDefIds, activeWallet]);
  const enabledCount = useCallback((addr: string) => effectiveDefIds(addr).size, [effectiveDefIds]);

  const checked = useMemo(
    () => checkedByWallet[activeWallet] ?? new Set<string>(),
    [checkedByWallet, activeWallet],
  );
  const pkgOn = useMemo(() => pkgOnByWallet[activeWallet] ?? new Set<string>(), [pkgOnByWallet, activeWallet]);

  /** Is this policy's checkbox on, within this package (per-binding)? */
  const isPolicyOn = useCallback(
    (packageId: string, defId: string): boolean => checked.has(bindingKey(packageId, defId)),
    [checked],
  );
  const togglePolicy = useCallback(
    (packageId: string, defId: string) => {
      const key = bindingKey(packageId, defId);
      setCheckedByWallet((prev) => {
        const cur = new Set(prev[activeWallet] ?? []);
        if (cur.has(key)) cur.delete(key);
        else cur.add(key);
        return { ...prev, [activeWallet]: cur };
      });
    },
    [activeWallet],
  );
  // Package toggle = the gate only (binary). It does NOT touch the checkboxes;
  // a policy turns on when its checkbox AND this gate are both on.
  const packageState = useCallback((id: string): PkgState => (pkgOn.has(id) ? "on" : "off"), [pkgOn]);
  const togglePackage = useCallback(
    (id: string) => {
      setPkgOnByWallet((prev) => {
        const cur = new Set(prev[activeWallet] ?? []);
        if (cur.has(id)) cur.delete(id);
        else cur.add(id);
        return { ...prev, [activeWallet]: cur };
      });
    },
    [activeWallet],
  );
  const activeState = useMemo(() => data.statesByAddr[activeWallet] ?? null, [activeWallet, data.statesByAddr]);
  const walletRelatedPolicies = useMemo(
    () => data.policies.filter((p) => p.walletAddress === activeWallet),
    [activeWallet, data.policies],
  );
  const relevantTokens = useMemo(() => {
    const s = new Set<string>();
    for (const p of data.policies) if (enabled.has(p.id)) for (const t of p.tokens) s.add(t);
    return s;
  }, [enabled, data.policies]);
  const relevantProtocols = useMemo(() => {
    const s = new Set<string>();
    for (const p of data.policies) if (enabled.has(p.id)) for (const pr of p.protocols) s.add(pr);
    return s;
  }, [enabled, data.policies]);
  const isTokenRelevant = useCallback(
    (symbol: string) => relevantTokens.size === 0 || relevantTokens.has(symbol),
    [relevantTokens],
  );
  const isProtocolRelevant = useCallback(
    (protocol: string) => relevantProtocols.size === 0 || relevantProtocols.has(protocol),
    [relevantProtocols],
  );
  const relevantWidgets = useMemo(() => {
    const s = new Set<string>();
    for (const p of data.policies) if (enabled.has(p.id)) for (const w of widgetsOfPolicy(p)) s.add(w);
    return s;
  }, [enabled, data.policies]);
  const isWidgetRelevant = useCallback(
    (key: string) => relevantWidgets.size === 0 || relevantWidgets.has(key),
    [relevantWidgets],
  );
  // The state view narrows whenever ≥1 policy is enabled (widget-level), even if
  // no specific token/protocol is named.
  const hasRelevanceFilter = enabled.size > 0;

  // ── step 3 ──
  const setTxRows = useCallback((rows: TxRow[]) => setTxRowsState(rows), []);
  const addRow = useCallback(() => {
    setTxRowsState((rows) => [
      ...rows,
      {
        id: `tx-${rows.length + 1}-${rows.length}`,
        label: t("wizard.txLabel", { n: rows.length + 1 }),
        fromWallet: [...selected][0] ?? "",
        to: "",
        calldata: "",
        value: "0",
      },
    ]);
  }, [selected, t]);
  // 예시: USDC(0xA0b8…eB48)에 무제한 approve(0x095ea7b3, spender + uint256 max).
  // 흔한 위험 패턴이라 기본 안전팩의 "무제한 승인" 정책이 바로 잡아 데모하기 좋다.
  const addExampleRow = useCallback(() => {
    setTxRowsState((rows) => [
      ...rows,
      {
        id: `tx-ex-${rows.length + 1}-${rows.length}`,
        label: t("wizard.step3.exampleLabel"),
        fromWallet: [...selected][0] ?? "",
        to: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        calldata:
          "0x095ea7b3" +
          "0000000000000000000000001111111111111111111111111111111111111111" +
          "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        value: "0",
      },
    ]);
  }, [selected, t]);
  const removeRow = useCallback((id: string) => setTxRowsState((rows) => rows.filter((r) => r.id !== id)), []);
  const updateRow = useCallback(
    (id: string, patch: Partial<TxRow>) =>
      setTxRowsState((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r))),
    [],
  );

  // ── step 4: run via the provider (mock fixtures / real sim-bridge) ──
  const run = useCallback(() => {
    setRunning(true);
    setResult(null);
    void provider
      .run({
        selected: [...selected],
        chain,
        // Active policies per wallet = effective (checkbox AND package gate).
        enabledByWallet: Object.fromEntries([...selected].map((addr) => [addr, [...effectiveDefIds(addr)]])),
        txRows,
        statesByAddr: data.statesByAddr,
      })
      .then((res) => {
        setResult(res);
        // Land the cursor on the first failing step (like the real page does).
        const firstBad = res.steps.findIndex((s) => s.verdict !== "pass");
        setCursorIdx(firstBad >= 0 ? firstBad + 1 : res.steps.length);
      })
      .finally(() => setRunning(false));
  }, [provider, selected, chain, effectiveDefIds, txRows, data.statesByAddr]);
  const cumulativeDenies = useCallback(
    (cursor: number): DenyView[] => {
      if (!result) return [];
      const byPolicy = new Map<string, DenyView>();
      for (const s of result.steps) {
        if (s.index > cursor) break;
        for (const d of s.denies) if (!byPolicy.has(d.policyId)) byPolicy.set(d.policyId, d);
      }
      return [...byPolicy.values()];
    },
    [result],
  );

  return {
    step, goTo, next, back, canAdvance,
    wallets: data.wallets, selected, toggleWallet, chain, setChain, selectedStates,
    statesByAddr: data.statesByAddr,
    policies: data.policies, packages: activePackages,
    activeWallet, setActiveWallet, activeState, enabled, enabledCount,
    isPolicyOn, togglePolicy, togglePackage, packageState,
    walletRelatedPolicies, relevantTokens, isTokenRelevant,
    relevantProtocols, isProtocolRelevant, relevantWidgets, isWidgetRelevant, hasRelevanceFilter,
    txRows, setTxRows, addRow, addExampleRow, removeRow, updateRow,
    run, running, result, cursorIdx, setCursorIdx, cumulativeDenies,
  };
}
