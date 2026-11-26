CREATE TABLE IF NOT EXISTS owner_profiles (
 username TEXT PRIMARY KEY, next_offset TEXT NOT NULL DEFAULT '', generation TEXT NOT NULL DEFAULT '',
 next_at INTEGER NOT NULL DEFAULT 0, last_error TEXT
);
CREATE TABLE IF NOT EXISTS owner_inventory (
 slug TEXT PRIMARY KEY, gift_id TEXT NOT NULL, profile TEXT NOT NULL, owner_id TEXT NOT NULL,
 username TEXT NOT NULL, premium INTEGER, observed_at INTEGER NOT NULL, generation TEXT NOT NULL,
 page_offset TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS owner_inventory_profile ON owner_inventory(profile);
CREATE TABLE IF NOT EXISTS owner_preparations (
 lot_id INTEGER PRIMARY KEY, done INTEGER NOT NULL DEFAULT 0, prepared_at INTEGER
);
