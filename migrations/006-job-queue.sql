CREATE INDEX IF NOT EXISTS jobs_ready ON jobs(done,next_at,kind,id);
