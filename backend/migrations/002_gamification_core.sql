-- ============================================================
-- Migration 002 — Gamification Core
-- XP transactions, progression, achievements, cosmetics
-- ============================================================

-- XP / Level progression ----------------------------------------
CREATE TABLE IF NOT EXISTS user_progression (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  total_xp INTEGER NOT NULL DEFAULT 0 CHECK (total_xp >= 0),
  current_level INTEGER NOT NULL DEFAULT 1 CHECK (current_level >= 1),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Immutable XP audit log; idempotency key prevents double-grants
CREATE TABLE IF NOT EXISTS xp_transactions (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL CHECK (amount > 0),
  source_type TEXT NOT NULL CHECK (source_type IN (
    'quest','artifact','achievement','cooperative_mission',
    'seasonal_event','exploration_challenge','admin_grant'
  )),
  source_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  note TEXT,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS xp_transactions_user_idx ON xp_transactions(user_id, granted_at DESC);

-- Level thresholds (configurable — change rows, not code) --------
CREATE TABLE IF NOT EXISTS level_thresholds (
  level INTEGER PRIMARY KEY CHECK (level >= 1),
  title TEXT NOT NULL,
  xp_required INTEGER NOT NULL CHECK (xp_required >= 0),
  reward_cosmetic_id TEXT
);

INSERT INTO level_thresholds (level, title, xp_required) VALUES
  (1,  'Apprentice Cartographer',  0),
  (2,  'Curious Explorer',          300),
  (3,  'Trail Seeker',              800),
  (4,  'Keeper of Secrets',         1800),
  (5,  'Master Cartographer',       3500),
  (6,  'Arcane Pathfinder',         6000),
  (7,  'Lorekeeper',                9500),
  (8,  'Guardian of the Atlas',     14000),
  (9,  'Celestial Wanderer',        20000),
  (10, 'Grandmaster of the Map',    30000)
ON CONFLICT (level) DO NOTHING;

-- ============================================================
-- Artifact definitions
-- ============================================================
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  lore TEXT,
  rarity TEXT NOT NULL DEFAULT 'common'
    CHECK (rarity IN ('common','uncommon','rare','legendary')),
  icon TEXT NOT NULL,
  xp_reward INTEGER NOT NULL DEFAULT 50 CHECK (xp_reward >= 0),
  cosmetic_unlock_id TEXT,
  discovery_type TEXT NOT NULL DEFAULT 'quest'
    CHECK (discovery_type IN ('quest','puzzle','checkpoint','cooperative','seasonal')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO artifacts (id, name, description, lore, rarity, icon, xp_reward, discovery_type) VALUES
  ('artifact-silver-compass',
   'The Silver Compass',
   'A compass that always points toward the next adventure.',
   'Forged by the first Cartographers, this compass never loses its way — even when its bearer does.',
   'rare', '🧭', 150, 'quest'),
  ('artifact-whispering-quill',
   'The Whispering Quill',
   'A feather quill that transcribes secrets only you can hear.',
   'Those who wield it hear whispers of hidden paths between the lines of every map.',
   'uncommon', '🪶', 80, 'puzzle'),
  ('artifact-moonlit-key',
   'The Moonlit Key',
   'An ornate key that glows faintly under moonlight.',
   'Said to open a door that appears only once per year, on the longest night.',
   'rare', '🗝️', 120, 'cooperative'),
  ('artifact-cartographers-journal',
   'The Cartographer''s Journal',
   'A leather-bound journal filled with maps to places that do not yet exist.',
   'Every completed quest adds a new page. Every new page reveals a new world.',
   'uncommon', '📖', 75, 'quest'),
  ('artifact-crystal-of-echoes',
   'The Crystal of Echoes',
   'A pale crystal that replays whispers of those who passed before you.',
   'Hold it to your ear at an ancient crossing and hear the footsteps of a thousand journeys.',
   'legendary', '💎', 300, 'seasonal'),
  ('artifact-lost-observatory-seal',
   'The Lost Observatory Seal',
   'A wax seal from an observatory that vanished from all known maps.',
   'The observatory still exists — just not in any dimension you have yet explored.',
   'legendary', '🔮', 250, 'puzzle'),
  ('artifact-enchanted-ink-vial',
   'The Enchanted Ink Vial',
   'A vial of ink that draws maps on its own during the night.',
   'By morning, new paths appear. Whether they lead somewhere real is another matter entirely.',
   'common', '⚗️', 50, 'checkpoint')
ON CONFLICT (id) DO NOTHING;

-- User-collected artifacts
CREATE TABLE IF NOT EXISTS user_artifacts (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  quest_id TEXT,
  UNIQUE (user_id, artifact_id)
);
CREATE INDEX IF NOT EXISTS user_artifacts_user_idx ON user_artifacts(user_id);

-- ============================================================
-- Achievements
-- ============================================================
CREATE TABLE IF NOT EXISTS achievements (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  icon TEXT NOT NULL,
  xp_reward INTEGER NOT NULL DEFAULT 0,
  hidden BOOLEAN NOT NULL DEFAULT FALSE,
  category TEXT NOT NULL DEFAULT 'exploration'
    CHECK (category IN ('exploration','social','puzzle','collection','special')),
  requirement_type TEXT NOT NULL,
  requirement_value INTEGER NOT NULL DEFAULT 1
);

INSERT INTO achievements (id, title, description, icon, xp_reward, hidden, category, requirement_type, requirement_value) VALUES
  ('ach-first-expedition',   'First Expedition',      'Complete your very first quest.',             '🗺️', 100, FALSE, 'exploration', 'quests_completed', 1),
  ('ach-artifact-hunter',    'Artifact Hunter',        'Collect 5 unique magical artifacts.',         '🏺', 200, FALSE, 'collection',  'artifacts_collected', 5),
  ('ach-puzzle-breaker',     'Puzzle Breaker',         'Solve 10 mystery riddles.',                  '🧩', 150, FALSE, 'puzzle',      'puzzles_solved', 10),
  ('ach-circle-of-friends',  'Circle of Friends',      'Complete a cooperative mission with friends.','🤝', 200, FALSE, 'social',      'cooperative_completed', 1),
  ('ach-master-cartographer','Master Cartographer',    'Complete 20 quests in total.',               '🗂️', 500, FALSE, 'exploration', 'quests_completed', 20),
  ('ach-secret-keeper',      'Secret Keeper',          'Discover a hidden story stage.',             '🔏', 300, TRUE,  'special',     'hidden_stages', 1),
  ('ach-team-pathfinder',    'Team Pathfinder',        'Complete 5 group missions.',                 '🧭', 350, FALSE, 'social',      'cooperative_completed', 5),
  ('ach-legendary-finder',   'Legendary Finder',       'Collect your first legendary artifact.',     '✨', 400, FALSE, 'collection',  'legendary_collected', 1),
  ('ach-early-riser',        'Dawn Cartographer',      'Complete a quest before 8 am.',              '🌅', 100, TRUE,  'special',     'dawn_quest', 1),
  ('ach-all-artifacts',      'The Complete Atlas',     'Collect all known artifacts.',               '📚', 1000, FALSE,'collection',  'all_artifacts', 7)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS user_achievements (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_id TEXT NOT NULL REFERENCES achievements(id),
  unlocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, achievement_id)
);
CREATE INDEX IF NOT EXISTS user_achievements_user_idx ON user_achievements(user_id);

-- ============================================================
-- Cosmetics
-- ============================================================
CREATE TABLE IF NOT EXISTS cosmetics (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL
    CHECK (category IN ('avatar_frame','title','map_pin','footprint','compass','parchment','room_theme','symbol')),
  icon TEXT,
  unlock_type TEXT NOT NULL DEFAULT 'achievement'
    CHECK (unlock_type IN ('achievement','level','artifact','quest','seasonal','default')),
  unlock_reference_id TEXT,
  is_default BOOLEAN NOT NULL DEFAULT FALSE
);

INSERT INTO cosmetics (id, name, description, category, icon, unlock_type, unlock_reference_id, is_default) VALUES
  ('cosmetic-default-pin',    'Standard Pin',         'The classic map marker.',            'map_pin',    '📍', 'default', NULL, TRUE),
  ('cosmetic-rune-pin',       'Rune Pin',             'A pin etched with ancient runes.',   'map_pin',    '🔵', 'level', '3', FALSE),
  ('cosmetic-star-pin',       'Celestial Pin',        'A pin shaped like a star.',          'map_pin',    '⭐', 'level', '5', FALSE),
  ('cosmetic-apprentice-title','Apprentice',          'Your first explorer title.',         'title',      NULL, 'default', NULL, TRUE),
  ('cosmetic-master-title',   'Master Cartographer',  'For those who mapped everything.',   'title',      NULL, 'level', '10', FALSE),
  ('cosmetic-ghost-footprint','Ghost Footsteps',      'Faint ethereal footprints.',         'footprint',  '👻', 'achievement', 'ach-secret-keeper', FALSE),
  ('cosmetic-compass-gold',   'Golden Compass',       'A gilded compass rose.',             'compass',    '🌟', 'achievement', 'ach-master-cartographer', FALSE),
  ('cosmetic-parchment-aged', 'Aged Parchment',       'Your map has seen better decades.',  'parchment',  '📜', 'artifact', 'artifact-cartographers-journal', FALSE)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS user_cosmetics (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cosmetic_id TEXT NOT NULL REFERENCES cosmetics(id),
  unlocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, cosmetic_id)
);

CREATE TABLE IF NOT EXISTS user_customization (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  active_pin_cosmetic TEXT REFERENCES cosmetics(id),
  active_title_cosmetic TEXT REFERENCES cosmetics(id),
  active_footprint_cosmetic TEXT REFERENCES cosmetics(id),
  active_compass_cosmetic TEXT REFERENCES cosmetics(id),
  active_parchment_cosmetic TEXT REFERENCES cosmetics(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Reward claims (idempotent guard for any reward type)
-- ============================================================
CREATE TABLE IF NOT EXISTS reward_claims (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  claim_key TEXT NOT NULL,
  reward_type TEXT NOT NULL,
  payload JSONB,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, claim_key)
);
