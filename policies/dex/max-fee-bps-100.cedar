// Policy: deny Dex routes whose maximum reported protocol fee tier exceeds
// 100 basis points (1.0%).
//
// `maxFeeBps` is the largest fee reported by the route's adapters. The policy
// skips silently when an adapter does not disclose fee data.

@id("user/max-fee-bps-100")
@severity("deny")
@reason("Dex route fee tier exceeds 100 bps (1.0%)")
forbid (
  principal is Wallet,
  action == Action::"dex",
  resource is Protocol
)
when {
  context has maxFeeBps
  && context.maxFeeBps > 100
};
