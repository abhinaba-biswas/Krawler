-- Krawler database initialization
-- Run once: psql $DATABASE_URL -f migrations/init.sql

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Crawl jobs ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS crawl_jobs (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    url           TEXT        NOT NULL,
    mode          VARCHAR(20) NOT NULL DEFAULT 'web',
    depth         INTEGER     NOT NULL DEFAULT 3,
    render_js     BOOLEAN     NOT NULL DEFAULT FALSE,
    output_format VARCHAR(20) NOT NULL DEFAULT 'markdown',
    restrict_domain BOOLEAN   NOT NULL DEFAULT TRUE,
    respect_robots  BOOLEAN   NOT NULL DEFAULT TRUE,
    screenshot    BOOLEAN     NOT NULL DEFAULT FALSE,
    options       JSONB       NOT NULL DEFAULT '{}',
    status        VARCHAR(20) NOT NULL DEFAULT 'pending',
    stats         JSONB       NOT NULL DEFAULT '{}',
    error         TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_crawl_jobs_status     ON crawl_jobs (status);
CREATE INDEX IF NOT EXISTS idx_crawl_jobs_created_at ON crawl_jobs (created_at DESC);

-- ── Crawl results ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS crawl_results (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id           UUID        NOT NULL REFERENCES crawl_jobs(id) ON DELETE CASCADE,
    url              TEXT        NOT NULL,
    source_type      VARCHAR(20) NOT NULL DEFAULT 'web',
    title            TEXT,
    content_markdown TEXT,
    content_html     TEXT,
    metadata         JSONB       DEFAULT '{}',
    links            JSONB       DEFAULT '[]',
    structured_data  JSONB       DEFAULT '{}',
    status_code      INTEGER,
    depth            INTEGER     NOT NULL DEFAULT 0,
    error            TEXT,
    screenshot_key   TEXT,
    raw_html_key     TEXT,
    timestamp        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crawl_results_job_id  ON crawl_results (job_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_crawl_results_job_url ON crawl_results (job_id, url);

-- ── Auto-update updated_at ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_crawl_jobs_updated_at
    BEFORE UPDATE ON crawl_jobs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
