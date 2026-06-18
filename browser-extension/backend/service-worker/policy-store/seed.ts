/** builtin 시드 + 구(v1) 키 정리.
 *
 *  day1-safety baked 정책(`default-policies/policy-set-v2.json`)을 wasm
 *  text→EST→BlockIR 역변환으로 builtin 정의 + "기본 안전팩" 패키지로 흡수한다.
 *  baked의 "항상 평가" 특례는 resolve의 미등록-지갑 default 경로가 대체한다. */
import Browser from "webextension-polyfill";

import { estToBlocks } from "../../../sdk/block-ir/estToBlocks";
import type { EstPolicy } from "../../../sdk/block-ir/est";
import { policyTextToEst } from "../wasm-bridge";
import { mutate, readStore } from "./store";
import type { PolicyDef } from "./types";

export const BUILTIN_PKG = "pkg::builtin.day1-safety";

/** builtin 정책의 한글 제목(displayName) — baked 세트엔 제목이 없어 여기서 부여한다.
 *  키는 정책 id(`def::builtin.<id>`의 <id> 부분). 매핑에 없으면 id를 그대로 쓴다. */
const BUILTIN_TITLES: Record<string, string> = {
  "unlimited-approval-deny": "무제한 토큰 승인 경고",
  "send-first-time-or-burn-recipient-warn": "소각주소로 전송 차단",
  "unknown-blind-sign-warning": "정체불명 블라인드 서명 경고",
  "permit2-sign-allowance-confirm": "Permit2 허용량 서명 경고",
  "swap-recipient-not-self-deny": "스왑 수령처 본인 외 차단",
};
const titleFor = (id: string): string => BUILTIN_TITLES[id] ?? id;
/** `def::builtin.<id>` → `<id>` (제목 매핑 키). */
const builtinIdOf = (defId: string): string => defId.replace(/^def::builtin\./, "");

/** builtin 시드 버전 — 제목/심각도 등 builtin 정의가 바뀌면 올린다. 기존 사용자는
 *  버전이 다르면 재시드(같은 def id로 다시 심어 바인딩은 유지하고 내용만 갱신). */
const BUILTIN_SEED_VERSION = 3;
const seedVerKey = (uid: string): string => `ps2-builtin-seed-version:${uid}`;

/** 계정당 한 번만 시드 (SW 수명 내 캐시 + 버전 비교로 멱등). */
const seededUids = new Set<string>();

export function clearSeedCache(): void {
  seededUids.clear();
}

/** baked 세트(policy-set-v2.json)를 text→EST→BlockIR 로 풀어 builtin 정의 배열로. */
async function buildBuiltinDefs(): Promise<PolicyDef[]> {
  const res = await fetch(Browser.runtime.getURL("default-policies/policy-set-v2.json"));
  if (!res.ok) throw new Error(`baked set fetch failed: HTTP ${res.status}`);
  const baked = JSON.parse(await res.text()) as { id: string; policy: string; manifest?: unknown }[];

  const defs: PolicyDef[] = [];
  for (const b of baked) {
    try {
      const parsed = JSON.parse(await policyTextToEst(b.policy)) as {
        ok: boolean;
        policies?: { id: string; est: unknown }[];
      };
      if (!parsed.ok || !parsed.policies?.[0]) throw new Error("text→EST 변환 실패");
      const ir = estToBlocks(parsed.policies[0].est as EstPolicy, null);
      defs.push({
        id: `def::builtin.${b.id.replace(/[^A-Za-z0-9_.-]/g, "-")}`,
        displayName: titleFor(b.id),
        skeleton: { ir, manifest: b.manifest },
        holes: [],
        defaults: { enabled: true, params: {}, packageId: BUILTIN_PKG },
        source: "builtin",
        updatedAtMs: Date.now(),
      });
    } catch (err) {
      // 손상 항목은 건너뜀 (best-effort) — 나머지 builtin 보호는 유지
      console.warn(`[Dambi] builtin 정책 시드 실패 — 건너뜀: ${b.id}`, err);
    }
  }
  return defs;
}

export async function ensureSeeded(uid: string): Promise<void> {
  if (seededUids.has(uid)) return;
  const s = await readStore(uid);
  const hasBuiltin = Object.values(s.library.defs).some((d) => d.source === "builtin");
  const storedVer = (await Browser.storage.local.get(seedVerKey(uid)))[seedVerKey(uid)] as
    | number
    | undefined;

  if (hasBuiltin && storedVer === BUILTIN_SEED_VERSION) {
    // 최신 버전 — 재시드 없이 제목만 안전망으로 맞춘다(이름 바뀐 경우 1회 mutate).
    const needsTitle = Object.values(s.library.defs).some(
      (d) => d.source === "builtin" && d.displayName !== titleFor(builtinIdOf(d.id)),
    );
    if (needsTitle) {
      await mutate(uid, (d) => {
        for (const def of Object.values(d.library.defs)) {
          if (def.source === "builtin") def.displayName = titleFor(builtinIdOf(def.id));
        }
      });
    }
    seededUids.add(uid);
    return;
  }

  // 신규 OR 구버전 → (재)시드. 기존 builtin def 를 지우고 같은 id 로 다시 심으므로
  // 유지되는 정책의 바인딩은 그대로 살고, 세트에서 빠진 정책(예: sweep)을 가리키던
  // 바인딩은 정리한다. 내용(심각도/제목)도 갱신된다.
  const defs = await buildBuiltinDefs();
  const validBuiltinIds = new Set(defs.map((x) => x.id));
  await mutate(uid, (d) => {
    for (const id of Object.keys(d.library.defs)) {
      if (d.library.defs[id].source === "builtin") delete d.library.defs[id];
    }
    d.library.packages[BUILTIN_PKG] = {
      id: BUILTIN_PKG,
      displayName: "기본 안전팩",
      source: "builtin",
      updatedAtMs: Date.now(),
    };
    for (const def of defs) d.library.defs[def.id] = def;
    // 새 set 에 없는 builtin 정책을 참조하는 고아 바인딩 제거(예: 삭제된 sweep).
    for (const w of Object.values(d.wallets.byAddress)) {
      for (const bid of Object.keys(w.bindings)) {
        const ref = w.bindings[bid].defId;
        if (typeof ref === "string" && ref.startsWith("def::builtin.") && !validBuiltinIds.has(ref)) {
          delete w.bindings[bid];
        }
      }
    }
  });
  await Browser.storage.local.set({ [seedVerKey(uid)]: BUILTIN_SEED_VERSION });
  seededUids.add(uid);
}

const LEGACY_PREFIXES = ["dashboard:policies:", "dashboard:sets:", "policy-selection:", "migration:"];

/** v1 정책 스토리지 네임스페이스 제거 — 마이그레이션 없는 리셋(스펙 합의). */
export async function cleanupLegacyKeys(): Promise<void> {
  const all = (await Browser.storage.local.get(null)) as Record<string, unknown>;
  const doomed = Object.keys(all).filter((k) => LEGACY_PREFIXES.some((p) => k.startsWith(p)));
  if (doomed.length > 0) await Browser.storage.local.remove(doomed);
}
