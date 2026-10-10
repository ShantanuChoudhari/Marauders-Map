-- ============================================================
-- Migration 004 — Cooperative Missions & Guilds
-- ============================================================

-- Cooperative mission sessions (tied to rooms)
CRATE TABLE IF NOT EXISTS cooperative_sessions (
  id TEXT PRIMARY KEY,
  quest_id TEXT NOT NULL REFERENCES quest_definitions(id),
  room_id TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  state TEXT NOT NULL DEFAULT 'active'
    CHECK (state IN ('active','completed','expired','abandoned')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  reward_granted BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS cooperative_participants (
  session_id TEXT NOT NULL REFERENCES cooperative_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  participant_index INTEGER NOT NULL DEFAULT 0,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  left_at TIMESTAMPTZ,
  PRIMARY KEY (session_id, user_id)
);

CREATE TABLE IF NOT EXISTS cooperative_objective_completions (
  id BIGSERIAL PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES cooperative_sessions(id) ON DELETE CASCADE,
  objective_id TEXT NOT NULL REFERENCES quest_objectives(id),
  completed_by UUID NOT NULL REFERENCES users(id),
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, objective_id)
);

-- Guilds
CREATE TABLE IF NOT EXISTS guilds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(60) NOT NULL UNIQUE,
  description TEXT,
  icon TEXT NOT NULL DEFAULT '⚔️',
  created_by UUID NOT NULL REFERENCES users(id),
  total_xp INTEGER NOT NULL DEFAULT 0 CHECK (total_xp >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS guild_members (
  guild_id UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','officer','member')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (guild_id, user_id)
);
CREATE INDEX IF NOT EXISTS guild_members_user_idx ON guild_members(user_id);

-- Seasonal events
CREATE TABLE IF NOT EXISTS seasonal_events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  theme TEXT,
  icon TEXT,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  meta JSONB
);

CREATE TABLE IF NOT EXISTS seasonal_event_participants (
  event_id TEXT NOT NULL REFERENCES seasonal_events(id),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  xp_earned INTEGER NOT NULL DEFAULT 0,
  quests_completed INTEGER NOT NULL DEFAULT 0,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (event_id, user_id)
);

-- Leaderboard snapshots (populated by a periodic job)
CREATE TABLE IF NOT EXISTS leaderboard_snapshots (
  id BIGSERIAL PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('global','guild','seasonal')),
  scope_id TEXT,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rank INTEGER NOT NULL,
  xp_total INTEGER NOT NULL,
  quests_completed INTEGER NOT NULL DEFAULT 0,
  artifacts_collected INTEGER NOT NULL DEFAULT 0,
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS leaderboard_snapshots_scope_idx ON leaderboard_snapshots(scope, scope_id, snapshot_at DESC);

-- Admin roles
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'player'
  CHECK (role IN ('player','moderator','admin'));

-- Audit log for admin actions
CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  actor_id UUID REFERENCES users(id),
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  payload JSONB,
  ip TEXT,
  acted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS audit_log_actor_idx ON audit_log(actor_id, acted_at DESC);
