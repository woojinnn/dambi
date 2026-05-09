// Policy: deny Dex swaps that spend more than 3 USDT (mainnet).
//
// USDT on Ethereum mainnet is `0xdac17f958d2ee523a2206206994597c13d831ec7`
// with 6 decimals. Since 1 USDT ≈ 1 USD, comparing `totalInputUsd > 3.00`
// is equivalent to "input USDT > ~3 USDT" for a single-token USDT swap.
//
// `staleSec <= 60` guards against an extremely stale oracle reading.

@id("user/max-usdt-input-3")
@severity("deny")
@reason("Cannot swap more than 3 USDT")
forbid (
  principal is Wallet,
  action == Action::"dex",
  resource is Protocol
)
when {
  context has inputTokens
  && context.inputTokens.contains({
       chainId: 1,
       address: "0xdac17f958d2ee523a2206206994597c13d831ec7",
       symbol: "USDT",
       decimals: 6,
       isNative: false
     })
  && context has totalInputUsd
  && context.totalInputUsd.staleSec <= 60
  && context.totalInputUsd.value.greaterThan(decimal("3.00"))
};
