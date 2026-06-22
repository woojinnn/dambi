import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRedirectURL: vi.fn<() => string>(),
  launchWebAuthFlow: vi.fn<(opts: { url: string; interactive: boolean }) => Promise<string>>(),
  setTokens: vi.fn<(access: string | null, refresh?: string | null) => Promise<void>>(),
}));

vi.mock("webextension-polyfill", () => ({
  default: {
    identity: {
      getRedirectURL: mocks.getRedirectURL,
      launchWebAuthFlow: mocks.launchWebAuthFlow,
    },
  },
}));

vi.mock("./tokenStore", () => ({
  setTokens: mocks.setTokens,
}));

vi.mock("./client", () => ({
  getServerBaseUrl: () => "https://dambi-policy.duckdns.org",
}));

import { parseTokensFromUrl, startGoogleLogin } from "./oauthFlow";

describe("OAuth flow token parsing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRedirectURL.mockReturnValue("https://extension-id.chromiumapp.org/");
    mocks.setTokens.mockResolvedValue(undefined);
  });

  it("parses access and refresh tokens from the redirect fragment", () => {
    expect(
      parseTokensFromUrl(
        "https://extension-id.chromiumapp.org/#access_token=access&refresh_token=refresh",
      ),
    ).toEqual({ access: "access", refresh: "refresh" });
  });

  it("redacts redirect fragments from missing-access errors", async () => {
    mocks.launchWebAuthFlow.mockResolvedValue(
      "https://extension-id.chromiumapp.org/#refresh_token=secret-refresh&state=opaque",
    );

    let message = "";
    try {
      await startGoogleLogin();
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }

    expect(message).toContain("#<redacted>");
    expect(message).not.toMatch(/secret-refresh|refresh_token/);
    expect(mocks.setTokens).not.toHaveBeenCalled();
  });
});
