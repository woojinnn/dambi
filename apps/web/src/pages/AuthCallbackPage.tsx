import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { consumeTokensFromHash, getStoredToken } from "@scopeball/api-client";

/**
 * Hit by the server's OAuth redirect with `#access_token=…`. Pulls the
 * tokens out of the hash, stores them, and bounces home.
 *
 * `consumeTokensFromHash` clears the hash after reading it, so under
 * StrictMode the second effect run sees an empty hash. We fall back to
 * `getStoredToken()` (set by the first run) to avoid bouncing back to
 * /login on the second pass.
 */
export function AuthCallbackPage() {
  const navigate = useNavigate();
  useEffect(() => {
    const fresh = consumeTokensFromHash();
    const token = fresh ?? getStoredToken();
    navigate(token ? "/" : "/login", { replace: true });
  }, [navigate]);
  return <p style={{ padding: 24 }}>Signing in…</p>;
}
