//! Strict projection of a locally exported browser-selection observation.
//!
//! Reading a page does not establish server freshness or account identity.
//! Only the narrow normalized observation below can enter storage.

use chrono::{DateTime, Datelike, SecondsFormat, TimeDelta, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fmt;

pub const BROWSER_SOURCE: &str = "user_initiated_browser_selection";
pub const USAGE_URL: &str = "https://chatgpt.com/settings/usage?tab=overview";
pub const MAX_RELATIVE_RESET_SECONDS: u64 = 366 * 86_400;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BrowserObservation {
    pub page_read_at: String,
    pub server_observed_at: Option<String>,
    pub source: String,
    pub freshness: String,
    pub remaining_percent: f64,
    pub relative_reset_seconds: Option<u64>,
    pub credits_balance: Option<String>,
}

/// Fixed categories only; untrusted JSON, labels, local paths, SQL messages,
/// and account identifiers must never be reflected through an error.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DomainError {
    InvalidReport,
    InvalidReadTime,
    InvalidAccountLabel,
    AccountNotFound,
    OlderSnapshot,
    SnapshotConflict,
    InvalidDatabase,
    UnsupportedDatabaseVersion,
    StorageUnavailable,
}

impl DomainError {
    pub fn code(self) -> &'static str {
        match self {
            Self::InvalidReport => "invalid_browser_report",
            Self::InvalidReadTime => "invalid_read_time",
            Self::InvalidAccountLabel => "invalid_account_label",
            Self::AccountNotFound => "account_not_found",
            Self::OlderSnapshot => "older_snapshot",
            Self::SnapshotConflict => "snapshot_conflict",
            Self::InvalidDatabase => "invalid_database",
            Self::UnsupportedDatabaseVersion => "unsupported_database_version",
            Self::StorageUnavailable => "storage_unavailable",
        }
    }
}

impl fmt::Display for DomainError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.code())
    }
}

impl std::error::Error for DomainError {}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct BrowserReport {
    schema_version: u32,
    provider: String,
    source: String,
    source_page: String,
    page_read_at: String,
    server_observed_at: Option<Value>,
    freshness: String,
    account: Option<Value>,
    provider_pool_id: Option<Value>,
    applies_to_products: Option<Value>,
    real_account_verified: bool,
    weekly: WeeklyReport,
    credits: Option<CreditReport>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WeeklyReport {
    window: String,
    remaining_percent: f64,
    resets_at: Option<Value>,
    reset_relative: Option<RelativeReset>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RelativeReset {
    label: String,
    seconds: u64,
    precision: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CreditReport {
    meter_kind: String,
    balance: String,
    unit: String,
}

/// Parse the exact selection-export contract. Unknown fields are rejected,
/// rather than retained for diagnostics or silently persisted.
pub fn parse_browser_report(
    value: &Value,
    now: DateTime<Utc>,
) -> Result<BrowserObservation, DomainError> {
    let report: BrowserReport =
        serde_json::from_value(value.clone()).map_err(|_| DomainError::InvalidReport)?;
    if report.schema_version != 1
        || report.provider != "openai"
        || report.source != BROWSER_SOURCE
        || report.source_page != USAGE_URL
        || report.server_observed_at.is_some()
        || report.freshness != "unknown"
        || report.account.is_some()
        || report.provider_pool_id.is_some()
        || report.applies_to_products.is_some()
        || report.real_account_verified
        || report.weekly.window != "weekly"
        || report.weekly.resets_at.is_some()
    {
        return Err(DomainError::InvalidReport);
    }
    let relative_reset_seconds = match report.weekly.reset_relative {
        Some(reset) => {
            if reset.precision != "estimated_from_display"
                || reset.seconds > MAX_RELATIVE_RESET_SECONDS
                || reset.label.len() > 128
            {
                return Err(DomainError::InvalidReport);
            }
            // Labels are not trusted display strings. Consumers reconstruct
            // their own wording from the bounded seconds; no raw label is kept.
            Some(reset.seconds)
        }
        None => None,
    };
    let credits_balance = match report.credits {
        Some(credits) => {
            if credits.meter_kind != "consumer_credit_balance" || credits.unit != "credits" {
                return Err(DomainError::InvalidReport);
            }
            Some(credits.balance)
        }
        None => None,
    };
    normalize_observation(
        &BrowserObservation {
            page_read_at: report.page_read_at,
            server_observed_at: None,
            source: BROWSER_SOURCE.to_owned(),
            freshness: "unknown".to_owned(),
            remaining_percent: report.weekly.remaining_percent,
            relative_reset_seconds,
            credits_balance,
        },
        Some(now),
    )
}

/// Public DTOs may also be constructed by trusted local callers, so storage
/// repeats these invariants rather than relying on the JSON entry point alone.
pub(crate) fn normalize_observation(
    observation: &BrowserObservation,
    now: Option<DateTime<Utc>>,
) -> Result<BrowserObservation, DomainError> {
    if observation.source != BROWSER_SOURCE
        || observation.freshness != "unknown"
        || observation.server_observed_at.is_some()
        || !observation.remaining_percent.is_finite()
        || !(0.0..=100.0).contains(&observation.remaining_percent)
        || observation
            .relative_reset_seconds
            .is_some_and(|seconds| seconds > MAX_RELATIVE_RESET_SECONDS)
        || observation
            .credits_balance
            .as_deref()
            .is_some_and(|balance| !valid_credit_decimal(balance))
    {
        return Err(DomainError::InvalidReport);
    }
    let read_at = read_time(&observation.page_read_at)?;
    if now.is_some_and(|now| read_at.signed_duration_since(now) > TimeDelta::minutes(5)) {
        return Err(DomainError::InvalidReadTime);
    }
    Ok(BrowserObservation {
        page_read_at: utc_milliseconds(read_at),
        server_observed_at: None,
        source: BROWSER_SOURCE.to_owned(),
        freshness: "unknown".to_owned(),
        remaining_percent: if observation.remaining_percent == 0.0 {
            0.0
        } else {
            observation.remaining_percent
        },
        relative_reset_seconds: observation.relative_reset_seconds,
        credits_balance: observation.credits_balance.clone(),
    })
}

pub(crate) fn read_time(value: &str) -> Result<DateTime<Utc>, DomainError> {
    if value.len() > 40 {
        return Err(DomainError::InvalidReadTime);
    }
    let parsed = DateTime::parse_from_rfc3339(value).map_err(|_| DomainError::InvalidReadTime)?;
    // Chrono can represent leap seconds, but browser Date/Intl cannot. The
    // selection-export contract only contains ordinary millisecond instants.
    if parsed.timestamp_subsec_nanos() >= 1_000_000_000
        || parsed.timestamp_subsec_nanos() % 1_000_000 != 0
    {
        return Err(DomainError::InvalidReadTime);
    }
    let utc = parsed.with_timezone(&Utc);
    // Browser-export instants use four-digit years. Offset normalization must
    // not introduce Chrono's signed extended-year spelling, which JS rejects.
    if !(0..=9999).contains(&utc.year()) {
        return Err(DomainError::InvalidReadTime);
    }
    Ok(utc)
}

pub(crate) fn utc_milliseconds(value: DateTime<Utc>) -> String {
    value.to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn valid_credit_decimal(value: &str) -> bool {
    if value.is_empty() || value.len() > 128 {
        return false;
    }
    let mut parts = value.split('.');
    let integer = parts.next().unwrap_or_default();
    if integer.is_empty() || !integer.bytes().all(|byte| byte.is_ascii_digit()) {
        return false;
    }
    match parts.next() {
        Some(fraction) => {
            !fraction.is_empty()
                && fraction.bytes().all(|byte| byte.is_ascii_digit())
                && parts.next().is_none()
        }
        None => true,
    }
}
