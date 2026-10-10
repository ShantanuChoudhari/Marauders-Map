CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(20) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  avatar VARCHAR(24) NOT NULL DEFAULT '🧭',
  score INTEGER NOT NULL DEFAULT 0 CHECK (score >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS missions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  reward INTEGER NOT NULL CHECK (reward >= 0),
  target_lat DOUBLE PRECISION NOT NULL CHECK (target_lat BETWEEN -85 AND 85),
  target_lng DOUBLE PRECISION NOT NULL CHECK (target_lng BETWEEN -180 AND 180),
  radius_m INTEGER NOT NULL CHECK (radius_m > 0)
);
CREATE TABLE IF NOT EXISTS mission_completions (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mission_id TEXT NOT NULL REFERENCES missions(id),
  reward INTEGER NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, mission_id)
);
-- Dynamic quests keep their short-lived target coordinates in process memory only.
-- Persist the reward claim without storing a GPS-centered quest target.
CREATE TABLE IF NOT EXISTS quest_completions (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quest_id TEXT NOT NULL,
  reward INTEGER NOT NULL CHECK (reward >= 0),
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, quest_id)
);
CREATE TABLE IF NOT EXISTS collectible_claims (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  collectible_id TEXT NOT NULL,
  points INTEGER NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, collectible_id)
);
CREATE TABLE IF NOT EXISTS game_sessions (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  server_id TEXT
);
CREATE TABLE IF NOT EXISTS player_statistics (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  total_distance_m DOUBLE PRECISION NOT NULL DEFAULT 0,
  missions_completed INTEGER NOT NULL DEFAULT 0,
  collectibles_found INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS friend_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','cancelled')),
  CHECK (sender_user_id <> recipient_user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS friend_requests_pending_pair_idx ON friend_requests(LEAST(sender_user_id, recipient_user_id), GREATEST(sender_user_id, recipient_user_id)) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS friend_requests_incoming_idx ON friend_requests(recipient_user_id, created_at DESC) WHERE status = 'pending';
CREATE TABLE IF NOT EXISTS friendships (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (user_id < friend_user_id),
  PRIMARY KEY (user_id, friend_user_id)
);
CREATE INDEX IF NOT EXISTS friendships_reverse_idx ON friendships(friend_user_id, user_id);
