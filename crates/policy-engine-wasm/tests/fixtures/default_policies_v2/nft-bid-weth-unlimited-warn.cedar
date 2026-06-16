// dambi default v2 policy — explorer id: NFT-05 (unlimited / over-cap WETH
// approval granted to a bidding conduit; the NFT-bid instance of GEN-01).
//
// Bidding on NFTs requires pre-approving WETH to the marketplace conduit. An
// `approve(spender, U256::MAX)` (or an amount far over what a bid needs) turns
// that conduit into an open-ended spend channel. `amount` is a raw U256 hex
// String on `Erc20ApproveContext`, but lowering emits it in canonical lowercase
// `{:#x}` form with no leading zeros. This policy therefore checks the two
// canonical unlimited sentinels directly: `uint256::MAX` (64 f's) and
// `uint160::MAX` (40 f's, Permit2-style max).
//
// NOTE: this slice was rewritten from the earlier `context.custom.bidApprovalIsUnlimited`
// form, which depended on the `approval.unlimited_over_balance` policy_rpc method.
// That method is NOT implemented. Keeping it in a required manifest path trips
// `SystemFail` on EVERY approve (deny-all). The static check warns only on a
// genuinely unlimited approval; over-balance / WETH-bid-specific scoring returns
// with balance + venue enrichment in a later increment.
@id("nft-bid-weth-unlimited-warn")
@severity("warn")
@reason("this WETH approval is unlimited — a bid only needs the offer amount, so cap it")
forbid(principal, action == Token::Action::"Erc20Approve", resource)
when {
  context.amount == "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
  || context.amount == "0xffffffffffffffffffffffffffffffffffffffff"
};
