/** 적용 현황 매트릭스의 파생 계산 — 렌더와 분리된 순수 함수. */
import type { StoreSnapshot } from "../../../server-api/policy-store";

export interface MatrixRow {
  address: string;
  label?: string | undefined;
}
export interface MatrixCol {
  id: string;
  displayName: string;
}
export interface MatrixCell {
  total: number;
  /** binding.enabled 수 — 패키지 토글과 무관한 개별 토글 카운트. */
  activeBindings: number;
  packageOn: boolean;
  bindingIds: string[];
}
export interface Matrix {
  rows: MatrixRow[];
  cols: MatrixCol[];
  cellOf(address: string, packageId: string): MatrixCell;
}

export function deriveMatrix(
  snap: StoreSnapshot,
  serverWallets: { address: string; label?: string | undefined }[],
): Matrix {
  const labels = new Map(serverWallets.map((w) => [w.address.toLowerCase(), w.label]));
  const addrs = new Set([
    ...Object.keys(snap.wallets.byAddress),
    ...serverWallets.map((w) => w.address.toLowerCase()),
  ]);
  const rows: MatrixRow[] = [...addrs].sort().map((address) => ({ address, label: labels.get(address) }));
  const cols: MatrixCol[] = Object.values(snap.library.packages)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((p) => ({ id: p.id, displayName: p.displayName }));

  const cellOf = (address: string, packageId: string): MatrixCell => {
    const w = snap.wallets.byAddress[address.toLowerCase()];
    const members = w ? Object.values(w.bindings).filter((b) => b.packageId === packageId) : [];
    return {
      total: members.length,
      activeBindings: members.filter((b) => b.enabled).length,
      packageOn: w ? (w.packageEnabled[packageId] ?? true) : true,
      bindingIds: members.map((b) => b.id).sort(),
    };
  };
  return { rows, cols, cellOf };
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
 *  없으면 꺼진 것으로 보여준다("정책이 다 꺼지면 토글도 꺼져 보이길").
 *  켜기 동작은 게이트 on + (전부 꺼져 있었다면) 멤버 일괄 on. */
export function packageDisplayOn(packageOn: boolean, activeBindings: number): boolean {
  return packageOn && activeBindings > 0;
}
