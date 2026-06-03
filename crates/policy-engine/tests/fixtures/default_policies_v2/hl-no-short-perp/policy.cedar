@id("hl-no-short-perp")
@severity("deny")
@reason("Opening a new short perp on Hyperliquid is blocked by policy")
forbid(
  principal,
  action == HyperliquidCore::Action::"HlOrder",
  resource
)
when {
  // `side == "short"` is the order DIRECTION (sell), which also covers
  // reduce-only long-CLOSES. Gate on `positionEffect == "open"` so this blocks
  // only NEW short exposure, never a position exit (reduce-only ⇒ "reduce").
  context.venue.name == "hyperliquid"
    && context.side == "short"
    && context.positionEffect == "open"
};
