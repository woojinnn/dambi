import { useQuery } from "@tanstack/react-query";

import { listTiers, type MarketTier, type PublisherTier } from "../server-api/market";

/** Tier definitions, cached for the whole session — drives publisher badges. */
export function useTiers() {
  return useQuery({
    queryKey: ["market-tiers-public"],
    queryFn: listTiers,
    staleTime: 5 * 60_000,
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
