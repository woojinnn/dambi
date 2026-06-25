/**
 * 서버 지갑이 ps2 스토어에 아직 없으면 프로비저닝(멱등).
 *
 * 첫 로그인 직후에는 서버에 지갑이 있어도 ps2 per-wallet 상태(바인딩/패키지)가
 * 없다 — 이 훅이 없는 화면을 먼저 열면 폴더가 비어 보인다(홈에서 패키지가 안
 * 뜨고 에디터를 한 번 들렀다 와야 생기던 버그). 홈/에디터 양쪽이 같은 훅을
 * 쓴다. 주소별로 이미 시도한 항목만 dedupe하고, 새 지갑이 추가되면 같은 화면
 * 세션에서도 다시 프로비저닝한다.
 */
import { useEffect, useRef } from "react";

import {
  provisionWallets,
  type StoreSnapshot,
} from "../server-api/policy-store";

export function useProvisionWallets(
  /** 서버 지갑 주소 목록 — 쿼리가 아직 안 끝났으면 null (빈 배열과 구분). */
  serverAddresses: string[] | null,
  snap: StoreSnapshot | null,
  invalidate: () => void,
): void {
  const attempted = useRef(new Set<string>());
  useEffect(() => {
    if (!serverAddresses || !snap) return;
    const known = snap.wallets.byAddress;
    const missing = serverAddresses
      .map((a) => a.toLowerCase())
      .filter((a) => !known[a] && !attempted.current.has(a));
    if (missing.length === 0) return;
    for (const address of missing) attempted.current.add(address);
    void provisionWallets(missing)
      .then(invalidate)
      .catch((err) => {
        for (const address of missing) attempted.current.delete(address);
        console.warn("[ps2] provisioning failed:", err);
      });
    // invalidate는 호출측 인라인 콜백일 수 있다 — ref 가드가 재실행을 막는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverAddresses, snap]);
}
