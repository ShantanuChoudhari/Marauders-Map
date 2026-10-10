-- ============================================================
-- Migration 003 — Quest Engine
-- ============================================================

CREATE TABLE IF NOT EXISTS quest_definitions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  story_text TEXT,
  category TEXT NOT NULL
    CHECK (category IN ('exploration','mystery','cooperative','daily','weekly','story')),
  difficulty TEXT NOT NULL DEFAULT 'normal'
    CHECK (difficulty IN ('easy','normal','hard','legendary')),
  xp_reward INTEGER NOT NULL DEFAULT 100 CHECK (xp_reward >= 0),
  artifact_reward_id TEXT REFERENCES artifacts(id),
  cosmetic_reward_id TEXT REFERENCES cosmetics(id),
  max_participants INTEGER NOT NULL DEFAULT 1,
  min_participants INTEGER NOT NULL DEFAULT 1,
  repeatable BOOLEAN NOT NULL DEFAULT FALSE,
  is_daily BOOLEAN NOT NULL DEFAULT FALSE,
  is_weekly BOOLEAN NOT NULL DEFAULT FALSE,
  is_story BOOLEAN NOT NULL DEFAULT FALSE,
  story_order INTEGER,
  starts_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quest_objectives (
  id TEXT PRIMARY KEY,
  quest_id TEXT NOT NULL REFERENCES quest_definitions(id) ON DELETE CASCADE,
  sequence_order INTEGER NOT NULL DEFAULT 1,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  objective_type TEXT NOT NULL
    CHECK (objective_type IN ('reach_checkpoint','collect_artifact','solve_riddle','cooperative_checkin','timed_challenge','visit_location')),
  target_artifact_id TEXT REFERENCES artifacts(id),
  target_lat DOUBLE PRECISION CHECK (target_lat IS NULL OR target_lat BETWEEN -85 AND 85),
  target_lng DOUBLE PRECISION CHECK (target_lng IS NULL OR target_lng BETWEEN -180 AND 180),
  radius_m INTEGER DEFAULT 80,
  riddle_question TEXT,
  riddle_answer_hash TEXT,  -- bcrypt hash of lowercased answer
  xp_partial INTEGER NOT NULL DEFAULT 0,
  is_optional BOOLEAN NOT NULL DEFAULT FALSE,
  assigned_participant_index INTEGER  -- for cooperative: which participant slot
);
CREATE INDEX IF NOT EXISTS quest_objectives_quest_idx ON quest_objectives(quest_id, sequence_order);

CREATE TABLE IF NOT EXISTS quest_prerequisites (
  quest_id TEXT NOT NULL REFERENCES quest_definitions(id) ON DELETE CASCADE,
  required_quest_id TEXT NOT NULL REFERENCES quest_definitions(id) ON DELETE CASCADE,
  PRIMARY KEY (quest_id, required_quest_id)
);

-- Per-user quest tracking
CREATE TABLE IF NOT EXISTS user_quests (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quest_id TEXT NOT NULL REFERENCES quest_definitions(id),
  room_id TEXT,
  state TEXT NOT NULL DEFAULT 'active'
    CHECK (state IN ('active','completed','expired','abandoned')),
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  reward_claimed BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (user_id, quest_id)  -- one active attempt per quest per user
);
CREATE INDEX IF NOT EXISTS user_quests_user_idx ON user_quests(user_id, state);
CREATE INDEX IF NOT EXISTS user_quests_quest_idx ON user_quests(quest_id, state);

CREATE TABLE IF NOT EXISTS quest_progress (
  id BIGSERIAL PRIMARY KEY,
  user_quest_id BIGINT NOT NULL REFERENCES user_quests(id) ON DELETE CASCADE,
  objective_id TEXT NOT NULL REFERENCES quest_objectives(id),
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at TIMESTAMPTZ,
  meta JSONB,
  UNIQUE (user_quest_id, objective_id)
);

-- Seed initial quests
INSERT INTO quest_definitions (id, title, description, story_text, category, difficulty, xp_reward, max_participants, min_participants, is_story, story_order, is_active)
VALUES
  ('quest-001',
   'The First Step',
   'Every great journey begins with a single step. Accept this quest to begin your legend as a Cartographer.',
   'The old map-keepers say that the first mark you make on your personal atlas is the most important. It sets the direction for every journey after.',
   'story', 'easy', 100, 1, 1, TRUE, 1, TRUE),

  ('quest-002',
   'Trace the Quiet Way',
   'Follow the ancient route markers. Reach the designated virtual checkpoint and sense what the old paths still remember.',
   'Some roads have been walked so many times that they remember every traveller. Add your name to that list.',
   'exploration', 'easy', 120, 1, 1, FALSE, NULL, TRUE),

  ('quest-003',
   'The Wandering Light',
   'A mysterious spark has been spotted near a local landmark. Find it before it fades.',
   'They say this spark is a piece of a star that fell from the Cartographer''s Night Sky — a sky no longer visible to those who do not seek.',
   'mystery', 'normal', 180, 1, 1, FALSE, NULL, TRUE),

  ('quest-004',
   'Twin Trail',
   'Two explorers must each reach a separate checkpoint. Only together can you unlock the reward.',
   'The ancient road splits. The ancient road must reunite. Bring a companion.',
   'cooperative', 'normal', 250, 2, 2, FALSE, NULL, TRUE),

  ('quest-005',
   'The Riddle of Crossroads',
   'A riddle has been left at the crossroads of the map. Only the correct answer will reveal the next clue.',
   'The figure at the crossroads wore a silver compass and spoke only in riddles. This is the first.',
   'mystery', 'normal', 200, 1, 1, FALSE, NULL, TRUE),

  ('quest-006',
   'Gathering of Three',
   'Three cartographers must contribute to a shared challenge. Each brings something the others cannot.',
   'Some maps require three hands to draw — one for the past, one for the present, and one for the path ahead.',
   'cooperative', 'hard', 400, 3, 3, FALSE, NULL, TRUE),

  ('quest-007',
   'The Lost Observatory',
   'Chapter Two: A sealed door has been found near a public landmark. Find the key hidden across the map.',
   'The observatory''s doors require a key that was split into three pieces and scattered across the city. Who scattered them, and why?',
   'story', 'hard', 350, 1, 1, TRUE, 2, TRUE),

  ('quest-008',
   'Daily Discovery',
   'Today''s challenge: Explore something new. Solve a small mystery to earn a daily bonus.',
   NULL,
   'daily', 'easy', 75, 1, 1, FALSE, NULL, TRUE),

  ('quest-009',
   'The Secret Society',
   'An invitation arrives from a group of unknown explorers. Join them to unlock a rare collectible.',
   'The note is unsigned. The seal is unfamiliar. And yet something pulls you toward it.',
   'cooperative', 'legendary', 600, 4, 2, FALSE, NULL, TRUE),

  ('quest-010',
   'The Cartographer''s Relay',
   'Complete a sequence of four checkpoints in order. One cartographer, four discoveries.',
   'The relay was designed as a test of endurance — not physical, but of the spirit of exploration.',
   'exploration', 'hard', 300, 1, 1, FALSE, NULL, TRUE)
ON CONFLICT (id) DO NOTHING;

-- Set story prerequisite: quest-007 requires quest-001
INSERT INTO quest_prerequisites (quest_id, required_quest_id)
VALUES ('quest-007', 'quest-001')
ON CONFLICT DO NOTHING;

-- Objectives for The First Step (quest-001)
INSERT INTO quest_objectives (id, quest_id, sequence_order, title, description, objective_type, xp_partial)
VALUES
  ('obj-001-01', 'quest-001', 1, 'Accept the Call', 'Accept your first quest.', 'solve_riddle', 50)
ON CONFLICT (id) DO NOTHING;

-- Objectives for Twin Trail (quest-004)
INSERT INTO quest_objectives (id, quest_id, sequence_order, title, description, objective_type, xp_partial, assigned_participant_index)
VALUES
  ('obj-004-01', 'quest-004', 1, 'Explorer One: Reach the Northern Mark', 'First explorer reaches their checkpoint.', 'cooperative_checkin', 100, 0),
  ('obj-004-02', 'quest-004', 2, 'Explorer Two: Reach the Southern Mark', 'Second explorer reaches their checkpoint.', 'cooperative_checkin', 100, 1)
ON CONFLICT (id) DO NOTHING;

-- Objectives for The Riddle of Crossroads (quest-005)
INSERT INTO quest_objectives (id, quest_id, sequence_order, title, description, objective_type, riddle_question, xp_partial)
VALUES
  ('obj-005-01', 'quest-005', 1,
   'Answer the First Riddle',
   'I have cities, but no houses live there. Mountains, but no trees. Water, but no fish. What am I?',
   'solve_riddle',
   'I have cities, but no houses live there. Mountains, but no trees. Water, but no fish. What am I?',
   150)
ON CONFLICT (id) DO NOTHING;

UPDATE quest_objectives SET riddle_answer_hash = 'map' WHERE id = 'obj-005-01' AND riddle_answer_hash IS NULL;
