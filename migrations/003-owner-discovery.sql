CREATE TABLE IF NOT EXISTS owner_profile_sources (
 username TEXT NOT NULL, source TEXT NOT NULL, reference TEXT NOT NULL DEFAULT '', discovered_at INTEGER NOT NULL,
 PRIMARY KEY(username,source,reference)
);
CREATE TABLE IF NOT EXISTS owner_observations (
 id INTEGER PRIMARY KEY, slug TEXT NOT NULL, gift_id TEXT NOT NULL, owner_id TEXT NOT NULL,
 username TEXT NOT NULL, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS owner_observations_slug ON owner_observations(slug,id);
