// dambi default v2 policy — block opening NEW short perp exposure through
// Hyperliquid CoreWriter action 1.
//
// CoreWriter calldata carries raw HyperCore order fields, not human
// price/size/symbol metadata, so it is modeled as `HlCoreLimitOrder` instead of
// `Perp::PlaceOrder`. `side` and `reduceOnly` are still exact and sufficient for
// a no-new-short risk limit. This complements `hl-no-short-perp`, which covers
// `/exchange` orders decoded as `Perp::PlaceOrder`.
@id("hl-corewriter-no-short-perp")
@severity("deny")
@reason("Opening a new short perp through Hyperliquid CoreWriter is blocked by policy")
forbid(principal, action == HyperliquidCore::Action::"HlCoreLimitOrder", resource)
when {
  context.venue.name == "hyperliquid"
    && context.side == "short"
    && context.reduceOnly == false
};
