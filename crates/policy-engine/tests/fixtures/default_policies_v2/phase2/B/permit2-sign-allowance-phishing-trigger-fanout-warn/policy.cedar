// scopeball policy — fan the two shipped erc20_permit (EIP-2612) phishing guards
// onto the REAL Uniswap Permit2 signed-allowance path (Token::Permit2SignAllowance).
//
// The most-cited Permit2 drain (PEPE $1.39M; cited in-repo inside
// permit2-unknown-spender-full-balance-warn/policy.cedar) goes through
// permit2_sign_allowance, NOT erc20_permit — so the named incident's own path
// currently has ZERO Cedar coverage (grep-confirmed: every shipped permit
// fixture triggers on the erc20_permit tag). This fixture closes that trigger
// gap by re-applying, verbatim, the two existing erc20_permit phishing signals
// to Token::Action::"Permit2SignAllowance", whose context carries the same
// spender / amount / token / meta.nature.domain.chainId fields
// (permit2_sign_allowance.cedarschema + core.cedarschema, verified).
//
// Two branches, OR-combined, each fully has-guarded over the optional `custom`
// slot so the policy fail-opens until each host method ships:
//
//   1. chain-mismatch  — reuses `signature.chain_mismatch` (IMPLEMENTED,
//      stateless in facts/signature.rs). Bool `chainMismatch`: the EIP-712
//      domain chainId differs from the connected chain. Same comparison as the
//      shipped signature-chain-mismatch-permit-warn sibling.
//
//   2. unknown-spender full-balance — reuses `permit.full_balance_unknown_spender`
//      (a NotImplemented STUB today, exactly like its erc20_permit sibling
//      permit2-unknown-spender-full-balance-warn — both fail-open until the host
//      method lands; precedented pattern). Bool `spenderIsKnown` + decimal
//      `permitFullBalancePct` (amount / token_balance × 100, 4dp dotted).
//
// `custom` is optional, so every field is `has`-guarded before it is read; the
// policy_rpc calls are `optional`, so the policy fail-opens (no deny on an
// unbuilt method). Threshold 90% mirrors the shipped sibling.
@id("permit2-sign-allowance-phishing-trigger-fanout-warn")
@severity("warn")
@reason("This Permit2 signature is bound to a different chain, or lets an unfamiliar spender take almost your entire balance of this token")
forbid(principal, action == Token::Action::"Permit2SignAllowance", resource)
when {
  (
    context has custom
    && context.custom has chainMismatch
    && context.custom.chainMismatch
  )
  ||
  (
    context has custom
    && context.custom has spenderIsKnown
    && context.custom.spenderIsKnown == false
    && context.custom has permitFullBalancePct
    && context.custom.permitFullBalancePct.greaterThan(decimal("90.0000"))
  )
};
