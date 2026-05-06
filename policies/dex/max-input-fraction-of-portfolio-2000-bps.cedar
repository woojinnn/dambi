@id("user/max-input-fraction-of-portfolio-2000-bps")
@severity("deny")
@reason("Dex input exceeds 20% of the actor's portfolio")
forbid (
  principal is Wallet,
  action == Action::"dex",
  resource is Protocol
)
when {
  context has totalInputFractionOfPortfolioBps
  && context.totalInputFractionOfPortfolioBps > 2000
};
