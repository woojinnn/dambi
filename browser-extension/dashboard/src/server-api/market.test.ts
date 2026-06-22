import { beforeEach, describe, expect, it, vi } from "vitest";

describe("dashboard marketplace API client", () => {
  let storage: Map<string, string>;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    storage = new Map([["dambi_jwt", "access-token"]]);
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
        clear: () => storage.clear(),
      },
    });
  });

  it("encodes marketplace ids before constructing authenticated paths", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({}));
    vi.stubGlobal("fetch", fetchMock);
    const {
      deleteListing,
      getListing,
      getListingVersion,
      reportReview,
      updateReportStatus,
      voteHelpful,
      watchListing,
    } = await import("./market");

    await getListing("safe/listing");
    await getListingVersion("listing/id", "1.2.3+build/meta");
    await deleteListing("listing/id");
    await reportReview("review/id", { reason: "spam" });
    await updateReportStatus("report/id", { status: "resolved" });
    await voteHelpful("review/id");
    await watchListing("listing/id");

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://dambi-policy.duckdns.org/market/listings/safe%2Flisting",
    );
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://dambi-policy.duckdns.org/market/listings/id/listing%2Fid/versions/1.2.3%2Bbuild%2Fmeta",
    );
    expect(fetchMock.mock.calls[2][0]).toBe(
      "https://dambi-policy.duckdns.org/market/listings/id/listing%2Fid",
    );
    expect(fetchMock.mock.calls[3][0]).toBe(
      "https://dambi-policy.duckdns.org/market/reviews/review%2Fid/report",
    );
    expect(fetchMock.mock.calls[4][0]).toBe(
      "https://dambi-policy.duckdns.org/market/reports/report%2Fid",
    );
    expect(fetchMock.mock.calls[5][0]).toBe(
      "https://dambi-policy.duckdns.org/market/reviews/review%2Fid/helpful",
    );
    expect(fetchMock.mock.calls[6][0]).toBe(
      "https://dambi-policy.duckdns.org/market/listings/id/listing%2Fid/watch",
    );
  });

  it("rejects empty or control-character marketplace ids before fetch", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const { deleteListing, getListingVersion, reportReview } = await import("./market");

    await expect(deleteListing("")).rejects.toThrow(/path segment/);
    await expect(getListingVersion("listing-id", "1.0.0\n")).rejects.toThrow(/path segment/);
    await expect(reportReview("review\u0000id", { reason: "spam" })).rejects.toThrow(/path segment/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
