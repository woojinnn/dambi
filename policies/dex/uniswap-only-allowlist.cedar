// Policy: only allow Dex routes whose aggregate protocol IDs are all Uniswap
// variants currently emitted by the shipped adapters.

@id("user/uniswap-only-allowlist")
@severity("deny")
@reason("Dex protocol is not on the allowlist (uniswap-v2 / uniswap-v3 / uniswap-v4 / uniswap)")
forbid (
  principal is Wallet,
  action == Action::"dex",
  resource is Protocol
)
unless {
  ["uniswap-v2", "uniswap-v3", "uniswap-v4", "uniswap"].containsAll(context.protocolIds)
};
