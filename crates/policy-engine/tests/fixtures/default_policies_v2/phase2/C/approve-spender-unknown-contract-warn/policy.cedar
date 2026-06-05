// scopeball draft policy — approve-spender-unknown-contract-warn.
//
// The existing `approve-spender-eoa-warn` only fires when the `Erc20Approve`
// spender is a plain EOA (codehash empty). Drainers have explicitly shifted from
// EOAs to freshly-deployed phishing CONTRACTS precisely to slip past that
// EOA heuristic — a first-week user reads "it's a contract, so it's a real
// dApp" and clicks approve, unable to tell a 2-day-old drainer contract from a
// legitimate router (SentinelOne Labs: scammers moved from EOAs to deploying
// phishing contracts to deceive users).
//
// This policy is the complementary half: it warns when the spender HAS code
// (is a contract) AND is not recognised by a known-good allowlist/registry.
// `spenderUnknownContract` is an enriched Bool projected by the manifest's
// `external.spender_reputation` policy_rpc call — a live on-chain `eth_getCode`
// (has-code) view crossed with an external known-good registry. That is a
// signal made OUTSIDE the wallet (External / live view + reputation feed), so
// the call is `optional` and the policy fail-opens until the fact host ships it.
//
// `custom` is optional, so the path is `has`-guarded; the value is a `Bool`.
// Unknown ⇒ false ⇒ never fires. A recognised router/vault ⇒ false ⇒ the user's
// normal re-approval flow passes silently. Orthogonal to the EOA gate (which
// fires on NO code) — together they cover both spender shapes.
@id("approve-spender-unknown-contract-warn")
@severity("warn")
@reason("This spender is a contract your wallet does not recognise — a freshly-deployed phishing contract looks just like a real dApp")
forbid(principal, action == Token::Action::"Erc20Approve", resource)
when {
  context has custom
  && context.custom has spenderUnknownContract
  && context.custom.spenderUnknownContract
};
