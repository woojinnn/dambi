# Security Policy

Dambi runs in the signing path for Web3 wallets. Please report vulnerabilities
privately and give maintainers time to investigate before public disclosure.

## Supported Scope

Security reports are in scope when they affect the current public repository or
the released Dambi browser extension, including:

- wallet RPC interception and request forwarding,
- transaction, typed-data, and venue-order decoding,
- WASM policy evaluation and fail-closed behavior,
- policy-server auth, wallet registration, and token handling,
- registry bundle serving, selector lookup, and manifest materialization,
- Chrome Web Store release packaging and console/log stripping.

Reports about third-party dApps, wallets, exchanges, or chains are out of scope
unless the issue is caused by Dambi's handling of those integrations.

## Reporting

Use GitHub private vulnerability reporting when available. If that is not
available for your account, open a minimal public issue that says you have a
private security report, without exploit details, secrets, addresses with live
funds, or reproduction payloads that could harm users.

Include:

- affected component and commit or release version,
- expected vs actual behavior,
- reproduction steps or a minimal payload,
- impact assessment,
- whether the issue is already public or exploited.

## Disclosure Handling

Maintainers will triage reports by impact and exploitability. High-impact issues
in signing, auth, registry serving, policy evaluation, or release packaging are
handled before feature work.

Coordinated disclosure expectations:

- Do not publish exploit details before maintainers acknowledge the report.
- Give maintainers a reasonable fix window for confirmed issues.
- Public advisories should describe impact and remediation without exposing
  user secrets or live exploit payloads.

## Security Design Expectations

Changes to the signing path should preserve these properties:

- unknown, malformed, or unsupported wallet actions warn or fail closed,
- HyperLiquid high-risk venue-order parse failures deny closed,
- typed-data normalization is shared across routing, logging, and redaction,
- untrusted server URLs must not receive authenticated requests,
- release builds should not expose sensitive debug logs.
