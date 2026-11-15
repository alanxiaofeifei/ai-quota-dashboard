//! App-owned SQLite storage for profiles and their latest validated snapshot.
//! No original browser export, platform credentials, or server session is kept.

use crate::snapshot::{
    normalize_observation, read_time, utc_milliseconds, BrowserObservation, DomainError,
};
use chrono::{DateTime, Utc};
use rusqlite::{
    params, Connection, OpenFlags, OptionalExtension, Transaction, TransactionBehavior,
};
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions as FileOptions};
use std::path::Path;
use std::time::Duration;
use uuid::Uuid;

const APPLICATION_ID: i32 = 0x4151_5144;
const SCHEMA_VERSION: i32 = 1;
const SOURCE_ID: &str = "openai_usage_selection";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Account {
    pub id: String,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Snapshot {
    pub account_id: String,
    pub observation: BrowserObservation,
    pub imported_at: String,
}

pub struct Store {
    connection: Connection,
}

impl Store {
    pub fn open(path: &Path) -> Result<Self, DomainError> {
        ensure_private_regular_file(path)?;
        // Canonical absolute filenames avoid SQLite's special :memory: name or
        // URI interpretation. URI mode is not enabled for this file database.
        let filename = path.file_name().ok_or(DomainError::InvalidDatabase)?;
        let parent = path
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
            .unwrap_or_else(|| Path::new("."));
        let path = fs::canonicalize(parent)
            .map_err(|_| DomainError::StorageUnavailable)?
            .join(filename);
        let connection = Connection::open_with_flags(
            &path,
            OpenFlags::SQLITE_OPEN_READ_WRITE
                | OpenFlags::SQLITE_OPEN_NO_MUTEX
                | OpenFlags::SQLITE_OPEN_NOFOLLOW,
        )
        .map_err(|_| DomainError::InvalidDatabase)?;
        connection
            .busy_timeout(Duration::from_secs(5))
            .map_err(|_| DomainError::StorageUnavailable)?;
        initialize_schema(&connection)?;
        connection
            .execute_batch(
                "PRAGMA foreign_keys = ON;
                 PRAGMA secure_delete = ON;
                 PRAGMA trusted_schema = OFF;
                 PRAGMA journal_mode = DELETE;
                 PRAGMA synchronous = FULL;",
            )
            .map_err(|_| DomainError::StorageUnavailable)?;
        Ok(Self { connection })
    }

    pub fn create_account(&self, label: &str) -> Result<Account, DomainError> {
        let label = normalize_label(label)?;
        let account = Account {
            id: Uuid::new_v4().to_string(),
            label,
        };
        self.connection
            .execute(
                "INSERT INTO accounts (id, label) VALUES (?1, ?2)",
                params![account.id, account.label],
            )
            .map_err(|_| DomainError::StorageUnavailable)?;
        Ok(account)
    }

    pub fn list_accounts(&self) -> Result<Vec<Account>, DomainError> {
        let mut statement = self
            .connection
            .prepare("SELECT id, label FROM accounts ORDER BY rowid")
            .map_err(|_| DomainError::StorageUnavailable)?;
        let rows = statement
            .query_map([], |row| {
                Ok(Account {
                    id: row.get(0)?,
                    label: row.get(1)?,
                })
            })
            .map_err(|_| DomainError::StorageUnavailable)?;
        let mut result = Vec::new();
        for row in rows {
            let account = row.map_err(|_| DomainError::InvalidDatabase)?;
            if normalized_id(&account.id).as_deref() != Ok(account.id.as_str())
                || normalize_label(&account.label).as_deref() != Ok(account.label.as_str())
            {
                return Err(DomainError::InvalidDatabase);
            }
            result.push(account);
        }
        Ok(result)
    }

    pub fn delete_account(&self, id: &str) -> Result<(), DomainError> {
        let id = normalized_id(id)?;
        let changed = self
            .connection
            .execute("DELETE FROM accounts WHERE id = ?1", [id])
            .map_err(|_| DomainError::StorageUnavailable)?;
        if changed == 0 {
            return Err(DomainError::AccountNotFound);
        }
        Ok(())
    }

    pub fn import_snapshot(
        &self,
        account_id: &str,
        observation: &BrowserObservation,
        now: DateTime<Utc>,
    ) -> Result<Snapshot, DomainError> {
        let account_id = normalized_id(account_id)?;
        let observation = normalize_observation(observation, Some(now))?;
        let page_read_at_ms = read_time(&observation.page_read_at)?.timestamp_millis();
        // This lock is acquired before both read and write, including when
        // another application process has a separate SQLite connection.
        let transaction =
            Transaction::new_unchecked(&self.connection, TransactionBehavior::Immediate)
                .map_err(|_| DomainError::StorageUnavailable)?;
        let exists: bool = transaction
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM accounts WHERE id = ?1)",
                [&account_id],
                |row| row.get(0),
            )
            .map_err(|_| DomainError::StorageUnavailable)?;
        if !exists {
            return Err(DomainError::AccountNotFound);
        }
        let current = transaction
            .query_row(
                "SELECT observation, page_read_at_ms, imported_at FROM latest_snapshots
                 WHERE account_id = ?1 AND source_id = ?2",
                params![account_id, SOURCE_ID],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .optional()
            .map_err(|_| DomainError::StorageUnavailable)?;
        if let Some((json, current_time, imported_at)) = current {
            let current = decode_snapshot(&account_id, &json, &imported_at)?;
            if read_time(&current.observation.page_read_at)?.timestamp_millis() != current_time {
                return Err(DomainError::InvalidDatabase);
            }
            if page_read_at_ms < current_time {
                return Err(DomainError::OlderSnapshot);
            }
            if page_read_at_ms == current_time {
                if observation != current.observation {
                    return Err(DomainError::SnapshotConflict);
                }
                // Duplicate imports retain the original receipt timestamp.
                transaction
                    .commit()
                    .map_err(|_| DomainError::StorageUnavailable)?;
                return Ok(current);
            }
        }
        let imported_at = utc_milliseconds(now);
        let json = serde_json::to_string(&observation).map_err(|_| DomainError::InvalidReport)?;
        transaction
            .execute(
                "INSERT INTO latest_snapshots
                 (account_id, source_id, observation, page_read_at_ms, imported_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(account_id, source_id) DO UPDATE SET
                   observation = excluded.observation,
                   page_read_at_ms = excluded.page_read_at_ms,
                   imported_at = excluded.imported_at",
                params![account_id, SOURCE_ID, json, page_read_at_ms, imported_at],
            )
            .map_err(|_| DomainError::StorageUnavailable)?;
        transaction
            .commit()
            .map_err(|_| DomainError::StorageUnavailable)?;
        Ok(Snapshot {
            account_id,
            observation,
            imported_at,
        })
    }

    pub fn list_snapshots(&self) -> Result<Vec<Snapshot>, DomainError> {
        let mut statement = self
            .connection
            .prepare(
                "SELECT s.account_id, s.observation, s.imported_at
                 FROM latest_snapshots AS s JOIN accounts AS a ON a.id = s.account_id
                 WHERE s.source_id = ?1 ORDER BY a.rowid",
            )
            .map_err(|_| DomainError::StorageUnavailable)?;
        let rows = statement
            .query_map([SOURCE_ID], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|_| DomainError::StorageUnavailable)?;
        let mut result = Vec::new();
        for row in rows {
            let (account_id, json, imported_at) = row.map_err(|_| DomainError::InvalidDatabase)?;
            result.push(decode_snapshot(&account_id, &json, &imported_at)?);
        }
        Ok(result)
    }
}

fn decode_snapshot(
    account_id: &str,
    json: &str,
    imported_at: &str,
) -> Result<Snapshot, DomainError> {
    let account_id = normalized_id(account_id).map_err(|_| DomainError::InvalidDatabase)?;
    let observation: BrowserObservation =
        serde_json::from_str(json).map_err(|_| DomainError::InvalidDatabase)?;
    let observation =
        normalize_observation(&observation, None).map_err(|_| DomainError::InvalidDatabase)?;
    let imported_at = read_time(imported_at).map_err(|_| DomainError::InvalidDatabase)?;
    Ok(Snapshot {
        account_id,
        observation,
        imported_at: utc_milliseconds(imported_at),
    })
}

fn normalize_label(label: &str) -> Result<String, DomainError> {
    let trimmed = label.trim();
    if trimmed.is_empty() || trimmed.chars().count() > 40 || label.chars().any(char::is_control) {
        return Err(DomainError::InvalidAccountLabel);
    }
    Ok(trimmed.to_owned())
}

fn normalized_id(id: &str) -> Result<String, DomainError> {
    Uuid::parse_str(id)
        .map(|id| id.to_string())
        .map_err(|_| DomainError::AccountNotFound)
}

fn ensure_private_regular_file(path: &Path) -> Result<(), DomainError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => {
            if !metadata.is_file() || metadata.file_type().is_symlink() {
                return Err(DomainError::InvalidDatabase);
            }
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if metadata.permissions().mode() & 0o077 != 0 {
                    // Refuse broad access instead of silently changing an
                    // existing file's ownership or permissions.
                    return Err(DomainError::StorageUnavailable);
                }
            }
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;
                if metadata.file_attributes() & 0x400 != 0 {
                    return Err(DomainError::InvalidDatabase);
                }
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let mut options = FileOptions::new();
            options.read(true).write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            options
                .open(path)
                .map_err(|_| DomainError::StorageUnavailable)?;
        }
        Err(_) => return Err(DomainError::StorageUnavailable),
    }
    Ok(())
}

fn initialize_schema(connection: &Connection) -> Result<(), DomainError> {
    let transaction = Transaction::new_unchecked(connection, TransactionBehavior::Immediate)
        .map_err(|_| DomainError::InvalidDatabase)?;
    let application_id: i32 = transaction
        .pragma_query_value(None, "application_id", |row| row.get(0))
        .map_err(|_| DomainError::InvalidDatabase)?;
    let version: i32 = transaction
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|_| DomainError::InvalidDatabase)?;
    if version > SCHEMA_VERSION {
        return Err(DomainError::UnsupportedDatabaseVersion);
    }
    if application_id == 0 && version == 0 {
        let entries: u64 = transaction
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'",
                [],
                |row| row.get(0),
            )
            .map_err(|_| DomainError::InvalidDatabase)?;
        if entries != 0 {
            return Err(DomainError::InvalidDatabase);
        }
        transaction
            .execute_batch(
                "CREATE TABLE accounts (
                   id TEXT PRIMARY KEY NOT NULL,
                   label TEXT NOT NULL
                 );
                 CREATE TABLE latest_snapshots (
                   account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                   source_id TEXT NOT NULL,
                   observation TEXT NOT NULL,
                   page_read_at_ms INTEGER NOT NULL,
                   imported_at TEXT NOT NULL,
                   PRIMARY KEY (account_id, source_id)
                 );",
            )
            .map_err(|_| DomainError::InvalidDatabase)?;
        transaction
            .pragma_update(None, "application_id", APPLICATION_ID)
            .map_err(|_| DomainError::InvalidDatabase)?;
        transaction
            .pragma_update(None, "user_version", SCHEMA_VERSION)
            .map_err(|_| DomainError::InvalidDatabase)?;
    } else if application_id != APPLICATION_ID || version != SCHEMA_VERSION {
        return Err(DomainError::InvalidDatabase);
    }
    transaction
        .prepare("SELECT id, label FROM accounts LIMIT 0")
        .map_err(|_| DomainError::InvalidDatabase)?;
    transaction
        .prepare(
            "SELECT account_id, source_id, observation, page_read_at_ms, imported_at
             FROM latest_snapshots LIMIT 0",
        )
        .map_err(|_| DomainError::InvalidDatabase)?;
    transaction
        .commit()
        .map_err(|_| DomainError::StorageUnavailable)
}
