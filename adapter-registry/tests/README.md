# adapter-registry/tests

Vitest suite for `build-manifest.js` plus shape guards for the registry's
public manifest.

## Vendored parser

`_vendored/adapter-manifest.ts` is a **temporary** copy of the manifest types +
`parseAdapterManifest` function. The canonical home is
`extension/src/lib/adapter-manifest.ts`, which at the time of this PR has not
yet been published by track-B / the action-and-adapter-refactor stream.

Why vendor instead of cross-package import?

1. Importing from `../../extension/src/lib/...` works in TypeScript but pulls
   in the extension's full `tsconfig` (DOM lib, webpack-flavored paths) which
   leaks into vitest cache. We tried that route in an earlier draft and the
   transitive import surface grew (other lib files import `messages.ts` and
   `types.ts`, which import each other).
2. The canonical file does not exist yet at all. Track-D shipping first means
   shipping the shape definition somewhere.
3. The duplication is intentionally a forcing function: when track-B publishes
   the canonical module, this directory becomes a "delete me" pointer.

Reconciliation plan — after PR #22 (`feat/adapter-registry-design`) merges to main:

1. (a) Update `adapter-registry/scripts/build-manifest.js` to emit the canonical
   schema (per-version `url`, `0x`-prefixed `sha256`, `size_bytes`, `signature`,
   `signer_id`, `published_at`, adapter-level `canary_version`, lowercased
   addresses, error-on-missing-`display_name`). **Done in this PR.**
2. (b) Delete `adapter-registry/tests/_vendored/`.
3. (c) Update the import in `adapter-registry/tests/manifest-shape.test.ts` to
   `../../extension/src/lib/adapter-manifest.js` (and adjust
   `vitest.config.ts` / `tsconfig.json` if module resolution needs widening).

The two parsers must stay in lockstep. CI will eventually catch drift by
diffing the runtime output of `build-manifest.js` against
`parseAdapterManifest`'s acceptance set, which is exactly what
`manifest-shape.test.ts` already does — so the vendored copy is regression-safe
in the sense that an unwanted divergence between the canonical type and the
generator output will fail this suite, regardless of which file changed.

## Running

```
cd adapter-registry
yarn install     # actually just reuses ../extension/node_modules — no install needed
npx vitest run   # or: ../extension/node_modules/.bin/vitest run
```

The suite spawns Node child processes that invoke `scripts/build-manifest.js`
against temporary fixtures in `os.tmpdir()`. No state in the repo is mutated
during tests.
