#!/usr/bin/env node
// Publish the pasu-docs catalog to a policy-server via the public API
// (POST /market/listings). Listings land as publisher_tier=community owned by
// the token's account (the API forces community; official needs DB-direct).
//
// Usage:
//   DAMBI_TOKEN=<jwt> DAMBI_URL=https://dambi-policy.duckdns.org \
//     node publish-remote.mjs            # publish all
//   ... node publish-remote.mjs --dry    # print what would be sent, no POST

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "out");
const TOKEN = process.env.DAMBI_TOKEN;
const BASE = process.env.DAMBI_URL || "https://dambi-policy.duckdns.org";
const DRY = process.argv.includes("--dry");

if (!TOKEN && !DRY) {
  console.error("Set DAMBI_TOKEN=<jwt> (or pass --dry).");
  process.exit(1);
}

const policies = JSON.parse(fs.readFileSync(path.join(OUT, "policies.seed.json"), "utf8"));
const packages = JSON.parse(fs.readFileSync(path.join(OUT, "packages.seed.json"), "utf8"));

const CAT_BY_POLDIR = {
  "token-erc-20": "Token", "dex-amm": "DEX", lending: "Lending", perp: "Perp",
  bridge: "Bridge", "liquid-staking": "LiquidStaking", staking: "Staking",
  restaking: "Restaking", nft: "NFT", airdrop: "Airdrop", launchpad: "Launchpad",
};
const CAT_BY_DIR = { ...CAT_BY_POLDIR, "erc-20": "Token" };
const CAT_BY_PREFIX = {
  TOKEN: "Token", AMM: "DEX", LEND: "Lending", PERP: "Perp", BRIDGE: "Bridge",
  LIDO: "LiquidStaking", STAKE: "Staking", RESTAKE: "Restaking", NFT: "NFT",
  AIRDROP: "Airdrop", LAUNCH: "Launchpad", OTHER: "Others", BASIC: "Others",
};
const cleanKo = (s) =>
  (s || "").replace(/\s*\([^)]*(?:삭제|예정|같음|->|→)[^)]*\)\s*$/u, "").trim();

const bySlug = new Map(policies.filter((p) => p.slug && p.cedar).map((p) => [p.slug, p]));

function policyBody(p) {
  const prefix = (p.code || "").split("-")[0];
  const ko = cleanKo(p.name_ko) || p.slug;
  const en = (p.description_en || ko).replace(/\s*\((DENY|WARN)\)\s*$/i, "");
  return {
    slug: p.slug,
    kind: "policy",
    display_name: { en, ko },
    description: { en, ko },
    domain: "security",
    category: CAT_BY_POLDIR[p.category] || CAT_BY_PREFIX[prefix] || "Others",
    severity: p.severity === "deny" ? "deny" : "warn",
    version: "1.0.0",
    cedar_text: p.cedar,
    manifest: p.manifest ?? undefined,
  };
}

function packageBody(pkg) {
  const members = (pkg.members || [])
    .map((m) => bySlug.get(m.slug))
    .filter(Boolean)
    .map((pol) => ({
      slug: pol.slug,
      display_name: cleanKo(pol.name_ko) || pol.slug,
      cedar_text: pol.cedar,
      manifest: pol.manifest ?? undefined,
    }));
  if (members.length === 0) return null;
  const ko = pkg.name_ko || pkg.slug;
  const en = pkg.name_en || ko;
  return {
    slug: pkg.slug,
    kind: "set",
    display_name: { en, ko },
    description: { en: pkg.description_ko || en, ko: pkg.description_ko || ko },
    category: CAT_BY_DIR[pkg.category] || "Others",
    version: "1.0.0",
    members,
  };
}

const bodies = [
  ...policies.filter((p) => p.slug && p.cedar).map(policyBody),
  ...packages.map(packageBody).filter(Boolean),
];

console.log(`${bodies.length} listings to publish → ${BASE}${DRY ? "  (DRY RUN)" : ""}`);

const result = { ok: 0, conflict: 0, fail: 0, errors: [] };
for (const body of bodies) {
  if (DRY) {
    console.log(`  [dry] ${body.kind} ${body.slug} (${body.category})`);
    continue;
  }
  try {
    const res = await fetch(`${BASE}/market/listings`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      result.ok++;
    } else {
      const txt = await res.text();
      if (res.status === 409 || /exist|conflict|unique/i.test(txt)) {
        result.conflict++;
      } else {
        result.fail++;
        result.errors.push(`${body.slug}: HTTP ${res.status} ${txt.slice(0, 120)}`);
      }
    }
  } catch (e) {
    result.fail++;
    result.errors.push(`${body.slug}: ${String(e.message || e)}`);
  }
}

if (!DRY) {
  console.log(`\nDONE — ok:${result.ok}  conflict(이미 존재):${result.conflict}  fail:${result.fail}`);
  if (result.errors.length) console.log("errors:\n" + result.errors.slice(0, 20).join("\n"));
}
