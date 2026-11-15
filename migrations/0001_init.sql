PRAGMA foreign_keys = ON;
CREATE TABLE providers (
 id TEXT PRIMARY KEY NOT NULL, provider_type TEXT NOT NULL, label TEXT NOT NULL,
 category TEXT NOT NULL, source_mode TEXT NOT NULL, config_json TEXT NOT NULL DEFAULT '{}',
 sort_order INTEGER NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 1,
 next_allowed_fetch_ms INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE credentials (
 provider_id TEXT PRIMARY KEY NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
 key_kind TEXT NOT NULL, cipher_json TEXT NOT NULL, last_check_at INTEGER,
 last_check_status TEXT NOT NULL DEFAULT 'unverified', last_error_code TEXT, updated_at INTEGER NOT NULL
);
-- Manual and extension entries share this latest-good snapshot table. Refresh locks
-- live on providers, so even an initial failed fetch retains its cooldown.
CREATE TABLE snapshots (
 provider_id TEXT PRIMARY KEY NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
 source TEXT NOT NULL, items_json TEXT NOT NULL, facts_json TEXT NOT NULL DEFAULT '{}',
 fetched_at TEXT NOT NULL, observed_at TEXT NOT NULL, stale_after INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE auth_rate (id TEXT PRIMARY KEY NOT NULL, hits INTEGER NOT NULL, reset_at INTEGER NOT NULL);
