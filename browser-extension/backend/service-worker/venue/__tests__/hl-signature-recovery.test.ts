/**
 * GOLDEN-VECTOR regression tests for the HyperLiquid L1-action signer recovery.
 *
 * The other venue tests sign with the SAME `hlL1ActionHash` they later recover
 * with (round-trip self-consistency), so a systematic bug in the hand-rolled
 * msgpack encoder or the phantom-agent EIP-712 domain would be INVISIBLE there.
 * These tests instead pin the implementation against HyperLiquid's OFFICIAL
 * vectors from `hyperliquid-python-sdk/tests/signing_test.py`:
 *
 *   - test_phantom_agent_creation_matches_production → a known `action_hash`
 *     (connectionId) value — pins the msgpack encoding + action-hash bytes.
 *   - test_l1_action_signing_order_matches → known signature r/s/v over a known
 *     order, by the SDK test key, on BOTH mainnet (source "a") and testnet
 *     (source "b") — pins the phantom-agent domain/types/source independently
 *     (a wrong domain recovers a DIFFERENT address and fails).
 *   - test_l1_action_signing_matches_with_vault → known signature with a
 *     vaultAddress — pins the vault byte-append branch of `hlL1ActionHash`.
 *
 * If a future refactor of the encoder/domain breaks byte-exactness, these fail.
 */
import { describe, it, expect } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import {
  concatHex,
  numberToHex,
  recoverTypedDataAddress,
  type Hex,
} from "viem";

import type { HyperliquidExchangeEnvelopeWire } from "@lib/types";
import { hlL1ActionHash, recoverHlL1Signer } from "../hl-signature-recovery";

/** The private key used by the hyperliquid-python-sdk signing tests. */
const SDK_KEY =
  "0x0123456789012345678901234567890123456789012345678901234567890123" as const;
const SDK_ACCOUNT = privateKeyToAccount(SDK_KEY);
const SDK_SIGNER = SDK_ACCOUNT.address.toLowerCase();

/** Order wire for the order-signing golden vector (ETH, sz 100, px 100, Gtc, asset 1). */
const ORDER_ACTION = {
  type: "order",
  orders: [{ a: 1, b: true, p: "100", s: "100", r: false, t: { limit: { tif: "Gtc" } } }],
  grouping: "na",
};

const MAINNET = "https://api.hyperliquid.xyz/exchange";
const TESTNET = "https://api.hyperliquid-testnet.xyz/exchange";

function pad32(hex: string): Hex {
  return `0x${hex.slice(2).padStart(64, "0")}` as Hex;
}

describe("hl-signature-recovery — HyperLiquid official golden vectors", () => {
  it("hlL1ActionHash reproduces the SDK phantom-agent connectionId byte-exactly", () => {
    // test_phantom_agent_creation_matches_production: order(ETH, sz 0.0147,
    // px 1670.1, Ioc, asset 4), nonce 1677777606040, no vault / no expiresAfter.
    const action = {
      type: "order",
      orders: [
        { a: 4, b: true, p: "1670.1", s: "0.0147", r: false, t: { limit: { tif: "Ioc" } } },
      ],
      grouping: "na",
    };
    expect(hlL1ActionHash(action, undefined, 1677777606040, undefined)).toBe(
      "0x0fcbeda5ae3c4950a548021552a4fea2226858c4453571bf3f24ba017eac2908",
    );
  });

  it("recoverHlL1Signer recovers the SDK signer from the official MAINNET order signature", async () => {
    // test_l1_action_signing_order_matches (is_mainnet=True) → source "a".
    const envelope: HyperliquidExchangeEnvelopeWire = {
      action: ORDER_ACTION,
      nonce: 0,
      signature: {
        r: "0xd65369825a9df5d80099e513cce430311d7d26ddf477f5b3a33d2806b100d78e",
        s: "0x2b54116ff64054968aa237c20ca9ff68000f977c93289157748a3162b6ea940e",
        v: 28,
      },
    };
    expect(await recoverHlL1Signer(envelope, MAINNET)).toBe(SDK_SIGNER);
  });

  it("recoverHlL1Signer recovers the SDK signer from the official TESTNET order signature (source 'b')", async () => {
    // test_l1_action_signing_order_matches (is_mainnet=False) → source "b".
    const envelope: HyperliquidExchangeEnvelopeWire = {
      action: ORDER_ACTION,
      nonce: 0,
      signature: {
        r: "0x82b2ba28e76b3d761093aaded1b1cdad4960b3af30212b343fb2e6cdfa4e3d54",
        s: "0x6b53878fc99d26047f4d7e8c90eb98955a109f44209163f52d8dc4278cbbd9f5",
        v: 27,
      },
    };
    expect(await recoverHlL1Signer(envelope, TESTNET)).toBe(SDK_SIGNER);
  });

  it("hlL1ActionHash vault-address branch matches the SDK with-vault signature", async () => {
    // test_l1_action_signing_matches_with_vault: action {type:"dummy", num:
    // float_to_int_for_hashing(1000)} = 100000000000, vault 0x1719…, nonce 0.
    // `recoverHlL1Signer` rejects non-L1 action types ("dummy"), so reconstruct
    // the phantom agent directly to isolate the vault byte-append correctness.
    const connectionId = hlL1ActionHash(
      { type: "dummy", num: 100000000000 },
      "0x1719884eb866cb12b2287399b15f7db5e7d775ea",
      0,
      undefined,
    );
    const signature = concatHex([
      pad32("0x3c548db75e479f8012acf3000ca3a6b05606bc2ec0c29c50c515066a326239"),
      pad32("0x4d402be7396ce74fbba3795769cda45aec00dc3125a984f2a9f23177b190da2c"),
      numberToHex(28, { size: 1 }),
    ]);
    const recovered = await recoverTypedDataAddress({
      domain: { name: "Exchange", version: "1", chainId: 1337, verifyingContract: "0x0000000000000000000000000000000000000000" },
      types: { Agent: [{ name: "source", type: "string" }, { name: "connectionId", type: "bytes32" }] },
      primaryType: "Agent",
      message: { source: "a", connectionId },
      signature,
    });
    expect(recovered.toLowerCase()).toBe(SDK_SIGNER);
  });

  it("recoverHlL1Signer exercises the expiresAfter branch (hash mutates + round-trips)", async () => {
    // No official expiresAfter vector exists; prove the branch is wired (the
    // hash MUST change when expiresAfter is present) and that recovery uses the
    // same construction end-to-end.
    const nonce = 1_700_000_000_000;
    const expiresAfter = 1_800_000_000_000;
    const withExpiry = hlL1ActionHash(ORDER_ACTION, undefined, nonce, expiresAfter);
    expect(withExpiry).not.toBe(hlL1ActionHash(ORDER_ACTION, undefined, nonce, undefined));

    const sig = await SDK_ACCOUNT.signTypedData({
      domain: { name: "Exchange", version: "1", chainId: 1337, verifyingContract: "0x0000000000000000000000000000000000000000" },
      types: { Agent: [{ name: "source", type: "string" }, { name: "connectionId", type: "bytes32" }] },
      primaryType: "Agent",
      message: { source: "a", connectionId: withExpiry },
    });
    const envelope: HyperliquidExchangeEnvelopeWire = {
      action: ORDER_ACTION,
      nonce,
      expiresAfter,
      signature: {
        r: `0x${sig.slice(2, 66)}`,
        s: `0x${sig.slice(66, 130)}`,
        v: Number.parseInt(sig.slice(130, 132), 16),
      },
    };
    expect(await recoverHlL1Signer(envelope, MAINNET)).toBe(SDK_SIGNER);
  });

  it("recoverHlL1Signer returns null for a non-L1 action type (no false binding)", async () => {
    const envelope: HyperliquidExchangeEnvelopeWire = {
      action: { type: "dummy", num: 1 },
      nonce: 0,
      signature: { r: `0x${"1".repeat(64)}`, s: `0x${"2".repeat(64)}`, v: 27 },
    };
    expect(await recoverHlL1Signer(envelope, MAINNET)).toBeNull();
  });
});
