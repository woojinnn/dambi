// Generate token registry entries for Curve StableSwap-NG 2-coin pools that are
// promoted through the source-materialized pool manifests.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const UNIVERSE = join(ROOT, "surface", "curve", "_pool_universe.json");
const TOKENS = join(ROOT, "tokens");

const SOURCES = {
  1: "https://api.curve.fi/api/getPools/ethereum/factory-stable-ng",
  8453: "https://api.curve.fi/api/getPools/base/factory-stable-ng",
};

const ADDR_RE = /^0x[0-9a-f]{40}$/;
const ZERO_RE = /^0x0{40}$/;

function tokenRef(chainId, address) {
  return {
    key: {
      standard: "erc20",
      chain: `eip155:${chainId}`,
      address,
    },
  };
}

function tokenPath(chainId, address) {
  return join(TOKENS, String(chainId), `${address}.json`);
}

function writeIfMissing(chainId, address, data) {
  const path = tokenPath(chainId, address);
  if (existsSync(path)) return false;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf8");
  return true;
}

const universe = JSON.parse(readFileSync(UNIVERSE, "utf8"));
let lpWritten = 0;
let coinWritten = 0;
let skipped = 0;

for (const row of universe.candidates ?? []) {
  const chainId = row.chainId;
  if (chainId !== 1 && chainId !== 8453) continue;
  if (!(row.families ?? []).includes("factory-stable-ng")) continue;
  const coins = (row.coins ?? [])
    .map((coin) => String(coin).toLowerCase())
    .filter((coin) => ADDR_RE.test(coin) && !ZERO_RE.test(coin));
  if (coins.length !== 2) continue;
  const coinDetails = row.coinDetails ?? [];
  if (coinDetails.length !== 2) {
    skipped++;
    continue;
  }

  const poolAddress = String(row.address).toLowerCase();
  const lpToken = String(row.lpTokenAddress ?? row.address).toLowerCase();
  const source = SOURCES[chainId];

  const lp = {
    erc_kind: "erc20",
    chainId,
    address: lpToken,
    symbol: row.symbol ?? row.curve_id ?? "Curve LP",
    decimals: 18,
    name: row.name ?? row.curve_id ?? "Curve StableSwap-NG LP",
    source,
    token_kind: {
      kind: "lp_share",
      pool: {
        protocol: {
          name: "curve_stableswap_ng",
          chain: `eip155:${chainId}`,
        },
        pool_addr: poolAddress,
      },
      underlyings: coins.map((coin) => tokenRef(chainId, coin)),
      share_form: "fungible",
      shape: {
        kind: "pooled",
      },
    },
  };
  if (writeIfMissing(chainId, lpToken, lp)) lpWritten++;

  for (const coin of coinDetails) {
    const address = String(coin.address).toLowerCase();
    if (!ADDR_RE.test(address) || ZERO_RE.test(address)) continue;
    const decimals = Number(coin.decimals);
    const metadata = {
      erc_kind: "erc20",
      chainId,
      address,
      symbol: coin.symbol ?? address,
      decimals: Number.isFinite(decimals) ? decimals : 18,
      name: coin.name ?? coin.symbol ?? address,
      source,
    };
    if (writeIfMissing(chainId, address, metadata)) coinWritten++;
  }
}

console.log(
  `curve stableswap-ng 2coin tokens: wrote ${lpWritten} LP + ${coinWritten} coin token file(s), skipped ${skipped} row(s) without coinDetails`,
);
