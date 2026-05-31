/**
 * `WalletsPage` — lists wallets the policy-rpc server knows about for
 * the authenticated user, with a tiny "add wallet" stub.
 *
 * Read-side uses the live SQLite-backed endpoints. Write-side (POST
 * /wallets) doesn't exist on the server yet, so the form is a UI
 * placeholder until that lands.
 */

import { useCallback, useEffect, useState } from "react";

import { listWallets, type WalletId } from "../server-api";
import { useAuth } from "../hooks/useAuth";

export function WalletsPage() {
  const { user, logout } = useAuth();
  const [wallets, setWallets] = useState<WalletId[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const w = await listWallets();
      setWallets(w);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <div style={{ padding: 24, maxWidth: 720, margin: "0 auto" }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <h1>Wallets</h1>
        <div style={{ opacity: 0.7 }}>
          {user?.email}{" "}
          <button onClick={logout} style={smallBtn}>
            Sign out
          </button>
        </div>
      </header>

      {error && (
        <p style={{ color: "crimson" }}>Failed to load wallets: {error}</p>
      )}

      {wallets === null && !error && <p>Loading…</p>}

      {wallets && wallets.length === 0 && (
        <p style={{ opacity: 0.7 }}>
          No wallets tracked yet. (Add via the browser extension or the future
          POST /wallets endpoint.)
        </p>
      )}

      {wallets && wallets.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {wallets.map((w) => (
            <li
              key={w.address}
              style={{
                padding: "12px 16px",
                border: "1px solid #ddd",
                borderRadius: 6,
                marginBottom: 8,
              }}
            >
              <code style={{ fontSize: 14 }}>{w.address}</code>
              <div style={{ fontSize: 12, opacity: 0.65 }}>
                Chains: {w.chains.join(", ") || "(none)"}
              </div>
            </li>
          ))}
        </ul>
      )}

      <button onClick={reload} style={{ ...smallBtn, marginTop: 16 }}>
        Refresh
      </button>
    </div>
  );
}

const smallBtn: React.CSSProperties = {
  fontSize: 12,
  padding: "4px 10px",
  borderRadius: 4,
  border: "1px solid #888",
  background: "white",
  cursor: "pointer",
};
