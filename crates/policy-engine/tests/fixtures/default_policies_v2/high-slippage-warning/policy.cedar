// Default v2 policy — warn on a swap with slippage tolerance above 1% (100 bp).
// `slippageBp` is a base field of `Amm::SwapContext` (no enrichment needed), so
// this manifest declares no policy_rpc calls.
@id("high-slippage-warning")
@severity("warn")
forbid(principal, action == Amm::Action::"Swap", resource)
when { context.slippageBp > 100 };
