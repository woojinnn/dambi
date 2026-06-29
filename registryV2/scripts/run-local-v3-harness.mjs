#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const registryRoot = resolve(here, "..");
const repoRoot = resolve(registryRoot, "..");
const localHarnessManifest = join(repoRoot, "crates", "integration-tests", "Cargo.toml");

if (!existsSync(localHarnessManifest)) {
  console.error(
    [
      "[run-local-v3-harness] missing local-only crates/integration-tests harness.",
      "This repo keeps that crate gitignored, so the Rust v3 manifest harness is",
      "available only in developer workspaces that have restored the local harness.",
    ].join(" ")
  );
  process.exit(1);
}

const rootCargoTomlPath = join(repoRoot, "Cargo.toml");
const rootCargoToml = readFileSync(rootCargoTomlPath, "utf8");
const workspaceCargoToml = rootCargoToml.includes('"crates/integration-tests"')
  ? rootCargoToml
  : rootCargoToml.replace(
      '    "crates/policy-engine-wasm",',
      '    "crates/policy-engine-wasm",\n    "crates/integration-tests",'
    );

if (!workspaceCargoToml.includes('"crates/integration-tests"')) {
  console.error("[run-local-v3-harness] failed to inject local harness into temporary workspace");
  process.exit(1);
}

const tmpRoot = mkdtempSync(join(tmpdir(), "dambi-v3-harness-"));
try {
  writeFileSync(join(tmpRoot, "Cargo.toml"), workspaceCargoToml);
  for (const name of ["Cargo.lock", "crates", "registryV2", "schema"]) {
    const src = join(repoRoot, name);
    if (existsSync(src)) {
      symlinkSync(src, join(tmpRoot, name));
    }
  }

  const args = [
    "run",
    "--quiet",
    "--manifest-path",
    join(tmpRoot, "crates", "integration-tests", "Cargo.toml"),
    "--bin",
    "v3-harness",
    "--",
    ...process.argv.slice(2),
  ];
  const result = spawnSync("cargo", args, {
    cwd: tmpRoot,
    stdio: "inherit",
    env: process.env,
  });
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(tmpRoot, { recursive: true, force: true });
}
