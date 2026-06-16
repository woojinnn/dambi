// dambi default v2 policy — explorer id: BRG-03 (unlimited / over-balance
// ERC20 approval to a bridge contract — only a finite, ~bridge-amount approval
// is acceptable).
//
// In the LI.FI exploit (2024-07, ~$11.6M) only wallets holding an UNLIMITED
// approval to the bridge were drained; wallets with a finite approval were
// unharmed. This is the bridge instance of GEN-01: the approve lands as
// `Token::Erc20Approve` with `amount` a raw lowercase U256 hex String (`{:#x}`,
// no leading zeros). "Unlimited" can therefore be detected offline by string
// equality against the two canonical sentinels: `uint256::MAX` (64 f's,
// standard ERC20 max-approve) and `uint160::MAX` (40 f's, Permit2-style max).
//
// NOTE: this slice was rewritten from the earlier `context.custom.approvalIsUnlimited`
// form, which depended on the `approval.unlimited_over_balance` policy_rpc method.
// That method is NOT implemented. Leaving it in a required manifest path trips
// `SystemFail` on EVERY approve (deny-all). The static check denies only a
// genuinely unlimited approve; over-balance scoring returns with balance
// enrichment in a later increment. Deny applies to every spender — an unlimited
// bridge approval is never the safe default.
@id("bridge-unlimited-approval-deny")
@severity("deny")
@reason("Unlimited token approval to a bridge — a drained bridge could take your full balance")
forbid(principal, action == Token::Action::"Erc20Approve", resource)
when {
  context.amount == "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
  || context.amount == "0xffffffffffffffffffffffffffffffffffffffff"
};
