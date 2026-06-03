// scopeball policy — address-poisoning look-alike recipient (from signal
// "address-poisoning-lookalike-recipient").
//
// Address poisoning seeds a wallet's transaction history with a recipient whose
// FIRST and LAST hex chars match a real, previously-used recipient but whose
// MIDDLE differs. The user copies the look-alike from history and sends funds
// that are then unrecoverable — a recurring multi-hundred-million-dollar loss.
//
// This is NOT a generic "new recipient" warning (high false-positive). The
// distinguishing signal is "looks like an address you HAVE sent to before, but
// is itself a never-used new address" — a deliberate doppelgänger.
//
// The judgment is made server-side: `order.recipient_lookalike_history` reads
// the wallet's prior-recipient history (sim-server / Aggregator state) and the
// candidate `recipient`, runs the prefix/suffix-match-but-mid-mismatch compare,
// and projects a single Bool into `context.custom.recipientLookalike`. Cedar
// only reads the Bool — no send-history state crosses into the policy layer.
//
// The policy-rpc call is `optional`, so until the history provider ships it
// fail-opens: `context.custom has recipientLookalike` is false and the policy
// no-ops rather than SystemFail. It activates automatically once the provider
// lands.
@id("transfer-recipient-lookalike-poisoning-deny")
@severity("deny")
@reason("This recipient closely mimics an address you have sent to before but is a different, never-used address — a classic address-poisoning look-alike")
forbid(principal, action == Token::Action::"Erc20Transfer", resource)
when {
  context has custom
  && context.custom has recipientLookalike
  && context.custom.recipientLookalike
};
