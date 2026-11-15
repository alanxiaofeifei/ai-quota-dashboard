//! Narrow, credential-free projection of the published Codex quota response.
//!
//! This module does not read files, inspect authentication, contact a service, or
//! infer whether a quota has recovered. All examples and tests are synthetic.

use serde::Serialize;
use serde_json::{Map, Value};
use std::error::Error;
use std::fmt;

/// The largest Unix-second value representable through year 9999. Modern
/// millisecond timestamps exceed this bound and are rejected, never converted.
const MAX_UNIX_SECONDS: u64 = 253_402_300_799;
const MAX_BUCKETS: usize = 64;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct QuotaReport {
    pub schema_version: u32,
    pub provider: &'static str,
    /// The product surface queried by this adapter, not an assertion that the
    /// returned allowance belongs exclusively to that product.
    pub product: &'static str,
    pub meter_kind: &'static str,
    /// Names the schema contract, not the provenance of this particular input.
    pub protocol_contract: &'static str,
    /// Parsing success is not evidence of agreement with a real account UI.
    pub account_verification: &'static str,
    pub ordinary_usage_allowed: Option<bool>,
    pub buckets: Vec<QuotaBucket>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct QuotaBucket {
    /// `None` means the legacy response did not supply an identifier. It must
    /// not be replaced with a guessed product or shared-pool identifier.
    pub limit_id: Option<String>,
    /// `None` means the covered products are unknown. The published quota
    /// contract does not provide this metadata; plan names, bucket identifiers,
    /// and coincidentally equal usage cannot establish a shared-product scope.
    pub applies_to_products: Option<Vec<String>>,
    pub plan_type: Option<String>,
    pub primary: Option<QuotaWindow>,
    pub secondary: Option<QuotaWindow>,
    pub credits: Option<ConsumerCredits>,
    pub spend_control_reached: Option<bool>,
    pub rate_limit_reached_type: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct QuotaWindow {
    /// Source-reported percentage, not a message count or an estimated balance.
    pub used_percent: Option<f64>,
    pub duration_minutes: Option<u64>,
    pub resets_at_unix_seconds: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ConsumerCredits {
    pub meter_kind: &'static str,
    pub has_credits: Option<bool>,
    pub unlimited: Option<bool>,
    /// Kept as a decimal string. No currency, token-price, or API-wallet
    /// interpretation is attached to this consumer/workspace credit balance.
    pub balance: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ParseError {
    ExpectedObject,
    UpstreamError,
    MissingSnapshot,
    InvalidBucket,
    InvalidWindow,
    InvalidCredits,
    InvalidMetadata,
}

impl ParseError {
    /// Stable safe code. Neither this code nor Display contains input values.
    pub fn code(self) -> &'static str {
        match self {
            Self::ExpectedObject => "expected_object",
            Self::UpstreamError => "upstream_error",
            Self::MissingSnapshot => "missing_snapshot",
            Self::InvalidBucket => "invalid_bucket",
            Self::InvalidWindow => "invalid_window",
            Self::InvalidCredits => "invalid_credits",
            Self::InvalidMetadata => "invalid_metadata",
        }
    }
}

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::ExpectedObject => "Quota input must be a JSON object.",
            Self::UpstreamError => "The upstream quota request did not succeed.",
            Self::MissingSnapshot => "No usable quota snapshot was supplied.",
            Self::InvalidBucket => "The quota bucket shape or identifier is invalid.",
            Self::InvalidWindow => "A quota window contains an invalid measurement or timestamp.",
            Self::InvalidCredits => "Consumer credit metadata is invalid.",
            Self::InvalidMetadata => "Quota metadata has an invalid type or value.",
        })
    }
}

impl Error for ParseError {}

/// Accept the result body or a JSON-RPC response containing it. This is a
/// projection, not passthrough serialization: account identifiers, labels,
/// email, error messages, and unknown fields never enter the returned report.
///
/// A present multi-bucket map is authoritative, including an empty map. We do
/// not fall back to an older single bucket after an empty or malformed map.
pub fn parse_codex_rate_limits(value: &Value) -> Result<QuotaReport, ParseError> {
    let envelope = value.as_object().ok_or(ParseError::ExpectedObject)?;
    if envelope.get("error").is_some_and(|v| !v.is_null()) {
        return Err(ParseError::UpstreamError);
    }
    let body = match envelope.get("result") {
        Some(result) => result.as_object().ok_or(ParseError::ExpectedObject)?,
        None => envelope,
    };
    let ordinary_usage_allowed = optional_bool(body, "ordinaryUsageAllowed")?;
    let mut buckets = Vec::new();
    match body.get("rateLimitsByLimitId") {
        Some(Value::Object(map)) => {
            if map.is_empty() {
                return Err(ParseError::MissingSnapshot);
            }
            if map.len() > MAX_BUCKETS {
                return Err(ParseError::InvalidBucket);
            }
            let mut entries: Vec<_> = map.iter().collect();
            entries.sort_by_key(|(a, _)| *a);
            for (id, snapshot) in entries {
                if !valid_identifier(id) {
                    return Err(ParseError::InvalidBucket);
                }
                buckets.push(parse_bucket(snapshot, Some(id))?);
            }
        }
        Some(Value::Null) | None => {
            let snapshot = body
                .get("rateLimits")
                .filter(|v| !v.is_null())
                .ok_or(ParseError::MissingSnapshot)?;
            buckets.push(parse_bucket(snapshot, None)?);
        }
        Some(_) => return Err(ParseError::InvalidBucket),
    }
    Ok(QuotaReport {
        schema_version: 1,
        provider: "openai",
        product: "codex",
        meter_kind: "consumer_subscription_allowance",
        protocol_contract: "codex_app_server_rate_limits",
        account_verification: "pending_official_ui_comparison",
        ordinary_usage_allowed,
        buckets,
    })
}

fn parse_bucket(value: &Value, map_id: Option<&str>) -> Result<QuotaBucket, ParseError> {
    let object = value.as_object().ok_or(ParseError::InvalidBucket)?;
    let source_id = optional_identifier(object, "limitId")?;
    if let (Some(map_id), Some(source_id)) = (map_id, source_id.as_deref()) {
        if map_id != source_id {
            return Err(ParseError::InvalidBucket);
        }
    }
    let limit_id = map_id.map(str::to_owned).or(source_id);
    let primary = optional_window(object, "primary")?;
    let secondary = optional_window(object, "secondary")?;
    let credits = optional_credits(object)?;
    let spend_control_reached = optional_bool(object, "spendControlReached")?;
    let rate_limit_reached_type = optional_identifier(object, "rateLimitReachedType")?;
    let plan_type = optional_identifier(object, "planType")?;

    let has_window_evidence = [&primary, &secondary].into_iter().any(|window| {
        window.as_ref().is_some_and(|window| {
            window.used_percent.is_some() || window.resets_at_unix_seconds.is_some()
        })
    });
    let has_credit_evidence = credits.as_ref().is_some_and(|credits| {
        credits.balance.is_some() || credits.has_credits.is_some() || credits.unlimited.is_some()
    });
    if !has_window_evidence
        && !has_credit_evidence
        && spend_control_reached.is_none()
        && rate_limit_reached_type.is_none()
    {
        return Err(ParseError::MissingSnapshot);
    }
    Ok(QuotaBucket {
        limit_id,
        applies_to_products: None,
        plan_type,
        primary,
        secondary,
        credits,
        spend_control_reached,
        rate_limit_reached_type,
    })
}

fn optional_window(
    object: &Map<String, Value>,
    key: &str,
) -> Result<Option<QuotaWindow>, ParseError> {
    let window = match object.get(key) {
        None | Some(Value::Null) => return Ok(None),
        Some(Value::Object(window)) => window,
        Some(_) => return Err(ParseError::InvalidWindow),
    };
    let used_percent = match window.get("usedPercent") {
        None | Some(Value::Null) => None,
        Some(number) => {
            let percentage = number.as_f64().ok_or(ParseError::InvalidWindow)?;
            if !percentage.is_finite() || !(0.0..=100.0).contains(&percentage) {
                return Err(ParseError::InvalidWindow);
            }
            Some(percentage)
        }
    };
    let duration_minutes = match window.get("windowDurationMins") {
        None | Some(Value::Null) => None,
        Some(value) => {
            let minutes = value.as_u64().ok_or(ParseError::InvalidWindow)?;
            if minutes == 0 {
                return Err(ParseError::InvalidWindow);
            }
            Some(minutes)
        }
    };
    let resets_at_unix_seconds = match window.get("resetsAt") {
        None | Some(Value::Null) => None,
        Some(value) => {
            let seconds = value.as_u64().ok_or(ParseError::InvalidWindow)?;
            if seconds > MAX_UNIX_SECONDS {
                return Err(ParseError::InvalidWindow);
            }
            Some(seconds)
        }
    };
    Ok(Some(QuotaWindow {
        used_percent,
        duration_minutes,
        resets_at_unix_seconds,
    }))
}

fn optional_credits(object: &Map<String, Value>) -> Result<Option<ConsumerCredits>, ParseError> {
    let credits = match object.get("credits") {
        None | Some(Value::Null) => return Ok(None),
        Some(Value::Object(credits)) => credits,
        Some(_) => return Err(ParseError::InvalidCredits),
    };
    let has_credits =
        optional_bool(credits, "hasCredits").map_err(|_| ParseError::InvalidCredits)?;
    let unlimited = optional_bool(credits, "unlimited").map_err(|_| ParseError::InvalidCredits)?;
    let balance = match credits.get("balance") {
        None | Some(Value::Null) => None,
        Some(Value::String(balance)) if valid_decimal(balance) => Some(balance.clone()),
        Some(_) => return Err(ParseError::InvalidCredits),
    };
    Ok(Some(ConsumerCredits {
        meter_kind: "consumer_credit_balance",
        has_credits,
        unlimited,
        balance,
    }))
}

fn optional_bool(object: &Map<String, Value>, key: &str) -> Result<Option<bool>, ParseError> {
    match object.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Bool(value)) => Ok(Some(*value)),
        Some(_) => Err(ParseError::InvalidMetadata),
    }
}

fn optional_identifier(
    object: &Map<String, Value>,
    key: &str,
) -> Result<Option<String>, ParseError> {
    match object.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) if valid_identifier(value) => Ok(Some(value.clone())),
        Some(_) => Err(ParseError::InvalidMetadata),
    }
}

// Quota identifiers and enum-like metadata are not arbitrary server labels.
// Restricting their shape also prevents unsafe strings entering diagnostics.
fn valid_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-' | b'.' | b':'))
}

fn valid_decimal(value: &str) -> bool {
    if value.is_empty() || value.len() > 128 {
        return false;
    }
    let unsigned = value
        .strip_prefix('-')
        .or_else(|| value.strip_prefix('+'))
        .unwrap_or(value);
    let mut parts = unsigned.split('.');
    let whole = parts.next().unwrap_or_default();
    let fraction = parts.next();
    !whole.is_empty()
        && whole.bytes().all(|b| b.is_ascii_digit())
        && fraction.is_none_or(|part| !part.is_empty() && part.bytes().all(|b| b.is_ascii_digit()))
        && parts.next().is_none()
}
