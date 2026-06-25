//! Marketplace store — `market_listings` + `market_listing_versions` +
//! installs / reviews / watches.
//!
//! All listings live in one table and discriminate on `kind`. Stats
//! (`install_count`, `rating_avg`) are computed on read; they're not stored
//! as denormalized columns so a missed sync can't make them lie.

// TODO: fill in `# Errors` docs + field/fn docs on the public surface.
// Suppressed for the initial market PR; documentation pass to follow.
#![allow(
    missing_docs,
    clippy::missing_errors_doc,
    clippy::missing_docs_in_private_items,
    clippy::doc_markdown,
    clippy::too_long_first_doc_paragraph,
    clippy::too_many_arguments,
    clippy::needless_lifetimes,
    clippy::map_unwrap_or,
    clippy::option_if_let_else,
    clippy::redundant_else,
    clippy::derivable_impls,
    clippy::needless_pass_by_value
)]

use std::str::FromStr;

use serde_json::Value;
use sqlx_core::query::query;
use sqlx_core::row::Row;
use sqlx_postgres::{PgPool, PgRow};
use uuid::Uuid;

use crate::error::{DbError, DbResult};

/// Listing row pulled from `market_listings` augmented with computed stats.
/// Mirrors the wire-side `ListingSummary` field-for-field.
#[derive(Clone, Debug)]
pub struct ListingRow {
    pub id: Uuid,
    pub slug: String,
    pub kind: String,
    pub publisher_id: String,
    pub publisher_tier: String,
    pub display_name: Value,
    pub description: Option<Value>,
    pub domain: Option<String>,
    pub category: Option<String>,
    pub doc: Option<Value>,
    pub intents: Option<Value>,
    pub severity: Option<String>,
    pub status: String,
    pub current_version: Option<String>,
    pub forked_from: Option<Uuid>,
    pub created_at: i64,
    pub updated_at: i64,
    pub install_count: i64,
    pub rating_avg: Option<f64>,
    pub rating_count: i64,
    pub is_installed: bool,
    /// Publisher's email, joined from `users`. NULL only if the row was
    /// orphaned (FK should prevent this; LEFT JOIN keeps reads resilient).
    pub publisher_email: Option<String>,
}

/// Immutable per-version body. `cedar_text` and `members` are mutually
/// exclusive — exactly one is non-NULL per row.
#[derive(Clone, Debug)]
pub struct VersionRow {
    pub listing_id: Uuid,
    pub version: String,
    pub major: i32,
    pub minor: i32,
    pub patch: i32,
    pub cedar_text: Option<String>,
    pub manifest: Option<Value>,
    pub policy_tree: Option<String>,
    pub members: Option<Value>,
    pub changelog: Option<Value>,
    pub published_at: i64,
}

#[derive(Clone, Debug)]
pub struct ReviewRow {
    pub id: Uuid,
    pub listing_id: Uuid,
    pub user_id: String,
    pub version: String,
    pub rating: i16,
    pub body: Value,
    pub helpful_count: i32,
    pub created_at: i64,
}

#[derive(Clone, Debug)]
pub struct ReportRow {
    pub id: Uuid,
    pub listing_id: Option<Uuid>,
    pub review_id: Option<Uuid>,
    pub reporter_id: String,
    pub reason: String,
    pub details: Option<String>,
    pub status: String,
    pub resolved_by: Option<String>,
    pub resolved_at: Option<i64>,
    pub created_at: i64,
}

/// Sort orderings exposed to the browse query. The integer values keep the
/// caller stable when serde maps query strings to the enum.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ListingSort {
    Popular,
    New,
    Rating,
}

/// Browse filters. Every field is optional; absence means "any".
#[derive(Clone, Debug, Default)]
pub struct ListingFilter {
    pub kind: Option<String>,
    pub domain: Option<String>,
    pub category: Option<String>,
    pub publisher_id: Option<String>,
    pub publisher_tier: Option<String>,
    /// Substring match against `display_name` jsonb fields (en + ko).
    pub q: Option<String>,
}

#[derive(Clone, Debug, Default)]
pub struct VersionBody {
    pub cedar_text: Option<String>,
    pub manifest: Option<Value>,
    pub policy_tree: Option<String>,
    pub members: Option<Value>,
    pub changelog: Option<Value>,
}

#[derive(Clone, Debug)]
pub struct NewListing {
    pub slug: String,
    pub kind: String,
    pub publisher_id: String,
    pub publisher_tier: String,
    pub display_name: Value,
    pub description: Option<Value>,
    pub domain: Option<String>,
    pub category: Option<String>,
    pub doc: Option<Value>,
    pub intents: Option<Value>,
    pub severity: Option<String>,
    pub forked_from: Option<Uuid>,
    pub initial_version: String,
    pub initial_body: VersionBody,
}

/// Cap server-side regardless of caller value. The browse grid filters and
/// paginates client-side, so it pulls the whole result set in one shot; keep
/// this high enough to cover the full catalog for the foreseeable future.
pub const LIST_LIMIT_MAX: i64 = 500;
pub const LIST_LIMIT_DEFAULT: i64 = 30;

/// `SemVer` regex check duplicated from the SQL CHECK so failures surface
/// as a typed error instead of a Postgres constraint violation string.
pub fn validate_semver(v: &str) -> DbResult<(i32, i32, i32)> {
    let parts: Vec<&str> = v.split('.').collect();
    if parts.len() != 3 {
        return Err(DbError::Invariant(format!(
            "version must be MAJOR.MINOR.PATCH (got {v})"
        )));
    }
    let major = i32::from_str(parts[0])
        .map_err(|_| DbError::Invariant(format!("major must be a non-negative integer ({v})")))?;
    let minor = i32::from_str(parts[1])
        .map_err(|_| DbError::Invariant(format!("minor must be a non-negative integer ({v})")))?;
    let patch = i32::from_str(parts[2])
        .map_err(|_| DbError::Invariant(format!("patch must be a non-negative integer ({v})")))?;
    if major < 0 || minor < 0 || patch < 0 {
        return Err(DbError::Invariant(format!(
            "version components must be >= 0 ({v})"
        )));
    }
    Ok((major, minor, patch))
}

/// Browse: filter + sort + paginate. Joins `LATERAL` subqueries for install
/// count and rating so the per-row stats hit the DB in one round-trip.
/// `viewer_id` keys `is_installed` per-caller — pass `None` for unauthenticated
/// reads (the flag comes back `false` for every row).
pub async fn list_listings(
    pool: &PgPool,
    filter: &ListingFilter,
    sort: ListingSort,
    limit: i64,
    offset: i64,
    viewer_id: Option<&str>,
) -> DbResult<Vec<ListingRow>> {
    let limit = limit.clamp(1, LIST_LIMIT_MAX);
    let offset = offset.max(0);

    // Order-by clause is built statically (no SQL injection vector) so the
    // pg planner can pick a real plan instead of treating sort as a param.
    let order = match sort {
        ListingSort::Popular => "stats.install_count DESC, l.created_at DESC",
        ListingSort::New => "l.created_at DESC",
        ListingSort::Rating => {
            "stats.rating_avg DESC NULLS LAST, stats.rating_count DESC, l.created_at DESC"
        }
    };

    let sql = format!(
        "SELECT l.id, l.slug, l.kind, l.publisher_id, COALESCE(u.publisher_tier, 'community') AS publisher_tier,
                l.display_name, l.description, l.domain, l.category, l.doc, l.intents, l.severity,
                l.status, l.current_version, l.forked_from, l.created_at, l.updated_at,
                stats.install_count, stats.rating_avg, stats.rating_count,
                stats.is_installed,
                u.email AS publisher_email
         FROM market_listings l
         LEFT JOIN users u ON u.user_id = l.publisher_id
         CROSS JOIN LATERAL (
           SELECT
             (SELECT COUNT(DISTINCT i.user_id) FROM market_installs i WHERE i.listing_id = l.id) AS install_count,
             (SELECT AVG(rating)::float8 FROM market_reviews r WHERE r.listing_id = l.id) AS rating_avg,
             (SELECT COUNT(*) FROM market_reviews r WHERE r.listing_id = l.id) AS rating_count,
             ($9::text IS NOT NULL AND EXISTS (
                SELECT 1 FROM market_installs i
                WHERE i.listing_id = l.id AND i.user_id = $9
             )) AS is_installed
         ) stats
         WHERE l.status = 'published'
           AND ($1::text IS NULL OR l.kind = $1)
           AND ($2::text IS NULL OR l.domain = $2)
           AND ($3::text IS NULL OR l.category = $3)
           AND ($4::text IS NULL OR l.publisher_id = $4)
           AND ($5::text IS NULL OR COALESCE(u.publisher_tier, 'community') = $5)
           AND ($6::text IS NULL OR
                l.display_name->>'en' ILIKE '%' || $6 || '%' OR
                l.display_name->>'ko' ILIKE '%' || $6 || '%')
         ORDER BY {order}
         LIMIT $7 OFFSET $8"
    );

    let rows = query(&sql)
        .bind(filter.kind.as_deref())
        .bind(filter.domain.as_deref())
        .bind(filter.category.as_deref())
        .bind(filter.publisher_id.as_deref())
        .bind(filter.publisher_tier.as_deref())
        .bind(filter.q.as_deref())
        .bind(limit)
        .bind(offset)
        .bind(viewer_id)
        .fetch_all(pool)
        .await
        .map_err(|e| DbError::Invariant(e.to_string()))?;

    Ok(rows.iter().map(row_to_listing).collect())
}

pub async fn get_listing_by_slug(
    pool: &PgPool,
    slug: &str,
    viewer_id: Option<&str>,
) -> DbResult<Option<ListingRow>> {
    let row = query(
        "SELECT l.id, l.slug, l.kind, l.publisher_id, COALESCE(u.publisher_tier, 'community') AS publisher_tier,
                l.display_name, l.description, l.domain, l.category, l.doc, l.intents, l.severity,
                l.status, l.current_version, l.forked_from, l.created_at, l.updated_at,
                stats.install_count, stats.rating_avg, stats.rating_count,
                stats.is_installed,
                u.email AS publisher_email
         FROM market_listings l
         LEFT JOIN users u ON u.user_id = l.publisher_id
         CROSS JOIN LATERAL (
           SELECT
             (SELECT COUNT(DISTINCT i.user_id) FROM market_installs i WHERE i.listing_id = l.id) AS install_count,
             (SELECT AVG(rating)::float8 FROM market_reviews r WHERE r.listing_id = l.id) AS rating_avg,
             (SELECT COUNT(*) FROM market_reviews r WHERE r.listing_id = l.id) AS rating_count,
             ($2::text IS NOT NULL AND EXISTS (
                SELECT 1 FROM market_installs i
                WHERE i.listing_id = l.id AND i.user_id = $2
             )) AS is_installed
         ) stats
         WHERE l.slug = $1 AND l.status = 'published'",
    )
    .bind(slug)
    .bind(viewer_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| DbError::Invariant(e.to_string()))?;
    Ok(row.as_ref().map(row_to_listing))
}

pub async fn get_listing_by_id(
    pool: &PgPool,
    id: Uuid,
    viewer_id: Option<&str>,
) -> DbResult<Option<ListingRow>> {
    let row = query(
        "SELECT l.id, l.slug, l.kind, l.publisher_id, COALESCE(u.publisher_tier, 'community') AS publisher_tier,
                l.display_name, l.description, l.domain, l.category, l.doc, l.intents, l.severity,
                l.status, l.current_version, l.forked_from, l.created_at, l.updated_at,
                stats.install_count, stats.rating_avg, stats.rating_count,
                stats.is_installed,
                u.email AS publisher_email
         FROM market_listings l
         LEFT JOIN users u ON u.user_id = l.publisher_id
         CROSS JOIN LATERAL (
           SELECT
             (SELECT COUNT(DISTINCT i.user_id) FROM market_installs i WHERE i.listing_id = l.id) AS install_count,
             (SELECT AVG(rating)::float8 FROM market_reviews r WHERE r.listing_id = l.id) AS rating_avg,
             (SELECT COUNT(*) FROM market_reviews r WHERE r.listing_id = l.id) AS rating_count,
             ($2::text IS NOT NULL AND EXISTS (
                SELECT 1 FROM market_installs i
                WHERE i.listing_id = l.id AND i.user_id = $2
             )) AS is_installed
         ) stats
         WHERE l.id = $1 AND l.status = 'published'",
    )
    .bind(id)
    .bind(viewer_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| DbError::Invariant(e.to_string()))?;
    Ok(row.as_ref().map(row_to_listing))
}

pub async fn get_version(
    pool: &PgPool,
    listing_id: Uuid,
    version: &str,
) -> DbResult<Option<VersionRow>> {
    let row = query(
        "SELECT v.listing_id, v.version, v.major, v.minor, v.patch,
                v.cedar_text, v.manifest, v.policy_tree, v.members, v.changelog, v.published_at
         FROM market_listing_versions v
         JOIN market_listings l ON l.id = v.listing_id
         WHERE v.listing_id = $1 AND v.version = $2 AND l.status = 'published'",
    )
    .bind(listing_id)
    .bind(version)
    .fetch_optional(pool)
    .await
    .map_err(|e| DbError::Invariant(e.to_string()))?;
    Ok(row.as_ref().map(row_to_version))
}

pub async fn get_latest_version(pool: &PgPool, listing_id: Uuid) -> DbResult<Option<VersionRow>> {
    let row = query(
        "SELECT v.listing_id, v.version, v.major, v.minor, v.patch,
                v.cedar_text, v.manifest, v.policy_tree, v.members, v.changelog, v.published_at
         FROM market_listing_versions v
         JOIN market_listings l ON l.id = v.listing_id
         WHERE v.listing_id = $1 AND l.status = 'published'
         ORDER BY v.major DESC, v.minor DESC, v.patch DESC
         LIMIT 1",
    )
    .bind(listing_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| DbError::Invariant(e.to_string()))?;
    Ok(row.as_ref().map(row_to_version))
}

const RECORD_INSTALL_AND_GET_VERSION_SQL: &str = "
WITH target AS (
  SELECT v.listing_id, v.version, v.major, v.minor, v.patch,
         v.cedar_text, v.manifest, v.policy_tree, v.members, v.changelog, v.published_at
  FROM market_listing_versions v
  JOIN market_listings l ON l.id = v.listing_id
  WHERE v.listing_id = $2 AND v.version = $3 AND l.status = 'published'
),
inserted AS (
  INSERT INTO market_installs (id, listing_id, version, user_id, installed_at)
  SELECT $1, target.listing_id, target.version, $4, $5
  FROM target
  RETURNING listing_id, version
)
SELECT target.listing_id, target.version, target.major, target.minor, target.patch,
       target.cedar_text, target.manifest, target.policy_tree, target.members,
       target.changelog, target.published_at
FROM target
JOIN inserted
  ON inserted.listing_id = target.listing_id
 AND inserted.version = target.version";

/// Insert the listing row + its initial version row in one transaction. The
/// caller has already validated the `SemVer` + kind/body invariants; this
/// function performs the DB-level CHECK enforcement as a backstop only.
pub async fn create_listing(pool: &PgPool, n: NewListing, now: i64) -> DbResult<ListingRow> {
    let (major, minor, patch) = validate_semver(&n.initial_version)?;
    let id = Uuid::new_v4();

    let mut tx = pool
        .begin()
        .await
        .map_err(|e| DbError::Invariant(e.to_string()))?;

    if let Some(parent_id) = n.forked_from {
        let parent = query(
            "SELECT id
             FROM market_listings
             WHERE id = $1 AND status = 'published'
             FOR KEY SHARE",
        )
        .bind(parent_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| DbError::Invariant(e.to_string()))?;
        if parent.is_none() {
            return Err(DbError::Invariant(
                "forked_from listing must reference a published listing".to_owned(),
            ));
        }
    }

    query(
        "INSERT INTO market_listings (
           id, slug, kind, publisher_id, publisher_tier, display_name, description,
           domain, category, doc, intents, severity, status, current_version, forked_from,
           created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'published', $13, $14, $15, $15)",
    )
    .bind(id)
    .bind(&n.slug)
    .bind(&n.kind)
    .bind(&n.publisher_id)
    .bind(&n.publisher_tier)
    .bind(&n.display_name)
    .bind(n.description.as_ref())
    .bind(n.domain.as_deref())
    .bind(n.category.as_deref())
    .bind(n.doc.as_ref())
    .bind(n.intents.as_ref())
    .bind(n.severity.as_deref())
    .bind(&n.initial_version)
    .bind(n.forked_from)
    .bind(now)
    .execute(&mut *tx)
    .await
    .map_err(|e| DbError::Invariant(e.to_string()))?;

    insert_version_row(
        &mut tx,
        id,
        &n.initial_version,
        major,
        minor,
        patch,
        &n.initial_body,
        now,
    )
    .await?;

    tx.commit()
        .await
        .map_err(|e| DbError::Invariant(e.to_string()))?;

    get_listing_by_id(pool, id, None)
        .await?
        .ok_or_else(|| DbError::Invariant("listing not found after insert".into()))
}

/// Publish a new version on an existing listing. Updates `current_version`
/// to point at the newly inserted row.
pub async fn create_version(
    pool: &PgPool,
    listing_id: Uuid,
    version: &str,
    body: VersionBody,
    now: i64,
) -> DbResult<VersionRow> {
    let (major, minor, patch) = validate_semver(version)?;

    let mut tx = pool
        .begin()
        .await
        .map_err(|e| DbError::Invariant(e.to_string()))?;

    let locked = query(
        "SELECT current_version
         FROM market_listings
         WHERE id = $1 AND status = 'published'
         FOR UPDATE",
    )
    .bind(listing_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| DbError::Invariant(e.to_string()))?;
    let Some(row) = locked else {
        tx.rollback()
            .await
            .map_err(|e| DbError::Invariant(e.to_string()))?;
        return Err(DbError::NotFound {
            kind: "market_listing",
            id: listing_id.to_string(),
        });
    };

    let current_version: Option<String> = row.get("current_version");
    if let Some(current) = current_version.as_deref() {
        let current_tuple = validate_semver(current)?;
        if (major, minor, patch) <= current_tuple {
            tx.rollback()
                .await
                .map_err(|e| DbError::Invariant(e.to_string()))?;
            return Err(DbError::Invariant(
                "new version must be strictly greater than current_version".to_owned(),
            ));
        }
    }

    insert_version_row(
        &mut tx, listing_id, version, major, minor, patch, &body, now,
    )
    .await?;

    query(
        "UPDATE market_listings
         SET current_version = $1, updated_at = $2
         WHERE id = $3 AND status = 'published'",
    )
    .bind(version)
    .bind(now)
    .bind(listing_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| DbError::Invariant(e.to_string()))?;

    tx.commit()
        .await
        .map_err(|e| DbError::Invariant(e.to_string()))?;

    get_version(pool, listing_id, version)
        .await?
        .ok_or_else(|| DbError::Invariant("version not found after insert".into()))
}

async fn insert_version_row(
    tx: &mut sqlx_core::transaction::Transaction<'_, sqlx_postgres::Postgres>,
    listing_id: Uuid,
    version: &str,
    major: i32,
    minor: i32,
    patch: i32,
    body: &VersionBody,
    now: i64,
) -> DbResult<()> {
    query(
        "INSERT INTO market_listing_versions (
           listing_id, version, major, minor, patch,
           cedar_text, manifest, policy_tree, members, changelog, published_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
    )
    .bind(listing_id)
    .bind(version)
    .bind(major)
    .bind(minor)
    .bind(patch)
    .bind(body.cedar_text.as_deref())
    .bind(body.manifest.as_ref())
    .bind(body.policy_tree.as_deref())
    .bind(body.members.as_ref())
    .bind(body.changelog.as_ref())
    .bind(now)
    .execute(&mut **tx)
    .await
    .map_err(|e| DbError::Invariant(e.to_string()))?;
    Ok(())
}

/// Atomically record one install event for a currently published listing/version
/// and return the exact version body being installed. Returning the body from the
/// same statement prevents a concurrent archive from racing between "body read"
/// and "install eligibility" checks.
pub async fn record_install_and_get_version(
    pool: &PgPool,
    listing_id: Uuid,
    version: &str,
    user_id: &str,
    now: i64,
) -> DbResult<Option<VersionRow>> {
    let row = query(RECORD_INSTALL_AND_GET_VERSION_SQL)
        .bind(Uuid::new_v4())
        .bind(listing_id)
        .bind(version)
        .bind(user_id)
        .bind(now)
        .fetch_optional(pool)
        .await
        .map_err(|e| DbError::Invariant(e.to_string()))?;
    Ok(row.as_ref().map(row_to_version))
}

/// Record one install event for a currently published listing/version. The
/// same user installing twice writes two rows (event log, not state). Returns
/// `None` when the target listing/version is absent or no longer published.
pub async fn record_install(
    pool: &PgPool,
    listing_id: Uuid,
    version: &str,
    user_id: &str,
    now: i64,
) -> DbResult<Option<Uuid>> {
    let id = Uuid::new_v4();
    let res = query(
        "INSERT INTO market_installs (id, listing_id, version, user_id, installed_at)
         SELECT $1, v.listing_id, v.version, $4, $5
         FROM market_listing_versions v
         JOIN market_listings l ON l.id = v.listing_id
         WHERE v.listing_id = $2 AND v.version = $3 AND l.status = 'published'",
    )
    .bind(id)
    .bind(listing_id)
    .bind(version)
    .bind(user_id)
    .bind(now)
    .execute(pool)
    .await
    .map_err(|e| DbError::Invariant(e.to_string()))?;
    Ok((res.rows_affected() > 0).then_some(id))
}

/// One row of the install-activity rollup: a published listing plus how many
/// distinct users installed it since `since` (a unix-seconds cutoff).
///
/// The underlying table remains an event log, but public popularity metrics use
/// unique installers so one account cannot boost ranking by replaying installs.
/// `slug` lets the dashboard bucket rows by its own category taxonomy
/// (`categoryOf(slug)`), which is finer-grained than the server's action-based
/// `category` column.
#[derive(Clone, Debug)]
pub struct InstallActivityRow {
    pub slug: String,
    pub kind: String,
    pub display_name: Value,
    pub category: Option<String>,
    pub recent_installs: i64,
}

/// Aggregate distinct installers newer than `since` (unix seconds) per
/// published listing, most-installed first. Listings with zero recent installs
/// are omitted (INNER JOIN), so the result is exactly "what got installed
/// lately".
pub async fn install_activity_since(
    pool: &PgPool,
    since: i64,
    limit: i64,
) -> DbResult<Vec<InstallActivityRow>> {
    let limit = limit.clamp(1, LIST_LIMIT_MAX);
    let rows = query(
        "SELECT l.slug, l.kind, l.display_name, l.category,
                COUNT(DISTINCT i.user_id) AS recent_installs
         FROM market_listings l
         JOIN market_installs i ON i.listing_id = l.id
         WHERE l.status = 'published' AND i.installed_at >= $1
         GROUP BY l.slug, l.kind, l.display_name, l.category
         ORDER BY recent_installs DESC, l.slug ASC
         LIMIT $2",
    )
    .bind(since)
    .bind(limit)
    .fetch_all(pool)
    .await
    .map_err(|e| DbError::Invariant(e.to_string()))?;

    Ok(rows
        .iter()
        .map(|r| InstallActivityRow {
            slug: r.get("slug"),
            kind: r.get("kind"),
            display_name: r.get("display_name"),
            category: r.get("category"),
            recent_installs: r.get("recent_installs"),
        })
        .collect())
}

pub async fn list_reviews(pool: &PgPool, listing_id: Uuid, limit: i64) -> DbResult<Vec<ReviewRow>> {
    let limit = limit.clamp(1, 200);
    let rows = query(
        "SELECT r.id, r.listing_id, r.user_id, r.version, r.rating, r.body,
                r.helpful_count, r.created_at
         FROM market_reviews r
         JOIN market_listings l ON l.id = r.listing_id
         WHERE r.listing_id = $1 AND l.status = 'published'
         ORDER BY r.helpful_count DESC, r.created_at DESC
         LIMIT $2",
    )
    .bind(listing_id)
    .bind(limit)
    .fetch_all(pool)
    .await
    .map_err(|e| DbError::Invariant(e.to_string()))?;
    Ok(rows.iter().map(row_to_review).collect())
}

/// Upsert review (one per user per listing). Re-submitting overwrites the
/// previous body / rating; the `helpful_count` is preserved across edits.
pub async fn upsert_review(
    pool: &PgPool,
    listing_id: Uuid,
    user_id: &str,
    version: &str,
    rating: i16,
    body: &Value,
    now: i64,
) -> DbResult<Option<ReviewRow>> {
    let target = query(
        "SELECT l.publisher_id
         FROM market_listing_versions v
         JOIN market_listings l ON l.id = v.listing_id
         WHERE v.listing_id = $1 AND v.version = $2 AND l.status = 'published'",
    )
    .bind(listing_id)
    .bind(version)
    .fetch_optional(pool)
    .await
    .map_err(|e| DbError::Invariant(e.to_string()))?;
    let Some(row) = target else {
        return Ok(None);
    };
    let publisher_id: String = row.get("publisher_id");
    if publisher_id == user_id {
        return Err(DbError::Forbidden {
            reason: "publishers cannot review their own listings",
        });
    }

    let id = Uuid::new_v4();
    let res = query(
        "INSERT INTO market_reviews (id, listing_id, user_id, version, rating, body, created_at)
         SELECT $1, v.listing_id, $3, v.version, $5, $6, $7
         FROM market_listing_versions v
         JOIN market_listings l ON l.id = v.listing_id
         WHERE v.listing_id = $2 AND v.version = $4 AND l.status = 'published'
         ON CONFLICT (listing_id, user_id) DO UPDATE
         SET version = excluded.version,
             rating = excluded.rating,
             body = excluded.body,
             created_at = excluded.created_at",
    )
    .bind(id)
    .bind(listing_id)
    .bind(user_id)
    .bind(version)
    .bind(rating)
    .bind(body)
    .bind(now)
    .execute(pool)
    .await
    .map_err(|e| DbError::Invariant(e.to_string()))?;
    if res.rows_affected() == 0 {
        return Ok(None);
    }

    let row = query(
        "SELECT id, listing_id, user_id, version, rating, body, helpful_count, created_at
         FROM market_reviews
         WHERE listing_id = $1 AND user_id = $2",
    )
    .bind(listing_id)
    .bind(user_id)
    .fetch_one(pool)
    .await
    .map_err(|e| DbError::Invariant(e.to_string()))?;
    Ok(Some(row_to_review(&row)))
}

/// Vote "helpful" on a review. Returns `true` if the vote was newly inserted
/// (caller hadn't voted yet); `false` if it was already there.
pub async fn vote_helpful(
    pool: &PgPool,
    review_id: Uuid,
    user_id: &str,
    now: i64,
) -> DbResult<Option<bool>> {
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| DbError::Invariant(e.to_string()))?;
    let visible = query(
        "SELECT r.id, r.user_id
         FROM market_reviews r
         JOIN market_listings l ON l.id = r.listing_id
         WHERE r.id = $1 AND l.status = 'published'",
    )
    .bind(review_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| DbError::Invariant(e.to_string()))?;
    let Some(visible) = visible else {
        tx.rollback()
            .await
            .map_err(|e| DbError::Invariant(e.to_string()))?;
        return Ok(None);
    };
    let author_id: String = visible.get("user_id");
    if author_id == user_id {
        tx.rollback()
            .await
            .map_err(|e| DbError::Invariant(e.to_string()))?;
        return Err(DbError::Forbidden {
            reason: "review authors cannot vote helpful on their own reviews",
        });
    }

    let res = query(
        "INSERT INTO market_review_helpful (review_id, user_id, voted_at)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING",
    )
    .bind(review_id)
    .bind(user_id)
    .bind(now)
    .execute(&mut *tx)
    .await
    .map_err(|e| DbError::Invariant(e.to_string()))?;

    let inserted = res.rows_affected() > 0;
    if inserted {
        query(
            "UPDATE market_reviews
             SET helpful_count = helpful_count + 1
             WHERE id = $1",
        )
        .bind(review_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| DbError::Invariant(e.to_string()))?;
    }

    tx.commit()
        .await
        .map_err(|e| DbError::Invariant(e.to_string()))?;
    Ok(Some(inserted))
}

pub async fn create_listing_report(
    pool: &PgPool,
    listing_id: Uuid,
    reporter_id: &str,
    reason: &str,
    details: Option<&str>,
    now: i64,
) -> DbResult<Option<ReportRow>> {
    let row = query(
        "INSERT INTO market_reports (id, listing_id, reporter_id, reason, details, status, created_at)
         SELECT $1, l.id, $3, $4, $5, 'open', $6
         FROM market_listings l
         WHERE l.id = $2 AND l.status = 'published'
         RETURNING id, listing_id, review_id, reporter_id, reason, details, status,
                   resolved_by, resolved_at, created_at",
    )
    .bind(Uuid::new_v4())
    .bind(listing_id)
    .bind(reporter_id)
    .bind(reason)
    .bind(details)
    .bind(now)
    .fetch_optional(pool)
    .await
    .map_err(|e| DbError::Invariant(e.to_string()))?;
    Ok(row.as_ref().map(row_to_report))
}

pub async fn create_review_report(
    pool: &PgPool,
    review_id: Uuid,
    reporter_id: &str,
    reason: &str,
    details: Option<&str>,
    now: i64,
) -> DbResult<Option<ReportRow>> {
    let row = query(
        "INSERT INTO market_reports (id, review_id, reporter_id, reason, details, status, created_at)
         SELECT $1, r.id, $3, $4, $5, 'open', $6
         FROM market_reviews r
         JOIN market_listings l ON l.id = r.listing_id
         WHERE r.id = $2 AND l.status = 'published'
         RETURNING id, listing_id, review_id, reporter_id, reason, details, status,
                   resolved_by, resolved_at, created_at",
    )
    .bind(Uuid::new_v4())
    .bind(review_id)
    .bind(reporter_id)
    .bind(reason)
    .bind(details)
    .bind(now)
    .fetch_optional(pool)
    .await
    .map_err(|e| DbError::Invariant(e.to_string()))?;
    Ok(row.as_ref().map(row_to_report))
}

pub async fn list_reports_by_reporter(
    pool: &PgPool,
    reporter_id: &str,
    limit: i64,
) -> DbResult<Vec<ReportRow>> {
    let limit = limit.clamp(1, 200);
    let rows = query(
        "SELECT id, listing_id, review_id, reporter_id, reason, details, status,
                resolved_by, resolved_at, created_at
         FROM market_reports
         WHERE reporter_id = $1
         ORDER BY created_at DESC
         LIMIT $2",
    )
    .bind(reporter_id)
    .bind(limit)
    .fetch_all(pool)
    .await
    .map_err(|e| DbError::Invariant(e.to_string()))?;
    Ok(rows.iter().map(row_to_report).collect())
}

pub async fn list_reports(
    pool: &PgPool,
    status: Option<&str>,
    limit: i64,
) -> DbResult<Vec<ReportRow>> {
    let limit = limit.clamp(1, 500);
    let rows = query(
        "SELECT id, listing_id, review_id, reporter_id, reason, details, status,
                resolved_by, resolved_at, created_at
         FROM market_reports
         WHERE ($1::text IS NULL OR status = $1)
         ORDER BY
           CASE status WHEN 'open' THEN 0 ELSE 1 END,
           created_at DESC
         LIMIT $2",
    )
    .bind(status)
    .bind(limit)
    .fetch_all(pool)
    .await
    .map_err(|e| DbError::Invariant(e.to_string()))?;
    Ok(rows.iter().map(row_to_report).collect())
}

pub async fn update_report_status(
    pool: &PgPool,
    report_id: Uuid,
    status: &str,
    moderator_id: &str,
    now: i64,
) -> DbResult<Option<ReportRow>> {
    let (resolved_by, resolved_at) = if status == "resolved" {
        (Some(moderator_id), Some(now))
    } else {
        (None, None)
    };
    let row = query(
        "UPDATE market_reports
         SET status = $2,
             resolved_by = $3,
             resolved_at = $4
         WHERE id = $1
         RETURNING id, listing_id, review_id, reporter_id, reason, details, status,
                   resolved_by, resolved_at, created_at",
    )
    .bind(report_id)
    .bind(status)
    .bind(resolved_by)
    .bind(resolved_at)
    .fetch_optional(pool)
    .await
    .map_err(|e| DbError::Invariant(e.to_string()))?;
    Ok(row.as_ref().map(row_to_report))
}

pub async fn watch(pool: &PgPool, user_id: &str, listing_id: Uuid, now: i64) -> DbResult<bool> {
    let row = query(
        "WITH target AS (
           SELECT id
           FROM market_listings
           WHERE id = $2 AND status = 'published'
         ),
         inserted AS (
           INSERT INTO market_watches (user_id, listing_id, subscribed_at)
           SELECT $1, target.id, $3
           FROM target
           ON CONFLICT DO NOTHING
           RETURNING listing_id
         )
         SELECT
           EXISTS (SELECT 1 FROM target) AS target_visible,
           EXISTS (SELECT 1 FROM inserted) AS inserted",
    )
    .bind(user_id)
    .bind(listing_id)
    .bind(now)
    .fetch_one(pool)
    .await
    .map_err(|e| DbError::Invariant(e.to_string()))?;
    let target_visible: bool = row.get("target_visible");
    Ok(target_visible)
}

pub async fn unwatch(pool: &PgPool, user_id: &str, listing_id: Uuid) -> DbResult<()> {
    query("DELETE FROM market_watches WHERE user_id = $1 AND listing_id = $2")
        .bind(user_id)
        .bind(listing_id)
        .execute(pool)
        .await
        .map_err(|e| DbError::Invariant(e.to_string()))?;
    Ok(())
}

/// Archive a published listing owned by `publisher_id`. Child rows are kept so
/// reviews, install history, and moderation reports remain available for audit;
/// public read/write helpers already require `status = 'published'`, so archived
/// listings disappear from the marketplace surface. Any listing forked from this
/// one has its `forked_from` cleared to avoid exposing hidden provenance ids.
pub async fn delete_listing(pool: &PgPool, listing_id: Uuid, publisher_id: &str) -> DbResult<bool> {
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| DbError::Invariant(e.to_string()))?;

    let owned = query(
        "SELECT id
         FROM market_listings
         WHERE id = $1 AND publisher_id = $2 AND status = 'published'
         FOR UPDATE",
    )
    .bind(listing_id)
    .bind(publisher_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| DbError::Invariant(e.to_string()))?;

    if owned.is_none() {
        tx.rollback()
            .await
            .map_err(|e| DbError::Invariant(e.to_string()))?;
        return Ok(false);
    }

    query("UPDATE market_listings SET forked_from = NULL WHERE forked_from = $1")
        .bind(listing_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| DbError::Invariant(e.to_string()))?;
    let res = query(
        "UPDATE market_listings
         SET status = 'archived',
             updated_at = EXTRACT(EPOCH FROM NOW())::bigint
         WHERE id = $1 AND publisher_id = $2 AND status = 'published'",
    )
    .bind(listing_id)
    .bind(publisher_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| DbError::Invariant(e.to_string()))?;

    tx.commit()
        .await
        .map_err(|e| DbError::Invariant(e.to_string()))?;
    Ok(res.rows_affected() > 0)
}

pub async fn list_watches(pool: &PgPool, user_id: &str) -> DbResult<Vec<ListingRow>> {
    let rows = query(
        "SELECT l.id, l.slug, l.kind, l.publisher_id, COALESCE(u.publisher_tier, 'community') AS publisher_tier,
                l.display_name, l.description, l.domain, l.category, l.doc, l.intents, l.severity,
                l.status, l.current_version, l.forked_from, l.created_at, l.updated_at,
                stats.install_count, stats.rating_avg, stats.rating_count,
                stats.is_installed,
                u.email AS publisher_email
         FROM market_watches w
         JOIN market_listings l ON l.id = w.listing_id
         LEFT JOIN users u ON u.user_id = l.publisher_id
         CROSS JOIN LATERAL (
           SELECT
             (SELECT COUNT(DISTINCT i.user_id) FROM market_installs i WHERE i.listing_id = l.id) AS install_count,
             (SELECT AVG(rating)::float8 FROM market_reviews r WHERE r.listing_id = l.id) AS rating_avg,
             (SELECT COUNT(*) FROM market_reviews r WHERE r.listing_id = l.id) AS rating_count,
             EXISTS (
                SELECT 1 FROM market_installs i
                WHERE i.listing_id = l.id AND i.user_id = $1
             ) AS is_installed
         ) stats
         WHERE w.user_id = $1 AND l.status = 'published'
         ORDER BY w.subscribed_at DESC",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
    .map_err(|e| DbError::Invariant(e.to_string()))?;
    Ok(rows.iter().map(row_to_listing).collect())
}

fn row_to_listing(row: &PgRow) -> ListingRow {
    ListingRow {
        id: row.get("id"),
        slug: row.get("slug"),
        kind: row.get("kind"),
        publisher_id: row.get("publisher_id"),
        publisher_tier: row.get("publisher_tier"),
        display_name: row.get("display_name"),
        description: row.get("description"),
        domain: row.get("domain"),
        category: row.get("category"),
        doc: row.get("doc"),
        intents: row.get("intents"),
        severity: row.get("severity"),
        status: row.get("status"),
        current_version: row.get("current_version"),
        forked_from: row.get("forked_from"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
        install_count: row.get("install_count"),
        rating_avg: row.get("rating_avg"),
        rating_count: row.get("rating_count"),
        is_installed: row.get("is_installed"),
        publisher_email: row.get("publisher_email"),
    }
}

fn row_to_version(row: &PgRow) -> VersionRow {
    VersionRow {
        listing_id: row.get("listing_id"),
        version: row.get("version"),
        major: row.get("major"),
        minor: row.get("minor"),
        patch: row.get("patch"),
        cedar_text: row.get("cedar_text"),
        manifest: row.get("manifest"),
        policy_tree: row.get("policy_tree"),
        members: row.get("members"),
        changelog: row.get("changelog"),
        published_at: row.get("published_at"),
    }
}

fn row_to_review(row: &PgRow) -> ReviewRow {
    ReviewRow {
        id: row.get("id"),
        listing_id: row.get("listing_id"),
        user_id: row.get("user_id"),
        version: row.get("version"),
        rating: row.get("rating"),
        body: row.get("body"),
        helpful_count: row.get("helpful_count"),
        created_at: row.get("created_at"),
    }
}

fn row_to_report(row: &PgRow) -> ReportRow {
    ReportRow {
        id: row.get("id"),
        listing_id: row.get("listing_id"),
        review_id: row.get("review_id"),
        reporter_id: row.get("reporter_id"),
        reason: row.get("reason"),
        details: row.get("details"),
        status: row.get("status"),
        resolved_by: row.get("resolved_by"),
        resolved_at: row.get("resolved_at"),
        created_at: row.get("created_at"),
    }
}

#[cfg(test)]
mod tests {
    use super::RECORD_INSTALL_AND_GET_VERSION_SQL;

    #[test]
    fn install_download_sql_records_event_and_returns_body_atomically() {
        let sql = RECORD_INSTALL_AND_GET_VERSION_SQL;

        assert!(sql.contains("WITH target AS"));
        assert!(sql.contains("l.status = 'published'"));
        assert!(sql.contains("INSERT INTO market_installs"));
        assert!(sql.contains("RETURNING listing_id, version"));
        assert!(sql.contains("FROM target\nJOIN inserted"));
    }
}

/// One publisher account for the market-admin view.
#[derive(Debug, Clone)]
pub struct PublisherRow {
    pub user_id: String,
    pub email: String,
    /// Account-level tier — `official` | `verified` | `community`.
    pub publisher_tier: String,
    /// Published listings owned by this account.
    pub listing_count: i64,
}

/// Admin: list publisher accounts — anyone who owns a listing OR has a
/// non-community tier — with their account tier and published-listing count.
pub async fn list_publishers(pool: &PgPool) -> DbResult<Vec<PublisherRow>> {
    let rows = query(
        "SELECT u.user_id, u.email, u.publisher_tier,
                COUNT(l.id) FILTER (WHERE l.status = 'published') AS listing_count
         FROM users u
         LEFT JOIN market_listings l ON l.publisher_id = u.user_id
         GROUP BY u.user_id, u.email, u.publisher_tier
         HAVING COUNT(l.id) > 0 OR u.publisher_tier <> 'community'
         ORDER BY (u.publisher_tier <> 'community') DESC,
                  COUNT(l.id) DESC, u.email ASC",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| DbError::Invariant(e.to_string()))?;
    Ok(rows
        .iter()
        .map(|r| PublisherRow {
            user_id: r.get("user_id"),
            email: r.get("email"),
            publisher_tier: r.get("publisher_tier"),
            listing_count: r.get("listing_count"),
        })
        .collect())
}

/// Admin: set an account's publisher tier. Returns the account email on success,
/// `None` when no such user. The caller must restrict `tier` (e.g. reject
/// `official`, which is reserved for the brand account and set out of band).
pub async fn set_publisher_tier(
    pool: &PgPool,
    user_id: &str,
    tier: &str,
) -> DbResult<Option<String>> {
    let row = query("UPDATE users SET publisher_tier = $1 WHERE user_id = $2 RETURNING email")
        .bind(tier)
        .bind(user_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| DbError::Invariant(e.to_string()))?;
    Ok(row.map(|r| r.get("email")))
}
