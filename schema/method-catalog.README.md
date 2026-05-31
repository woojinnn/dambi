# `method-catalog.json` — what it is, in standard terms

This file is **not a bespoke invention**. It is a thin **Policy Information
Point (PIP) / attribute-finder registry**: it declares, per fact (method),
which attributes a Cedar policy needs, where they come from, and what they
mean. The vocabulary below names the prior art so the format is legible.

## Why a separate manifest/PIP layer at all

Cedar deliberately leaves **context assembly to the application** — the
authorization engine evaluates a policy against a `context` record but does
not fetch attributes itself. Some thin layer must declare and populate those
attributes. That layer is exactly the PIP role in the classic
**XACML PEP → PDP → PIP** architecture. So this manifest/PIP catalog is the
*expected* pattern, not a deviation from Cedar.

## Our concept → the standard it follows

| Our concept | Standard / prior art |
|---|---|
| This catalog (declares needed attributes + their source) | **Policy Information Point (PIP)** / attribute-finder registry (XACML PEP/PDP/**PIP**) |
| `defaultSelector` / `returns.from` (`$.action.token`, `$.result.usd`) | **JSONPath** (RFC 9535) subset |
| `policy_rpc` batched fact transport | **JSON-RPC 2.0**-shaped requests/responses |
| `params[].type` / `returns.type` (`Long`, `Bool`, `String`, `decimal`, `Set<String>`, records) | **Cedar** type system (incl. the `decimal` extension) |
| `chain_id`, `AssetRef` (chain + asset identifiers) | **CAIP-2** (chain id) / **CAIP-19** (asset id) |
| `readKind` taxonomy (`direct`/`derived`/`reducer`/`fold`/`external`) | local taxonomy — see `team/cedar-manifest/02-db-read-contract.md` |

## The semantics fields (what T1 added)

Each method now documents its **meaning**, not just its name:

- **`description`** — the human `semantics` line (what the fact computes).
- **`readKind`** — `direct` (a state column/JSON read, State₁) ·
  `derived` (action params × state arithmetic, no reducer) ·
  `reducer` (value of State₂ after virtually applying the action) ·
  `fold` (whole-wallet aggregate) · `external` (a feed outside the
  wallet state DB: oracle, cross-request history). Taxonomy from the DB
  read contract (`02-db-read-contract.md`).
- **`server`** — `sim-server` (served by the simulation server's fact
  host, reads the DB) · `local` (computed in-process from calldata or the
  host clock) · `external` (an outside feed). This refines the coarse
  `origin` tag; per **ADR-009** policy-rpc is being retired, so
  oracle/history facts carry `external` and the DB-backed reads move to
  `sim-server`.
- **`stateDependency`** — the `table.column` name(s) the fact reads, or a
  prose note for calldata-only / external facts.

## Two sections: `methods` vs `planned`

- **`methods`** — facts the daemon registry actually serves today. This map
  is kept **in lockstep** with the live `createMethodRegistry()` catalog;
  `policy-rpc/src/methods/__tests__/catalog.test.ts` fails the build on
  drift.
- **`planned`** — placeholder entries (each marked `"status": "planned"`)
  for upcoming facts documented before implementation
  (`valuation.asset_usd`, `position.health_factor_after`,
  `perp.notional_to_collateral`, and the experimental
  `portfolio.group_pct` PortfolioAggregate). These are **not** served by
  the daemon and are intentionally excluded from the drift comparison.

## Consumers

- `policy-rpc` daemon — `GET /v1/methods` emits the live catalog; the
  drift test asserts JSON ↔ registry equality on `methods`.
- `browser-extension` — `scripts/copy-method-catalog.js` ships the JSON as
  a static asset; the service worker merges it with any daemon catalog for
  the dashboard's manifest editor dropdowns.

Adding fields here is **additive/backward-compatible**: the TS
`MethodCatalogEntry` interfaces mark the new keys optional, and the
extension fetch path only reads `methods`.
