import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function repoText(...parts: string[]): string {
  return readFileSync(
    join(process.cwd(), "..", ...parts),
    "utf8",
  );
}

function workflowText(name: string): string {
  return repoText(".github", "workflows", name);
}

describe("registry deployment workflow safety", () => {
  it("guards policy-server deploys against branch-selected production runs", () => {
    const workflow = workflowText("policy-server-deploy.yml");
    const guard = workflow.indexOf("name: Require policy-server deploy release ref");
    const auth = workflow.indexOf("name: Authenticate to Google Cloud");
    const deploy = workflow.indexOf("name: Deploy with Helm");

    expect(workflow).toContain("environment: production");
    expect(guard).toBeGreaterThan(-1);
    expect(auth).toBeGreaterThan(guard);
    expect(deploy).toBeGreaterThan(guard);
    expect(workflow).toContain(
      'DEFAULT_BRANCH="${{ github.event.repository.default_branch }}"',
    );
    expect(workflow).toContain('test "${GITHUB_REF_TYPE}" = "branch"');
    expect(workflow).toContain(
      'test "${GITHUB_REF_NAME}" = "${DEFAULT_BRANCH}"',
    );
  });

  it("guards registry proxy deploys against branch-selected production runs", () => {
    const workflow = workflowText("registry-proxy-deploy.yml");
    const guard = workflow.indexOf("name: Require registry proxy release ref");
    const auth = workflow.indexOf("name: Authenticate to Google Cloud");
    const deploy = workflow.indexOf("name: Build proxy image + deploy to Cloud Run");

    expect(guard).toBeGreaterThan(-1);
    expect(auth).toBeGreaterThan(guard);
    expect(deploy).toBeGreaterThan(guard);
    expect(workflow).toContain(
      'DEFAULT_BRANCH="${{ github.event.repository.default_branch }}"',
    );
    expect(workflow).toContain(
      'if [ "${GITHUB_EVENT_NAME}" = "workflow_dispatch" ]; then',
    );
    expect(workflow).toContain(
      'test "${GITHUB_REF_NAME}" = "${DEFAULT_BRANCH}"',
    );
    expect(workflow).toContain('test "${GITHUB_REF_TYPE}" = "tag"');
    expect(workflow).toContain("registry-proxy-v*");
  });

  it("guards registry publishes against branch-selected bucket mutations", () => {
    const workflow = workflowText("registry-publish.yml");
    const guard = workflow.indexOf("name: Require registry publish release ref");
    const auth = workflow.indexOf("name: Authenticate to Google Cloud");
    const publish = workflow.indexOf("name: Publish to GCS");

    expect(guard).toBeGreaterThan(-1);
    expect(auth).toBeGreaterThan(guard);
    expect(publish).toBeGreaterThan(guard);
    expect(workflow).toContain(
      'DEFAULT_BRANCH="${{ github.event.repository.default_branch }}"',
    );
    expect(workflow).toContain(
      'if [ "${GITHUB_EVENT_NAME}" = "workflow_dispatch" ]; then',
    );
    expect(workflow).toContain(
      'test "${GITHUB_REF_NAME}" = "${DEFAULT_BRANCH}"',
    );
    expect(workflow).toContain('test "${GITHUB_REF_TYPE}" = "tag"');
    expect(workflow).toContain("registry-v*");
  });

  it("passes the extension pin into the KMS signing validity gate", () => {
    const workflow = workflowText("registry-publish.yml");
    const localPublish = repoText(
      "registryV2",
      "scripts",
      "deploy",
      "publish-index.sh",
    );
    const pinCheck = workflow.indexOf("name: Verify KMS signing key matches extension pin");
    const sign = workflow.indexOf("name: Sign bundles (KMS, DER→P1363)");
    const publish = workflow.indexOf("name: Publish to GCS");

    expect(pinCheck).toBeGreaterThan(-1);
    expect(sign).toBeGreaterThan(pinCheck);
    expect(publish).toBeGreaterThan(sign);
    expect(workflow).toContain("PINNED_BUNDLE_PUBLIC_KEY: ${{ vars.PINNED_BUNDLE_PUBLIC_KEY }}");
    expect(workflow).toContain("npx tsx scripts/sign-bundles.ts");
    expect(localPublish).toContain('BUNDLE_SIGNING_MODE="${BUNDLE_SIGNING_MODE:-kms}"');
    expect(localPublish).toContain('ALLOW_LOCAL_BUNDLE_SIGNING:-0');
  });

  it("does not run dependency lifecycle scripts in registry publish/release installers", () => {
    const registryPublish = workflowText("registry-publish.yml");
    const extensionRelease = workflowText("extension-release.yml");
    const localPublish = repoText(
      "registryV2",
      "scripts",
      "deploy",
      "publish-index.sh",
    );

    expect(registryPublish).toContain("npm ci --ignore-scripts");
    expect(extensionRelease).toContain("npm ci --ignore-scripts");
    expect(localPublish).toContain(
      "npm ci --ignore-scripts --no-audit --no-fund --silent",
    );
    expect(localPublish).not.toContain("npm install");
  });

  it("pins wasm-pack installs without executing the remote installer script", () => {
    const ci = workflowText("ci.yml");
    const extensionRelease = workflowText("extension-release.yml");
    const workflows = [ci, extensionRelease];

    for (const workflow of workflows) {
      expect(workflow).toContain('WASM_PACK_VERSION: "0.14.0"');
      expect(workflow).toContain(
        'cargo install wasm-pack --version "${WASM_PACK_VERSION}" --locked',
      );
      expect(workflow).not.toContain("rustwasm.github.io/wasm-pack/installer");
      expect(workflow).not.toContain("| sh");
    }
  });

  it("disables dependency lifecycle scripts during extension dependency installs", () => {
    const ci = workflowText("ci.yml");
    const extensionRelease = workflowText("extension-release.yml");

    expect(ci).toContain("yarn install --immutable --mode=skip-build");
    expect(extensionRelease).toContain("yarn install --immutable --mode=skip-build");
  });
});
