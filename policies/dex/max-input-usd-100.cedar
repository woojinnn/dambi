// Policy: deny Dex routes whose USD-denominated total input value exceeds
// 100 USD-equivalent.
//
// `staleSec <= 60` guards against accepting an extremely stale oracle reading.

@id("user/max-input-usd-100")
@severity("deny")
@reason("USD value of Dex input exceeds 100")
forbid (
  principal is Wallet,
  action == Action::"dex",
  resource is Protocol
)
when {
  context has totalInputUsd
  && context.totalInputUsd.staleSec <= 60
  && context.totalInputUsd.value.greaterThan(decimal("100.00"))
};
