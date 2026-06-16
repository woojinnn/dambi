import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../config";

const OLD_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...OLD_ENV };
});

describe("loadConfig", () => {
  it("defaults to the registry-v3 production bucket", () => {
    delete process.env.REGISTRY_BUCKET;

    expect(loadConfig().bucketName).toBe("dambi-registry-v3-seoul");
  });

  it("allows REGISTRY_BUCKET to override the default bucket", () => {
    process.env.REGISTRY_BUCKET = "custom-registry-bucket";

    expect(loadConfig().bucketName).toBe("custom-registry-bucket");
  });
});
