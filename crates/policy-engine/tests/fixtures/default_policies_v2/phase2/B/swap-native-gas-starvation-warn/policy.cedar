// scopeball draft policy — beginner-protection (gas-starvation on swap).
//
// Rule: warn if, AFTER this swap, the wallet's NATIVE gas balance would fall
// below a small reserve floor needed to pay for future transactions. A beginner
// does not distinguish "token balance" from "gas balance": they swap ~100% of
// their native ETH/BNB/MATIC into another token, the wallet "looks funded"
// (the bought token shows value), but every later tx (sell, transfer, approve)
// needs native for gas — leaving them stranded until an external top-up.
//
// This is a State₂ (reducer) fact, not a calldata fact. The check is
//   native_balance_after = nativeHolding.balance
//                          − (direction.amountIn if tokenIn is the native asset)
//                          − gasEstimate
//   reserveBelowFloor = native_balance_after < floor
// Cedar cannot subtract U256 hex strings, so the reducer computes it natively
// off-Cedar and the manifest's `valuation.native_reserve_after` policy_rpc call
// projects the boolean into `context.custom.nativeReserveBelowFloor`.
//
// Inputs are REAL WalletState fields only:
//   - TokenHolding{ kind: TokenKind::NativeGas }.balance  (the wallet's native
//     gas holding; NativeGas is separated in state precisely "to enable gas-only
//     policies")
//   - action.gasEstimate          (Amm::SwapContext base field, U256 hex)
//   - action.direction.amountIn   (native spend iff tokenIn is the native asset)
//   - action.tokenIn              (to decide whether amountIn debits native)
// No new Cedar state surface: the engine reads only the projected Bool.
//
// `custom` is optional, so the guard uses the has-guard triad. The native
// holding read lives in the sim-server fact host, so the call is `optional` and
// the policy fail-opens (no-op WARN) until it ships. The reserve floor is user
// configuration; for this slice the threshold is folded into the reducer (the
// projected Bool already encodes "below floor"). warn-only — never blocks a
// legitimate swap, only nudges the user to keep gas.
//
// Scoped to `Amm::Action::"Swap"` here (trigger_tag = swap). The same fact folds
// onto `Token::Action::"Erc20Transfer"` / native-send as a second trigger (one
// method, two policies) in a sibling draft — not duplicated here.
@id("swap-native-gas-starvation-warn")
@severity("warn")
@reason("After this swap you may not have enough native coin left to pay gas for future transactions")
forbid(principal, action == Amm::Action::"Swap", resource)
when {
  context has custom
  && context.custom has nativeReserveBelowFloor
  && context.custom.nativeReserveBelowFloor
};
