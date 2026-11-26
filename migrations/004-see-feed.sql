CREATE TABLE IF NOT EXISTS see_events (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL, slug TEXT NOT NULL, data TEXT NOT NULL,
 received_at INTEGER NOT NULL, done INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS see_events_pending ON see_events(done,received_at);
