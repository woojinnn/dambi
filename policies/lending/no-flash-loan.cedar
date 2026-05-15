@id("user/no-flash-loan")
@severity("deny")
@reason("Flash loans are not permitted")
forbid (
  principal,
  action == Action::"flash_loan",
  resource
);
