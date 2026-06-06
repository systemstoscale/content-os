-- Auth — email + password login with HTTP-only cookie sessions.
--
-- Replaces the Bearer-token paste UX for human users. Bearer-token still
-- exists as the API/operator credential (set as a wrangler secret), but
-- the SPA exchanges email+password for a cookie session and never sees
-- the Bearer.
--
-- Password storage: PBKDF2-SHA256, 600k iterations, 16-byte random salt,
-- 32-byte derived key. All values stored as hex. See src/lib/password.ts
-- for the hash + verify implementation (uses Workers-native crypto.subtle).

CREATE TABLE IF NOT EXISTS users (
  email                   TEXT PRIMARY KEY,
  password_hash           TEXT NOT NULL,           -- hex(32 bytes)
  password_salt           TEXT NOT NULL,           -- hex(16 bytes)
  password_iters          INTEGER NOT NULL,        -- PBKDF2 iteration count
  role                    TEXT NOT NULL DEFAULT 'admin',
  must_change_password    INTEGER NOT NULL DEFAULT 0,  -- 1 on first login after install
  created_at              INTEGER NOT NULL,
  last_login_at           INTEGER
);

-- Per-login session row. Cookie value = sessions.id (32-byte random hex).
-- Sessions expire 30 days from issue; cleaned up lazily on expired-lookup.
CREATE TABLE IF NOT EXISTS auth_sessions (
  id           TEXT PRIMARY KEY,                   -- 32-byte hex
  email        TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  ip           TEXT,
  user_agent   TEXT,
  FOREIGN KEY (email) REFERENCES users(email)
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_email ON auth_sessions(email);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions(expires_at);
