use policy_db::derive_user_id;
use policy_db::stores::market::{
    create_listing, create_listing_report, create_review_report, create_version, delete_listing,
    get_latest_version, get_listing_by_id, get_version, install_activity_since,
    list_reports_by_reporter, list_reviews, list_watches, record_install,
    record_install_and_get_version, upsert_review, vote_helpful, watch, NewListing, VersionBody,
};
use policy_db::stores::{PostgresGlobalDb, PostgresWalletStore};
use policy_db::DbError;
use policy_state::live_field::{DataSource, LiveField};
use policy_state::primitives::{Address, BlockHeight, ChainId, Price, Time, U256};
use policy_state::token::{Balance, TokenHolding, TokenKey, TokenKind};
use policy_state::{WalletId, WalletState, WalletStore};
use serde_json::json;
use sqlx_core::query::query;
use sqlx_postgres::{PgPool, PgPoolOptions};
use std::str::FromStr;
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
async fn active_wallet_load_uses_metadata_wallet_id_over_stale_state_json() {
    let url = match std::env::var("TEST_DATABASE_URL") {
        Ok(url) => url,
        Err(_) => return,
    };
    let pool = PgPool::connect(&url).await.unwrap();
    let global = PostgresGlobalDb::new(pool.clone());
    global.migrate().await.unwrap();

    let user_id = global
        .upsert_user(
            &format!("active-metadata-{}@example.com", Uuid::new_v4()),
            "google",
        )
        .await
        .unwrap();
    let store = PostgresWalletStore::new(pool.clone(), user_id.clone());
    let address = Address::from_str("0x676fa5b94067c2be14bc025df6c5c80dedf49a54").unwrap();
    let stale_id = WalletId::new(address, [ChainId::ethereum_mainnet()]);
    store.save(&WalletState::new(stale_id)).await.unwrap();

    let current_chains = serde_json::to_value(vec![ChainId::new("eip155:42161")]).unwrap();
    query("UPDATE wallets SET chains = $1 WHERE user_id = $2 AND address = $3")
        .bind(current_chains)
        .bind(&user_id)
        .bind(format!("{address:#x}"))
        .execute(&pool)
        .await
        .unwrap();

    let loaded = store
        .load_active_by_address(address)
        .await
        .unwrap()
        .expect("active wallet should load");

    assert_eq!(
        loaded.wallet_id,
        WalletId::new(address, [ChainId::new("eip155:42161")]),
        "active reads must trust wallet metadata, not stale state_json wallet_id chains",
    );
}

#[tokio::test]
async fn plain_state_save_does_not_overwrite_active_wallet_metadata_chains() {
    let url = match std::env::var("TEST_DATABASE_URL") {
        Ok(url) => url,
        Err(_) => return,
    };
    let pool = PgPool::connect(&url).await.unwrap();
    let global = PostgresGlobalDb::new(pool.clone());
    global.migrate().await.unwrap();

    let user_id = global
        .upsert_user(
            &format!("active-chain-preserve-{}@example.com", Uuid::new_v4()),
            "google",
        )
        .await
        .unwrap();
    let store = PostgresWalletStore::new(pool, user_id);
    let address = Address::from_str("0x676fa5b94067c2be14bc025df6c5c80dedf49a54").unwrap();
    let active_id = WalletId::new(address, [ChainId::ethereum_mainnet()]);
    let stale_id = WalletId::new(address, [ChainId::new("eip155:42161")]);

    store
        .save(&WalletState::new(active_id.clone()))
        .await
        .unwrap();
    store.save(&WalletState::new(stale_id)).await.unwrap();

    assert_eq!(
        store.list_wallets().await.unwrap(),
        vec![active_id.clone()],
        "plain state saves must not change the active tracking chain contract",
    );
    assert_eq!(
        store
            .load_active_by_address(address)
            .await
            .unwrap()
            .expect("active wallet should load")
            .wallet_id,
        active_id,
        "active reads should continue to expose metadata chains after a stale state save",
    );
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
    assert!(
        store
            .load_active_by_address(id.address)
            .await
            .unwrap()
            .is_none(),
        "active read helper must not return archived wallet state"
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
    assert!(
        store
            .load_active_by_address(id.address)
            .await
            .unwrap()
            .is_some(),
        "reactivated wallet should be active-loadable again"
    );
}

#[tokio::test]
async fn global_token_facts_ignore_archived_wallet_states() {
    let url = match std::env::var("TEST_DATABASE_URL") {
        Ok(url) => url,
        Err(_) => return,
    };
    let pool = PgPool::connect(&url).await.unwrap();
    let global = PostgresGlobalDb::new(pool.clone());
    global.migrate().await.unwrap();

    let token_addr = format!("0x{:040x}", Uuid::new_v4().as_u128());
    let archived_user = global
        .upsert_user(
            &format!("archived-price-{}@example.com", Uuid::new_v4()),
            "google",
        )
        .await
        .unwrap();
    let archived_store = PostgresWalletStore::new(pool.clone(), archived_user);
    let archived_id: WalletId = serde_json::from_value(serde_json::json!({
        "address": "0x0000000000000000000000000000000000000a11",
        "chains": ["eip155:1"]
    }))
    .unwrap();
    let mut archived_state = WalletState::new(archived_id.clone());
    archived_state.tokens.insert(
        token_key(&token_addr),
        priced_holding(&token_addr, "9.9900"),
    );
    archived_store.save(&archived_state).await.unwrap();
    archived_store
        .archive_wallet("0x0000000000000000000000000000000000000a11", unix_now())
        .await
        .unwrap();

    assert!(
        global
            .latest_token_price("eip155:1", &token_addr)
            .await
            .unwrap()
            .is_none(),
        "archived wallet state must not feed market-global prices"
    );
    assert!(
        global
            .latest_token_decimals("eip155:1", &token_addr)
            .await
            .unwrap()
            .is_none(),
        "archived wallet state must not feed market-global decimals"
    );

    let active_user = global
        .upsert_user(
            &format!("active-price-{}@example.com", Uuid::new_v4()),
            "google",
        )
        .await
        .unwrap();
    let active_store = PostgresWalletStore::new(pool, active_user);
    let active_id: WalletId = serde_json::from_value(serde_json::json!({
        "address": "0x0000000000000000000000000000000000000a22",
        "chains": ["eip155:1"]
    }))
    .unwrap();
    let mut active_state = WalletState::new(active_id);
    active_state.tokens.insert(
        token_key(&token_addr),
        priced_holding(&token_addr, "1.2300"),
    );
    active_store.save(&active_state).await.unwrap();

    let fact = global
        .latest_token_price("eip155:1", &token_addr)
        .await
        .unwrap()
        .expect("active wallet price should be visible");
    assert_eq!(fact.price_usd, "1.2300");
    assert_eq!(fact.decimals, 6);
    assert_eq!(
        global
            .latest_token_decimals("eip155:1", &token_addr)
            .await
            .unwrap(),
        Some(6)
    );
}

#[tokio::test]
async fn global_token_price_prefers_price_field_freshness_over_wallet_state_timestamp() {
    let url = match std::env::var("TEST_DATABASE_URL") {
        Ok(url) => url,
        Err(_) => return,
    };
    let pool = PgPool::connect(&url).await.unwrap();
    let global = PostgresGlobalDb::new(pool.clone());
    global.migrate().await.unwrap();

    let token_addr = format!("0x{:040x}", Uuid::new_v4().as_u128());
    let fresh_user = global
        .upsert_user(
            &format!("fresh-price-{}@example.com", Uuid::new_v4()),
            "google",
        )
        .await
        .unwrap();
    let stale_user = global
        .upsert_user(
            &format!("stale-price-{}@example.com", Uuid::new_v4()),
            "google",
        )
        .await
        .unwrap();

    let fresh_id: WalletId = serde_json::from_value(serde_json::json!({
        "address": "0x0000000000000000000000000000000000000b11",
        "chains": ["eip155:1"]
    }))
    .unwrap();
    let stale_id: WalletId = serde_json::from_value(serde_json::json!({
        "address": "0x0000000000000000000000000000000000000b22",
        "chains": ["eip155:1"]
    }))
    .unwrap();

    let fresh_store = PostgresWalletStore::new(pool.clone(), fresh_user.clone());
    let stale_store = PostgresWalletStore::new(pool.clone(), stale_user.clone());

    let mut fresh_state = WalletState::new(fresh_id);
    fresh_state.tokens.insert(
        token_key(&token_addr),
        priced_holding_at(&token_addr, "2.0000", 1_800_000_000),
    );
    fresh_store.save(&fresh_state).await.unwrap();

    let mut stale_state = WalletState::new(stale_id);
    stale_state.tokens.insert(
        token_key(&token_addr),
        priced_holding_at(&token_addr, "0.0100", 1_700_000_000),
    );
    stale_store.save(&stale_state).await.unwrap();

    query(
        "UPDATE wallet_states SET updated_at = $1 \
         WHERE user_id = $2 AND address = $3",
    )
    .bind(1_600_000_000_i64)
    .bind(&fresh_user)
    .bind("0x0000000000000000000000000000000000000b11")
    .execute(&pool)
    .await
    .unwrap();
    query(
        "UPDATE wallet_states SET updated_at = $1 \
         WHERE user_id = $2 AND address = $3",
    )
    .bind(2_000_000_000_i64)
    .bind(&stale_user)
    .bind("0x0000000000000000000000000000000000000b22")
    .execute(&pool)
    .await
    .unwrap();

    let fact = global
        .latest_token_price("eip155:1", &token_addr)
        .await
        .unwrap()
        .expect("active wallet price should be visible");
    assert_eq!(
        fact.price_usd, "2.0000",
        "global token pricing must use the freshest price field, not the freshest wallet_state row"
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
    let report = create_listing_report(
        &pool,
        parent.id,
        &attacker_id,
        "unsafe_policy",
        Some("publisher should not be able to erase this report"),
        unix_now(),
    )
    .await
    .unwrap()
    .expect("setup should create a report while the parent is published");

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
        "the publisher can archive their own published listing"
    );
    assert!(
        get_listing_by_id(&pool, parent.id, None)
            .await
            .unwrap()
            .is_none(),
        "archived listings must disappear from public direct reads"
    );
    assert_eq!(
        get_listing_by_id(&pool, fork.id, None)
            .await
            .unwrap()
            .unwrap()
            .forked_from,
        None,
        "authorized archives clear child fork references before hiding the parent"
    );
    let reports = list_reports_by_reporter(&pool, &attacker_id, 10)
        .await
        .unwrap();
    assert!(
        reports.iter().any(|r| r.id == report.id),
        "publisher archives must preserve existing moderation reports"
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
        get_latest_version(&pool, listing.id)
            .await
            .unwrap()
            .is_none(),
        "hidden listing latest version must not be readable by direct id"
    );
    assert!(
        record_install(&pool, listing.id, "1.0.0", &viewer_id, unix_now())
            .await
            .unwrap()
            .is_none(),
        "hidden listing versions must not accept install telemetry writes"
    );
    assert!(
        record_install_and_get_version(&pool, listing.id, "1.0.0", &viewer_id, unix_now())
            .await
            .unwrap()
            .is_none(),
        "hidden listing versions must not return a body through the install/download path"
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
async fn marketplace_watch_is_idempotent_for_published_listings() {
    let url = match std::env::var("TEST_DATABASE_URL") {
        Ok(url) => url,
        Err(_) => return,
    };
    let pool = PgPool::connect(&url).await.unwrap();
    let global = PostgresGlobalDb::new(pool.clone());
    global.migrate().await.unwrap();

    let suffix = Uuid::new_v4();
    let publisher_id = global
        .upsert_user(&format!("watch-publisher-{suffix}@example.com"), "google")
        .await
        .unwrap();
    let viewer_id = global
        .upsert_user(&format!("watch-viewer-{suffix}@example.com"), "google")
        .await
        .unwrap();
    let listing = create_listing(
        &pool,
        test_policy_listing(
            format!("watch-idempotent-{suffix}"),
            publisher_id,
            "Watch idempotent policy",
            None,
        ),
        unix_now(),
    )
    .await
    .unwrap();

    assert!(
        watch(&pool, &viewer_id, listing.id, unix_now())
            .await
            .unwrap(),
        "first watch should subscribe to the published listing"
    );
    assert!(
        watch(&pool, &viewer_id, listing.id, unix_now())
            .await
            .unwrap(),
        "replaying watch should stay successful for an already-watched published listing"
    );

    let watches = list_watches(&pool, &viewer_id).await.unwrap();
    assert_eq!(watches.len(), 1, "idempotent watch must not duplicate rows");
    assert_eq!(watches[0].id, listing.id);
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
    let downloaded =
        record_install_and_get_version(&pool, listing.id, "1.0.0", &installer_a, installed_at)
            .await
            .unwrap()
            .expect("atomic install/download should return the version body");
    assert_eq!(downloaded.listing_id, listing.id);
    assert_eq!(downloaded.version, "1.0.0");
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
async fn marketplace_review_signals_reject_self_promotion() {
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
            &format!("self-promo-publisher-{suffix}@example.com"),
            "google",
        )
        .await
        .unwrap();
    let reviewer_id = global
        .upsert_user(
            &format!("self-promo-reviewer-{suffix}@example.com"),
            "google",
        )
        .await
        .unwrap();
    let listing = create_listing(
        &pool,
        test_policy_listing(
            format!("self-promo-{suffix}"),
            publisher_id.clone(),
            "Self promotion",
            None,
        ),
        unix_now(),
    )
    .await
    .unwrap();

    let self_review = upsert_review(
        &pool,
        listing.id,
        &publisher_id,
        "1.0.0",
        5,
        &json!({ "en": "best policy" }),
        unix_now(),
    )
    .await
    .expect_err("publisher self-review must be rejected");
    assert!(
        matches!(self_review, DbError::Forbidden { .. }),
        "unexpected self-review error: {self_review}"
    );

    let review = upsert_review(
        &pool,
        listing.id,
        &reviewer_id,
        "1.0.0",
        5,
        &json!({ "en": "useful" }),
        unix_now(),
    )
    .await
    .unwrap()
    .expect("third-party review should be accepted");

    let self_helpful = vote_helpful(&pool, review.id, &reviewer_id, unix_now())
        .await
        .expect_err("review author self-helpful vote must be rejected");
    assert!(
        matches!(self_helpful, DbError::Forbidden { .. }),
        "unexpected self-helpful error: {self_helpful}"
    );
    assert!(
        vote_helpful(&pool, review.id, &publisher_id, unix_now())
            .await
            .unwrap()
            .unwrap(),
        "another user can still vote helpful"
    );
}

#[tokio::test]
async fn market_reports_db_rejects_ambiguous_listing_and_review_target() {
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
            &format!("ambiguous-report-publisher-{suffix}@example.com"),
            "google",
        )
        .await
        .unwrap();
    let reviewer_id = global
        .upsert_user(
            &format!("ambiguous-report-reviewer-{suffix}@example.com"),
            "google",
        )
        .await
        .unwrap();
    let reporter_id = global
        .upsert_user(
            &format!("ambiguous-report-reporter-{suffix}@example.com"),
            "google",
        )
        .await
        .unwrap();
    let listing = create_listing(
        &pool,
        test_policy_listing(
            format!("ambiguous-report-{suffix}"),
            publisher_id,
            "Ambiguous report",
            None,
        ),
        unix_now(),
    )
    .await
    .unwrap();
    let review = upsert_review(
        &pool,
        listing.id,
        &reviewer_id,
        "1.0.0",
        5,
        &json!({ "en": "useful" }),
        unix_now(),
    )
    .await
    .unwrap()
    .expect("setup should create a review");

    let err = query(
        "INSERT INTO market_reports (
           id, listing_id, review_id, reporter_id, reason, details, status, created_at
         ) VALUES ($1, $2, $3, $4, 'spam', NULL, 'open', $5)",
    )
    .bind(Uuid::new_v4())
    .bind(listing.id)
    .bind(review.id)
    .bind(&reporter_id)
    .bind(unix_now())
    .execute(&pool)
    .await
    .expect_err("market_reports must not allow both listing_id and review_id");

    assert!(
        err.to_string()
            .contains("market_reports_exactly_one_target"),
        "unexpected ambiguous-report error: {err}"
    );
}

#[tokio::test]
async fn create_version_rechecks_current_version_inside_db_transaction() {
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
    let listing = create_listing(
        &pool,
        test_policy_listing(
            format!("version-lock-{suffix}"),
            publisher_id,
            "Version lock",
            None,
        ),
        unix_now(),
    )
    .await
    .unwrap();

    create_version(
        &pool,
        listing.id,
        "1.2.0",
        version_body("permit(principal, action, resource); // 1.2.0"),
        unix_now(),
    )
    .await
    .expect("newer version should publish");

    let stale = create_version(
        &pool,
        listing.id,
        "1.1.0",
        version_body("permit(principal, action, resource); // stale"),
        unix_now(),
    )
    .await
    .expect_err("DB store must reject versions older than the locked current_version");
    assert!(
        stale
            .to_string()
            .contains("new version must be strictly greater than current_version"),
        "unexpected stale-version error: {stale}"
    );
    assert!(
        get_version(&pool, listing.id, "1.1.0")
            .await
            .unwrap()
            .is_none(),
        "rejected stale version must not be inserted"
    );
    assert_eq!(
        get_listing_by_id(&pool, listing.id, None)
            .await
            .unwrap()
            .expect("listing remains visible")
            .current_version
            .as_deref(),
        Some("1.2.0"),
        "current_version must not downgrade after a stale publish attempt"
    );

    query("UPDATE market_listings SET status = 'rejected' WHERE id = $1")
        .bind(listing.id)
        .execute(&pool)
        .await
        .unwrap();
    let hidden = create_version(
        &pool,
        listing.id,
        "1.3.0",
        version_body("permit(principal, action, resource); // hidden"),
        unix_now(),
    )
    .await
    .expect_err("DB store must reject versions for hidden listings");
    assert!(
        hidden.to_string().contains("entity not found"),
        "unexpected hidden-listing error: {hidden}"
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

fn version_body(cedar_text: &str) -> VersionBody {
    VersionBody {
        cedar_text: Some(cedar_text.to_owned()),
        manifest: None,
        policy_tree: None,
        members: None,
        changelog: None,
    }
}

fn token_key(address: &str) -> TokenKey {
    TokenKey::Erc20 {
        chain: ChainId::ethereum_mainnet(),
        address: Address::from_str(address).unwrap(),
    }
}

fn priced_holding(address: &str, price: &str) -> TokenHolding {
    priced_holding_at(address, price, 1_700_000_000)
}

fn priced_holding_at(address: &str, price: &str, synced_at: u64) -> TokenHolding {
    let key = token_key(address);
    TokenHolding {
        key,
        kind: TokenKind::Unknown,
        symbol: "TST".to_owned(),
        decimals: 6,
        balance: Balance::fungible(U256::from(1_000_000u64)),
        committed: Balance::zero_fungible(),
        approved_to: None,
        price_usd: Some(LiveField::new(
            Price::new(price),
            DataSource::UserSupplied,
            Time::from_unix(synced_at),
        )),
        metadata: None,
        value_usd: None,
        last_synced_at: Time::from_unix(synced_at),
        primitives_source: DataSource::UserSupplied,
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
