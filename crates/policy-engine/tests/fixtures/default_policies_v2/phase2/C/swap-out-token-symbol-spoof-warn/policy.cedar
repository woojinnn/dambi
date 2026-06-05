// scopeball default v2 policy — demand signal: symbol-spoof token buy (a token
// whose ticker/name matches a famous coin but whose CONTRACT is NOT the
// canonical address for that symbol). ethereum.org/FBI/Uniswap-support name
// symbol-impersonation as the #1 beginner token trap: "imitation tokens often
// use the same name, icon, and symbol as the real token with slight changes in
// the contract address ... scam tokens cannot use the same contract address."
// (https://ethereum.org/guides/how-to-id-scam-tokens/)
//
// New users pick tokens by ticker/logo in a search box and have no instinct to
// compare the on-chain contract against an official source. The token is
// RECOGNIZABLE by symbol, just deployed at a different address than the
// legitimate one — the INVERSE of the honeypot/unclassified case
// (swap-out-token-honeypot-warn covers "no registry presence" + "buy/sell
// honeypot sim"; this covers "the symbol IS a known token but at the WRONG
// address"). That canonical-symbol→address mismatch is a distinct external
// signal neither existing flag emits.
//
// "Does tokenOut.symbol resolve to a known canonical token whose canonical
// address != tokenOut's address?" needs an external symbol→canonical-address
// registry, which lives OUTSIDE the stateless policy engine. We follow the exact
// shape of swap-out-token-honeypot-warn: an `optional` policy-rpc method
// (`external.token_symbol_canonical_mismatch`) keeps the registry host-side and
// projects a single Bool into `context.custom.outTokenSymbolSpoof`. The Cedar
// engine adds NO new state surface — it only reads a host-supplied Bool. Because
// the call is `optional` and `custom` is optional, the flag is `has`-guarded;
// until the registry ships, its absence fail-opens (no-op) rather than
// SystemFail, and the policy activates automatically once the provider lands.
@id("swap-out-token-symbol-spoof-warn")
@severity("warn")
@reason("This token uses the symbol of a well-known coin but a different contract address than the official one")
forbid(principal, action == Amm::Action::"Swap", resource)
when {
  context has custom
  && context.custom has outTokenSymbolSpoof
  && context.custom.outTokenSymbolSpoof
};
