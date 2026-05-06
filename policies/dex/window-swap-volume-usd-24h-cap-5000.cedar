// Evaluator stamps post-this-action windowStats by projecting the current Dex
// deltas before enforcing the 24h cap.

@id("user/window-swap-volume-usd-24h-cap-5000")
@severity("deny")
@reason("Cumulative projected 24h swap USD volume crosses the configured cap")
forbid (
  principal is Wallet,
  action == Action::"dex",
  resource is Protocol
)
when {
  context has windowStats
  && context.windowStats has swapVolumeUsd24h
  && context.windowStats.swapVolumeUsd24h.greaterThan(decimal("5000.00"))
};
