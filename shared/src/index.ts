export type Position = { lat: number; lng: number };
export type Visibility = "visible" | "approximate" | "hidden";
export type PlayerStatus = "exploring" | "on-mission" | "resting";
export type FactionType = "gryffindor" | "slytherin" | "ravenclaw" | "hufflepuff" | "phoenix" | "serpent" | "owl";
export type PublicPlayer = {
  id: string;
  username: string;
  avatar: string;
  position: Position;
  status: PlayerStatus;
  visibility: Visibility;
  serverId: string;
  lastSeen: number;
  sequence: number;
  rttMs?: number;
  faction?: FactionType;
  isCloaked?: boolean;
  isCrowned?: boolean;
};
export type Mission = { id: string; title: string; description: string; reward: number; target: Position; radiusM: number };
export type Collectible = { id: string; label: string; position: Position; points: number; kind: "spark" | "relic" };
export type SharedDestination = { id: string; ownerId: string; ownerName: string; label: string; position: Position; createdAt: number };
export type RoomSummary = { id: string; code: string; name: string; ownerId: string; memberCount: number };
export type FriendProfile = { id: string; username: string; avatar: string };
export type FriendRequestSummary = { id: string; sender: FriendProfile; recipient?: FriendProfile; createdAt: string };

// ── Gamification types ──────────────────────────────────────
export type XpGrant = { amount: number; source: string; sourceId?: string; totalXp: number; newLevel?: number; previousLevel?: number };
export type ArtifactRarity = "common" | "uncommon" | "rare" | "legendary";
export type ArtifactSummary = { id: string; name: string; description: string; rarity: ArtifactRarity; icon: string; xpReward: number; discoveredAt?: string };
export type QuestCategory = "exploration" | "mystery" | "cooperative" | "daily" | "weekly" | "story";
export type QuestDifficulty = "easy" | "normal" | "hard" | "legendary";
export type QuestState = "available" | "active" | "completed" | "expired" | "locked";
export type ObjectiveType = "reach_checkpoint" | "collect_artifact" | "solve_riddle" | "cooperative_checkin" | "timed_challenge" | "visit_location";
export type QuestObjective = {
  id: string;
  title: string;
  description: string;
  type: ObjectiveType;
  completed: boolean;
  optional: boolean;
  participantIndex?: number;
  riddleQuestion?: string;
};
export type QuestSummary = {
  id: string;
  title: string;
  description: string;
  storyText?: string;
  category: QuestCategory;
  difficulty: QuestDifficulty;
  xpReward: number;
  artifactReward?: ArtifactSummary;
  maxParticipants: number;
  minParticipants: number;
  state: QuestState;
  objectives: QuestObjective[];
  objectivesCompleted: number;
  objectivesTotal: number;
  acceptedAt?: string;
  completedAt?: string;
  expiresAt?: string;
  rewardClaimed: boolean;
};
export type AchievementSummary = {
  id: string;
  title: string;
  description: string;
  icon: string;
  xpReward: number;
  unlocked: boolean;
  unlockedAt?: string;
  progress?: number;
  target?: number;
};
export type CosmeticSummary = {
  id: string;
  name: string;
  description: string;
  category: string;
  icon?: string;
  unlocked: boolean;
  unlockedAt?: string;
};
export type UserProgression = {
  userId: string;
  totalXp: number;
  currentLevel: number;
  currentLevelTitle: string;
  xpForCurrentLevel: number;
  xpForNextLevel: number;
  xpProgress: number;  // 0-100 percentage to next level
  questsCompleted: number;
  artifactsCollected: number;
  achievementsUnlocked: number;
};
export type CoopSessionSummary = {
  id: string;
  questId: string;
  questTitle: string;
  roomId: string;
  participants: { userId: string; username: string; avatar: string; participantIndex: number }[];
  objectivesCompleted: number;
  objectivesTotal: number;
  state: "active" | "completed" | "expired";
  expiresAt?: string;
};
export type LeaderboardEntry = {
  rank: number;
  userId: string;
  username: string;
  avatar: string;
  xpTotal: number;
  questsCompleted: number;
  artifactsCollected: number;
  level: number;
  levelTitle: string;
};

export type SpellType = "lumos" | "cloak" | "trap" | "ping";

export type SpellCastEvent = {
  spell: SpellType;
  casterId: string;
  casterName: string;
  position: Position;
  expiresAt: number;
  radiusM?: number;
  targetPosition?: Position;
};

export type RuneTrap = {
  id: string;
  ownerId: string;
  ownerName: string;
  position: Position;
  createdAt: number;
};

export type Spire = {
  id: string;
  name: string;
  position: Position;
  controllingFaction: FactionType | "neutral";
  captureProgress: number; // 0 to 100
  radiusM: number;
};

export type GoldenSnitch = {
  id: string;
  position: Position;
  points: number;
  caughtAt?: number;
};

export type GameEventFeedItem = {
  id: string;
  text: string;
  kind: "spell" | "spire" | "snitch" | "trap" | "level" | "bounty" | "duel";
  timestamp: number;
};

export type ClientToServerEvents = {
  "room:create": (payload: { name: string }, ack: (reply: { ok: boolean; error?: string; room?: RoomSummary }) => void) => void;
  "room:join": (payload: { code: string }, ack: (reply: { ok: boolean; error?: string; room?: RoomSummary }) => void) => void;
  "room:rejoin": (payload: { roomId: string }, ack: (reply: { ok: boolean; error?: string; room?: RoomSummary }) => void) => void;
  "room:leave": () => void;
  "room:end": () => void;
  "game:join": (payload: { position: Position; visibility?: Visibility }, ack: (reply: { ok: boolean; error?: string; players?: PublicPlayer[]; collectibles?: Collectible[]; missions?: Mission[]; destinations?: SharedDestination[]; spires?: Spire[]; traps?: RuneTrap[]; snitch?: GoldenSnitch | null; feed?: GameEventFeedItem[] }) => void) => void;
  "player:move": (payload: { position: Position; sequence: number; timestamp: number }) => void;
  "player:status": (payload: { status: PlayerStatus }) => void;
  "player:share": (payload: { enabled: false } | { enabled: true; position: Position; visibility: Exclude<Visibility, "hidden">; durationMs: number }) => void;
  "player:visibility": (payload: { visibility: Visibility }) => void;
  "player:proximity": (payload: { enabled: boolean; radiusMeters?: 100 | 250 | 500 }) => void;
  "player:faction": (payload: { faction: FactionType }) => void;
  "destination:share": (payload: { position: Position; label: string }, ack: (reply: { ok: boolean; error?: string; destination?: SharedDestination }) => void) => void;
  "destination:clear": (payload: { destinationId: string }) => void;
  "mission:start": (payload: { missionId: string }) => void;
  "mission:complete": (payload: { missionId: string }) => void;
  "item:collect": (payload: { itemId: string }) => void;
  "net:ping": (payload: { sentAt: number }) => void;
  // .io Spell & Action Events
  "spell:cast": (payload: { spell: SpellType; targetPosition?: Position }, ack: (reply: { ok: boolean; error?: string; spellEvent?: SpellCastEvent; cooldownRemainingMs?: number }) => void) => void;
  "snitch:catch": (payload: { snitchId: string }, ack: (reply: { ok: boolean; error?: string; points?: number }) => void) => void;
  "bounty:tag": (payload: { targetPlayerId: string }, ack: (reply: { ok: boolean; error?: string; xpStolen?: number }) => void) => void;
  // Dueling Club Events
  "duel:challenge": (payload: { targetPlayerId: string }, ack?: (reply: { ok: boolean; error?: string }) => void) => void;
  "duel:action": (payload: { targetPlayerId: string; spell: string; damage: number; shield?: boolean; message: string }) => void;
  "duel:win": (payload: { opponentName: string }, ack?: (reply: { ok: boolean; rewardXp?: number }) => void) => void;
  // Gamification events
  "quest:accept": (payload: { questId: string }, ack: (reply: { ok: boolean; error?: string; quest?: QuestSummary }) => void) => void;
  "quest:objective:complete": (payload: { questId: string; objectiveId: string; answer?: string }, ack: (reply: { ok: boolean; error?: string; xpGrant?: XpGrant }) => void) => void;
  "coop:create": (payload: { questId: string }, ack: (reply: { ok: boolean; error?: string; session?: CoopSessionSummary }) => void) => void;
  "coop:join": (payload: { sessionId: string }, ack: (reply: { ok: boolean; error?: string; session?: CoopSessionSummary }) => void) => void;
  "coop:objective:complete": (payload: { sessionId: string; objectiveId: string }, ack: (reply: { ok: boolean; error?: string }) => void) => void;
};

export type ServerToClientEvents = {
  "game:snapshot": (payload: { players: PublicPlayer[]; collectibles: Collectible[]; spires?: Spire[]; snitch?: GoldenSnitch | null }) => void;
  "player:joined": (player: PublicPlayer) => void;
  "player:moved": (payload: { playerId: string; position: Position; sequence: number; timestamp: number }) => void;
  "player:left": (payload: { playerId: string }) => void;
  "player:updated": (payload: Partial<PublicPlayer> & { id: string }) => void;
  "player:share-expired": () => void;
  "proximity:alert": (payload: { username: string; distanceMeters: number }) => void;
  "destination:shared": (destination: SharedDestination) => void;
  "destination:removed": (payload: { destinationId: string }) => void;
  "room:ended": () => void;
  "friend:request-received": (request: FriendRequestSummary) => void;
  "friend:request-accepted": (friend: FriendProfile) => void;
  "friend:request-rejected": (friendId: string) => void;
  "mission:updated": (payload: { missionId: string; playerId: string; state: "started" | "completed" }) => void;
  "item:collected": (payload: { itemId: string; playerId: string; username: string; points: number }) => void;
  "net:pong": (payload: { sentAt: number; serverAt: number }) => void;
  "game:error": (payload: { code: string; message: string }) => void;
  // .io Spell & World Events
  "spell:casted": (payload: SpellCastEvent) => void;
  "trap:placed": (trap: RuneTrap) => void;
  "trap:triggered": (payload: { trapId: string; victimId: string; victimName: string; trapperId: string; xpAwarded: number }) => void;
  "spires:update": (spires: Spire[]) => void;
  "spire:captured": (payload: { spireId: string; spireName: string; faction: FactionType; capturerName: string }) => void;
  "snitch:spawned": (snitch: GoldenSnitch) => void;
  "snitch:moved": (payload: { id: string; position: Position }) => void;
  "snitch:caught": (payload: { snitchId: string; catcherId: string; catcherName: string; points: number }) => void;
  "bounty:crowned": (payload: { playerId: string; username: string }) => void;
  "feed:item": (item: GameEventFeedItem) => void;
  // Dueling Club Events
  "duel:invitation": (payload: { fromId: string; fromName: string; fromFaction?: string; fromAvatar?: string }) => void;
  "duel:opponent_action": (payload: { fromId: string; spell: string; damage: number; shield?: boolean; message: string }) => void;
  // Gamification events
  "xp:granted": (grant: XpGrant) => void;
  "level:up": (payload: { previousLevel: number; newLevel: number; newTitle: string; totalXp: number }) => void;
  "quest:available": (quest: QuestSummary) => void;
  "quest:accepted": (quest: QuestSummary) => void;
  "quest:progress": (payload: { questId: string; objectiveId: string; completed: boolean; xpPartial?: number }) => void;
  "quest:completed": (payload: { questId: string; xpGrant: XpGrant; artifactReward?: ArtifactSummary }) => void;
  "artifact:discovered": (artifact: ArtifactSummary) => void;
  "achievement:unlocked": (achievement: AchievementSummary) => void;
  "cosmetic:unlocked": (cosmetic: CosmeticSummary) => void;
  "coop:session:updated": (session: CoopSessionSummary) => void;
  "coop:objective:completed": (payload: { sessionId: string; objectiveId: string; completedBy: string; completedByUsername: string }) => void;
  "coop:session:completed": (payload: { sessionId: string; xpGrant: XpGrant; artifactReward?: ArtifactSummary }) => void;
};

export function validPosition(p: Position): boolean {
  return Number.isFinite(p?.lat) && Number.isFinite(p?.lng) && p.lat >= -85 && p.lat <= 85 && p.lng >= -180 && p.lng <= 180;
}
export function distanceMeters(a: Position, b: Position): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
