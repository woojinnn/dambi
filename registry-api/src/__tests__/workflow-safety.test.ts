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
});
