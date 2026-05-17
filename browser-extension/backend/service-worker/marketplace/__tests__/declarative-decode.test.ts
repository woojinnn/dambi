/**
 * Phase 6 — `declarative-decode` cases.
 *
 * The decoder is a pure function over `(bundle, calldataHex)`, so these tests
 * stay zero-mock. We read the canonical V2 swap fixture (same one the Rust
 * side uses) plus the static integration-tests calldata fixture so the wire
 * shape is locked in lockstep with the engine.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseBundle } from "../bundle-schema";
import {
  decodeBundleCalldata,
  DeclarativeDecodeError,
  buildRouteInput,
  extractSelector,
} from "../declarative-decode";

const BUNDLE_PATH = path.resolve(
  __dirname,
  "../../../../../crates/adapters/mappers/tests/fixtures/uniswap-v2-swap-exact-tokens.json",
);

const V2_RAW_TX_PATH = path.resolve(
  __dirname,
  "../../../../../crates/integration-tests/data/golden/inputs/swap_uniswap_v2_exact_in.json",
);

function loadBundle() {
  return parseBundle(JSON.parse(readFileSync(BUNDLE_PATH, "utf8")));
}

function loadV2Calldata(): string {
  const fixture = JSON.parse(readFileSync(V2_RAW_TX_PATH, "utf8"));
  return fixture.rpc.params[0].data;
}

describe("extractSelector", () => {
  it("returns lowercased 0x + 8 hex for valid calldata", () => {
    expect(extractSelector("0x38ed1739abcd")).toBe("0x38ed1739");
    expect(extractSelector("0x38ED1739abcd")).toBe("0x38ed1739");
  });

  it("returns null for empty or too-short calldata", () => {
    expect(extractSelector(undefined)).toBeNull();
    expect(extractSelector("")).toBeNull();
    expect(extractSelector("0x")).toBeNull();
    expect(extractSelector("0x1234")).toBeNull();
  });

  it("returns null when 0x prefix missing", () => {
    expect(extractSelector("38ed1739")).toBeNull();
  });
});

describe("decodeBundleCalldata — V2 swap fixture", () => {
  it("decodes the canonical V2 calldata into the WASM wire shape", () => {
    const bundle = loadBundle();
    const decoded = decodeBundleCalldata(bundle, loadV2Calldata());

    expect(decoded.decoder_id).toBe(
      "declarative.uniswap/v2/swapExactTokensForTokens",
    );
    expect(decoded.function_signature).toBe(
      "swapExactTokensForTokens(uint256,uint256,address[],address,uint256)",
    );
    expect(decoded.args).toHaveLength(5);

    // amountIn (uint256) - 0xbebc200 = 200_000_000 (USDT raw amount, 6 decimals → 200 USDT)
    expect(decoded.args[0]).toMatchObject({
      name: "amountIn",
      abi_type: "uint256",
      value: { kind: "uint", value: "200000000" },
    });
    // amountOutMin (uint256) — fixture sets this to 0 (no slippage floor).
    expect(decoded.args[1]).toMatchObject({
      name: "amountOutMin",
      abi_type: "uint256",
      value: { kind: "uint", value: "0" },
    });
    // path (address[2]): USDT → WETH (both lowercased)
    expect(decoded.args[2].name).toBe("path");
    expect(decoded.args[2].abi_type).toBe("address[]");
    expect(decoded.args[2].value.kind).toBe("array");
    const pathArr = (
      decoded.args[2].value as { kind: "array"; value: unknown[] }
    ).value as Array<{ kind: string; value: string }>;
    expect(pathArr).toHaveLength(2);
    expect(pathArr[0]).toEqual({
      kind: "address",
      value: "0xdac17f958d2ee523a2206206994597c13d831ec7",
    });
    expect(pathArr[1]).toEqual({
      kind: "address",
      value: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
    });
    // to (address)
    expect(decoded.args[3]).toMatchObject({
      name: "to",
      abi_type: "address",
      value: {
        kind: "address",
        value: "0x1111111111111111111111111111111111111111",
      },
    });
    // deadline (uint256) — 0x2540be3ff = 9_999_999_999.
    expect(decoded.args[4]).toMatchObject({
      name: "deadline",
      abi_type: "uint256",
      value: { kind: "uint", value: "9999999999" },
    });
  });

  it("throws decode_failed when calldata is empty", () => {
    const bundle = loadBundle();
    try {
      decodeBundleCalldata(bundle, "0x");
      expect.fail("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(DeclarativeDecodeError);
      expect((err as DeclarativeDecodeError).code).toBe("missing_calldata");
    }
  });

  it("throws decode_failed when selector does not match bundle ABI", () => {
    const bundle = loadBundle();
    // Replace selector with one the bundle does not declare.
    const real = loadV2Calldata();
    const bad = "0xdeadbeef" + real.slice(10);
    try {
      decodeBundleCalldata(bundle, bad);
      expect.fail("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(DeclarativeDecodeError);
      expect((err as DeclarativeDecodeError).code).toBe("decode_failed");
    }
  });
});

describe("buildRouteInput", () => {
  it("composes the wire envelope with sensible defaults", () => {
    const bundle = loadBundle();
    const decoded = decodeBundleCalldata(bundle, loadV2Calldata());
    const input = buildRouteInput({
      chainId: 1,
      to: "0x7a250d5630b4cf539739df2c5dacb4c659f2488d",
      selector: "0x38ed1739",
      from: "0x0000000000000000000000000000000000000001",
      decoded,
    });

    expect(input.chain_id).toBe(1);
    expect(input.to).toBe("0x7a250d5630b4cf539739df2c5dacb4c659f2488d");
    expect(input.selector).toBe("0x38ed1739");
    expect(input.ctx).toEqual({
      chain_id: 1,
      from: "0x0000000000000000000000000000000000000001",
      to: "0x7a250d5630b4cf539739df2c5dacb4c659f2488d",
      value_wei: "0",
    });
    expect(input.decoded).toBe(decoded);
  });

  it("includes block_timestamp when supplied", () => {
    const bundle = loadBundle();
    const decoded = decodeBundleCalldata(bundle, loadV2Calldata());
    const input = buildRouteInput({
      chainId: 1,
      to: "0x7a250d5630b4cf539739df2c5dacb4c659f2488d",
      selector: "0x38ed1739",
      from: "0x0000000000000000000000000000000000000001",
      blockTimestamp: 1_700_000_000,
      decoded,
    });
    expect(input.ctx.block_timestamp).toBe(1_700_000_000);
  });
});
