@id("user/allowance-must-cover-input")
@severity("warn")
@reason("Existing allowances are below the swap inputs; an approve is required")
forbid (
  principal is Wallet,
  action == Action::"dex",
  resource is Protocol
)
when {
  context has allowancesCoverInputs
  && !context.allowancesCoverInputs
};
