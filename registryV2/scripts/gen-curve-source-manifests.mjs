// Generate Curve source-materialized manifest templates.
//
// These are not concrete per-pool manifests. They are build-index templates
// consumed by protocol resolvers that provide one `$source.*` context per pool.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const MANIFESTS = join(ROOT, "manifests", "curve", "stableswap-ng");

const GROUPS = [
  {
    name: "factory-stable-ng-2coin-mainnet",
    sourceKind: "curve:factory_stable_ng_2coin_mainnet",
    chainIds: [1],
    templateDir: join(MANIFESTS, "2btc"),
    outDir: join(MANIFESTS, "zz-source-factory-stable-ng-2coin-mainnet"),
    idPrefix: "curve/stableswap-ng/source/factory-stable-ng-2coin-mainnet",
    oldIdPrefix: "curve/stableswap-ng/2btc",
    oldCoins: [
      "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599",
      "0x18084fba666a33d37592fa2633fd49a74dd93a88",
    ],
  },
  {
    name: "factory-stable-ng-2coin-base",
    sourceKind: "curve:factory_stable_ng_2coin_base",
    chainIds: [8453],
    templateDir: join(MANIFESTS, "base-superoethb"),
    outDir: join(MANIFESTS, "zz-source-factory-stable-ng-2coin-base"),
    idPrefix: "curve/stableswap-ng/source/factory-stable-ng-2coin-base",
    oldIdPrefix: "curve/stableswap-ng/base-superoethb",
    oldCoins: [
      "0x4200000000000000000000000000000000000006",
      "0xdbfefd2e8460a6ee4955a68582f85708baea60a3",
    ],
  },
];

function replaceDeep(value, group) {
  if (typeof value === "string") {
    const idx = group.oldCoins.indexOf(value.toLowerCase());
    if (idx !== -1) return `$source.coins.${idx}`;
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => replaceDeep(item, group));
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, nested] of Object.entries(value)) {
      out[key] = replaceDeep(nested, group);
    }
    return out;
  }
  return value;
}

let written = 0;
for (const group of GROUPS) {
  mkdirSync(group.outDir, { recursive: true });
  const files = readdirSync(group.templateDir).filter((file) => file.endsWith(".json")).sort();
  for (const file of files) {
    const raw = JSON.parse(readFileSync(join(group.templateDir, file), "utf8"));
    const body = replaceDeep(raw, group);
    body.id = String(body.id).replace(group.oldIdPrefix, group.idPrefix);
    body.match = {
      selector: raw.match.selector,
      chain_to_addresses_source: group.sourceKind,
      chain_ids: group.chainIds,
    };
    body.source_materialize = {
      kind: "per_address_context",
      source: group.sourceKind,
      note: "build-index substitutes $source.* and appends a per-pool id suffix",
    };
    writeFileSync(join(group.outDir, file), JSON.stringify(body, null, 2) + "\n", "utf8");
    written++;
  }
  console.log(`${group.name}: wrote ${files.length} templates`);
}
console.log(`curve source manifests: wrote ${written} templates`);
