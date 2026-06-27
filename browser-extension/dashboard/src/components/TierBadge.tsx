import { useQuery } from "@tanstack/react-query";

import { listTiers, type MarketTier, type PublisherTier } from "../server-api/market";

/** Tier definitions, cached for the whole session — drives publisher badges. */
export function useTiers() {
  return useQuery({
    queryKey: ["market-tiers-public"],
    queryFn: listTiers,
    // 짧은 staleTime + 마운트마다 재검증 — 관리자가 등급을 새로 만들거나(예:
    // BlackList) 색·라벨을 바꿔도 배지가 옛 캐시에 묶여 안 뜨던 문제를 막는다.
    // 등급 목록은 작아 비용이 적고, 같은 키 동시 요청은 react-query가 합친다.
    staleTime: 30_000,
    refetchOnMount: "always",
  });
}

/**
 * A publisher tier badge: a colored chip with an optional checkmark + the tier
 * label. Renders nothing for `community`/unknown tiers (no badge by design).
 * Pass `tiers` to avoid a per-badge fetch when rendering a list.
 */
export function TierBadge({
  tier,
  tiers,
}: {
  tier: PublisherTier;
  tiers?: MarketTier[];
}) {
  const q = useTiers();
  const defs = tiers ?? q.data ?? [];
  const def = defs.find((t) => t.id === tier);
  if (!def || def.id === "community") return null;
  return (
    <span className="mc-tier" style={{ background: def.color, color: "#fff" }}>
      {def.checkmark ? "✓ " : ""}
      {def.label}
    </span>
  );
}
