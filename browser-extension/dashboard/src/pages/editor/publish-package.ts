/** 패키지 발행의 멤버 수집(순수) — 바인딩은 지갑별이므로 발행 단위로는
 *  defaults.packageId가 그 패키지인 defs가 "패키지 구성 정의"다. */
import type { PolicyDef } from "../../../../sdk/policy-store-types";

export function collectPackageMembers(
  defs: Record<string, PolicyDef>,
  packageId: string,
): PolicyDef[] {
  return Object.values(defs)
    .filter((d) => d.defaults.packageId === packageId)
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "ko"));
}
