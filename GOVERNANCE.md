# Dambi Governance

Dambi is currently maintained by a small maintainer group. Governance is kept
lightweight, but security-sensitive changes require explicit review and focused
validation.

## Maintainer Responsibilities

Maintainers are responsible for:

- reviewing and merging pull requests,
- triaging decoder, policy, and registry issues,
- maintaining release branches and extension tags,
- publishing registry and extension artifacts,
- reviewing security reports and coordinating fixes,
- keeping public documentation aligned with runtime behavior.

## Review Expectations

At least one maintainer review is expected for normal changes. Changes touching
the signing path, auth, release packaging, registry serving, or policy
evaluation should receive a stricter review and include targeted tests.

High-risk areas include:

- provider/fetch interception in the browser extension,
- service-worker orchestration and fail-closed verdict paths,
- EVM calldata, EIP-712, and venue-order decoding,
- policy-server auth and wallet ownership checks,
- registry index build, materialization, signing, and serving,
- Chrome Web Store release packaging.

## Merge Policy

Maintainers should merge only after:

- the diff scope is understood,
- required tests or targeted checks have passed,
- generated artifacts are intentional,
- security-sensitive behavior is documented in the PR,
- unrelated user or branch changes are not included.

## Releases

Extension releases use `ext-v*` tags and GitHub releases. Registry and backend
deployments are handled separately through the repository's release and deploy
workflows.

Release notes should identify:

- user-visible behavior changes,
- decoder or policy coverage changes,
- security hardening,
- build or packaging changes,
- known limitations.

## Decision Making

For routine work, maintainers decide by review consensus in the pull request.
For security-sensitive or irreversible operational work, prefer a written issue
or PR discussion that records the rationale, validation, and rollback plan.
