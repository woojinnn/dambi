@id("user/max-borrow-usd-1000")
@severity("deny")
@reason("Borrow exceeds the $1,000 limit")
forbid (
  principal,
  action == Action::"borrow",
  resource
) when {
  context has totalBorrowedUsd &&
  context.totalBorrowedUsd.value.greaterThanOrEqual(decimal("1000.0000"))
};
