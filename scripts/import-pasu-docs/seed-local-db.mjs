#!/usr/bin/env node
// Seed the LOCAL marketplace DB (docker scopeball-pg) from the pasu-docs import.
// Replaces existing market_listings with the doc catalog as an OFFICIAL publisher,
// with dashboard-taxonomy categories so the browse grid classifies them.
//
// Emits out/seed.sql; apply with:
//   node seed-local-db.mjs && docker exec -i scopeball-pg psql -U scopeball -d scopeball < out/seed.sql

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "out");
const policies = JSON.parse(fs.readFileSync(path.join(OUT, "policies.seed.json"), "utf8"));
const packages = JSON.parse(fs.readFileSync(path.join(OUT, "packages.seed.json"), "utf8"));

// dir / code-prefix → dashboard CategoryKey (mirror of import.mjs)
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

const TS = Math.floor(Date.UTC(2026, 5, 12) / 1000);
const PUB = "u_wallet_guardians";
const PUB_EMAIL = "official@walletguardians.seed";

const uuid = (key) => {
  const h = crypto.createHash("md5").update(key).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};
const Q = (s) => `$WG$${s ?? ""}$WG$`; // dollar-quote (cedar/json never contain $WG$)
const J = (o) => `${Q(JSON.stringify(o))}::jsonb`;
const cleanKo = (s) =>
  (s || "").replace(/\s*\([^)]*(?:삭제|예정|같음|->|→)[^)]*\)\s*$/u, "").trim();

// Target: "local" (default) wipes everything; "prod" deletes only liam's
// imported listings (owner of the current remote catalog) and keeps the rest.
const TARGET = process.argv[2] === "prod" ? "prod" : "local";
const LIAM_ID = "u_58ea8698f705"; // publisher of the 100 listings now on prod

const bySlug = new Map(policies.filter((p) => p.slug && p.cedar).map((p) => [p.slug, p]));
const lines = [];
lines.push("BEGIN;");
lines.push(
  `INSERT INTO users(user_id,email,provider,created_at,last_login_at) VALUES ('${PUB}',${Q(PUB_EMAIL)},'seed',${TS},${TS}) ON CONFLICT (user_id) DO NOTHING;`,
);
if (TARGET === "prod") {
  // Remove the existing remote catalog (liam's bulk import). ON DELETE CASCADE
  // drops their versions/installs/reviews. Frees the overlapping slugs so our
  // inserts don't conflict.
  lines.push(`DELETE FROM market_listings WHERE publisher_id = '${LIAM_ID}';`);
} else {
  // Replace whatever local market data exists with the doc catalog.
  lines.push("TRUNCATE market_listings CASCADE;");
}

const seenSlugs = new Set();
let nPol = 0;
let nPkg = 0;

for (const p of policies) {
  if (!p.slug || !p.cedar) continue;
  if (seenSlugs.has(p.slug)) continue;
  seenSlugs.add(p.slug);
  const prefix = (p.code || "").split("-")[0];
  const category = CAT_BY_POLDIR[p.category] || CAT_BY_PREFIX[prefix] || "Others";
  const severity = p.severity === "deny" ? "deny" : "warn";
  const ko = cleanKo(p.name_ko) || p.slug;
  const en = (p.description_en || ko).replace(/\s*\((DENY|WARN)\)\s*$/i, "");
  const id = uuid(p.slug);
  const dn = { en, ko };
  lines.push(
    `INSERT INTO market_listings(id,slug,kind,publisher_id,publisher_tier,display_name,description,domain,category,doc,severity,status,current_version,created_at,updated_at) ` +
      `VALUES ('${id}',${Q(p.slug)},'policy','${PUB}','official',${J(dn)},${J(dn)},'security',${Q(category)},${p.doc ? J(p.doc) : "NULL"},'${severity}','published','1.0.0',${TS},${TS});`,
  );
  lines.push(
    `INSERT INTO market_listing_versions(listing_id,version,major,minor,patch,cedar_text,manifest,published_at) ` +
      `VALUES ('${id}','1.0.0',1,0,0,${Q(p.cedar)},${p.manifest ? J(p.manifest) : "NULL"},${TS});`,
  );
  nPol++;
}

for (const pkg of packages) {
  if (seenSlugs.has(pkg.slug)) continue;
  const members = (pkg.members || [])
    .map((m) => bySlug.get(m.slug))
    .filter(Boolean)
    .map((pol) => ({
      slug: pol.slug,
      display_name: cleanKo(pol.name_ko) || pol.slug,
      cedar_text: pol.cedar,
      manifest: pol.manifest || null,
    }));
  if (members.length === 0) continue; // set version requires non-empty members
  seenSlugs.add(pkg.slug);
  const category = CAT_BY_DIR[pkg.category] || "Others";
  const id = uuid("pkg:" + pkg.slug);
  const dn = { en: pkg.name_en || pkg.name_ko || pkg.slug, ko: pkg.name_ko || pkg.slug };
  const desc = { en: pkg.description_ko || dn.en, ko: pkg.description_ko || dn.ko };
  lines.push(
    `INSERT INTO market_listings(id,slug,kind,publisher_id,publisher_tier,display_name,description,category,status,current_version,created_at,updated_at) ` +
      `VALUES ('${id}',${Q(pkg.slug)},'set','${PUB}','official',${J(dn)},${J(desc)},${Q(category)},'published','1.0.0',${TS},${TS});`,
  );
  lines.push(
    `INSERT INTO market_listing_versions(listing_id,version,major,minor,patch,members,published_at) ` +
      `VALUES ('${id}','1.0.0',1,0,0,${J(members)},${TS});`,
  );
  nPkg++;
}

lines.push("COMMIT;");
fs.mkdirSync(OUT, { recursive: true });
const outFile = TARGET === "prod" ? "seed-prod.sql" : "seed.sql";
fs.writeFileSync(path.join(OUT, outFile), lines.join("\n") + "\n");
console.log(
  `wrote out/${outFile} — ${nPol} policies + ${nPkg} packages (publisher=${PUB}, tier=official, target=${TARGET})`,
);
