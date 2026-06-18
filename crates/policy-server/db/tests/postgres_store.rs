use policy_db::derive_user_id;
use policy_db::stores::market::{
    create_listing, create_listing_report, create_review_report, delete_listing, get_listing_by_id,
    get_version, install_activity_since, list_reviews, list_watches, record_install, upsert_review,
    vote_helpful, watch, NewListing, VersionBody,
};
use policy_db::stores::{PostgresGlobalDb, PostgresWalletStore};
use policy_state::primitives::{BlockHeight, ChainId};
use policy_state::{WalletId, WalletState, WalletStore};
use serde_json::json;
use sqlx_core::query::query;
use sqlx_postgres::{PgPool, PgPoolOptions};
use uuid::Uuid;

#[tokio::test]
async fn postgres_wallet_store_round_trips_state() {
    let url = match std::env::var("TEST_DATABASE_URL") {
        Ok(url) => url,
        Err(_) => return,
    };
    let pool = PgPool::connect(&url).await.unwrap();
    let global = PostgresGlobalDb::new(pool.clone());
    global.migrate().await.unwrap();

    let user_id = global
        .upsert_user("alice@example.com", "google")
        .await
        .unwrap();
    let store = PostgresWalletStore::new(pool, user_id);
    let id: WalletId = serde_json::from_value(serde_json::json!({
        "address": "0x362E7e9e630481631D7C804dfe50e24b53250925",
        "chains": ["eip155:1"]
    }))
    .unwrap();

    let state = WalletState::new(id.clone());
    store.save(&state).await.unwrap();
    let loaded = store.load(&id).await.unwrap();

    assert_eq!(loaded.wallet_id, id);
}

#[tokio::test]
async fn postgres_wallet_state_load_is_address_keyed_for_venue_wallet_ids() {
    let url = match std::env::var("TEST_DATABASE_URL") {
        Ok(url) => url,
        Err(_) => return,
    };
    let pool = PgPool::connect(&url).await.unwrap();
    let global = PostgresGlobalDb::new(pool.clone());
    global.migrate().await.unwrap();

    let user_id = global
        .upsert_user(
            &format!("venue-wallet-{}@example.com", Uuid::new_v4()),
            "google",
        )
        .await
        .unwrap();
    let store = PostgresWalletStore::new(pool, user_id);
    let stored_id: WalletId = serde_json::from_value(serde_json::json!({
        "address": "0x676fa5b94067c2be14bc025df6c5c80dedf49a54",
        "chains": ["eip155:1"]
    }))
    .unwrap();
    let venue_wire_id: WalletId = serde_json::from_value(serde_json::json!({
        "address": "0x676fa5b94067c2be14bc025df6c5c80dedf49a54",
        "chains": ["hl-mainnet"]
    }))
    .unwrap();

    let mut state = WalletState::new(stored_id.clone());
    state.block_heights.insert(
        ChainId::new("eip155:1"),
        BlockHeight {
            number: 123,
            time: 456,
        },
    );
    store.save(&state).await.unwrap();

    let loaded = store.load(&venue_wire_id).await.unwrap();

    assert_eq!(
        loaded.wallet_id, stored_id,
        "Postgres /evaluate state lookup is keyed by user+address, so HL venue wire chains do not hide the stored EVM wallet state",
    );
    assert_eq!(loaded.block_heights[&ChainId::new("eip155:1")].number, 123);
}

#[tokio::test]
async fn refresh_session_rotation_rejects_replay() {
    let url = match std::env::var("TEST_DATABASE_URL") {
        Ok(url) => url,
        Err(_) => return,
    };
    let pool = PgPool::connect(&url).await.unwrap();
    let global = PostgresGlobalDb::new(pool);
    global.migrate().await.unwrap();

    let email = format!("refresh-{}@example.com", Uuid::new_v4());
    let user_id = global.upsert_user(&email, "google").await.unwrap();
    let issued_at = unix_now();
    let old_jti = Uuid::new_v4().to_string();
    let new_jti = Uuid::new_v4().to_string();
    let replay_jti = Uuid::new_v4().to_string();

    global
        .create_refresh_session(&user_id, &old_jti, issued_at, issued_at + 3600)
        .await
        .unwrap();

    assert!(
        global
            .rotate_refresh_session(
                &user_id,
                &old_jti,
                &new_jti,
                issued_at + 1,
                issued_at + 3601
            )
            .await
            .unwrap(),
        "first rotation must consume the active refresh session"
    );
    assert!(
        !global
            .rotate_refresh_session(
                &user_id,
                &old_jti,
                &replay_jti,
                issued_at + 2,
                issued_at + 3602
            )
            .await
            .unwrap(),
        "replaying the old refresh session must be rejected"
    );
}

#[tokio::test]
async fn wallet_state_save_does_not_reactivate_archived_wallet() {
    let url = match std::env::var("TEST_DATABASE_URL") {
        Ok(url) => url,
        Err(_) => return,
    };
    let pool = PgPool::connect(&url).await.unwrap();
    let global = PostgresGlobalDb::new(pool.clone());
    global.migrate().await.unwrap();

    let user_id = global
        .upsert_user(
            &format!("archive-save-{}@example.com", Uuid::new_v4()),
            "google",
        )
        .await
        .unwrap();
    let store = PostgresWalletStore::new(pool, user_id);
    let id: WalletId = serde_json::from_value(serde_json::json!({
        "address": "0x000000000000000000000000000000000000dEaD",
        "chains": ["eip155:1"]
    }))
    .unwrap();
    let mut state = WalletState::new(id.clone());

    store.save(&state).await.unwrap();
    assert_eq!(store.list_wallet_metadata().await.unwrap().len(), 1);
    assert!(
        store
            .archive_wallet("0x000000000000000000000000000000000000dead", unix_now())
            .await
            .unwrap(),
        "setup should archive the wallet"
    );
    assert!(
        store.list_wallet_metadata().await.unwrap().is_empty(),
        "archived wallet should be absent from active views"
    );

    state.block_heights.insert(
        ChainId::new("eip155:1"),
        BlockHeight {
            number: 123,
            time: 456,
        },
    );
    store.save(&state).await.unwrap();
    assert!(
        store.list_wallet_metadata().await.unwrap().is_empty(),
        "plain state saves must not resurrect an archived wallet"
    );
    assert_eq!(
        store
            .load(&id)
            .await
            .unwrap()
            .block_heights
            .get(&ChainId::new("eip155:1"))
            .unwrap()
            .number,
        123,
        "state writes should still persist while the wallet remains archived"
    );

    store.reactivate_wallet(&state).await.unwrap();
    assert_eq!(
        store.list_wallet_metadata().await.unwrap().len(),
        1,
        "only the explicit tracking path should reactivate the wallet"
    );
}

#[tokio::test]
async fn delete_listing_does_not_clear_forks_without_ownership() {
    let url = match std::env::var("TEST_DATABASE_URL") {
        Ok(url) => url,
        Err(_) => return,
    };
    let pool = PgPool::connect(&url).await.unwrap();
    let global = PostgresGlobalDb::new(pool.clone());
    global.migrate().await.unwrap();

    let suffix = Uuid::new_v4();
    let owner_id = global
        .upsert_user(&format!("owner-{suffix}@example.com"), "google")
        .await
        .unwrap();
    let fork_publisher_id = global
        .upsert_user(&format!("forker-{suffix}@example.com"), "google")
        .await
        .unwrap();
    let attacker_id = global
        .upsert_user(&format!("attacker-{suffix}@example.com"), "google")
        .await
        .unwrap();

    let parent = create_listing(
        &pool,
        test_policy_listing(
            format!("parent-{suffix}"),
            owner_id.clone(),
            "Parent policy",
            None,
        ),
        unix_now(),
    )
    .await
    .unwrap();
    let fork = create_listing(
        &pool,
        test_policy_listing(
            format!("fork-{suffix}"),
            fork_publisher_id,
            "Fork policy",
            Some(parent.id),
        ),
        unix_now(),
    )
    .await
    .unwrap();

    assert!(
        !delete_listing(&pool, parent.id, &attacker_id)
            .await
            .unwrap(),
        "non-publishers must not delete the listing"
    );
    assert_eq!(
        get_listing_by_id(&pool, fork.id, None)
            .await
            .unwrap()
            .unwrap()
            .forked_from,
        Some(parent.id),
        "failed delete attempts must not mutate fork provenance"
    );

    assert!(
        delete_listing(&pool, parent.id, &owner_id).await.unwrap(),
        "the publisher can delete their own listing"
    );
    assert_eq!(
        get_listing_by_id(&pool, fork.id, None)
            .await
            .unwrap()
            .unwrap()
            .forked_from,
        None,
        "authorized deletes clear child fork references before parent deletion"
    );
}

#[tokio::test]
async fn hidden_market_listings_are_not_directly_actionable() {
    let url = match std::env::var("TEST_DATABASE_URL") {
        Ok(url) => url,
        Err(_) => return,
    };
    let pool = PgPool::connect(&url).await.unwrap();
    let global = PostgresGlobalDb::new(pool.clone());
    global.migrate().await.unwrap();

    let suffix = Uuid::new_v4();
    let publisher_id = global
        .upsert_user(&format!("publisher-{suffix}@example.com"), "google")
        .await
        .unwrap();
    let viewer_id = global
        .upsert_user(&format!("viewer-{suffix}@example.com"), "google")
        .await
        .unwrap();
    let listing = create_listing(
        &pool,
        test_policy_listing(
            format!("hidden-{suffix}"),
            publisher_id,
            "Hidden policy",
            None,
        ),
        unix_now(),
    )
    .await
    .unwrap();
    let review = upsert_review(
        &pool,
        listing.id,
        &viewer_id,
        "1.0.0",
        5,
        &json!({ "en": "useful" }),
        unix_now(),
    )
    .await
    .unwrap()
    .unwrap();
    assert!(
        watch(&pool, &viewer_id, listing.id, unix_now())
            .await
            .unwrap(),
        "setup should create a watch while the listing is still published"
    );

    query("UPDATE market_listings SET status = 'archived' WHERE id = $1")
        .bind(listing.id)
        .execute(&pool)
        .await
        .unwrap();

    assert!(
        get_listing_by_id(&pool, listing.id, Some(&viewer_id))
            .await
            .unwrap()
            .is_none(),
        "hidden listings must not be readable by direct id"
    );
    assert!(
        get_version(&pool, listing.id, "1.0.0")
            .await
            .unwrap()
            .is_none(),
        "hidden listing versions must not be installable by direct id"
    );
    assert!(
        record_install(&pool, listing.id, "1.0.0", &viewer_id, unix_now())
            .await
            .unwrap()
            .is_none(),
        "hidden listing versions must not accept install telemetry writes"
    );
    assert!(
        list_reviews(&pool, listing.id, 10)
            .await
            .unwrap()
            .is_empty(),
        "hidden listing reviews must not be listed by direct id"
    );
    assert!(
        upsert_review(
            &pool,
            listing.id,
            &viewer_id,
            "1.0.0",
            4,
            &json!({ "en": "updated" }),
            unix_now(),
        )
        .await
        .unwrap()
        .is_none(),
        "hidden listing versions must not accept direct review writes"
    );
    assert!(
        create_listing_report(&pool, listing.id, &viewer_id, "spam", None, unix_now())
            .await
            .unwrap()
            .is_none(),
        "hidden listings must not accept direct reports"
    );
    assert!(
        create_review_report(&pool, review.id, &viewer_id, "spam", None, unix_now())
            .await
            .unwrap()
            .is_none(),
        "reviews on hidden listings must not accept direct reports"
    );
    assert!(
        vote_helpful(&pool, review.id, &viewer_id, unix_now())
            .await
            .unwrap()
            .is_none(),
        "reviews on hidden listings must not accept direct helpful votes"
    );
    assert!(
        !watch(&pool, &viewer_id, listing.id, unix_now())
            .await
            .unwrap(),
        "hidden listings must not accept direct watch writes"
    );
    assert!(
        list_watches(&pool, &viewer_id).await.unwrap().is_empty(),
        "existing watches must not expose hidden listings"
    );
    assert!(
        create_listing(
            &pool,
            test_policy_listing(
                format!("hidden-fork-{suffix}"),
                viewer_id,
                "Hidden fork",
                Some(listing.id),
            ),
            unix_now(),
        )
        .await
        .is_err(),
        "published listings must not fork from hidden marketplace targets"
    );
}

#[tokio::test]
async fn marketplace_popularity_counts_unique_installers_not_events() {
    let url = match std::env::var("TEST_DATABASE_URL") {
        Ok(url) => url,
        Err(_) => return,
    };
    let pool = PgPool::connect(&url).await.unwrap();
    let global = PostgresGlobalDb::new(pool.clone());
    global.migrate().await.unwrap();

    let suffix = Uuid::new_v4();
    let publisher_id = global
        .upsert_user(
            &format!("popularity-publisher-{suffix}@example.com"),
            "google",
        )
        .await
        .unwrap();
    let installer_a = global
        .upsert_user(&format!("popularity-a-{suffix}@example.com"), "google")
        .await
        .unwrap();
    let installer_b = global
        .upsert_user(&format!("popularity-b-{suffix}@example.com"), "google")
        .await
        .unwrap();
    let slug = format!("popularity-{suffix}");
    let listing = create_listing(
        &pool,
        test_policy_listing(slug.clone(), publisher_id, "Popular policy", None),
        unix_now(),
    )
    .await
    .unwrap();
    let installed_at = unix_now();

    assert!(
        record_install(&pool, listing.id, "1.0.0", &installer_a, installed_at)
            .await
            .unwrap()
            .is_some(),
        "first install should write an event"
    );
    assert!(
        record_install(&pool, listing.id, "1.0.0", &installer_a, installed_at)
            .await
            .unwrap()
            .is_some(),
        "same-user reinstall should still write an audit/history event"
    );
    assert!(
        record_install(&pool, listing.id, "1.0.0", &installer_b, installed_at)
            .await
            .unwrap()
            .is_some(),
        "another user install should write an event"
    );

    assert_eq!(
        get_listing_by_id(&pool, listing.id, Some(&installer_a))
            .await
            .unwrap()
            .unwrap()
            .install_count,
        2,
        "public listing popularity should count unique installers"
    );

    let activity = install_activity_since(&pool, installed_at, 200)
        .await
        .unwrap();
    let entry = activity
        .iter()
        .find(|row| row.slug == slug)
        .expect("listing should appear in recent install activity");
    assert_eq!(
        entry.recent_installs, 2,
        "recent popularity should count unique installers, not replayed events"
    );
}

#[tokio::test]
async fn market_writes_to_missing_targets_return_absent_not_db_errors() {
    let url = match std::env::var("TEST_DATABASE_URL") {
        Ok(url) => url,
        Err(_) => return,
    };
    let pool = PgPool::connect(&url).await.unwrap();
    let global = PostgresGlobalDb::new(pool.clone());
    global.migrate().await.unwrap();

    let suffix = Uuid::new_v4();
    let user_id = global
        .upsert_user(&format!("missing-target-{suffix}@example.com"), "google")
        .await
        .unwrap();
    let missing_listing = Uuid::new_v4();
    let missing_review = Uuid::new_v4();

    assert!(
        upsert_review(
            &pool,
            missing_listing,
            &user_id,
            "1.0.0",
            5,
            &json!({ "en": "missing" }),
            unix_now(),
        )
        .await
        .unwrap()
        .is_none(),
        "missing listing/version review writes should map to absent"
    );
    assert!(
        vote_helpful(&pool, missing_review, &user_id, unix_now())
            .await
            .unwrap()
            .is_none(),
        "missing review helpful votes should map to absent"
    );
    assert!(
        !watch(&pool, &user_id, missing_listing, unix_now())
            .await
            .unwrap(),
        "missing listing watches should map to absent"
    );
}

fn test_policy_listing(
    slug: String,
    publisher_id: String,
    display_name: &str,
    forked_from: Option<Uuid>,
) -> NewListing {
    NewListing {
        slug,
        kind: "policy".to_owned(),
        publisher_id,
        publisher_tier: "community".to_owned(),
        display_name: json!({ "en": display_name }),
        description: None,
        domain: Some("approval".to_owned()),
        category: None,
        doc: None,
        intents: None,
        severity: Some("warn".to_owned()),
        forked_from,
        initial_version: "1.0.0".to_owned(),
        initial_body: VersionBody {
            cedar_text: Some("permit(principal, action, resource);".to_owned()),
            manifest: None,
            policy_tree: None,
            members: None,
            changelog: None,
        },
    }
}

fn unix_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| i64::try_from(d.as_secs()).unwrap_or(i64::MAX))
}

/// Concurrent first-time logins of the SAME email must all succeed and return
/// the same id. `users` has two unique constraints (`users_pkey` on user_id and
/// `users_email_key` on email); a `upsert_user` that arbitrates `ON CONFLICT`
/// on only one of them races to insert the other and fails with a duplicate-key
/// 500 instead of upserting idempotently.
///
/// The race only fires on the *first* insert for an email (an existing row makes
/// every caller skip the conflicting INSERT), so each burst uses a fresh email
/// and we loop many bursts to make the narrow window reproduce reliably.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn upsert_user_is_idempotent_under_concurrent_first_login() {
    let url = match std::env::var("TEST_DATABASE_URL") {
        Ok(url) => url,
        Err(_) => return,
    };
    // Enough connections that the concurrent INSERTs genuinely overlap at the
    // server without exhausting the shared local test database when this file's
    // other concurrency regressions run in parallel.
    let pool = PgPoolOptions::new()
        .max_connections(24)
        .connect(&url)
        .await
        .unwrap();
    let global = PostgresGlobalDb::new(pool);
    global.migrate().await.unwrap();

    const BURSTS: usize = 30;
    const CONCURRENCY: usize = 20;
    for _ in 0..BURSTS {
        let email = format!("race-{}@example.com", Uuid::new_v4());
        let expected = derive_user_id(&email);

        let mut handles = Vec::with_capacity(CONCURRENCY);
        for _ in 0..CONCURRENCY {
            let global = global.clone();
            let email = email.clone();
            handles.push(tokio::spawn(async move {
                global.upsert_user(&email, "google").await
            }));
        }

        for handle in handles {
            let id = handle
                .await
                .expect("upsert_user task panicked")
                .expect("upsert_user must succeed idempotently under concurrency");
            assert_eq!(id, expected, "all concurrent logins must yield the same id");
        }
    }
}

#[tokio::test]
async fn oauth_user_identity_is_provider_subject_stable() {
    let url = match std::env::var("TEST_DATABASE_URL") {
        Ok(url) => url,
        Err(_) => return,
    };
    let pool = PgPool::connect(&url).await.unwrap();
    let global = PostgresGlobalDb::new(pool);
    global.migrate().await.unwrap();

    let suffix = Uuid::new_v4();
    let legacy_email = format!("legacy-oauth-{suffix}@example.com");
    let changed_email = format!("legacy-oauth-renamed-{suffix}@example.com");
    let fresh_email = format!("fresh-oauth-{suffix}@example.com");
    let subject = format!("google-sub-{suffix}");
    let other_subject = format!("google-sub-other-{suffix}");
    let fresh_subject = format!("google-sub-fresh-{suffix}");
    let legacy_id = global.upsert_user(&legacy_email, "google").await.unwrap();

    let linked_id = global
        .upsert_oauth_user(&legacy_email, "google", &subject)
        .await
        .unwrap();
    assert_eq!(
        linked_id, legacy_id,
        "first subject-aware login links the pre-subject email row"
    );

    let renamed_id = global
        .upsert_oauth_user(&changed_email, "google", &subject)
        .await
        .unwrap();
    assert_eq!(
        renamed_id, legacy_id,
        "same Google subject keeps the same local user_id across email changes"
    );
    assert!(
        global
            .get_user_by_email(&legacy_email)
            .await
            .unwrap()
            .is_none(),
        "the old email is not a second active identity after subject-linked rename"
    );
    assert_eq!(
        global
            .get_user_by_email(&changed_email)
            .await
            .unwrap()
            .unwrap()
            .user_id,
        legacy_id
    );

    let takeover = global
        .upsert_oauth_user(&changed_email, "google", &other_subject)
        .await;
    assert!(
        takeover.is_err(),
        "a different Google subject must not silently attach to an existing email"
    );

    let fresh_id = global
        .upsert_oauth_user(&fresh_email, "google", &fresh_subject)
        .await
        .unwrap();
    assert_ne!(
        fresh_id,
        derive_user_id(&fresh_email),
        "new OAuth users are keyed by provider subject, not mutable email"
    );
}

#[tokio::test]
async fn user_identity_inputs_are_trimmed_and_lowercased() {
    let url = match std::env::var("TEST_DATABASE_URL") {
        Ok(url) => url,
        Err(_) => return,
    };
    let pool = PgPool::connect(&url).await.unwrap();
    let global = PostgresGlobalDb::new(pool);
    global.migrate().await.unwrap();

    let suffix = Uuid::new_v4();
    let legacy_email = format!("  Legacy-Canon-{suffix}@Example.COM  ");
    let legacy_canonical = format!("legacy-canon-{suffix}@example.com");
    let legacy_id = global.upsert_user(&legacy_email, " Google ").await.unwrap();
    assert_eq!(
        legacy_id,
        derive_user_id(&legacy_canonical),
        "legacy/test user ids should derive from trimmed lowercase email"
    );
    let legacy = global
        .get_user_by_email(&format!("  LEGACY-CANON-{suffix}@EXAMPLE.COM  "))
        .await
        .unwrap()
        .expect("canonical email lookup should find the legacy user");
    assert_eq!(legacy.user_id, legacy_id);
    assert_eq!(legacy.email, legacy_canonical);
    assert_eq!(legacy.provider, "google");

    let oauth_email = format!("  OAuth-Canon-{suffix}@Example.COM  ");
    let oauth_canonical = format!("oauth-canon-{suffix}@example.com");
    let subject = format!("canonical-subject-{suffix}");
    let oauth_id = global
        .upsert_oauth_user(&oauth_email, " Google ", &subject)
        .await
        .unwrap();
    let oauth = global
        .get_user_by_email(&oauth_canonical)
        .await
        .unwrap()
        .expect("canonical email lookup should find the OAuth user");
    assert_eq!(oauth.user_id, oauth_id);
    assert_eq!(oauth.email, oauth_canonical);
    assert_eq!(oauth.provider, "google");
    assert_eq!(
        global
            .upsert_oauth_user(&oauth_canonical, "google", &subject)
            .await
            .unwrap(),
        oauth_id,
        "canonical-equivalent OAuth logins should keep the same user id"
    );

    assert!(global.upsert_user("   ", "google").await.is_err());
    assert!(global
        .upsert_oauth_user("user@example.com", "   ", &subject)
        .await
        .is_err());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn upsert_oauth_user_is_idempotent_under_concurrent_first_login() {
    let url = match std::env::var("TEST_DATABASE_URL") {
        Ok(url) => url,
        Err(_) => return,
    };
    let pool = PgPoolOptions::new()
        .max_connections(24)
        .connect(&url)
        .await
        .unwrap();
    let global = PostgresGlobalDb::new(pool);
    global.migrate().await.unwrap();

    const BURSTS: usize = 20;
    const CONCURRENCY: usize = 20;
    for _ in 0..BURSTS {
        let suffix = Uuid::new_v4();
        let email = format!("oauth-race-{suffix}@example.com");
        let subject = format!("oauth-race-subject-{suffix}");

        let mut handles = Vec::with_capacity(CONCURRENCY);
        for _ in 0..CONCURRENCY {
            let global = global.clone();
            let email = email.clone();
            let subject = subject.clone();
            handles.push(tokio::spawn(async move {
                global.upsert_oauth_user(&email, "google", &subject).await
            }));
        }

        let mut expected = None;
        for handle in handles {
            let id = handle
                .await
                .expect("upsert_oauth_user task panicked")
                .expect("upsert_oauth_user must succeed idempotently under concurrency");
            if let Some(expected) = expected.as_ref() {
                assert_eq!(
                    &id, expected,
                    "all concurrent OAuth logins must yield the same id"
                );
            } else {
                expected = Some(id);
            }
        }

        let stored = global
            .get_user_by_email(&email)
            .await
            .unwrap()
            .expect("concurrent OAuth login must create one user row");
        assert_eq!(Some(stored.user_id), expected);
    }
}
