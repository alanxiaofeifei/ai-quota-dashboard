-- Additive: API snapshots remain intact when pages supply a fallback balance.
-- Account labels live in providers.config_json and extension_sources.config_json;
-- successful observations retain the label in facts_json. Old rows = 默认账户.
CREATE TABLE extension_snapshots (
 provider_id TEXT PRIMARY KEY REFERENCES providers(id) ON DELETE CASCADE,
 snapshot_json TEXT NOT NULL,
 updated_at INTEGER NOT NULL
);
