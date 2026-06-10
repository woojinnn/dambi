/** 지갑별 정책 화면의 파생 계산 — 렌더와 분리된 순수 함수. */
import type { StoreSnapshot } from "../../../server-api/policy-store";

export interface WalletRow {
  address: string;
  label?: string | undefined;
}

/** 지갑 선택 목록 = ps2 스토어의 지갑 ∪ 서버 지갑(소문자 주소, 서버 라벨). */
export function deriveWalletRows(
  snap: StoreSnapshot,
  serverWallets: { address: string; label?: string | undefined }[],
): WalletRow[] {
  const labels = new Map(serverWallets.map((w) => [w.address.toLowerCase(), w.label]));
  const addrs = new Set([
    ...Object.keys(snap.wallets.byAddress),
    ...serverWallets.map((w) => w.address.toLowerCase()),
  ]);
  return [...addrs].sort().map((address) => ({ address, label: labels.get(address) }));
}

/** 라이브러리 탭의 "적용 지갑 수" — def가 바인딩된 서로 다른 지갑 수. */
export function defUsageCount(snap: StoreSnapshot, defId: string): number {
  let n = 0;
  for (const w of Object.values(snap.wallets.byAddress)) {
    if (Object.values(w.bindings).some((b) => b.defId === defId)) n += 1;
  }
  return n;
}

/** 하이브리드 패키지 토글의 표시 상태 — 게이트가 켜져 있어도 활성 멤버가
 *  없으면 꺼진 것으로 보여준다. 켜기 동작은 게이트 on + (전부 꺼져 있었다면)
 *  멤버 일괄 on. */
export function packageDisplayOn(packageOn: boolean, activeBindings: number): boolean {
  return packageOn && activeBindings > 0;
}
