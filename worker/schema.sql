-- Approval queue. The client keeps a local copy for the demo; this is
-- the authoritative store once the Worker is wired up.
CREATE TABLE IF NOT EXISTS approvals (
  id          TEXT PRIMARY KEY,
  business    TEXT NOT NULL,          -- playbook key, scopes rows per business
  connector   TEXT NOT NULL,
  op          TEXT NOT NULL,
  args        TEXT NOT NULL,          -- JSON
  risk        TEXT NOT NULL CHECK (risk IN ('low','medium','high')),
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','approved','rejected','executed','failed')),
  created_at  TEXT NOT NULL,
  decided_at  TEXT,
  result      TEXT                    -- JSON, populated after execution
);

CREATE INDEX IF NOT EXISTS idx_approvals_pending
  ON approvals (business, status, created_at DESC);

-- Append-only audit of every tool call, including refusals. An agent
-- acting on someone's business needs a record that survives the client.
CREATE TABLE IF NOT EXISTS tool_log (
  id         TEXT PRIMARY KEY,
  business   TEXT NOT NULL,
  connector  TEXT NOT NULL,
  op         TEXT NOT NULL,
  outcome    TEXT NOT NULL,           -- queued | executed | refused | error
  detail     TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tool_log_business
  ON tool_log (business, created_at DESC);
