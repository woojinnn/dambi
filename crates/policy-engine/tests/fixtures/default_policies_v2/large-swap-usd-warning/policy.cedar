// Default v2 policy — warn on a swap whose enriched USD input value exceeds
// 1000 USD. `totalInputUsd` is projected into `context.custom` by the
// manifest's `oracle.usd_value` policy_rpc call (see manifest.json). `custom`
// is optional and `totalInputUsd` is a Cedar `decimal` extension value, so the
// guard `has`-checks the path and uses `.greaterThan(...)` (Cedar has no `>`
// on decimal).
@id("large-swap-usd-warning")
@severity("warn")
forbid(principal, action == Amm::Action::"Swap", resource)
when {
  context has custom
  && context.custom has totalInputUsd
  && context.custom.totalInputUsd.greaterThan(decimal("1000.0000"))
};
