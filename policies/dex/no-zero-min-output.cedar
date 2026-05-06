// Policy: warn when a Dex route includes a swap whose minimum output amount is
// exactly zero.
//
// We emit a warning rather than a deny so legitimate exact-out routes are not
// blocked when zero minimum output is intentional for that adapter shape.

@id("user/no-zero-min-output")
@severity("warn")
@reason("Dex route contains a zero minimum output - MEV-vulnerable")
forbid (
  principal is Wallet,
  action == Action::"dex",
  resource is Protocol
)
when {
  context.hasZeroMinOutput
};
