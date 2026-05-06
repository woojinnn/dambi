// Policy: deny Dex routes whose minimum output USD value is below an absolute
// floor.
//
// Skipped silently when oracle data is missing or stale (>60 s).

@id("user/min-output-usd-floor")
@severity("deny")
@reason("Minimum output USD value below floor (10.00) - high MEV / dust-out risk")
forbid (
  principal is Wallet,
  action == Action::"dex",
  resource is Protocol
)
when {
  context has totalMinOutputUsd
  && context.totalMinOutputUsd.staleSec <= 60
  && context.totalMinOutputUsd.value.lessThan(decimal("10.00"))
};
