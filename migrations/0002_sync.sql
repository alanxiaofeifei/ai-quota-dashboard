-- Preserve original AAD coordinates: ciphertext cannot be re-bound in SQL.
CREATE TABLE or_map AS SELECT id AS old_id,
 (SELECT id FROM providers q WHERE q.provider_type IN ('openrouter_key','openrouter_credits') ORDER BY CASE q.provider_type WHEN 'openrouter_credits' THEN 0 ELSE 1 END,q.created_at,q.id LIMIT 1) AS new_id
 FROM providers WHERE provider_type IN ('openrouter_key','openrouter_credits');
ALTER TABLE credentials RENAME TO credentials_old;
CREATE TABLE credentials (
 provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
 slot TEXT NOT NULL DEFAULT 'key', key_kind TEXT NOT NULL, aad_provider_id TEXT,
 cipher_json TEXT NOT NULL,last_check_at INTEGER,last_check_status TEXT NOT NULL DEFAULT 'unverified',last_error_code TEXT,updated_at INTEGER NOT NULL,
 PRIMARY KEY(provider_id,slot)
);
INSERT INTO credentials SELECT COALESCE(m.new_id,c.provider_id),CASE WHEN p.provider_type='openrouter_credits' THEN 'management' ELSE 'key' END,c.key_kind,c.provider_id,c.cipher_json,c.last_check_at,c.last_check_status,c.last_error_code,c.updated_at
 FROM credentials_old c JOIN providers p ON p.id=c.provider_id LEFT JOIN or_map m ON m.old_id=c.provider_id
 WHERE c.provider_id=(SELECT c2.provider_id FROM credentials_old c2 JOIN providers p2 ON p2.id=c2.provider_id WHERE COALESCE((SELECT new_id FROM or_map WHERE old_id=c2.provider_id),c2.provider_id)=COALESCE(m.new_id,c.provider_id) AND p2.provider_type=p.provider_type ORDER BY c2.updated_at DESC,c2.provider_id LIMIT 1);
DROP TABLE credentials_old;
-- Invalidate old OpenRouter snapshots: old primary values were key limits and
-- multiple source times must not be represented as one fresh account balance.
DELETE FROM snapshots WHERE provider_id IN (SELECT old_id FROM or_map);
DELETE FROM providers WHERE id IN (SELECT old_id FROM or_map WHERE old_id<>new_id);
UPDATE providers SET provider_type='openrouter',label='OpenRouter',next_allowed_fetch_ms=0 WHERE id IN (SELECT new_id FROM or_map);
DROP TABLE or_map;
CREATE TABLE devices (id TEXT PRIMARY KEY,token_hash TEXT NOT NULL UNIQUE,name TEXT NOT NULL,created_at INTEGER NOT NULL,last_seen INTEGER,revoked_at INTEGER);
CREATE TABLE extension_sources (id TEXT PRIMARY KEY,config_json TEXT NOT NULL,updated_at INTEGER NOT NULL);
CREATE TABLE extension_status (source_id TEXT PRIMARY KEY REFERENCES extension_sources(id) ON DELETE CASCADE,device_id TEXT REFERENCES devices(id),status TEXT NOT NULL,observed_at TEXT NOT NULL,last_success TEXT);
