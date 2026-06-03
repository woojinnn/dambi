// scopeball default v2 policy — beginner-protection: an ERC20 transfer whose
// recipient is ANY smart contract (not just the token's own address).
//
// THREAT: first-weeks users copy a contract address from Etherscan / a tutorial
// / a token page and paste it into Send, treating a contract like a normal
// wallet ("I'll send my tokens to the protocol to stake/swap"). Most contracts
// have no withdrawal path for raw inbound `transfer`s, so the funds are
// permanently stuck. (info.etherscan.com: "If the contract does not include a
// withdrawal function, the funds remain permanently stuck in that contract.")
//
// GAP CLOSED: the shipped DENY `transfer-to-token-own-contract-deny` fires ONLY
// when `recipient == context.token.key.address` (the token's OWN contract) —
// verified. `send-first-time-or-burn-recipient-warn` matches only the two
// literal burn strings. The broad "recipient is ANY contract" case slips
// through both. No existing fixture reads recipientIsContract on Erc20Transfer
// (verified: that fact is wired only to Airdrop::Claim).
//
// EXTERNAL/method-backed read (same probe as the airdrop sibling
// air-recipient-is-contract-warn): EOA-vs-contract is decided by whether the
// recipient address has deployed code (codehash / eth_getCode) — a LIVE
// on-chain lookup OUTSIDE the wallet snapshot, so it is filled by external info,
// not state. The reused `external.recipient_is_contract` fact runs the codehash
// check and projects the verdict into `context.custom.recipientIsContract`
// (Bool). Defined-not-fully-wired → `optional`, so its absence fail-opens
// (the `has` guard is false → no-op) rather than SystemFail. Warn (plausible,
// not certain — some contracts are legitimate transfer targets) when the
// recipient is a contract.
@id("transfer-recipient-is-contract-warn")
@severity("warn")
@reason("This send goes to a smart contract, not a wallet — most contracts cannot return raw token transfers, so the funds may be stuck")
forbid(principal, action == Token::Action::"Erc20Transfer", resource)
when {
  context has custom
  && context.custom has recipientIsContract
  && context.custom.recipientIsContract
};
