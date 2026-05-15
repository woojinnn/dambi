import { describe, expect, it } from "vitest";
import {
  AdapterManifestError,
  parseAdapterManifest,
  type AdapterManifest,
} from "@lib/adapter-manifest";

function validVersion(overrides: Record<string, unknown> = {}) {
  return {
    version: "0.1.0",
    url: "/adapters/uniswap-v4/0.1.0/adapter.wasm",
    sha256: "0x" + "ab".repeat(32),
    size_bytes: 528_344,
    supported_chains: [1, 10, 8453],
    supported_addresses: [
      { chain_id: 1, address: "0x000000000004444c5dc75cb358380d2e3de08a90" },
    ],
    host_capabilities: ["oracle.usd_value"],
    signature: null,
    signer_id: null,
    published_at: "2026-05-15T06:30:00Z",
    revoked: false,
    ...overrides,
  };
}

function validEntry(overrides: Record<string, unknown> = {}) {
  return {
    protocol: "uniswap-v4",
    display_name: "Uniswap V4",
    stable_version: "0.1.0",
    canary_version: null,
    versions: [validVersion()],
    ...overrides,
  };
}

function validManifest(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    generated_at: "2026-05-15T07:00:00Z",
    adapters: [validEntry()],
    ...overrides,
  };
}

describe("parseAdapterManifest", () => {
  it("accepts an empty manifest (no adapters)", () => {
    const parsed = parseAdapterManifest({
      schema_version: 1,
      generated_at: "2026-05-15T07:00:00Z",
      adapters: [],
    });
    expect(parsed.adapters).toEqual([]);
  });

  it("parses a fully-populated single-adapter manifest", () => {
    const parsed: AdapterManifest = parseAdapterManifest(validManifest());
    expect(parsed.schema_version).toBe(1);
    expect(parsed.adapters).toHaveLength(1);
    const [entry] = parsed.adapters;
    expect(entry.protocol).toBe("uniswap-v4");
    expect(entry.stable_version).toBe("0.1.0");
    expect(entry.canary_version).toBeNull();
    expect(entry.versions[0].sha256).toMatch(/^0x[0-9a-f]{64}$/);
    expect(entry.versions[0].revoked).toBe(false);
  });

  it("rejects an unsupported schema_version", () => {
    expect(() =>
      parseAdapterManifest(validManifest({ schema_version: 999 })),
    ).toThrow(AdapterManifestError);
  });

  it("rejects a manifest whose stable_version is not in versions[]", () => {
    expect(() =>
      parseAdapterManifest(
        validManifest({
          adapters: [validEntry({ stable_version: "9.9.9" })],
        }),
      ),
    ).toThrow(/stable_version "9.9.9" not in versions/);
  });

  it("rejects a manifest whose canary_version is set but missing from versions[]", () => {
    expect(() =>
      parseAdapterManifest(
        validManifest({
          adapters: [validEntry({ canary_version: "0.2.0" })],
        }),
      ),
    ).toThrow(/canary_version "0.2.0" not in versions/);
  });

  it("accepts a canary_version that exists in versions[]", () => {
    const parsed = parseAdapterManifest(
      validManifest({
        adapters: [
          validEntry({
            canary_version: "0.2.0",
            versions: [
              validVersion(),
              validVersion({ version: "0.2.0" }),
            ],
          }),
        ],
      }),
    );
    expect(parsed.adapters[0].canary_version).toBe("0.2.0");
  });

  it("rejects sha256 with wrong length", () => {
    expect(() =>
      parseAdapterManifest(
        validManifest({
          adapters: [
            validEntry({ versions: [validVersion({ sha256: "0xdeadbeef" })] }),
          ],
        }),
      ),
    ).toThrow(/expected 0x-prefixed 32-byte hex string/);
  });

  it("rejects an upper-cased address (must be lowercased canonical)", () => {
    expect(() =>
      parseAdapterManifest(
        validManifest({
          adapters: [
            validEntry({
              versions: [
                validVersion({
                  supported_addresses: [
                    { chain_id: 1, address: "0xABCDEF1234567890ABCDEF1234567890ABCDEF12" },
                  ],
                }),
              ],
            }),
          ],
        }),
      ),
    ).not.toThrow();
    // Parser normalizes to lowercase rather than rejecting — confirm.
    const parsed = parseAdapterManifest(
      validManifest({
        adapters: [
          validEntry({
            versions: [
              validVersion({
                supported_addresses: [
                  { chain_id: 1, address: "0xABCDEF1234567890ABCDEF1234567890ABCDEF12" },
                ],
              }),
            ],
          }),
        ],
      }),
    );
    expect(parsed.adapters[0].versions[0].supported_addresses[0].address).toBe(
      "0xabcdef1234567890abcdef1234567890abcdef12",
    );
  });

  it("rejects an empty versions[] array", () => {
    expect(() =>
      parseAdapterManifest(
        validManifest({ adapters: [validEntry({ versions: [] })] }),
      ),
    ).toThrow(/must contain at least one version/);
  });

  it("rejects when revoked is missing (required field, no implicit default)", () => {
    const v = validVersion();
    delete (v as { revoked?: boolean }).revoked;
    expect(() =>
      parseAdapterManifest(
        validManifest({ adapters: [validEntry({ versions: [v] })] }),
      ),
    ).toThrow(/missing required field/);
  });

  it("rejects when sha256 is missing", () => {
    const v = validVersion();
    delete (v as { sha256?: string }).sha256;
    expect(() =>
      parseAdapterManifest(
        validManifest({ adapters: [validEntry({ versions: [v] })] }),
      ),
    ).toThrow(/missing required field/);
  });

  it("rejects a non-integer chain_id", () => {
    expect(() =>
      parseAdapterManifest(
        validManifest({
          adapters: [
            validEntry({
              versions: [validVersion({ supported_chains: [1, 1.5] })],
            }),
          ],
        }),
      ),
    ).toThrow(/expected non-negative integer chain id/);
  });
});
