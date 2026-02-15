CREATE TABLE IF NOT EXISTS shared_boards (
  id TEXT PRIMARY KEY,
  board_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shared_boards_created_at
  ON shared_boards (created_at DESC);
