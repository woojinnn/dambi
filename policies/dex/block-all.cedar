// Test policy: deny ANY Dex action unconditionally.
//
// Used to validate the engine end-to-end without depending on oracle /
// price-feed integration. The neighboring `max-usdt-input-3.cedar`
// policy guards on `context.totalInputUsd > 3.00`, but until the
// oracle pipeline writes that fact into the Cedar context, that guard
// stays false and the policy never fires. This rule has no `when`
// clause, so toggling it on should block every dex swap on Uniswap
// (or any other recognized router) regardless of price data.

@id("user/block-all-dex")
@severity("deny")
@reason("Test policy — all DEX swaps blocked while max-usdt rule waits for oracle wiring")
forbid (
  principal is Wallet,
  action == Action::"dex",
  resource is Protocol
);
