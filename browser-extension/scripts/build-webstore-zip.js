#!/usr/bin/env node
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const extRoot = path.resolve(__dirname, "..");
const distDir = path.join(extRoot, "dist");
const sourceTarget = process.env.DAMBI_WEBSTORE_SOURCE_TARGET || "chrome-webstore";
const chromeDist = path.join(distDir, sourceTarget);
const manifestPath = path.join(chromeDist, "manifest.json");
const archiveName = "chrome-webstore.zip";

if (!fs.existsSync(manifestPath)) {
  console.error(
    `[build-webstore-zip] missing ${manifestPath}; run yarn build:chrome:webstore first.`,
  );
  process.exit(1);
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dambi-webstore-"));
const tempChromeDist = path.join(tempRoot, "chrome");

try {
  fs.cpSync(chromeDist, tempChromeDist, { recursive: true });

  const tempManifestPath = path.join(tempChromeDist, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(tempManifestPath, "utf8"));
  if (Object.prototype.hasOwnProperty.call(manifest, "key")) {
    delete manifest.key;
  }
  fs.writeFileSync(tempManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const webExtBin = process.platform === "win32" ? "web-ext.cmd" : "web-ext";
  const result = childProcess.spawnSync(
    webExtBin,
    ["build", "-s", tempChromeDist, "-a", distDir, "-n", archiveName, "-o"],
    {
      cwd: extRoot,
      env: { ...process.env, NO_UPDATE_NOTIFIER: "1" },
      stdio: "inherit",
    },
  );

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  console.log(
    `[build-webstore-zip] wrote ${path.relative(extRoot, path.join(distDir, archiveName))} without manifest.key`,
  );
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
