@id("user/total-input-usd-cap-500")
@severity("deny")
@reason("Combined Dex USD input value exceeds the per-action cap")
forbid (
  principal is Wallet,
  action == Action::"dex",
  resource is Protocol
)
when {
  context has totalInputUsd
  && context.totalInputUsd.value.greaterThan(decimal("500.00"))
};
