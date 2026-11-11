use ai_quota_preflight::snapshot::{parse_browser_report, BrowserObservation};
use ai_quota_preflight::store::Store;
use chrono::{DateTime, Duration, Utc};
use serde_json::{json, Value};
use std::fs;

const SYNTHETIC_SECRET: &str = "SYNTHETIC_SELECTION_NOT_FOR_STORAGE";

fn instant(value: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(value)
        .unwrap()
        .with_timezone(&Utc)
}

fn now() -> DateTime<Utc> {
    instant("2031-04-05T10:10:00.000Z")
}

fn report() -> Value {
    json!({
        "schema_version": 1,
        "provider": "openai",
        "source": "user_initiated_browser_selection",
        "source_page": "https://chatgpt.com/settings/usage?tab=overview",
        "page_read_at": "2031-04-05T10:00:00.000Z",
        "server_observed_at": null,
        "freshness": "unknown",
        "account": null,
        "provider_pool_id": null,
        "applies_to_products": null,
        "real_account_verified": false,
        "weekly": {
            "window": "weekly",
            "remaining_percent": 37,
            "resets_at": null,
            "reset_relative": {
                "label": "3d 4h",
                "seconds": 273600,
                "precision": "estimated_from_display"
            }
        },
        "credits": {
            "meter_kind": "consumer_credit_balance",
            "balance": "12.7500",
            "unit": "credits"
        }
    })
}

fn observation() -> BrowserObservation {
    parse_browser_report(&report(), now()).unwrap()
}

#[test]
fn projects_only_browser_measurements_and_preserves_unknown_service_freshness() {
    let parsed = observation();
    let value = serde_json::to_value(&parsed).unwrap();
    assert_eq!(parsed.page_read_at, "2031-04-05T10:00:00.000Z");
    assert_eq!(parsed.remaining_percent, 37.0);
    assert_eq!(parsed.relative_reset_seconds, Some(273600));
    assert_eq!(parsed.credits_balance.as_deref(), Some("12.7500"));
    assert!(parsed.server_observed_at.is_none());
    assert_eq!(parsed.freshness, "unknown");
    assert_eq!(parsed.source, "user_initiated_browser_selection");
    assert!(value.get("weekly").is_none());
    assert!(value.get("account").is_none());
    assert!(value.get("provider_pool_id").is_none());
    assert!(value.get("applies_to_products").is_none());
    assert!(value.get("real_account_verified").is_none());
    assert!(value.get("resets_at").is_none());
}

#[test]
fn actual_zero_and_full_remaining_allowance_are_not_unavailable_defaults() {
    for remaining in [0.0, 100.0] {
        let mut input = report();
        input["weekly"]["remaining_percent"] = json!(remaining);
        let parsed = parse_browser_report(&input, now()).unwrap();
        assert_eq!(parsed.remaining_percent, remaining);
    }
    for invalid in [json!(-0.1), json!(100.1), json!(null), json!("37")] {
        let mut input = report();
        input["weekly"]["remaining_percent"] = invalid;
        assert!(parse_browser_report(&input, now()).is_err());
    }
}

#[test]
fn missing_credit_and_relative_reset_are_unknown_not_zero() {
    let mut input = report();
    input["credits"] = Value::Null;
    input["weekly"]["reset_relative"] = Value::Null;
    let parsed = parse_browser_report(&input, now()).unwrap();
    assert_eq!(parsed.credits_balance, None);
    assert_eq!(parsed.relative_reset_seconds, None);
    assert_eq!(parsed.remaining_percent, 37.0);
}

#[test]
fn zero_credits_does_not_consume_the_separate_weekly_allowance() {
    let mut input = report();
    input["credits"]["balance"] = json!("0");
    let parsed = parse_browser_report(&input, now()).unwrap();
    assert_eq!(parsed.credits_balance.as_deref(), Some("0"));
    assert_eq!(parsed.remaining_percent, 37.0);
}

#[test]
fn decimal_credit_strings_keep_precision_and_do_not_become_api_money() {
    let huge_decimal = "9".repeat(120);
    let mut input = report();
    input["credits"]["balance"] = json!(huge_decimal);
    assert_eq!(
        parse_browser_report(&input, now())
            .unwrap()
            .credits_balance
            .as_deref(),
        Some(huge_decimal.as_str())
    );
    for invalid in [
        json!(12.75),
        json!("-1"),
        json!("1e3"),
        json!("$12"),
        json!("1.2.3"),
        json!("9".repeat(129)),
    ] {
        input["credits"]["balance"] = invalid;
        assert!(parse_browser_report(&input, now()).is_err());
    }
    for (field, invalid) in [("unit", "USD"), ("meter_kind", "developer_api_balance")] {
        let mut input = report();
        input["credits"][field] = json!(invalid);
        assert!(parse_browser_report(&input, now()).is_err());
    }
}

#[test]
fn source_identity_and_verification_cannot_be_forged_by_import_metadata() {
    for (field, invalid) in [
        ("schema_version", json!(2)),
        ("provider", json!("another_provider")),
        ("source", json!("official_account_api")),
        ("source_page", json!("https://chatgpt.com/")),
        (
            "source_page",
            json!("https://chatgpt.com/settings/usage?tab=history"),
        ),
        ("account", json!("synthetic-private-account")),
        ("provider_pool_id", json!("guessed-pool")),
        ("applies_to_products", json!(["guessed-product"])),
        ("real_account_verified", json!(true)),
        ("server_observed_at", json!("2031-04-05T10:00:00.000Z")),
        ("freshness", json!("fresh")),
    ] {
        let mut input = report();
        input[field] = invalid;
        assert!(
            parse_browser_report(&input, now()).is_err(),
            "field {field}"
        );
    }
    let mut input = report();
    input["weekly"]["resets_at"] = json!("2031-04-12T10:00:00.000Z");
    assert!(parse_browser_report(&input, now()).is_err());
    input = report();
    input["weekly"]["window"] = json!("five_hour");
    assert!(parse_browser_report(&input, now()).is_err());
}

#[test]
fn future_relative_reset_is_only_an_estimate_without_an_absolute_reset() {
    let parsed = observation();
    assert!(serde_json::to_value(parsed)
        .unwrap()
        .get("resets_at")
        .is_none());
    let mut input = report();
    input["weekly"]["reset_relative"]["seconds"] = json!(366 * 86400 + 1);
    assert!(parse_browser_report(&input, now()).is_err());
    input = report();
    input["weekly"]["reset_relative"]["precision"] = json!("verified_by_server");
    assert!(parse_browser_report(&input, now()).is_err());
}

#[test]
fn unknown_fields_are_rejected_with_fixed_safe_errors() {
    for scope in ["root", "weekly", "credits", "relative"] {
        let mut input = report();
        let object = match scope {
            "root" => input.as_object_mut().unwrap(),
            "weekly" => input["weekly"].as_object_mut().unwrap(),
            "credits" => input["credits"].as_object_mut().unwrap(),
            _ => input["weekly"]["reset_relative"].as_object_mut().unwrap(),
        };
        object.insert(
            "unexpected_access_token".to_owned(),
            json!(SYNTHETIC_SECRET),
        );
        let error = parse_browser_report(&input, now()).err().unwrap();
        assert!(!error.to_string().contains(SYNTHETIC_SECRET));
        assert!(!format!("{error:?}").contains(SYNTHETIC_SECRET));
        assert!(!error.code().contains(SYNTHETIC_SECRET));
    }
}

#[test]
fn raw_relative_label_is_not_retained_in_the_observation_or_database() {
    let mut input = report();
    input["weekly"]["reset_relative"]["label"] = json!(SYNTHETIC_SECRET);
    let parsed = parse_browser_report(&input, now()).unwrap();
    assert!(!serde_json::to_string(&parsed)
        .unwrap()
        .contains(SYNTHETIC_SECRET));
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("quota.sqlite");
    let store = Store::open(&database).unwrap();
    let account = store.create_account("Synthetic account").unwrap();
    store.import_snapshot(&account.id, &parsed, now()).unwrap();
    drop(store);
    assert!(!fs::read(database)
        .unwrap()
        .windows(SYNTHETIC_SECRET.len())
        .any(|part| part == SYNTHETIC_SECRET.as_bytes()));
}

#[test]
fn timezone_offsets_normalize_before_ordering_and_import_time_does_not_replace_read_time() {
    let mut input = report();
    input["page_read_at"] = json!("2031-04-05T18:00:00.000+08:00");
    let parsed = parse_browser_report(&input, now()).unwrap();
    assert_eq!(parsed.page_read_at, observation().page_read_at);
    let directory = tempfile::tempdir().unwrap();
    let store = Store::open(&directory.path().join("quota.sqlite")).unwrap();
    let account = store.create_account("Synthetic").unwrap();
    let saved = store.import_snapshot(&account.id, &parsed, now()).unwrap();
    assert_eq!(saved.observation.page_read_at, "2031-04-05T10:00:00.000Z");
    assert_eq!(saved.imported_at, "2031-04-05T10:10:00.000Z");
}

#[test]
fn future_clock_guard_and_precision_do_not_turn_old_observations_into_fresh_ones() {
    let mut input = report();
    input["page_read_at"] = json!("2031-04-05T10:16:00.000Z");
    assert!(parse_browser_report(&input, now()).is_err());
    input["page_read_at"] = json!("2031-04-05T10:00:00.000001Z");
    assert!(parse_browser_report(&input, now()).is_err());
    input["page_read_at"] = json!("2030-12-31T23:59:60.000Z");
    assert_eq!(
        parse_browser_report(&input, now()).err().unwrap().code(),
        "invalid_read_time"
    );
    input["page_read_at"] = json!("0000-01-01T00:00:00.000+01:00");
    assert_eq!(
        parse_browser_report(&input, now()).err().unwrap().code(),
        "invalid_read_time"
    );
    input["page_read_at"] = json!("2020-01-01T00:00:00.000Z");
    let parsed = parse_browser_report(&input, now()).unwrap();
    assert_eq!(parsed.page_read_at, "2020-01-01T00:00:00.000Z");
    assert_eq!(parsed.freshness, "unknown");
}

#[test]
fn account_labels_are_bounded_and_invalid_ids_do_not_delete_other_accounts() {
    let directory = tempfile::tempdir().unwrap();
    let store = Store::open(&directory.path().join("quota.sqlite")).unwrap();
    for invalid in [
        "".to_owned(),
        "  ".to_owned(),
        "bad\nlabel".to_owned(),
        "测".repeat(41),
    ] {
        assert!(store.create_account(&invalid).is_err());
    }
    let first = store.create_account(&"测".repeat(40)).unwrap();
    assert!(uuid::Uuid::parse_str(&first.id).is_ok());
    let second = store.create_account("' OR 1=1 --").unwrap();
    assert_ne!(first.id, second.id);
    assert!(store.delete_account("' OR 1=1 --").is_err());
    assert_eq!(store.list_accounts().unwrap().len(), 2);
}

#[test]
fn duplicate_import_is_idempotent_and_preserves_the_original_import_time() {
    let directory = tempfile::tempdir().unwrap();
    let store = Store::open(&directory.path().join("quota.sqlite")).unwrap();
    let account = store.create_account("Synthetic").unwrap();
    let original = store
        .import_snapshot(&account.id, &observation(), now())
        .unwrap();
    let repeated = store
        .import_snapshot(&account.id, &observation(), now() + Duration::hours(1))
        .unwrap();
    assert_eq!(repeated.imported_at, original.imported_at);
    assert_eq!(store.list_snapshots().unwrap().len(), 1);
}

#[test]
fn old_or_conflicting_imports_cannot_overwrite_the_last_successful_measurement() {
    let directory = tempfile::tempdir().unwrap();
    let store = Store::open(&directory.path().join("quota.sqlite")).unwrap();
    let account = store.create_account("Synthetic").unwrap();
    store
        .import_snapshot(&account.id, &observation(), now())
        .unwrap();

    let mut older = report();
    older["page_read_at"] = json!("2031-04-05T09:59:00.000Z");
    older["weekly"]["remaining_percent"] = json!(88);
    let error = store
        .import_snapshot(
            &account.id,
            &parse_browser_report(&older, now()).unwrap(),
            now(),
        )
        .err()
        .unwrap();
    assert_eq!(error.code(), "older_snapshot");

    let mut conflicting = report();
    conflicting["weekly"]["remaining_percent"] = json!(88);
    let error = store
        .import_snapshot(
            &account.id,
            &parse_browser_report(&conflicting, now()).unwrap(),
            now(),
        )
        .err()
        .unwrap();
    assert_eq!(error.code(), "snapshot_conflict");
    let snapshots = store.list_snapshots().unwrap();
    assert_eq!(snapshots.len(), 1);
    assert_eq!(snapshots[0].observation.remaining_percent, 37.0);
}

#[test]
fn a_newer_snapshot_replaces_only_its_chosen_local_account() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("quota.sqlite");
    let store = Store::open(&database).unwrap();
    let first = store.create_account("A").unwrap();
    let second = store.create_account("B").unwrap();
    store
        .import_snapshot(&first.id, &observation(), now())
        .unwrap();
    store
        .import_snapshot(&second.id, &observation(), now())
        .unwrap();
    let mut new = report();
    new["page_read_at"] = json!("2031-04-05T10:05:00.000Z");
    new["weekly"]["remaining_percent"] = json!(29);
    store
        .import_snapshot(
            &first.id,
            &parse_browser_report(&new, now()).unwrap(),
            now(),
        )
        .unwrap();
    drop(store);

    let reopened = Store::open(&database).unwrap();
    let snapshots = reopened.list_snapshots().unwrap();
    assert_eq!(snapshots.len(), 2);
    assert_eq!(
        snapshots
            .iter()
            .find(|row| row.account_id == first.id)
            .unwrap()
            .observation
            .remaining_percent,
        29.0
    );
    assert_eq!(
        snapshots
            .iter()
            .find(|row| row.account_id == second.id)
            .unwrap()
            .observation
            .remaining_percent,
        37.0
    );
    assert!(snapshots
        .iter()
        .all(|row| row.observation.server_observed_at.is_none()));
}

#[test]
fn deleting_an_account_cascades_its_latest_snapshot_without_touching_another_account() {
    let directory = tempfile::tempdir().unwrap();
    let store = Store::open(&directory.path().join("quota.sqlite")).unwrap();
    let first = store.create_account("A").unwrap();
    let second = store.create_account("B").unwrap();
    store
        .import_snapshot(&first.id, &observation(), now())
        .unwrap();
    store
        .import_snapshot(&second.id, &observation(), now())
        .unwrap();
    store.delete_account(&first.id).unwrap();
    assert_eq!(store.list_accounts().unwrap().len(), 1);
    let snapshots = store.list_snapshots().unwrap();
    assert_eq!(snapshots.len(), 1);
    assert_eq!(snapshots[0].account_id, second.id);
    assert!(store
        .import_snapshot(&first.id, &observation(), now())
        .is_err());
}

#[test]
fn independent_connections_cannot_race_an_older_snapshot_over_a_newer_one() {
    use std::sync::{Arc, Barrier};
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("quota.sqlite");
    let store = Store::open(&database).unwrap();
    let account = store.create_account("Synthetic").unwrap();
    let barrier = Arc::new(Barrier::new(2));
    let mut joins = Vec::new();
    for (timestamp, remaining) in [
        ("2031-04-05T10:01:00.000Z", 59),
        ("2031-04-05T10:05:00.000Z", 23),
    ] {
        let path = database.clone();
        let id = account.id.clone();
        let barrier = barrier.clone();
        let mut input = report();
        input["page_read_at"] = json!(timestamp);
        input["weekly"]["remaining_percent"] = json!(remaining);
        let observation = parse_browser_report(&input, now()).unwrap();
        joins.push(std::thread::spawn(move || {
            let connection = Store::open(&path).unwrap();
            barrier.wait();
            match connection.import_snapshot(&id, &observation, now()) {
                Ok(_) => {}
                Err(error) => assert_eq!(error.code(), "older_snapshot"),
            }
        }));
    }
    for join in joins {
        join.join().unwrap();
    }
    assert_eq!(
        store.list_snapshots().unwrap()[0]
            .observation
            .remaining_percent,
        23.0
    );
}

#[test]
fn refuses_unrelated_or_future_database_without_overwriting_it() {
    let directory = tempfile::tempdir().unwrap();
    let unrelated = directory.path().join("unrelated.sqlite");
    let connection = rusqlite::Connection::open(&unrelated).unwrap();
    connection.execute_batch("CREATE TABLE unrelated(value TEXT); INSERT INTO unrelated VALUES ('preserve unrelated content');").unwrap();
    drop(connection);
    let before = fs::read(&unrelated).unwrap();
    assert!(Store::open(&unrelated).is_err());
    assert_eq!(fs::read(&unrelated).unwrap(), before);

    let future = directory.path().join("future.sqlite");
    drop(Store::open(&future).unwrap());
    let connection = rusqlite::Connection::open(&future).unwrap();
    connection.pragma_update(None, "user_version", 999).unwrap();
    drop(connection);
    let before = fs::read(&future).unwrap();
    assert!(Store::open(&future).is_err());
    assert_eq!(fs::read(&future).unwrap(), before);
}

#[cfg(unix)]
#[test]
fn database_is_owner_only_and_symlink_targets_are_not_followed() {
    use std::os::unix::fs::{symlink, PermissionsExt};
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("quota.sqlite");
    drop(Store::open(&database).unwrap());
    assert_eq!(
        fs::metadata(&database).unwrap().permissions().mode() & 0o777,
        0o600
    );
    let alias = directory.path().join("alias.sqlite");
    symlink(&database, &alias).unwrap();
    let before = fs::read(&database).unwrap();
    assert!(Store::open(&alias).is_err());
    assert_eq!(fs::read(&database).unwrap(), before);
}

#[cfg(unix)]
#[test]
fn existing_shared_database_is_refused_without_changing_its_content_or_permissions() {
    use std::os::unix::fs::PermissionsExt;
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("quota.sqlite");
    let store = Store::open(&path).unwrap();
    store.create_account("Synthetic").unwrap();
    drop(store);
    let original = fs::read(&path).unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
    assert!(Store::open(&path).is_err());
    assert_eq!(
        fs::metadata(&path).unwrap().permissions().mode() & 0o777,
        0o644
    );
    assert_eq!(fs::read(&path).unwrap(), original);
    fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
    assert_eq!(
        Store::open(&path).unwrap().list_accounts().unwrap().len(),
        1
    );
}
