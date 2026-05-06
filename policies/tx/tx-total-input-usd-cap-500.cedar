@id("user/tx-total-input-usd-cap-500")
@severity("deny")
@reason("Combined transaction USD value exceeds the per-tx cap")
forbid (principal, action == Action::"send_tx", resource)
when {
  context has "totalInputUsd"
  && context.totalInputUsd.greaterThan(decimal("500.00"))
};
