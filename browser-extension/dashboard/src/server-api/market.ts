/**
 * Marketplace API client.
 *
 * Mirrors the Rust DTOs in `crates/policy-server/server/src/market_dto.rs`.
 * Listings come in two kinds: 'policy' (a single Cedar policy) and 'set'
 * (a bundle whose member policies are snapshotted inline into each set
 * version). Install is copy-to-editor — receivers get the full body in one
 * payload and write it into their local extension store via the SW bridge.
 */

import { i18n } from "../i18n";
import { request } from "./client";

function pathSegment(value: string, label: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 256 ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error(`${label} is not a safe path segment`);
  }
  return encodeURIComponent(value);
}

export type ListingKind = "policy" | "set";
export type PublisherTier = "official" | "verified" | "community";
export type ListingStatus = "pending" | "published" | "archived" | "rejected";
export type Severity = "deny" | "warn";
export type ListingSort = "popular" | "new" | "rating";

/** Two-locale display string. `en` is the canonical fallback. */
export interface I18nText {
  en: string;
  ko?: string;
}

export interface SetMember {
  slug: string;
  display_name: string;
  cedar_text: string;
  manifest?: unknown;
}

/** Human-authored policy docs (정의/범위/대상/데이터). Single-language plain
 *  text; every field optional. Authored in the editor, shipped on publish,
 *  shown on the listing detail page. */
export interface ListingDoc {
  definition?: string;
  scope?: string;
  audience?: string;
  usedData?: string;
}

export interface ListingSummary {
  id: string;
  slug: string;
  kind: ListingKind;
  publisher_id?: string;
  publisher_tier: PublisherTier;
  display_name: I18nText;
  description?: I18nText;
  /** Policy docs shown on the detail page; absent for older/seed listings. */
  doc?: ListingDoc;
  domain?: string;
  /** Action-based taxonomy (approvals, swap, perps, …); see market-domain. */
  category?: string;
  intents?: string[];
  severity?: Severity;
  status: ListingStatus;
  current_version: string | null;
  created_at: number;
  updated_at: number;
  install_count: number;
  rating_avg: number | null;
  rating_count: number;
  /** True when the currently-authenticated user has installed this listing
   *  at least once (event log row, not state). Drives the 설치/설치됨 badge. */
  is_installed: boolean;
  /** Public publisher handle. Legacy field name is kept for compatibility. */
  publisher_email?: string;
}

export interface ListingVersion {
  listing_id: string;
  version: string;
  major: number;
  minor: number;
  patch: number;
  cedar_text?: string;
  manifest?: unknown;
  policy_tree?: string;
  members?: SetMember[];
  changelog?: I18nText;
  published_at: number;
}

export interface Review {
  id: string;
  listing_id: string;
  user_id?: string;
  reviewer_handle?: string;
  version: string;
  rating: number;
  body: I18nText;
  helpful_count: number;
  created_at: number;
}

export type ReportReason =
  | "unsafe_policy"
  | "misleading"
  | "spam"
  | "abuse"
  | "other";

export type ReportStatus = "open" | "resolved";

export interface MarketReport {
  id: string;
  listing_id?: string;
  review_id?: string;
  reporter_id?: string;
  reporter_handle?: string;
  reason: ReportReason;
  details?: string;
  status: ReportStatus;
  resolved_by?: string;
  resolved_by_handle?: string;
  resolved_at?: number;
  created_at: number;
}

export interface ListingDetail extends ListingSummary {
  latest_version: ListingVersion | null;
  recent_reviews: Review[];
}

export interface ListListingsParams {
  kind?: ListingKind;
  domain?: string;
  category?: string;
  publisher_id?: string;
  publisher_tier?: PublisherTier;
  q?: string;
  sort?: ListingSort;
  limit?: number;
  offset?: number;
}

export interface CreatePolicyListingBody {
  slug: string;
  kind: "policy";
  display_name: I18nText;
  description?: I18nText;
  domain: string;
  /** Action-based taxonomy (Token, DEX, Lending, …); user-picked at publish. */
  category?: string;
  /** Policy docs (정의/범위/대상/데이터) authored in the editor. */
  doc?: ListingDoc;
  intents?: string[];
  severity: Severity;
  version?: string;
  cedar_text: string;
  manifest?: unknown;
  policy_tree?: string;
  changelog?: I18nText;
}

export interface CreateSetListingBody {
  slug: string;
  kind: "set";
  display_name: I18nText;
  description?: I18nText;
  /** Member policies' categories (deduped) — a package spans these. */
  intents?: string[];
  version?: string;
  members: SetMember[];
  changelog?: I18nText;
}

export type CreateListingBody = CreatePolicyListingBody | CreateSetListingBody;

export interface CreateVersionBody {
  version: string;
  cedar_text?: string;
  manifest?: unknown;
  policy_tree?: string;
  members?: SetMember[];
  changelog?: I18nText;
}

export interface CreateReviewBody {
  version: string;
  rating: number;
  body: I18nText;
}

export interface CreateReportBody {
  reason: ReportReason;
  details?: string;
}

export interface ListReportsParams {
  status?: ReportStatus;
  limit?: number;
}

export interface UpdateReportStatusBody {
  status: ReportStatus;
}

/** `GET /market/listings` — browse + filter + sort. */
export async function listListings(
  params: ListListingsParams = {},
): Promise<ListingSummary[]> {
  const search = new URLSearchParams();
  if (params.kind) search.set("kind", params.kind);
  if (params.domain) search.set("domain", params.domain);
  if (params.category) search.set("category", params.category);
  if (params.publisher_id) search.set("publisher_id", params.publisher_id);
  if (params.publisher_tier) search.set("publisher_tier", params.publisher_tier);
  if (params.q) search.set("q", params.q);
  if (params.sort) search.set("sort", params.sort);
  if (params.limit != null) search.set("limit", String(params.limit));
  if (params.offset != null) search.set("offset", String(params.offset));
  const qs = search.toString();
  const path = qs ? `/market/listings?${qs}` : "/market/listings";
  return request<ListingSummary[]>(path);
}

/** One listing's recent-install rollup from `GET /market/activity-summary`.
 * Real install demand within the look-back window — never mocked. The landing
 * hero buckets these by `categoryOf(slug)` to surface "최근 인기" categories. */
export interface InstallActivityEntry {
  slug: string;
  kind: ListingKind;
  display_name: I18nText;
  /** Server action-based category (differs from the dashboard taxonomy). */
  category?: string;
  recent_installs: number;
}

export interface ActivitySummary {
  days: number;
  /** Unix-seconds cutoff actually used (now − days·86400). */
  since: number;
  entries: InstallActivityEntry[];
}

/** `GET /market/activity-summary` — per-listing install counts in the last
 * `days` (default 7), most-installed first. Powers the "최근 인기" hero with
 * real demand data. Returns an empty `entries` list when nothing was installed
 * in the window (the caller then falls back to coverage-based suggestions). */
export async function getActivitySummary(
  params: { days?: number; limit?: number } = {},
): Promise<ActivitySummary> {
  const search = new URLSearchParams();
  if (params.days != null) search.set("days", String(params.days));
  if (params.limit != null) search.set("limit", String(params.limit));
  const qs = search.toString();
  const path = qs ? `/market/activity-summary?${qs}` : "/market/activity-summary";
  try {
    return await request<ActivitySummary>(path);
  } catch {
    // Server unreachable / endpoint absent → no activity signal. The hero
    // falls back to coverage ("미설치 N개"), which is honest with no data.
    const days = params.days ?? 7;
    return { days, since: 0, entries: [] };
  }
}

/** `GET /market/listings/:slug` — listing detail + latest version + recent reviews. */
export async function getListing(slug: string): Promise<ListingDetail> {
  return request<ListingDetail>(
    `/market/listings/${pathSegment(slug, "listing slug")}`,
  );
}

/** `GET /market/listings/id/:id/versions/:ver` — fetch a specific version body. */
export async function getListingVersion(
  listingId: string,
  version: string,
): Promise<ListingVersion> {
  return request<ListingVersion>(
    `/market/listings/id/${pathSegment(listingId, "listing id")}/versions/${pathSegment(
      version,
      "listing version",
    )}`,
  );
}

/** `POST /market/listings` — publish a new listing + v1.0.0 atomically. */
export async function createListing(
  body: CreateListingBody,
): Promise<ListingSummary> {
  return request<ListingSummary>("/market/listings", { method: "POST", body });
}

/** `DELETE /market/listings/id/:id` — hide a listing the caller published.
 *  The server archives it and retains versions/reviews/reports for audit history. */
export async function deleteListing(listingId: string): Promise<void> {
  await request<void>(
    `/market/listings/id/${pathSegment(listingId, "listing id")}`,
    { method: "DELETE" },
  );
}

/** `POST /market/listings/id/:id/versions` — release a new SemVer version. */
export async function createVersion(
  listingId: string,
  body: CreateVersionBody,
): Promise<ListingVersion> {
  return request<ListingVersion>(
    `/market/listings/id/${pathSegment(listingId, "listing id")}/versions`,
    {
      method: "POST",
      body,
    },
  );
}

/** `POST /market/listings/id/:id/install` — record install + return version body. */
export async function installListing(
  listingId: string,
  version: string,
): Promise<ListingVersion> {
  return request<ListingVersion>(
    `/market/listings/id/${pathSegment(listingId, "listing id")}/install`,
    {
      method: "POST",
      body: { version },
    },
  );
}

/** `GET /market/listings/id/:id/reviews` — full review list. */
export async function listReviews(listingId: string): Promise<Review[]> {
  return request<Review[]>(
    `/market/listings/id/${pathSegment(listingId, "listing id")}/reviews`,
  );
}

/** `POST /market/listings/id/:id/reviews` — write or replace caller's review. */
export async function createReview(
  listingId: string,
  body: CreateReviewBody,
): Promise<Review> {
  return request<Review>(
    `/market/listings/id/${pathSegment(listingId, "listing id")}/reviews`,
    {
      method: "POST",
      body,
    },
  );
}

/** `POST /market/listings/id/:id/report` — report a listing. */
export async function reportListing(
  listingId: string,
  body: CreateReportBody,
): Promise<MarketReport> {
  return request<MarketReport>(
    `/market/listings/id/${pathSegment(listingId, "listing id")}/report`,
    {
      method: "POST",
      body,
    },
  );
}

/** `POST /market/reviews/:id/report` — report a review. */
export async function reportReview(
  reviewId: string,
  body: CreateReportBody,
): Promise<MarketReport> {
  return request<MarketReport>(
    `/market/reviews/${pathSegment(reviewId, "review id")}/report`,
    {
      method: "POST",
      body,
    },
  );
}

/** `GET /market/reports/mine` — reports submitted by the caller. */
export async function listMyReports(): Promise<MarketReport[]> {
  return request<MarketReport[]>("/market/reports/mine");
}

/** `GET /market/reports` — admin moderation queue. */
export async function listReports(
  params: ListReportsParams = {},
): Promise<MarketReport[]> {
  const search = new URLSearchParams();
  if (params.status) search.set("status", params.status);
  if (params.limit != null) search.set("limit", String(params.limit));
  const qs = search.toString();
  return request<MarketReport[]>(qs ? `/market/reports?${qs}` : "/market/reports");
}

/** `PATCH /market/reports/:id` — admin moderation status update. */
export async function updateReportStatus(
  reportId: string,
  body: UpdateReportStatusBody,
): Promise<MarketReport> {
  return request<MarketReport>(
    `/market/reports/${pathSegment(reportId, "report id")}`,
    {
      method: "PATCH",
      body,
    },
  );
}

/** `POST /market/reviews/:id/helpful` — idempotent helpful vote. */
export async function voteHelpful(
  reviewId: string,
): Promise<{ newly_voted: boolean }> {
  return request<{ newly_voted: boolean }>(
    `/market/reviews/${pathSegment(reviewId, "review id")}/helpful`,
    { method: "POST" },
  );
}

/** `POST /market/listings/id/:id/watch` — subscribe to new-version events. */
export async function watchListing(listingId: string): Promise<void> {
  await request<void>(
    `/market/listings/id/${pathSegment(listingId, "listing id")}/watch`,
    {
      method: "POST",
    },
  );
}

/** `DELETE /market/listings/id/:id/watch` — cancel subscription. */
export async function unwatchListing(listingId: string): Promise<void> {
  await request<void>(
    `/market/listings/id/${pathSegment(listingId, "listing id")}/watch`,
    {
      method: "DELETE",
    },
  );
}

/** `GET /market/watches` — caller's watched listings with stats. */
export async function listWatches(): Promise<ListingSummary[]> {
  return request<ListingSummary[]>("/market/watches");
}

/** Locale-aware fallback for I18nText. Falls back to en when locale is missing. */
export function pickI18n(t: I18nText | undefined, locale: "en" | "ko" = "ko"): string {
  if (!t) return "";
  if (locale === "ko" && t.ko) return t.ko;
  return t.en;
}

/**
 * Human-friendly publisher label. Official listings get a fixed brand name;
 * everyone else gets the server-provided public handle. Older local seed data
 * may still provide an email-looking value, so strip the domain defensively.
 */
export function publisherDisplay(
  tier: PublisherTier,
  email: string | undefined,
  locale: "ko" | "en" = "ko",
): string {
  if (tier === "official") {
    return "Wallet Guardians";
  }
  if (!email) return i18n.t("market:publisher.anonymous", { lng: locale });
  const at = email.indexOf("@");
  return at > 0 ? email.slice(0, at) : email;
}

/** Format a Unix-seconds timestamp as YYYY-MM-DD in the user's local TZ. */
export function formatYmd(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
