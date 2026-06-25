/**
 * DEEP 차트 팔레트 (frozen 핸드오프 07 데이터 시각화) — "무지개색 없음".
 * 범주형(categorical)은 navy/lemon/red/stone 4계열을 명도로 확장(앞 5색이 가장 잘 구분),
 * 순서형(sequential)은 navy 명도 5단. ★코인/체인 브랜드 로고색이 아니라 차트 '세그먼트' 색에만 사용.
 */
export const CHART_CATEGORICAL: string[] = [
  "#6F91B8", // navy-300
  "#F0DB7F", // lemon-300
  "#E4948B", // red-300
  "#AEB6C2", // stone-300
  "#B6C5D8", // navy-200
  "#294970", // navy-400 (확장 6→10)
  "#E7C637", // lemon-400
  "#D55649", // red-400
  "#7F8C9E", // stone-400
  "#DCE2EA", // navy-100
];

export const CHART_SEQUENTIAL: string[] = [
  "#DCE2EA", // navy-100
  "#B6C5D8", // navy-200
  "#6F91B8", // navy-300
  "#294970", // navy-400
  "#06203F", // navy-500
];

/** 범주형 색 — 인덱스 순환(앞에서부터 가장 잘 구분). */
export function catColor(i: number): string {
  const n = CHART_CATEGORICAL.length;
  return CHART_CATEGORICAL[((i % n) + n) % n];
}

/** 순서형 색 — 0..N-1 클램프(낮음→높음 = navy 옅음→진함). */
export function seqColor(i: number): string {
  return CHART_SEQUENTIAL[Math.max(0, Math.min(CHART_SEQUENTIAL.length - 1, i))];
}

/** 키(체인·토큰·지갑 등)를 안정적으로 범주형 색에 배정. */
export function catColorForKey(key: string): string {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return catColor(h % CHART_CATEGORICAL.length);
}
