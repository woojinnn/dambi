import { describe, expect, it } from "vitest";
import { GcsObjectReader, classifyGcsError, gcsMediaUrl } from "../gcs-client";

function response(
  status: number,
  body = "",
  statusText = status === 200 ? "OK" : "error",
) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    async arrayBuffer() {
      const bytes = Buffer.from(body);
      return bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      );
    },
  };
}

describe("classifyGcsError", () => {
  it("maps a 404 code to not_found", () => {
    expect(classifyGcsError({ code: 404 })).toBe("not_found");
  });
  it("maps a string '404' to not_found", () => {
    expect(classifyGcsError({ code: "404" })).toBe("not_found");
  });
  it("maps a 403 (bucket IAM misconfig) to upstream_error", () => {
    expect(classifyGcsError({ code: 403 })).toBe("upstream_error");
  });
  it("maps a network error to upstream_error", () => {
    expect(classifyGcsError(new Error("ECONNRESET"))).toBe("upstream_error");
  });
});

describe("gcsMediaUrl", () => {
  it("encodes bucket and object path components for the GCS media endpoint", () => {
    expect(
      gcsMediaUrl("registry bucket", "index/by-callkey/1__0x abc.json"),
    ).toBe(
      "https://storage.googleapis.com/storage/v1/b/registry%20bucket/o/index%2Fby-callkey%2F1__0x%20abc.json?alt=media",
    );
  });
});

describe("GcsObjectReader", () => {
  it("reads through the JSON API with a bearer token", async () => {
    const calls: Array<{ url: string; authorization: string | undefined }> = [];
    const reader = new GcsObjectReader({
      bucketName: "registry-bucket",
      auth: {
        async getAccessToken() {
          return "test-token";
        },
      },
      fetchImpl: async (url, init) => {
        calls.push({ url, authorization: init.headers.authorization });
        return response(200, "{\"ok\":true}");
      },
    });

    const result = await reader.read("index/by-callkey/key.json");

    expect(result.kind).toBe("found");
    if (result.kind === "found") {
      expect(result.body.toString("utf8")).toBe("{\"ok\":true}");
      expect(result.contentType).toBe("application/json; charset=utf-8");
    }
    expect(calls).toEqual([
      {
        url: "https://storage.googleapis.com/storage/v1/b/registry-bucket/o/index%2Fby-callkey%2Fkey.json?alt=media",
        authorization: "Bearer test-token",
      },
    ]);
  });

  it("maps a GCS 404 response to not_found", async () => {
    const reader = new GcsObjectReader({
      bucketName: "registry-bucket",
      auth: {
        async getAccessToken() {
          return "test-token";
        },
      },
      fetchImpl: async () => response(404, "", "Not Found"),
    });

    await expect(reader.read("missing.json")).resolves.toEqual({
      kind: "not_found",
    });
  });

  it("maps a GCS permission response to upstream_error", async () => {
    const reader = new GcsObjectReader({
      bucketName: "registry-bucket",
      auth: {
        async getAccessToken() {
          return "test-token";
        },
      },
      fetchImpl: async () => response(403, "", "Forbidden"),
    });

    await expect(reader.read("forbidden.json")).resolves.toEqual({
      kind: "upstream_error",
      message: "GCS read failed: 403 Forbidden",
    });
  });

  it("fails closed when ADC cannot provide an access token", async () => {
    let fetchCalls = 0;
    const reader = new GcsObjectReader({
      bucketName: "registry-bucket",
      auth: {
        async getAccessToken() {
          return null;
        },
      },
      fetchImpl: async () => {
        fetchCalls += 1;
        return response(200, "{}");
      },
    });

    await expect(reader.read("index.json")).resolves.toEqual({
      kind: "upstream_error",
      message: "GCS auth token unavailable",
    });
    expect(fetchCalls).toBe(0);
  });
});
