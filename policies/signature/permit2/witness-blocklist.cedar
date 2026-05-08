// Policy: block Permit2 witness transfer permits unless explicitly enabled.

@id("user/signature/permit2/witness-blocklist")
@severity("deny")
@reason("Permit2 witness transfer permits are disabled")
forbid (
  principal is Wallet,
  action == Action::"signature.permit2",
  resource is Protocol
)
when {
  context.witnessPresent
};
