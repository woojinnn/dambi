import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  provisionWallets: vi.fn(async () => undefined),
}));

vi.mock("../server-api/policy-store", () => ({
  provisionWallets: mocks.provisionWallets,
}));

import { useProvisionWallets } from "./use-provision-wallets";

const A = "0xa100000000000000000000000000000000000001";
const B = "0xb200000000000000000000000000000000000002";

function snap(addresses: string[]) {
  return {
    library: { schemaVersion: 1, defs: {}, packages: {} },
    wallets: {
      schemaVersion: 1,
      byAddress: Object.fromEntries(
        addresses.map((address) => [
          address,
          { bindings: {}, packages: {}, packageEnabled: {} },
        ]),
      ),
    },
    rev: 1,
  };
}

function Probe({
  serverAddresses,
  knownAddresses,
  invalidate,
}: {
  serverAddresses: string[];
  knownAddresses: string[];
  invalidate: () => void;
}) {
  useProvisionWallets(serverAddresses, snap(knownAddresses), invalidate);
  return null;
}

describe("useProvisionWallets", () => {
  beforeEach(() => mocks.provisionWallets.mockClear());
  afterEach(() => cleanup());

  it("provisions a wallet added after an initial no-op pass", async () => {
    const invalidate = vi.fn();
    const { rerender } = render(
      <Probe
        serverAddresses={[A]}
        knownAddresses={[A]}
        invalidate={invalidate}
      />,
    );

    expect(mocks.provisionWallets).not.toHaveBeenCalled();

    rerender(
      <Probe
        serverAddresses={[A, B]}
        knownAddresses={[A]}
        invalidate={invalidate}
      />,
    );

    await waitFor(() =>
      expect(mocks.provisionWallets).toHaveBeenCalledWith([B]),
    );
    await waitFor(() => expect(invalidate).toHaveBeenCalled());
  });
});
