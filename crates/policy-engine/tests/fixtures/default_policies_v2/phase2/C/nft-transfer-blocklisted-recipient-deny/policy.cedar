// scopeball factory draft — extends the shipped sibling
// `transfer-blocklisted-recipient-deny` (which screens `erc20_transfer`
// recipients) onto the verified-dark `nft_transfer` tag.
//
// Warn on an NFT transfer whose `recipient` is flagged by an external address
// blocklist (External Fact Lookup — OFAC / known-drainer feeds live outside
// wallet state). The manifest's `external.address_blocklisted` policy_rpc call
// projects the verdict into `context.custom.recipientBlocklisted`.
//
// The blocklist provider is an external policy-rpc host method (mock for this
// slice); until it ships, the call is `optional`, so its absence fail-opens —
// `context.custom has recipientBlocklisted` is false and the policy no-ops
// rather than SystemFail. It activates automatically once the provider lands.
// Severity is `deny`, mirroring the shipped sibling
// `transfer-blocklisted-recipient-deny`: a known-drainer/sanctioned recipient is
// an unambiguous hard signal, and the same fail-open has-guard prevents any deny
// while the provider is unbuilt — so the conservative posture is already held by
// the guard, and matching the sibling keeps blocklist-recipient semantics
// consistent across the erc20_transfer and nft_transfer paths.
@id("nft-transfer-blocklisted-recipient-deny")
@severity("deny")
@reason("받는 주소가 알려진 드레이너/제재 블록리스트에 있습니다 — NFT 전송을 차단합니다. 주소를 다시 확인하세요.")
forbid(principal, action == Token::Action::"NftTransfer", resource)
when {
  context has custom
  && context.custom has recipientBlocklisted
  && context.custom.recipientBlocklisted
};
