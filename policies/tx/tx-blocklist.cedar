@id("user/tx-blocklist")
@severity("deny")
@reason("Transaction target is on the blocklist")
forbid (
  principal,
  action == Action::"send_tx",
  resource == Address_::"0x000000000000000000000000000000000000dead"
);
