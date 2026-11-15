use ai_quota_preflight::quota::{parse_codex_rate_limits, ParseError};
use serde_json::{json, Value};

fn legacy(window: Value) -> Value {
    json!({"rateLimits": {"limitId":"codex", "primary":window}})
}

#[test]
fn legacy_preserves_source_units_and_unknowns() {
    let report = parse_codex_rate_limits(&json!({
        "result": {
            "ordinaryUsageAllowed": null,
            "rateLimits": {
                "limitId": "codex", "planType": "pro",
                "primary": {"usedPercent": 17.5, "windowDurationMins": 37, "resetsAt": 1794400000},
                "secondary": null
            }
        }
    }))
    .unwrap();
    assert_eq!(report.buckets.len(), 1);
    assert_eq!(report.meter_kind, "consumer_subscription_allowance");
    assert_eq!(report.ordinary_usage_allowed, None);
    assert_eq!(
        report.account_verification,
        "pending_official_ui_comparison"
    );
    assert_eq!(report.protocol_contract, "codex_app_server_rate_limits");
    let bucket = &report.buckets[0];
    assert_eq!(bucket.limit_id.as_deref(), Some("codex"));
    assert_eq!(bucket.plan_type.as_deref(), Some("pro"));
    assert_eq!(bucket.secondary, None);
    let window = bucket.primary.as_ref().unwrap();
    assert_eq!(window.used_percent, Some(17.5));
    assert_eq!(window.duration_minutes, Some(37));
    assert_eq!(window.resets_at_unix_seconds, Some(1794400000));
}

#[test]
fn multi_bucket_is_preferred_sorted_and_not_added_to_legacy() {
    let report = parse_codex_rate_limits(&json!({
        "rateLimits": {"limitId":"codex", "primary":{"usedPercent":99}},
        "rateLimitsByLimitId": {
            "codex_other": {"limitId":"codex_other", "secondary":{"usedPercent":40}},
            "codex": {"limitId":"codex", "primary":{"usedPercent":25}}
        }
    }))
    .unwrap();
    assert_eq!(report.buckets.len(), 2);
    assert_eq!(report.buckets[0].limit_id.as_deref(), Some("codex"));
    assert_eq!(
        report.buckets[0].primary.as_ref().unwrap().used_percent,
        Some(25.0)
    );
    assert_eq!(report.buckets[1].limit_id.as_deref(), Some("codex_other"));
}

#[test]
fn map_key_can_supply_missing_bucket_id() {
    let report = parse_codex_rate_limits(&json!({
        "rateLimitsByLimitId": {"future_bucket": {"primary":{"usedPercent":12}}}
    }))
    .unwrap();
    assert_eq!(report.buckets[0].limit_id.as_deref(), Some("future_bucket"));
}

#[test]
fn legacy_missing_id_is_not_invented() {
    let report = parse_codex_rate_limits(&json!({
        "rateLimits":{"primary":{"usedPercent":12}}
    }))
    .unwrap();
    assert_eq!(report.buckets[0].limit_id, None);
}

#[test]
fn query_product_and_unpublished_scope_metadata_do_not_establish_allowance_coverage() {
    for (limit_id, plan_type) in [
        ("codex", "pro"),
        ("shared_agent_pool", "future_plan"),
        ("future_bucket", "unknown"),
    ] {
        let report = parse_codex_rate_limits(&json!({
            "sharedProducts": ["synthetic_agent_a", "synthetic_agent_b"],
            "rateLimits": {
                "limitId": limit_id,
                "planType": plan_type,
                "primary": {"usedPercent":25},
                "appliesToProducts": ["synthetic_agent_a"],
                "applies_to_products": ["synthetic_agent_b"],
                "sharedProducts": ["synthetic_agent_a", "synthetic_agent_b"],
                "isShared": true
            }
        }))
        .unwrap();
        assert_eq!(report.product, "codex");
        assert_eq!(report.meter_kind, "consumer_subscription_allowance");
        assert_eq!(report.buckets[0].applies_to_products, None);
        let serialized = serde_json::to_value(&report).unwrap();
        assert!(serialized["buckets"][0]["applies_to_products"].is_null());
        let text = serde_json::to_string(&report).unwrap();
        assert!(!text.contains("synthetic_agent_a"));
        assert!(!text.contains("synthetic_agent_b"));
    }
}

#[test]
fn distinct_buckets_with_equal_percentages_are_not_merged_or_assumed_shared() {
    let report = parse_codex_rate_limits(&json!({
        "rateLimitsByLimitId": {
            "bucket_a": {"primary":{"usedPercent":25}},
            "bucket_b": {"primary":{"usedPercent":25}}
        }
    }))
    .unwrap();
    assert_eq!(report.buckets.len(), 2);
    assert_eq!(report.buckets[0].limit_id.as_deref(), Some("bucket_a"));
    assert_eq!(report.buckets[1].limit_id.as_deref(), Some("bucket_b"));
    for bucket in &report.buckets {
        assert_eq!(bucket.applies_to_products, None);
        assert_eq!(bucket.primary.as_ref().unwrap().used_percent, Some(25.0));
    }
}

#[test]
fn weekly_only_observation_does_not_create_a_five_hour_window() {
    let report = parse_codex_rate_limits(&json!({
        "rateLimits": {
            "limitId":"future_bucket",
            "primary":null,
            "secondary":{"usedPercent":33,"windowDurationMins":10080}
        }
    }))
    .unwrap();
    let bucket = &report.buckets[0];
    assert_eq!(bucket.primary, None);
    assert_eq!(
        bucket.secondary.as_ref().unwrap().duration_minutes,
        Some(10080)
    );
    assert_eq!(bucket.applies_to_products, None);
}

#[test]
fn reset_only_is_unknown_usage_not_zero() {
    let report = parse_codex_rate_limits(&legacy(json!({
        "usedPercent":null, "windowDurationMins":null, "resetsAt":1794400000
    })))
    .unwrap();
    let window = report.buckets[0].primary.as_ref().unwrap();
    assert_eq!(window.used_percent, None);
    assert_eq!(window.duration_minutes, None);
    assert_eq!(window.resets_at_unix_seconds, Some(1794400000));
}

#[test]
fn zero_and_full_are_actual_measurements() {
    for number in [0, 100] {
        let report = parse_codex_rate_limits(&legacy(json!({"usedPercent":number}))).unwrap();
        assert_eq!(
            report.buckets[0].primary.as_ref().unwrap().used_percent,
            Some(f64::from(number))
        );
    }
}

#[test]
fn missing_and_empty_snapshots_are_errors_not_full_or_empty_allowance() {
    for input in [
        json!({}),
        json!({"rateLimits":null}),
        json!({"rateLimits":{}}),
        json!({"rateLimits":{"primary":{"usedPercent":null}}}),
        json!({"rateLimits":{"primary":{"windowDurationMins":300}}}),
        json!({"rateLimits":{"planType":"pro"}}),
        json!({"rateLimits":{"credits":{}}}),
        json!({"rateLimitsByLimitId":{}}),
        json!({"rateLimitsByLimitId":{},"rateLimits":{"primary":{"usedPercent":50}}}),
    ] {
        assert_eq!(
            parse_codex_rate_limits(&input).unwrap_err(),
            ParseError::MissingSnapshot
        );
    }
}

#[test]
fn null_map_allows_legacy_but_malformed_map_never_does() {
    let mut input = legacy(json!({"usedPercent":25}));
    input["rateLimitsByLimitId"] = Value::Null;
    assert!(parse_codex_rate_limits(&input).is_ok());
    input["rateLimitsByLimitId"] = json!([]);
    assert_eq!(
        parse_codex_rate_limits(&input).unwrap_err(),
        ParseError::InvalidBucket
    );
}

#[test]
fn malformed_known_window_values_are_not_clamped_or_coerced() {
    for window in [
        json!({"usedPercent":-1}),
        json!({"usedPercent":101}),
        json!({"usedPercent":"25"}),
        json!({"usedPercent":true}),
        json!({"usedPercent":25,"windowDurationMins":0}),
        json!({"usedPercent":25,"windowDurationMins":-1}),
        json!({"usedPercent":25,"windowDurationMins":1.5}),
        json!({"usedPercent":25,"windowDurationMins":"300"}),
        json!({"usedPercent":25,"resetsAt":1794400000000_u64}),
        json!({"usedPercent":25,"resetsAt":-1}),
        json!({"usedPercent":25,"resetsAt":1.5}),
        json!({"usedPercent":25,"resetsAt":"1794400000"}),
        json!([]),
        json!(true),
    ] {
        assert_eq!(
            parse_codex_rate_limits(&legacy(window)).unwrap_err(),
            ParseError::InvalidWindow
        );
    }
}

#[test]
fn null_reset_stays_unknown_and_epoch_zero_is_not_changed() {
    let report =
        parse_codex_rate_limits(&legacy(json!({"usedPercent":20,"resetsAt":null}))).unwrap();
    assert_eq!(
        report.buckets[0]
            .primary
            .as_ref()
            .unwrap()
            .resets_at_unix_seconds,
        None
    );
    let report = parse_codex_rate_limits(&legacy(json!({"usedPercent":20,"resetsAt":0}))).unwrap();
    assert_eq!(
        report.buckets[0]
            .primary
            .as_ref()
            .unwrap()
            .resets_at_unix_seconds,
        Some(0)
    );
}

#[test]
fn credits_remain_decimal_consumer_units_and_never_currency() {
    let report = parse_codex_rate_limits(&json!({
        "rateLimits":{"credits":{"hasCredits":true,"unlimited":false,"balance":"0012.3400"}}
    }))
    .unwrap();
    let credits = report.buckets[0].credits.as_ref().unwrap();
    assert_eq!(credits.meter_kind, "consumer_credit_balance");
    assert_eq!(credits.balance.as_deref(), Some("0012.3400"));
    let output = serde_json::to_string(&report).unwrap();
    assert!(!output.contains("USD"));
    assert!(!output.contains("developer_api"));
}

#[test]
fn nullable_credit_balance_does_not_become_zero() {
    let report = parse_codex_rate_limits(&json!({
        "rateLimits":{"credits":{"hasCredits":false,"unlimited":false,"balance":null}}
    }))
    .unwrap();
    assert_eq!(report.buckets[0].credits.as_ref().unwrap().balance, None);
}

#[test]
fn signed_credit_strings_are_preserved_without_assuming_balance_semantics() {
    for balance in ["-1", "-0.5000", "+3.50"] {
        let report = parse_codex_rate_limits(&json!({
            "rateLimits":{"credits":{"balance":balance}}
        }))
        .unwrap();
        assert_eq!(
            report.buckets[0]
                .credits
                .as_ref()
                .unwrap()
                .balance
                .as_deref(),
            Some(balance)
        );
    }
}

#[test]
fn malformed_credit_fields_are_rejected() {
    for credits in [
        json!({"hasCredits":"true"}),
        json!({"unlimited":1}),
        json!({"balance":12}),
        json!({"balance":"--1"}),
        json!({"balance":"1e6"}),
        json!({"balance":"1."}),
        json!({"balance":".1"}),
        json!({"balance":" 1"}),
        json!({"balance":"1.2.3"}),
        json!({"balance":"USD 12"}),
        json!({"balance":""}),
        json!({"balance":"-"}),
        json!([]),
    ] {
        assert_eq!(
            parse_codex_rate_limits(&json!({"rateLimits":{"credits":credits}})).unwrap_err(),
            ParseError::InvalidCredits
        );
    }
}

#[test]
fn authoritative_blocking_signals_are_preserved_without_recovery_inference() {
    let report = parse_codex_rate_limits(&json!({
        "ordinaryUsageAllowed":false,
        "rateLimits":{
            "primary":{"usedPercent":0,"resetsAt":1},
            "spendControlReached":true,
            "rateLimitReachedType":"workspace_member_usage_limit_reached"
        }
    }))
    .unwrap();
    assert_eq!(report.ordinary_usage_allowed, Some(false));
    assert_eq!(report.buckets[0].spend_control_reached, Some(true));
    assert_eq!(
        report.buckets[0].rate_limit_reached_type.as_deref(),
        Some("workspace_member_usage_limit_reached")
    );
}

#[test]
fn unknown_identifiers_are_preserved_but_untrusted_arbitrary_strings_are_not() {
    let report = parse_codex_rate_limits(&json!({
        "rateLimits":{"limitId":"future-v2.thing","planType":"future_plan","primary":{"usedPercent":5}}
    })).unwrap();
    assert_eq!(report.buckets[0].plan_type.as_deref(), Some("future_plan"));
    for field in ["limitId", "planType", "rateLimitReachedType"] {
        for invalid in [
            "",
            "person@example.invalid",
            "hello\nworld",
            "word with spaces",
        ] {
            let mut input = legacy(json!({"usedPercent":25}));
            input["rateLimits"][field] = json!(invalid);
            assert_eq!(
                parse_codex_rate_limits(&input).unwrap_err(),
                ParseError::InvalidMetadata
            );
        }
    }
}

#[test]
fn map_id_mismatch_and_invalid_bucket_shapes_fail() {
    for input in [
        json!({"rateLimitsByLimitId":{"codex":{"limitId":"different","primary":{"usedPercent":5}}}}),
        json!({"rateLimitsByLimitId":{"person@example.invalid":{"primary":{"usedPercent":5}}}}),
        json!({"rateLimitsByLimitId":{"codex":null}}),
        json!({"rateLimits":[]}),
    ] {
        assert_eq!(
            parse_codex_rate_limits(&input).unwrap_err(),
            ParseError::InvalidBucket
        );
    }
}

#[test]
fn unrelated_sensitive_fields_and_server_labels_are_never_projected() {
    let report = parse_codex_rate_limits(&json!({
        "accountId":"synthetic-private-account",
        "email":"synthetic@example.invalid",
        "token":"SYNTHETIC_SECRET",
        "rateLimitResetCredits":{"credits":[{"description":"SYNTHETIC_CHAT"}]},
        "rateLimits":{
            "limitId":"codex", "limitName":"SYNTHETIC_LABEL",
            "primary":{"usedPercent":20,"extra":"SYNTHETIC_EXTRA"},
            "unknown":{"token":"SYNTHETIC_NESTED"}
        }
    }))
    .unwrap();
    let serialized = serde_json::to_string(&report).unwrap();
    for forbidden in [
        "synthetic-private-account",
        "synthetic@example.invalid",
        "SYNTHETIC_SECRET",
        "SYNTHETIC_CHAT",
        "SYNTHETIC_LABEL",
        "SYNTHETIC_EXTRA",
        "SYNTHETIC_NESTED",
    ] {
        assert!(!serialized.contains(forbidden));
    }
}

#[test]
fn upstream_errors_are_fixed_messages_and_do_not_serialize_details() {
    let error = parse_codex_rate_limits(&json!({
        "id":3,"error":{"code":401,"message":"SYNTHETIC_SECRET"},
        "result":{"rateLimits":{"primary":{"usedPercent":0}}}
    }))
    .unwrap_err();
    assert_eq!(error, ParseError::UpstreamError);
    assert_eq!(error.code(), "upstream_error");
    assert!(!error.to_string().contains("SYNTHETIC_SECRET"));
}

#[test]
fn invalid_top_level_metadata_fails_instead_of_guessing() {
    for value in [json!("true"), json!(0), json!([])] {
        let mut input = legacy(json!({"usedPercent":2}));
        input["ordinaryUsageAllowed"] = value;
        assert_eq!(
            parse_codex_rate_limits(&input).unwrap_err(),
            ParseError::InvalidMetadata
        );
    }
    for input in [
        json!(null),
        json!([]),
        json!("login required"),
        json!({"result":null}),
    ] {
        assert_eq!(
            parse_codex_rate_limits(&input).unwrap_err(),
            ParseError::ExpectedObject
        );
    }
}
