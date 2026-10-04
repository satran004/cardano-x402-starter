CREATE TABLE IF NOT EXISTS demo_quotes (
  id VARCHAR(36) PRIMARY KEY,
  question VARCHAR(300) NOT NULL,
  requirements TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  tx_hash VARCHAR(64) UNIQUE,
  payload TEXT,
  settlement TEXT,
  answer TEXT
);
