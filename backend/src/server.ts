import dotenv from "dotenv";
import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import http from "node:http";
import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { rateLimit } from "express-rate-limit";
import { Pool, PoolClient } from "pg";
import { createClient } from "redis";
import { createAdapter } from "@socket.io/redis-adapter";
import { Server, Socket } from "socket.io";
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "prom-client";
import { z } from "zod";
import {
  AchievementSummary, ArtifactSummary, ClientToServerEvents, CoopSessionSummary, Collectible,
  CosmeticSummary, distanceMeters, FactionType, FriendProfile, FriendRequestSummary, GameEventFeedItem,
  GoldenSnitch, LeaderboardEntry, Mission, PlayerStatus, Position, PublicPlayer, QuestObjective,
  QuestState, QuestSummary, RoomSummary, RuneTrap, ServerToClientEvents, SharedDestination,
  SpellCastEvent, SpellType, Spire, UserProgression, validPosition, Visibility, XpGrant,
} from "@wayfinder/protocol";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });
const PORT = Number(process.env.PORT ?? 3001);
const SERVER_ID = process.env.SERVER_ID ?? crypto.randomUUID();
const JWT_SECRET = process.env.JWT_SECRET ?? "local-development-only-change-this-secret-32";
if (process.env.NODE_ENV === "production" && JWT_SECRET.length < 32) throw new Error("JWT_SECRET must have at least 32 characters in production");
const allowedOrigins = process.env.CLIENT_ORIGIN
  ? process.env.CLIENT_ORIGIN.split(",").map((origin) => origin.trim())
  : true;

type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
type Player = PublicPlayer & { socketId: string; connectedAt: number; sessionId?: number; distanceTravelled: number; missionId?: string; roomId: string; score: number };
type Room = { id: string; code: string; name: string; ownerId: string; members: Set<string>; createdAt: number };
type RoomWorld = {
  roomId: string;
  center: Position;
  collectibles: Collectible[];
  missions: Mission[];
  spires: Spire[];
  traps: RuneTrap[];
  snitch: GoldenSnitch | null;
  feed: GameEventFeedItem[];
};
const spellCooldowns = new Map<string, Map<SpellType, number>>();
type AuthedRequest = Request & { userId?: string; userRole?: string };
type LocalUser = { id: string; username: string; password_hash: string; avatar: string; score: number; role: string; created_at: Date };
type LocalFriendRequest = { id: string; senderId: string; recipientId: string; createdAt: Date };
const active = new Map<string, Player>();
const localCollected = new Set<string>();
const localUsers = new Map<string, LocalUser>();
const localUsernameIndex = new Map<string, string>();
const localFriendRequests = new Map<string, LocalFriendRequest>();
const localFriendships = new Set<string>();
const userSockets = new Map<string, Set<string>>();
const localMissionCompletions = new Set<string>();
const localUserCollectibles = new Set<string>();
const rooms = new Map<string, Room>();
const roomIdByUser = new Map<string, string>();
const userWorlds = new Map<string, RoomWorld>();
const destinations = new Map<string, SharedDestination>();
const proximityPreferences = new Map<string, 100 | 250 | 500>();
const proximityCooldown = new Map<string, number>();
let localDemoMode = false;
let localSessionId = 0;
const friendshipKey = (a: string, b: string) => [a, b].sort().join(":");
const db = new Pool({ connectionString: process.env.DATABASE_URL, max: 10, idleTimeoutMillis: 10000, connectionTimeoutMillis: 2000 });
let redis: ReturnType<typeof createClient> | undefined;

// ── Express Setup ──────────────────────────────────────────────
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS ?? 1));
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));
app.use(cors({ origin: allowedOrigins, credentials: false }));
app.use(express.json({ limit: "64kb" }));

// ── Prometheus Metrics ─────────────────────────────────────────
const httpRequests = new Counter({ name: "server_requests_total", help: "HTTP requests by method, route and status", labelNames: ["method", "route", "status"] });
const wsConnections = new Gauge({ name: "active_connections", help: "Currently connected game sockets" });
const wsMessages = new Counter({ name: "websocket_messages_total", help: "Received websocket messages", labelNames: ["event"] });
const wsErrors = new Counter({ name: "websocket_errors_total", help: "Rejected websocket messages", labelNames: ["reason"] });
const networkBytes = new Counter({ name: "network_bytes_total", help: "Approximate Socket.IO application payload bytes by direction", labelNames: ["direction"] });
const moves = new Counter({ name: "player_moves_total", help: "Accepted player movement packets" });
const invalidMoves = new Counter({ name: "invalid_moves_total", help: "Rejected movement packets" });
const disconnects = new Counter({ name: "disconnects_total", help: "Socket disconnects" });
const reconnects = new Counter({ name: "reconnects_total", help: "Reconnects within ten minutes" });
const latency = new Histogram({ name: "websocket_rtt_ms", help: "Client-observed websocket round trip time", buckets: [10, 25, 50, 100, 200, 400, 800, 1600] });
const averageLatency = new Gauge({ name: "average_latency", help: "Rolling average websocket RTT in milliseconds" });
const responseTime = new Histogram({ name: "server_response_time_ms", help: "HTTP handler duration", labelNames: ["route"], buckets: [5, 10, 25, 50, 100, 250, 500, 1000] });
const recentRtt: number[] = [];
const registry = new Registry();
registry.setDefaultLabels({ service: "wayfinder-api", server_id: SERVER_ID });
collectDefaultMetrics({ register: registry });
[httpRequests, wsConnections, wsMessages, wsErrors, networkBytes, moves, invalidMoves, disconnects, reconnects, latency, averageLatency, responseTime].forEach((m) => registry.registerMetric(m as any));

app.use((req, res, next) => {
  const start = performance.now();
  const id = req.header("x-request-id")?.slice(0, 100) || crypto.randomUUID();
  res.setHeader("x-request-id", id);
  res.on("finish", () => { const route = req.route?.path ? `${req.baseUrl}${req.route.path}` : req.path; httpRequests.labels(req.method, route, String(res.statusCode)).inc(); responseTime.labels(route).observe(performance.now() - start); });
  next();
});
app.get("/health", (_req, res) => res.json({ status: "ok", serverId: SERVER_ID, time: new Date().toISOString() }));
app.get("/ready", async (_req, res) => {
  const checks: Record<string, string> = {};
  if (localDemoMode) checks.postgres = "in-memory demo";
  else { try { await db.query("SELECT 1"); checks.postgres = "ok"; } catch { checks.postgres = "degraded"; } }
  try { if (redis) await redis.ping(); checks.redis = redis ? "ok" : "unconfigured"; } catch { checks.redis = "degraded"; }
  const ready = localDemoMode || checks.postgres === "ok";
  res.status(ready ? 200 : 503).json({ status: ready ? "ready" : "degraded", checks });
});
app.get("/metrics", async (_req, res) => { res.setHeader("Content-Type", registry.contentType); res.end(await registry.metrics()); });
app.use("/api", rateLimit({ windowMs: 60_000, limit: Number(process.env.API_RATE_LIMIT_MAX ?? 200), standardHeaders: "draft-7", legacyHeaders: false }));

// ── Auth ───────────────────────────────────────────────────────
function issueToken(id: string) { const expiresIn = (process.env.JWT_TTL ?? "7d") as jwt.SignOptions["expiresIn"]; return jwt.sign({ sub: id }, JWT_SECRET, { expiresIn }); }
function auth(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = req.header("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Sign in to continue." });
  try { const payload = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload; req.userId = payload.sub; req.userRole = payload.role as string | undefined; next(); }
  catch { return res.status(401).json({ error: "Your session expired. Please sign in again." }); }
}
function adminOnly(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.userId) return res.status(401).json({ error: "Authentication required." });
  if (req.userRole !== "admin" && req.userRole !== "moderator") return res.status(403).json({ error: "Administrator access required." });
  next();
}
const credentialsSchema = z.object({ username: z.string().trim().min(3).max(20).regex(/^[\p{L}\p{N}_-]+$/u), password: z.string().min(10).max(72), avatar: z.enum(["🧭", "🦊", "🌿", "🦉", "🐈", "🌙"]).optional() });
const authLimit = rateLimit({ windowMs: 15 * 60_000, limit: Number(process.env.AUTH_RATE_LIMIT_MAX ?? 20), standardHeaders: "draft-7", legacyHeaders: false });

app.post("/api/auth/register", authLimit, async (req, res) => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Use a 3–20 character username and a password of at least 10 characters." });
  const { username, password, avatar = "🧭" } = parsed.data;
  try {
    const hash = await bcrypt.hash(password, 12);
    if (localDemoMode) {
      const key = username.toLocaleLowerCase();
      if (localUsernameIndex.has(key)) return res.status(409).json({ error: "That username is already taken." });
      const user: LocalUser = { id: crypto.randomUUID(), username, password_hash: hash, avatar, score: 0, role: "player", created_at: new Date() };
      localUsers.set(user.id, user); localUsernameIndex.set(key, user.id);
      return res.status(201).json({ token: issueToken(user.id), player: { id: user.id, username: user.username, avatar: user.avatar, score: user.score } });
    }
    const result = await db.query("INSERT INTO users(username,password_hash,avatar) VALUES($1,$2,$3) RETURNING id,username,avatar,score", [username, hash, avatar]);
    const user = result.rows[0];
    // Initialize progression
    await db.query("INSERT INTO user_progression(user_id) VALUES($1) ON CONFLICT DO NOTHING", [user.id]);
    return res.status(201).json({ token: issueToken(user.id), player: { id: user.id, username: user.username, avatar: user.avatar, score: user.score } });
  } catch (error: any) {
    if (error?.code === "23505") return res.status(409).json({ error: "That username is already taken." });
    console.error(JSON.stringify({ event: "AUTH_REGISTER_FAILED", message: error?.message }));
    return res.status(503).json({ error: "Account service is unavailable. Please try again." });
  }
});

app.post("/api/auth/login", authLimit, async (req, res) => {
  const parsed = z.object({ username: z.string().trim().min(1).max(20), password: z.string().min(1).max(72) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter your username and password." });
  try {
    if (localDemoMode) {
      const userId = localUsernameIndex.get(parsed.data.username.toLocaleLowerCase());
      const user = userId ? localUsers.get(userId) : undefined;
      if (!user || !(await bcrypt.compare(parsed.data.password, user.password_hash))) return res.status(401).json({ error: "Username or password is incorrect." });
      return res.json({ token: issueToken(user.id), player: { id: user.id, username: user.username, avatar: user.avatar, score: user.score } });
    }
    const result = await db.query("SELECT id,username,password_hash,avatar,score,role FROM users WHERE lower(username)=lower($1)", [parsed.data.username]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(parsed.data.password, user.password_hash))) return res.status(401).json({ error: "Username or password is incorrect." });
    const token = jwt.sign({ sub: user.id, role: user.role }, JWT_SECRET, { expiresIn: (process.env.JWT_TTL ?? "7d") as jwt.SignOptions["expiresIn"] });
    await db.query("INSERT INTO user_progression(user_id) VALUES($1) ON CONFLICT DO NOTHING", [user.id]);
    return res.json({ token, player: { id: user.id, username: user.username, avatar: user.avatar, score: user.score } });
  } catch { return res.status(503).json({ error: "Account service is unavailable. Please try again." }); }
});

app.post("/api/auth/guest", async (_req, res) => {
  const adjectives = ["Swift", "Enchanted", "Silent", "Mystic", "Golden", "Shadow", "Celestial", "Arcane", "Brave"];
  const nouns = ["Raven", "Fox", "Marauder", "Seeker", "Wanderer", "Owl", "Stag", "Wizard", "Ranger"];
  const randomNum = Math.floor(1000 + Math.random() * 9000);
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const username = `${adj}${noun}#${randomNum}`;
  const avatars = ["🧭", "🦊", "🌿", "🦉", "🐈", "🌙"];
  const avatar = avatars[Math.floor(Math.random() * avatars.length)];
  const userId = crypto.randomUUID();

  if (localDemoMode) {
    const user: LocalUser = { id: userId, username, password_hash: "", avatar, score: 0, role: "guest", created_at: new Date() };
    localUsers.set(user.id, user);
    localUsernameIndex.set(username.toLowerCase(), user.id);
    return res.status(201).json({ token: issueToken(user.id), player: { id: user.id, username: user.username, avatar: user.avatar, score: 0 } });
  }

  try {
    const fakeHash = await bcrypt.hash(crypto.randomUUID(), 4);
    const result = await db.query("INSERT INTO users(id,username,password_hash,avatar,role) VALUES($1,$2,$3,$4,'guest') RETURNING id,username,avatar,score", [userId, username, fakeHash, avatar]);
    const user = result.rows[0];
    await db.query("INSERT INTO user_progression(user_id) VALUES($1) ON CONFLICT DO NOTHING", [user.id]);
    return res.status(201).json({ token: issueToken(user.id), player: { id: user.id, username: user.username, avatar: user.avatar, score: user.score } });
  } catch {
    // If db insert fails, fallback to in-memory guest
    const user: LocalUser = { id: userId, username, password_hash: "", avatar, score: 0, role: "guest", created_at: new Date() };
    localUsers.set(user.id, user);
    localUsernameIndex.set(username.toLowerCase(), user.id);
    return res.status(201).json({ token: issueToken(user.id), player: { id: user.id, username: user.username, avatar: user.avatar, score: 0 } });
  }
});

app.get("/api/profile", auth, async (req: AuthedRequest, res) => {
  if (localDemoMode) { const user = localUsers.get(req.userId!); if (!user) return res.status(404).json({ error: "Player not found." }); return res.json({ player: { id: user.id, username: user.username, avatar: user.avatar, score: user.score, created_at: user.created_at } }); }
  try { const { rows } = await db.query("SELECT id,username,avatar,score,created_at FROM users WHERE id=$1", [req.userId]); if (!rows[0]) return res.status(404).json({ error: "Player not found." }); return res.json({ player: rows[0] }); }
  catch { return res.status(503).json({ error: "Profile service is unavailable." }); }
});

// ── User search ────────────────────────────────────────────────
app.get("/api/users/search", auth, async (req: AuthedRequest, res) => {
  const query = z.string().trim().min(1).max(20).safeParse(req.query.q);
  if (!query.success) return res.json({ users: [] });
  const limit = Math.min(20, Math.max(1, Number(req.query.limit) || 10));
  if (localDemoMode) {
    const users = [...localUsers.values()].filter((user) => user.id !== req.userId && user.username.toLocaleLowerCase().includes(query.data.toLocaleLowerCase())).sort((a, b) => a.username.localeCompare(b.username)).slice(0, limit).map(({ id, username, avatar }) => ({ id, username, avatar }));
    return res.json({ users });
  }
  try { const { rows } = await db.query("SELECT id,username,avatar FROM users WHERE id<>$1 AND lower(username) LIKE lower($2) ORDER BY username LIMIT $3", [req.userId, `%${query.data}%`, limit]); return res.json({ users: rows }); }
  catch { return res.status(503).json({ error: "User search is unavailable." }); }
});

// ── Friends ────────────────────────────────────────────────────
app.get("/api/friends", auth, async (req: AuthedRequest, res) => {
  if (localDemoMode) {
    const ids = [...localFriendships].filter((pair) => pair.split(":").includes(req.userId!)).map((pair) => pair.split(":").find((id) => id !== req.userId)!).map((id) => localUsers.get(id)).filter((user): user is LocalUser => !!user).map(({ id, username, avatar }) => ({ id, username, avatar }));
    return res.json({ friends: ids });
  }
  try { const { rows } = await db.query("SELECT u.id,u.username,u.avatar FROM friendships f JOIN users u ON u.id=CASE WHEN f.user_id=$1 THEN f.friend_user_id ELSE f.user_id END WHERE f.user_id=$1 OR f.friend_user_id=$1 ORDER BY u.username", [req.userId]); return res.json({ friends: rows }); }
  catch { return res.status(503).json({ error: "Friends are unavailable." }); }
});

app.get("/api/friends/requests/:direction(incoming|outgoing)", auth, async (req: AuthedRequest, res) => {
  const incoming = req.params.direction === "incoming";
  if (localDemoMode) {
    const list = [...localFriendRequests.values()].filter((request) => (incoming ? request.recipientId : request.senderId) === req.userId).map((request) => {
      const other = localUsers.get(incoming ? request.senderId : request.recipientId); if (!other) return null;
      const result: FriendRequestSummary = { id: request.id, sender: incoming ? { id: other.id, username: other.username, avatar: other.avatar } : { id: request.senderId, username: localUsers.get(request.senderId)?.username ?? "", avatar: localUsers.get(request.senderId)?.avatar ?? "🧭" }, ...(incoming ? {} : { recipient: { id: other.id, username: other.username, avatar: other.avatar } }), createdAt: request.createdAt.toISOString() };
      return result;
    }).filter((entry): entry is FriendRequestSummary => !!entry);
    return res.json({ requests: list });
  }
  try {
    const column = incoming ? "recipient_user_id" : "sender_user_id";
    const { rows } = await db.query(`SELECT fr.id,fr.created_at,u.id AS other_id,u.username AS other_username,u.avatar AS other_avatar FROM friend_requests fr JOIN users u ON u.id=fr.${incoming ? "sender_user_id" : "recipient_user_id"} WHERE fr.${column}=$1 AND fr.status='pending' ORDER BY fr.created_at DESC LIMIT 100`, [req.userId]);
    const requests: FriendRequestSummary[] = rows.map((row) => incoming ? { id: row.id, sender: { id: row.other_id, username: row.other_username, avatar: row.other_avatar }, createdAt: row.created_at.toISOString() } : { id: row.id, sender: { id: req.userId!, username: "", avatar: "🧭" }, recipient: { id: row.other_id, username: row.other_username, avatar: row.other_avatar }, createdAt: row.created_at.toISOString() });
    return res.json({ requests });
  } catch { return res.status(503).json({ error: "Friend requests are unavailable." }); }
});

app.post("/api/friends/requests", auth, async (req: AuthedRequest, res) => {
  const target = z.object({ userId: z.string().uuid() }).safeParse(req.body);
  if (!target.success) return res.status(400).json({ error: "Choose a valid person to add." });
  const senderId = req.userId!; const recipientId = target.data.userId;
  if (senderId === recipientId) return res.status(400).json({ error: "You cannot send a friend request to yourself." });
  if (localDemoMode) {
    const recipient = localUsers.get(recipientId); const sender = localUsers.get(senderId);
    if (!recipient || !sender) return res.status(404).json({ error: "That explorer could not be found." });
    if (localFriendships.has(friendshipKey(senderId, recipientId))) return res.status(409).json({ error: "You are already friends." });
    if ([...localFriendRequests.values()].some((request) => (request.senderId === senderId && request.recipientId === recipientId) || (request.senderId === recipientId && request.recipientId === senderId))) return res.status(409).json({ error: "A friend request is already pending between you." });
    const request: LocalFriendRequest = { id: crypto.randomUUID(), senderId, recipientId, createdAt: new Date() }; localFriendRequests.set(request.id, request);
    notifyFriendRequest(recipientId, { id: request.id, sender: { id: sender.id, username: sender.username, avatar: sender.avatar }, createdAt: request.createdAt.toISOString() });
    return res.status(201).json({ ok: true });
  }
  try {
    const targetUser = await db.query("SELECT id FROM users WHERE id=$1", [recipientId]); if (!targetUser.rowCount) return res.status(404).json({ error: "That explorer could not be found." });
    const pair = await db.query("SELECT 1 FROM friendships WHERE (user_id=$1 AND friend_user_id=$2) OR (user_id=$2 AND friend_user_id=$1)", [senderId, recipientId]); if (pair.rowCount) return res.status(409).json({ error: "You are already friends." });
    const prior = await db.query("SELECT 1 FROM friend_requests WHERE status='pending' AND ((sender_user_id=$1 AND recipient_user_id=$2) OR (sender_user_id=$2 AND recipient_user_id=$1))", [senderId, recipientId]); if (prior.rowCount) return res.status(409).json({ error: "A friend request is already pending between you." });
    const { rows } = await db.query("INSERT INTO friend_requests(sender_user_id,recipient_user_id) VALUES($1,$2) RETURNING id,created_at", [senderId, recipientId]);
    const { rows: senderRows } = await db.query("SELECT id,username,avatar FROM users WHERE id=$1", [senderId]);
    const sender = senderRows[0] as FriendProfile; notifyFriendRequest(recipientId, { id: rows[0].id, sender, createdAt: rows[0].created_at.toISOString() }); return res.status(201).json({ ok: true });
  } catch (error: any) { if (error?.code === "23505") return res.status(409).json({ error: "A friend request is already pending between you." }); return res.status(503).json({ error: "Could not send the friend request." }); }
});

app.post("/api/friends/requests/:requestId(\\w{8}-\\w{4}-\\w{4}-\\w{4}-\\w{12})/:action(accept|reject)", auth, async (req: AuthedRequest, res) => {
  const requestId = Array.isArray(req.params.requestId) ? req.params.requestId[0] : req.params.requestId; const action = Array.isArray(req.params.action) ? req.params.action[0] : req.params.action; const recipientId = req.userId!;
  if (localDemoMode) {
    const request = localFriendRequests.get(requestId);
    if (!request || request.recipientId !== recipientId) return res.status(404).json({ error: "That friend request is unavailable." });
    const sender = localUsers.get(request.senderId); if (!sender) return res.status(404).json({ error: "That explorer could not be found." });
    localFriendRequests.delete(requestId);
    if (action === "accept") { localFriendships.add(friendshipKey(request.senderId, request.recipientId)); const friend = { id: sender.id, username: sender.username, avatar: sender.avatar }; notifyFriendAccepted(sender.id, { id: localUsers.get(recipientId)!.id, username: localUsers.get(recipientId)!.username, avatar: localUsers.get(recipientId)!.avatar }); return res.json({ ok: true, friend }); }
    notifyFriendRejected(sender.id, recipientId); return res.json({ ok: true });
  }
  const client = await db.connect();
  try {
    await client.query("BEGIN"); const request = await client.query("SELECT id,sender_user_id,recipient_user_id FROM friend_requests WHERE id=$1 AND recipient_user_id=$2 AND status='pending' FOR UPDATE", [requestId, recipientId]);
    if (!request.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ error: "That friend request is unavailable." }); }
    const senderId = request.rows[0].sender_user_id;
    if (action === "accept") {
      await client.query("UPDATE friend_requests SET status='accepted',responded_at=NOW() WHERE id=$1", [requestId]);
      await client.query("INSERT INTO friendships(user_id,friend_user_id) VALUES(LEAST($1::uuid,$2::uuid),GREATEST($1::uuid,$2::uuid)) ON CONFLICT DO NOTHING", [senderId, recipientId]);
    } else await client.query("UPDATE friend_requests SET status='rejected',responded_at=NOW() WHERE id=$1", [requestId]);
    await client.query("COMMIT");
    if (action === "accept") { const [senderRows, recipientRows] = await Promise.all([db.query("SELECT id,username,avatar FROM users WHERE id=$1", [senderId]), db.query("SELECT id,username,avatar FROM users WHERE id=$1", [recipientId])]); const friend = senderRows.rows[0] as FriendProfile; notifyFriendAccepted(senderId, recipientRows.rows[0] as FriendProfile); notifyFriendAccepted(recipientId, friend); return res.json({ ok: true, friend }); }
    notifyFriendRejected(senderId, recipientId); return res.json({ ok: true });
  } catch { await client.query("ROLLBACK"); return res.status(503).json({ error: "Could not update the friend request." }); }
  finally { client.release(); }
});

app.delete("/api/friends/requests/:requestId", auth, async (req: AuthedRequest, res) => {
  const requestId = Array.isArray(req.params.requestId) ? req.params.requestId[0] : req.params.requestId;
  if (localDemoMode) { const request = localFriendRequests.get(requestId); if (!request || request.senderId !== req.userId) return res.status(404).json({ error: "That outgoing request is unavailable." }); localFriendRequests.delete(request.id); return res.json({ ok: true }); }
  try { const result = await db.query("UPDATE friend_requests SET status='cancelled',responded_at=NOW() WHERE id=$1 AND sender_user_id=$2 AND status='pending'", [requestId, req.userId]); return result.rowCount ? res.json({ ok: true }) : res.status(404).json({ error: "That outgoing request is unavailable." }); }
  catch { return res.status(503).json({ error: "Could not cancel the friend request." }); }
});

app.delete("/api/friends/:friendId", auth, async (req: AuthedRequest, res) => {
  const friendId = Array.isArray(req.params.friendId) ? req.params.friendId[0] : req.params.friendId;
  if (localDemoMode) { const key = friendshipKey(req.userId!, friendId); if (!localFriendships.delete(key)) return res.status(404).json({ error: "That friendship was not found." }); return res.json({ ok: true }); }
  try { const result = await db.query("DELETE FROM friendships WHERE (user_id=$1 AND friend_user_id=$2) OR (user_id=$2 AND friend_user_id=$1)", [req.userId, friendId]); return result.rowCount ? res.json({ ok: true }) : res.status(404).json({ error: "That friendship was not found." }); }
  catch { return res.status(503).json({ error: "Could not remove that friend." }); }
});

// ── Missions (legacy map-based) ────────────────────────────────
app.get("/api/missions", auth, (req: AuthedRequest, res) => {
  const roomId = roomIdByUser.get(req.userId!);
  const world = userWorlds.get(req.userId!);
  return res.json({ missions: roomId && world?.roomId === roomId ? world.missions : [] });
});
app.get("/api/players", auth, async (req: AuthedRequest, res) => { const roomId = roomIdByUser.get(req.userId!); return res.json({ players: roomId ? await allPlayers(roomId) : [] }); });

// ── Gamification: Progression ──────────────────────────────────
app.get("/api/progression", auth, async (req: AuthedRequest, res) => {
  if (localDemoMode) {
    const user = localUsers.get(req.userId!);
    if (!user) return res.status(404).json({ error: "Player not found." });
    const prog = computeLocalProgression(user.score);
    return res.json({ progression: prog });
  }
  try {
    const { rows } = await db.query(`
      SELECT up.total_xp, up.current_level, lt.title, lt.xp_required,
             COALESCE(lt2.xp_required, lt.xp_required + 5000) AS next_xp_required,
             COALESCE((SELECT COUNT(*) FROM user_quests WHERE user_id=$1 AND state='completed'),0) AS quests_completed,
             COALESCE((SELECT COUNT(*) FROM user_artifacts WHERE user_id=$1),0) AS artifacts_collected,
             COALESCE((SELECT COUNT(*) FROM user_achievements WHERE user_id=$1),0) AS achievements_unlocked
      FROM user_progression up
      JOIN level_thresholds lt ON lt.level = up.current_level
      LEFT JOIN level_thresholds lt2 ON lt2.level = up.current_level + 1
      WHERE up.user_id=$1
    `, [req.userId]);
    if (!rows[0]) {
      await db.query("INSERT INTO user_progression(user_id) VALUES($1) ON CONFLICT DO NOTHING", [req.userId]);
      return res.json({ progression: { userId: req.userId, totalXp: 0, currentLevel: 1, currentLevelTitle: "Apprentice Cartographer", xpForCurrentLevel: 0, xpForNextLevel: 300, xpProgress: 0, questsCompleted: 0, artifactsCollected: 0, achievementsUnlocked: 0 } });
    }
    const r = rows[0];
    const xpInLevel = r.total_xp - r.xp_required;
    const levelRange = r.next_xp_required - r.xp_required;
    const prog: UserProgression = { userId: req.userId!, totalXp: r.total_xp, currentLevel: r.current_level, currentLevelTitle: r.title, xpForCurrentLevel: r.xp_required, xpForNextLevel: r.next_xp_required, xpProgress: Math.min(100, Math.round((xpInLevel / levelRange) * 100)), questsCompleted: Number(r.quests_completed), artifactsCollected: Number(r.artifacts_collected), achievementsUnlocked: Number(r.achievements_unlocked) };
    return res.json({ progression: prog });
  } catch { return res.status(503).json({ error: "Progression unavailable." }); }
});

function computeLocalProgression(score: number): UserProgression {
  const thresholds = [0, 300, 800, 1800, 3500, 6000, 9500, 14000, 20000, 30000];
  const titles = ["Apprentice Cartographer", "Curious Explorer", "Trail Seeker", "Keeper of Secrets", "Master Cartographer", "Arcane Pathfinder", "Lorekeeper", "Guardian of the Atlas", "Celestial Wanderer", "Grandmaster of the Map"];
  let level = 1;
  for (let i = 1; i < thresholds.length; i++) { if (score >= thresholds[i]) level = i + 1; else break; }
  level = Math.min(level, 10);
  const xpForCurrent = thresholds[level - 1];
  const xpForNext = level < 10 ? thresholds[level] : thresholds[9] + 5000;
  const xpInLevel = score - xpForCurrent;
  const levelRange = xpForNext - xpForCurrent;
  return { userId: "", totalXp: score, currentLevel: level, currentLevelTitle: titles[level - 1], xpForCurrentLevel: xpForCurrent, xpForNextLevel: xpForNext, xpProgress: Math.min(100, Math.round((xpInLevel / levelRange) * 100)), questsCompleted: 0, artifactsCollected: 0, achievementsUnlocked: 0 };
}

// ── Gamification: Quests ───────────────────────────────────────
app.get("/api/quests", auth, async (req: AuthedRequest, res) => {
  if (localDemoMode) return res.json({ quests: getLocalQuests() });
  try {
    const { rows } = await db.query(`
      SELECT qd.*,
             uq.id AS user_quest_id, uq.state AS user_state, uq.accepted_at, uq.completed_at, uq.reward_claimed,
             a.id AS artifact_id, a.name AS artifact_name, a.description AS artifact_desc, a.rarity AS artifact_rarity, a.icon AS artifact_icon, a.xp_reward AS artifact_xp
      FROM quest_definitions qd
      LEFT JOIN user_quests uq ON uq.quest_id=qd.id AND uq.user_id=$1
      LEFT JOIN artifacts a ON a.id=qd.artifact_reward_id
      WHERE qd.is_active=TRUE
        AND (qd.expires_at IS NULL OR qd.expires_at > NOW())
      ORDER BY qd.story_order NULLS LAST, qd.created_at
    `, [req.userId]);

    // Check prerequisites
    const completedQuestIds = new Set(rows.filter((r) => r.user_state === "completed").map((r) => r.id));
    const prereqs = await db.query("SELECT quest_id, required_quest_id FROM quest_prerequisites");
    const prereqMap = new Map<string, string[]>();
    for (const p of prereqs.rows) { const existing = prereqMap.get(p.quest_id) ?? []; existing.push(p.required_quest_id); prereqMap.set(p.quest_id, existing); }

    const quests: QuestSummary[] = rows.map((r) => {
      const prereqsMet = (prereqMap.get(r.id) ?? []).every((pid) => completedQuestIds.has(pid));
      let state: QuestState = "available";
      if (!prereqsMet) state = "locked";
      else if (r.user_state === "active") state = "active";
      else if (r.user_state === "completed") state = "completed";
      else if (r.user_state === "expired") state = "expired";
      return {
        id: r.id, title: r.title, description: r.description, storyText: r.story_text,
        category: r.category, difficulty: r.difficulty, xpReward: r.xp_reward,
        artifactReward: r.artifact_id ? { id: r.artifact_id, name: r.artifact_name, description: r.artifact_desc, rarity: r.artifact_rarity, icon: r.artifact_icon, xpReward: r.artifact_xp } : undefined,
        maxParticipants: r.max_participants, minParticipants: r.min_participants, state,
        objectives: [], objectivesCompleted: 0, objectivesTotal: 0,
        acceptedAt: r.accepted_at?.toISOString(), completedAt: r.completed_at?.toISOString(),
        expiresAt: r.expires_at?.toISOString(), rewardClaimed: r.reward_claimed ?? false,
      };
    });
    return res.json({ quests });
  } catch { return res.status(503).json({ error: "Quests unavailable." }); }
});

const localQuestStore = new Map<string, { state: QuestState; acceptedAt: string; completedAt?: string; objectivesCompleted: number }>();
function getLocalQuests(): QuestSummary[] {
  const definitions = [
    { id: "quest-001", title: "The Secret Passage of Gregory", description: "Discover the hidden passage behind the statue of Gregory the Smarmy.", category: "story" as const, difficulty: "easy" as const, xpReward: 100, maxParticipants: 1, minParticipants: 1 },
    { id: "quest-002", title: "Patrol the Black Lake Perimeter", description: "Wander the misty shores and ward off the Grindylows.", category: "exploration" as const, difficulty: "easy" as const, xpReward: 120, maxParticipants: 1, minParticipants: 1 },
    { id: "quest-003", title: "The Portrait's Password", description: "The Fat Lady demands the secret password to open the portrait hole.", category: "mystery" as const, difficulty: "normal" as const, xpReward: 180, maxParticipants: 1, minParticipants: 1 },
    { id: "quest-004", title: "Dual Corridor Guard (Co-op)", description: "Two wizards must hold opposing corridor checkpoints simultaneously.", category: "cooperative" as const, difficulty: "normal" as const, xpReward: 250, maxParticipants: 2, minParticipants: 2 },
    { id: "quest-005", title: "Riddle of the Sphinx", description: "Solve the riddle posed by the enchanted Sphinx guardian.", category: "mystery" as const, difficulty: "normal" as const, xpReward: 200, maxParticipants: 1, minParticipants: 1 },
    { id: "quest-008", title: "Daily Care of Magical Creatures", description: "Today's duty: Patrol the grounds for wandering Bowtruckles and Golden Snitches.", category: "daily" as const, difficulty: "easy" as const, xpReward: 95, maxParticipants: 1, minParticipants: 1 },
    { id: "quest-009", title: "Infiltrate the Restricted Section", description: "Don the Invisibility Cloak and evade Filch and Mrs. Norris.", category: "story" as const, difficulty: "hard" as const, xpReward: 320, maxParticipants: 1, minParticipants: 1 },
  ];
  return definitions.map((def) => {
    const stored = localQuestStore.get(def.id);
    const state: QuestState = stored?.state ?? "available";
    return { ...def, state, storyText: undefined, artifactReward: undefined, objectives: [], objectivesCompleted: stored?.objectivesCompleted ?? 0, objectivesTotal: 1, acceptedAt: stored?.acceptedAt, completedAt: stored?.completedAt, expiresAt: undefined, rewardClaimed: state === "completed" };
  });
}

app.post("/api/quests/:questId/accept", auth, async (req: AuthedRequest, res) => {
  const questId = Array.isArray(req.params.questId) ? req.params.questId[0] : String(req.params.questId);
  if (localDemoMode) {
    const stored = localQuestStore.get(questId);
    if (stored?.state === "active") return res.status(409).json({ error: "You have already accepted this quest." });
    if (stored?.state === "completed") return res.status(409).json({ error: "You have already completed this quest." });
    localQuestStore.set(questId, { state: "active", acceptedAt: new Date().toISOString(), objectivesCompleted: 0 });
    return res.json({ ok: true });
  }
  try {
    const quest = await db.query("SELECT * FROM quest_definitions WHERE id=$1 AND is_active=TRUE", [questId]);
    if (!quest.rowCount) return res.status(404).json({ error: "Quest not found." });
    const existing = await db.query("SELECT state FROM user_quests WHERE user_id=$1 AND quest_id=$2", [req.userId, questId]);
    if (existing.rows[0]?.state === "active") return res.status(409).json({ error: "You have already accepted this quest." });
    if (existing.rows[0]?.state === "completed" && !quest.rows[0].repeatable) return res.status(409).json({ error: "You have already completed this quest." });
    await db.query("INSERT INTO user_quests(user_id,quest_id,state) VALUES($1,$2,'active') ON CONFLICT(user_id,quest_id) DO UPDATE SET state='active',accepted_at=NOW(),completed_at=NULL,reward_claimed=FALSE", [req.userId, questId]);
    return res.json({ ok: true });
  } catch { return res.status(503).json({ error: "Could not accept quest." }); }
});

app.post("/api/quests/:questId/objective/:objectiveId/complete", auth, async (req: AuthedRequest, res) => {
  const questId = Array.isArray(req.params.questId) ? req.params.questId[0] : String(req.params.questId);
  const objectiveId = Array.isArray(req.params.objectiveId) ? req.params.objectiveId[0] : String(req.params.objectiveId);
  const answer = z.object({ answer: z.string().trim().max(200).optional() }).safeParse(req.body);
  if (localDemoMode) {
    const stored = localQuestStore.get(questId);
    if (!stored || stored.state !== "active") return res.status(400).json({ error: "Accept this quest first." });
    stored.objectivesCompleted += 1;
    stored.state = "completed";
    stored.completedAt = new Date().toISOString();
    localQuestStore.set(questId, stored);
    const user = localUsers.get(req.userId!);
    if (user) user.score += 100;
    const grant: XpGrant = { amount: 100, source: "quest", sourceId: questId, totalXp: user?.score ?? 100 };
    return res.json({ ok: true, xpGrant: grant });
  }
  try {
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const uq = await client.query("SELECT id FROM user_quests WHERE user_id=$1 AND quest_id=$2 AND state='active' FOR UPDATE", [req.userId, questId]);
      if (!uq.rowCount) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Accept this quest first." }); }
      const userQuestId = uq.rows[0].id;
      const obj = await client.query("SELECT * FROM quest_objectives WHERE id=$1 AND quest_id=$2", [objectiveId, questId]);
      if (!obj.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Objective not found." }); }
      const objective = obj.rows[0];
      // Validate riddle answer
      if (objective.objective_type === "solve_riddle" && objective.riddle_answer_hash && answer.success && answer.data.answer) {
        const userAnswer = answer.data.answer.toLowerCase().trim();
        const correctAnswer = objective.riddle_answer_hash;
        if (userAnswer !== correctAnswer) { await client.query("ROLLBACK"); return res.status(400).json({ error: "That's not quite right. Try again." }); }
      }
      const existing = await client.query("SELECT id FROM quest_progress WHERE user_quest_id=$1 AND objective_id=$2", [userQuestId, objectiveId]);
      if (existing.rowCount) { await client.query("ROLLBACK"); return res.status(409).json({ error: "Objective already completed." }); }
      await client.query("INSERT INTO quest_progress(user_quest_id,objective_id,completed,completed_at) VALUES($1,$2,TRUE,NOW())", [userQuestId, objectiveId]);
      // Check if all non-optional objectives complete
      const totalObjs = await client.query("SELECT COUNT(*) AS total FROM quest_objectives WHERE quest_id=$1 AND is_optional=FALSE", [questId]);
      const completedObjs = await client.query("SELECT COUNT(*) AS done FROM quest_progress qp JOIN quest_objectives qo ON qo.id=qp.objective_id WHERE qp.user_quest_id=$1 AND qo.is_optional=FALSE AND qp.completed=TRUE", [userQuestId]);
      const allDone = Number(completedObjs.rows[0].done) >= Number(totalObjs.rows[0].total);
      let xpGrant: XpGrant | null = null;
      if (allDone) {
        const questDef = await client.query("SELECT xp_reward FROM quest_definitions WHERE id=$1", [questId]);
        const xpAmount = questDef.rows[0].xp_reward;
        await client.query("UPDATE user_quests SET state='completed',completed_at=NOW(),reward_claimed=TRUE WHERE id=$1", [userQuestId]);
        xpGrant = await grantXpInTransaction(client, req.userId!, xpAmount, "quest", questId);
        // Check achievements
        void checkAndGrantAchievements(req.userId!);
      }
      await client.query("COMMIT");
      return res.json({ ok: true, allComplete: allDone, xpGrant });
    } catch (e) { await client.query("ROLLBACK"); throw e; }
    finally { client.release(); }
  } catch { return res.status(503).json({ error: "Could not complete objective." }); }
});

// ── Gamification: Artifacts ────────────────────────────────────
app.get("/api/artifacts", auth, async (req: AuthedRequest, res) => {
  if (localDemoMode) {
    const artifacts: ArtifactSummary[] = [
      { id: "artifact-elder-wand", name: "The Elder Wand", description: "Deathstick, Wand of Destiny. Forged with an ancient elder wood shaft and Thestral tail hair core.", rarity: "legendary", icon: "🪄", xpReward: 350 },
      { id: "artifact-invisibility-cloak", name: "The Invisibility Cloak", description: "Woven from Demiguise hair and ancient charms. Conceals the bearer completely from all sight.", rarity: "legendary", icon: "👤", xpReward: 300 },
      { id: "artifact-resurrection-stone", name: "The Resurrection Stone", description: "Turned thrice in hand, it recalls gentle shades of loved ones who passed beyond.", rarity: "legendary", icon: "💍", xpReward: 300 },
      { id: "artifact-sword-gryffindor", name: "The Sword of Gryffindor", description: "Goblin-made silver blade adorned with rubies that absorbs only that which makes it stronger.", rarity: "legendary", icon: "⚔️", xpReward: 250 },
      { id: "artifact-ravenclaw-diadem", name: "Ravenclaw's Diadem", description: "'Wit beyond measure is man's greatest treasure.' The lost ancient relic of Rowena Ravenclaw.", rarity: "rare", icon: "👑", xpReward: 200 },
      { id: "artifact-golden-snitch", name: "The Golden Snitch", description: "'I open at the close.' Enchants the seeker with lightning flight and flesh memory.", rarity: "rare", icon: "⚚", xpReward: 250 },
      { id: "artifact-time-turner", name: "The Ministry Time-Turner", description: "An hourglass on a gold chain. Three turns should do it.", rarity: "rare", icon: "⏳", xpReward: 180 },
      { id: "artifact-marauder-parchment", name: "The Marauder's Parchment", description: "Original enchanted blueprint crafted by Messrs Moony, Wormtail, Padfoot, and Prongs.", rarity: "uncommon", icon: "📜", xpReward: 120 },
      { id: "artifact-remembrall", name: "The Crystal Remembrall", description: "Glows scarlet when you have forgotten something important.", rarity: "common", icon: "🔮", xpReward: 60 },
    ];
    return res.json({ artifacts, collected: [] });
  }
  try {
    const [artRows, collectedRows] = await Promise.all([
      db.query("SELECT id,name,description,rarity,icon,xp_reward FROM artifacts ORDER BY rarity DESC,name"),
      db.query("SELECT artifact_id,discovered_at FROM user_artifacts WHERE user_id=$1", [req.userId]),
    ]);
    const collectedIds = new Set(collectedRows.rows.map((r) => r.artifact_id));
    const artifacts: ArtifactSummary[] = artRows.rows.map((r) => ({
      id: r.id, name: r.name, description: r.description, rarity: r.rarity, icon: r.icon, xpReward: r.xp_reward,
      discoveredAt: collectedRows.rows.find((c) => c.artifact_id === r.id)?.discovered_at?.toISOString(),
    }));
    return res.json({ artifacts, collected: [...collectedIds] });
  } catch { return res.status(503).json({ error: "Artifacts unavailable." }); }
});

// ── Gamification: Achievements ─────────────────────────────────
app.get("/api/achievements", auth, async (req: AuthedRequest, res) => {
  if (localDemoMode) {
    return res.json({ achievements: getLocalAchievements() });
  }
  try {
    const { rows } = await db.query(`
      SELECT a.*, ua.unlocked_at
      FROM achievements a
      LEFT JOIN user_achievements ua ON ua.achievement_id=a.id AND ua.user_id=$1
      ORDER BY ua.unlocked_at DESC NULLS LAST, a.xp_reward DESC
    `, [req.userId]);
    const achievements: AchievementSummary[] = rows.map((r) => ({
      id: r.id, title: r.title, description: r.hidden && !r.unlocked_at ? "???" : r.description,
      icon: r.hidden && !r.unlocked_at ? "🔒" : r.icon,
      xpReward: r.xp_reward, unlocked: !!r.unlocked_at, unlockedAt: r.unlocked_at?.toISOString(),
    }));
    return res.json({ achievements });
  } catch { return res.status(503).json({ error: "Achievements unavailable." }); }
});

function getLocalAchievements(): AchievementSummary[] {
  return [
    { id: "ach-first-expedition", title: "First Expedition", description: "Complete your very first quest.", icon: "🗺️", xpReward: 100, unlocked: false },
    { id: "ach-artifact-hunter", title: "Artifact Hunter", description: "Collect 5 unique magical artifacts.", icon: "🏺", xpReward: 200, unlocked: false },
    { id: "ach-puzzle-breaker", title: "Puzzle Breaker", description: "Solve 10 mystery riddles.", icon: "🧩", xpReward: 150, unlocked: false },
    { id: "ach-circle-of-friends", title: "Circle of Friends", description: "Complete a cooperative mission with friends.", icon: "🤝", xpReward: 200, unlocked: false },
    { id: "ach-master-cartographer", title: "Master Cartographer", description: "Complete 20 quests in total.", icon: "🗂️", xpReward: 500, unlocked: false },
    { id: "ach-team-pathfinder", title: "Team Pathfinder", description: "Complete 5 group missions.", icon: "🧭", xpReward: 350, unlocked: false },
  ];
}

// ── Gamification: Cosmetics ────────────────────────────────────
app.get("/api/cosmetics", auth, async (req: AuthedRequest, res) => {
  if (localDemoMode) return res.json({ cosmetics: [], active: {} });
  try {
    const [cosRows, unlockedRows, customRow] = await Promise.all([
      db.query("SELECT * FROM cosmetics ORDER BY category,name"),
      db.query("SELECT cosmetic_id,unlocked_at FROM user_cosmetics WHERE user_id=$1", [req.userId]),
      db.query("SELECT * FROM user_customization WHERE user_id=$1", [req.userId]),
    ]);
    const unlockedIds = new Map(unlockedRows.rows.map((r) => [r.cosmetic_id, r.unlocked_at]));
    const cosmetics: CosmeticSummary[] = cosRows.rows.map((r) => ({
      id: r.id, name: r.name, description: r.description, category: r.category, icon: r.icon,
      unlocked: r.is_default || unlockedIds.has(r.id),
      unlockedAt: unlockedIds.get(r.id)?.toISOString(),
    }));
    const active = customRow.rows[0] ?? {};
    return res.json({ cosmetics, active });
  } catch { return res.status(503).json({ error: "Cosmetics unavailable." }); }
});

// ── Gamification: Leaderboard ──────────────────────────────────
app.get("/api/leaderboard", auth, async (req: AuthedRequest, res) => {
  if (localDemoMode) return res.json({ entries: [], userRank: null });
  try {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const { rows } = await db.query(`
      SELECT u.id AS user_id, u.username, u.avatar,
             up.total_xp, up.current_level, lt.title AS level_title,
             COALESCE((SELECT COUNT(*) FROM user_quests uq WHERE uq.user_id=u.id AND uq.state='completed'),0) AS quests_completed,
             COALESCE((SELECT COUNT(*) FROM user_artifacts ua WHERE ua.user_id=u.id),0) AS artifacts_collected
      FROM user_progression up
      JOIN users u ON u.id=up.user_id
      JOIN level_thresholds lt ON lt.level=up.current_level
      ORDER BY up.total_xp DESC, u.username
      LIMIT $1
    `, [limit]);
    const entries: LeaderboardEntry[] = rows.map((r, i) => ({
      rank: i + 1, userId: r.user_id, username: r.username, avatar: r.avatar,
      xpTotal: r.total_xp, questsCompleted: Number(r.quests_completed), artifactsCollected: Number(r.artifacts_collected),
      level: r.current_level, levelTitle: r.level_title,
    }));
    const userRankRow = await db.query(`SELECT COUNT(*)+1 AS rank FROM user_progression WHERE total_xp > (SELECT total_xp FROM user_progression WHERE user_id=$1)`, [req.userId]);
    return res.json({ entries, userRank: Number(userRankRow.rows[0].rank) });
  } catch { return res.status(503).json({ error: "Leaderboard unavailable." }); }
});

// ── Gamification: Guilds ───────────────────────────────────────
app.get("/api/guilds/my", auth, async (req: AuthedRequest, res) => {
  if (localDemoMode) return res.json({ guild: null });
  try {
    const { rows } = await db.query(`
      SELECT g.*, gm.role
      FROM guilds g
      JOIN guild_members gm ON gm.guild_id=g.id AND gm.user_id=$1
    `, [req.userId]);
    return res.json({ guild: rows[0] ?? null });
  } catch { return res.status(503).json({ error: "Guild unavailable." }); }
});

app.post("/api/guilds", auth, async (req: AuthedRequest, res) => {
  const parsed = z.object({ name: z.string().trim().min(3).max(60), description: z.string().trim().max(200).optional(), icon: z.string().max(4).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Guild name must be 3–60 characters." });
  if (localDemoMode) return res.status(503).json({ error: "Guilds require a database connection." });
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query("SELECT 1 FROM guild_members WHERE user_id=$1", [req.userId]);
    if (existing.rowCount) { await client.query("ROLLBACK"); return res.status(409).json({ error: "Leave your current guild before creating a new one." }); }
    const guild = await client.query("INSERT INTO guilds(name,description,icon,created_by) VALUES($1,$2,$3,$4) RETURNING *", [parsed.data.name, parsed.data.description ?? "", parsed.data.icon ?? "⚔️", req.userId]);
    await client.query("INSERT INTO guild_members(guild_id,user_id,role) VALUES($1,$2,'owner')", [guild.rows[0].id, req.userId]);
    await client.query("COMMIT");
    return res.status(201).json({ guild: guild.rows[0] });
  } catch (e: any) { await client.query("ROLLBACK"); if (e?.code === "23505") return res.status(409).json({ error: "That guild name is already taken." }); return res.status(503).json({ error: "Could not create guild." }); }
  finally { client.release(); }
});

// ── Admin ──────────────────────────────────────────────────────
app.get("/api/admin/stats", auth, adminOnly, async (req: AuthedRequest, res) => {
  if (localDemoMode) return res.json({ stats: { users: localUsers.size, activeRooms: rooms.size, activePlayers: active.size } });
  try {
    const [userCount, questCount, artifactClaims] = await Promise.all([
      db.query("SELECT COUNT(*) FROM users"),
      db.query("SELECT COUNT(*) FROM user_quests WHERE state='completed'"),
      db.query("SELECT COUNT(*) FROM user_artifacts"),
    ]);
    return res.json({ stats: { users: Number(userCount.rows[0].count), questsCompleted: Number(questCount.rows[0].count), artifactsClaimed: Number(artifactClaims.rows[0].count), activeRooms: rooms.size, activePlayers: active.size } });
  } catch { return res.status(503).json({ error: "Stats unavailable." }); }
});

app.patch("/api/admin/quests/:questId", auth, adminOnly, async (req: AuthedRequest, res) => {
  const questId = req.params.questId;
  const update = z.object({ is_active: z.boolean().optional(), xp_reward: z.number().int().min(0).optional(), title: z.string().trim().min(3).max(120).optional() }).safeParse(req.body);
  if (!update.success) return res.status(400).json({ error: "Invalid update data." });
  if (localDemoMode) return res.status(503).json({ error: "Admin quest editing requires a database connection." });
  try {
    const setClauses: string[] = []; const values: unknown[] = []; let i = 1;
    if (update.data.is_active !== undefined) { setClauses.push(`is_active=$${i++}`); values.push(update.data.is_active); }
    if (update.data.xp_reward !== undefined) { setClauses.push(`xp_reward=$${i++}`); values.push(update.data.xp_reward); }
    if (update.data.title !== undefined) { setClauses.push(`title=$${i++}`); values.push(update.data.title); }
    if (!setClauses.length) return res.status(400).json({ error: "No changes provided." });
    values.push(questId);
    await db.query(`UPDATE quest_definitions SET ${setClauses.join(",")} WHERE id=$${i}`, values);
    await db.query("INSERT INTO audit_log(actor_id,action,target_type,target_id,payload) VALUES($1,'quest_update','quest',$2,$3)", [req.userId, questId, JSON.stringify(update.data)]);
    return res.json({ ok: true });
  } catch { return res.status(503).json({ error: "Could not update quest." }); }
});

// ── XP grant helper ────────────────────────────────────────────
async function grantXpInTransaction(client: PoolClient, userId: string, amount: number, sourceType: string, sourceId: string): Promise<XpGrant> {
  const idempotencyKey = `${userId}:${sourceType}:${sourceId}`;
  const existing = await client.query("SELECT id FROM xp_transactions WHERE idempotency_key=$1", [idempotencyKey]);
  if (existing.rowCount) {
    const prog = await client.query("SELECT total_xp,current_level FROM user_progression WHERE user_id=$1", [userId]);
    return { amount: 0, source: sourceType, sourceId, totalXp: prog.rows[0]?.total_xp ?? 0 };
  }
  await client.query("INSERT INTO xp_transactions(user_id,amount,source_type,source_id,idempotency_key) VALUES($1,$2,$3,$4,$5)", [userId, amount, sourceType, sourceId, idempotencyKey]);
  // Upsert progression
  await client.query(`
    INSERT INTO user_progression(user_id,total_xp,updated_at) VALUES($1,$2,NOW())
    ON CONFLICT(user_id) DO UPDATE SET total_xp=user_progression.total_xp+$2,updated_at=NOW()
  `, [userId, amount]);
  // Update level
  const progRow = await client.query("SELECT total_xp FROM user_progression WHERE user_id=$1", [userId]);
  const totalXp = progRow.rows[0].total_xp;
  const levelRow = await client.query("SELECT level FROM level_thresholds WHERE xp_required <= $1 ORDER BY level DESC LIMIT 1", [totalXp]);
  const newLevel = levelRow.rows[0]?.level ?? 1;
  const prevLevelRow = await client.query("SELECT current_level FROM user_progression WHERE user_id=$1", [userId]);
  const prevLevel = prevLevelRow.rows[0]?.current_level ?? 1;
  if (newLevel > prevLevel) {
    await client.query("UPDATE user_progression SET current_level=$1 WHERE user_id=$2", [newLevel, userId]);
  }
  // Also update legacy score
  await client.query("UPDATE users SET score=score+$1 WHERE id=$2", [amount, userId]);
  return { amount, source: sourceType, sourceId, totalXp, newLevel: newLevel > prevLevel ? newLevel : undefined, previousLevel: newLevel > prevLevel ? prevLevel : undefined };
}

async function checkAndGrantAchievements(userId: string): Promise<void> {
  if (localDemoMode) return;
  try {
    const [questCount, artifactCount, coopCount] = await Promise.all([
      db.query("SELECT COUNT(*) AS c FROM user_quests WHERE user_id=$1 AND state='completed'", [userId]),
      db.query("SELECT COUNT(*) AS c FROM user_artifacts WHERE user_id=$1", [userId]),
      db.query("SELECT COUNT(*) AS c FROM cooperative_participants cp JOIN cooperative_sessions cs ON cs.id=cp.session_id WHERE cp.user_id=$1 AND cs.state='completed'", [userId]),
    ]);
    const qc = Number(questCount.rows[0].c);
    const ac = Number(artifactCount.rows[0].c);
    const cc = Number(coopCount.rows[0].c);
    const toCheck = [
      { id: "ach-first-expedition", met: qc >= 1 },
      { id: "ach-artifact-hunter", met: ac >= 5 },
      { id: "ach-circle-of-friends", met: cc >= 1 },
      { id: "ach-master-cartographer", met: qc >= 20 },
      { id: "ach-team-pathfinder", met: cc >= 5 },
    ];
    for (const check of toCheck) {
      if (!check.met) continue;
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        const existing = await client.query("SELECT id FROM user_achievements WHERE user_id=$1 AND achievement_id=$2", [userId, check.id]);
        if (existing.rowCount) { await client.query("ROLLBACK"); continue; }
        await client.query("INSERT INTO user_achievements(user_id,achievement_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [userId, check.id]);
        const achDef = await client.query("SELECT * FROM achievements WHERE id=$1", [check.id]);
        if (achDef.rows[0]?.xp_reward > 0) {
          await grantXpInTransaction(client, userId, achDef.rows[0].xp_reward, "achievement", check.id);
        }
        await client.query("COMMIT");
        // Notify via socket
        const ach: AchievementSummary = { id: check.id, title: achDef.rows[0].title, description: achDef.rows[0].description, icon: achDef.rows[0].icon, xpReward: achDef.rows[0].xp_reward, unlocked: true, unlockedAt: new Date().toISOString() };
        for (const socketId of userSockets.get(userId) ?? []) io.to(socketId).emit("achievement:unlocked", ach);
      } catch { await client.query("ROLLBACK"); }
      finally { client.release(); }
    }
  } catch { /* Non-critical */ }
}

// ── Serve Static Frontend (Production / .io Game Hosting) ──────
const possibleDistPaths = [
  path.resolve(process.cwd(), "frontend/dist"),
  path.resolve(__dirname, "../../frontend/dist"),
  path.resolve(__dirname, "../frontend/dist"),
];
const frontendDist = possibleDistPaths.find((p) => existsSync(p));
if (frontendDist) {
  app.use(express.static(frontendDist));
  app.get("*", (req, res, next) => {
    if (
      req.path.startsWith("/api") ||
      req.path.startsWith("/socket.io") ||
      req.path === "/health" ||
      req.path === "/ready" ||
      req.path === "/metrics"
    ) {
      return next();
    }
    res.sendFile(path.join(frontendDist, "index.html"));
  });
  console.info(JSON.stringify({ event: "STATIC_FRONTEND_MOUNTED", path: frontendDist }));
}

// ── Socket.IO ──────────────────────────────────────────────────
const server = http.createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, { cors: { origin: allowedOrigins }, transports: ["websocket"], maxHttpBufferSize: 16_384, pingInterval: 20_000, pingTimeout: 15_000, connectTimeout: 10_000 });
const tokenForSocket = (socket: GameSocket): string | undefined => socket.handshake.auth?.token ?? socket.handshake.headers.authorization?.replace(/^Bearer\s+/i, "");
io.use((socket, next) => {
  const token = tokenForSocket(socket as GameSocket);
  if (!token) return next(new Error("Sign in to join the map."));
  try { (socket.data as { userId?: string }).userId = (jwt.verify(token, JWT_SECRET) as jwt.JwtPayload).sub; next(); }
  catch { next(new Error("Your session expired. Please sign in again.")); }
});
function notifyFriendRequest(userId: string, request: FriendRequestSummary) { for (const socketId of userSockets.get(userId) ?? []) io.to(socketId).emit("friend:request-received", request); }
function notifyFriendAccepted(userId: string, friend: FriendProfile) { for (const socketId of userSockets.get(userId) ?? []) io.to(socketId).emit("friend:request-accepted", friend); }
function notifyFriendRejected(userId: string, friendId: string) { for (const socketId of userSockets.get(userId) ?? []) io.to(socketId).emit("friend:request-rejected", friendId); }
async function usersAreFriends(a: string, b: string): Promise<boolean> {
  if (localDemoMode) return localFriendships.has(friendshipKey(a, b));
  const result = await db.query("SELECT 1 FROM friendships WHERE (user_id=$1 AND friend_user_id=$2) OR (user_id=$2 AND friend_user_id=$1)", [a, b]);
  return !!result.rowCount;
}

function offsetPosition(origin: Position, northMeters: number, eastMeters: number): Position {
  const metersPerDegree = 111_320;
  const lngScale = metersPerDegree * Math.max(0.15, Math.cos(origin.lat * Math.PI / 180));
  return { lat: Math.max(-85, Math.min(85, origin.lat + northMeters / metersPerDegree)), lng: Math.max(-180, Math.min(180, origin.lng + eastMeters / lngScale)) };
}
function createRoomWorld(roomId: string, center: Position): RoomWorld {
  const worldKey = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const itemPoints = [
    { north: 95, east: 45, label: "Wandering spark", points: 25, kind: "spark" as const },
    { north: -155, east: 125, label: "Wandering spark", points: 25, kind: "spark" as const },
    { north: 240, east: -110, label: "Wandering spark", points: 25, kind: "spark" as const },
    { north: -290, east: -190, label: "Star-map fragment", points: 60, kind: "relic" as const },
    { north: 390, east: 250, label: "Lost field note", points: 60, kind: "relic" as const },
  ];
  const questPoints = [
    { north: 180, east: 30, title: "Follow the Lantern Mote", description: "Find the glow hiding along a nearby path.", reward: 80 },
    { north: -300, east: 170, title: "Trace the Quiet Way", description: "Reach the marked place and check in from the map.", reward: 120 },
    { north: 475, east: -215, title: "Recover the Lost Page", description: "Find the old page tucked into your local atlas.", reward: 100 },
  ];
  const spires: Spire[] = [
    {
      id: `spire-${worldKey}-gryffindor`,
      name: "Gryffindor Tower",
      position: offsetPosition(center, 280, 190),
      controllingFaction: "gryffindor",
      captureProgress: 100,
      radiusM: 65,
    },
    {
      id: `spire-${worldKey}-slytherin`,
      name: "Slytherin Dungeons",
      position: offsetPosition(center, -310, 240),
      controllingFaction: "slytherin",
      captureProgress: 100,
      radiusM: 65,
    },
    {
      id: `spire-${worldKey}-ravenclaw`,
      name: "Ravenclaw Rookery",
      position: offsetPosition(center, -210, -280),
      controllingFaction: "ravenclaw",
      captureProgress: 100,
      radiusM: 65,
    },
    {
      id: `spire-${worldKey}-hufflepuff`,
      name: "Hufflepuff Commons",
      position: offsetPosition(center, 220, -240),
      controllingFaction: "hufflepuff",
      captureProgress: 100,
      radiusM: 65,
    },
    {
      id: `spire-${worldKey}-nexus`,
      name: "The Marauder's Sanctuary",
      position: offsetPosition(center, 30, -30),
      controllingFaction: "neutral",
      captureProgress: 0,
      radiusM: 70,
    },
  ];

  const snitch: GoldenSnitch = {
    id: `snitch-${worldKey}`,
    position: offsetPosition(center, 95, -60),
    points: 250,
  };

  return {
    roomId,
    center,
    collectibles: itemPoints.map((item, index) => ({ id: `item-${worldKey}-${index + 1}`, label: item.label, position: offsetPosition(center, item.north, item.east), points: item.points, kind: item.kind })),
    missions: questPoints.map((quest, index) => ({ id: `quest-${worldKey}-${index + 1}`, title: quest.title, description: quest.description, reward: quest.reward, target: offsetPosition(center, quest.north, quest.east), radiusM: 55 })),
    spires,
    traps: [],
    snitch,
    feed: [
      { id: crypto.randomUUID(), text: "🌟 The living map realm is open. Cast spells and conquer spires!", kind: "spire", timestamp: Date.now() },
    ],
  };
}
function worldForPlayer(userId: string, roomId: string, center: Position): RoomWorld {
  const existing = userWorlds.get(userId);
  if (existing?.roomId === roomId) return existing;
  const world = createRoomWorld(roomId, center);
  userWorlds.set(userId, world);
  return world;
}

function ensureGlobalRealm(): Room {
  let realm = rooms.get("REALM-GLOBAL");
  if (!realm) {
    realm = {
      id: "REALM-GLOBAL",
      code: "REALM001",
      name: "The Grand Realm (Public Lobby)",
      ownerId: "system",
      members: new Set<string>(),
      createdAt: Date.now(),
    };
    rooms.set("REALM-GLOBAL", realm);
  }
  return realm;
}
ensureGlobalRealm();

async function grantXpInDemoOrDb(userId: string, amount: number, sourceType: string, sourceId: string): Promise<XpGrant | null> {
  if (localDemoMode) {
    const user = localUsers.get(userId);
    if (!user) return null;
    user.score += amount;
    return { amount, source: sourceType, sourceId, totalXp: user.score };
  }
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const grant = await grantXpInTransaction(client, userId, amount, sourceType, sourceId);
    await client.query("COMMIT");
    return grant;
  } catch {
    await client.query("ROLLBACK");
    return null;
  } finally {
    client.release();
  }
}

// ── Golden Snitch Wandering Engine ─────────────────────────────
setInterval(() => {
  for (const world of userWorlds.values()) {
    if (!world.snitch || world.snitch.caughtAt) {
      if (world.snitch?.caughtAt && Date.now() - world.snitch.caughtAt > 35_000) {
        const angle = Math.random() * 2 * Math.PI;
        const dist = 100 + Math.random() * 200;
        world.snitch = {
          id: `snitch-${crypto.randomUUID().slice(0, 8)}`,
          position: offsetPosition(world.center, Math.sin(angle) * dist, Math.cos(angle) * dist),
          points: 250,
        };
        io.to(channel(world.roomId)).emit("snitch:spawned", world.snitch);
        const feedItem: GameEventFeedItem = { id: crypto.randomUUID(), text: "✨ The Golden Snitch has reappeared in the realm!", kind: "snitch", timestamp: Date.now() };
        world.feed.push(feedItem);
        io.to(channel(world.roomId)).emit("feed:item", feedItem);
      }
      continue;
    }
    const angle = Math.random() * 2 * Math.PI;
    const distanceM = 12 + Math.random() * 8;
    const nextPos = offsetPosition(world.snitch.position, Math.sin(angle) * distanceM, Math.cos(angle) * distanceM);
    if (distanceMeters(nextPos, world.center) < 450) {
      world.snitch.position = nextPos;
      io.to(channel(world.roomId)).emit("snitch:moved", { id: world.snitch.id, position: nextPos });
    }
  }
}, 3500);
const playerKey = (id: string) => `wayfinder:player:${id}`;
function worldPosition(p: Player): Position { return p.visibility === "approximate" ? { lat: Math.round(p.position.lat * 1000) / 1000, lng: Math.round(p.position.lng * 1000) / 1000 } : p.position; }
async function savePlayer(player: Player) { if (!redis?.isReady) return; const { socketId, connectedAt: _connectedAt, sessionId: _sessionId, distanceTravelled: _distance, missionId: _missionId, ...publicPlayer } = player; await redis.set(playerKey(player.id), JSON.stringify({ ...publicPlayer, position: worldPosition(player), connectionId: socketId }), { EX: 90 }); }
async function allPlayers(roomId: string): Promise<PublicPlayer[]> {
  if (redis?.isReady) {
    try {
      const keys: string[] = [];
      for await (const key of redis.scanIterator({ MATCH: "wayfinder:player:*", COUNT: 100 })) keys.push(key);
      const values = await Promise.all(keys.map((key) => redis!.get(key)));
      return values.filter((v): v is string => !!v).map((v) => JSON.parse(v) as PublicPlayer & { roomId?: string; connectionId?: string }).filter((p) => p.roomId === roomId && p.visibility !== "hidden").map(({ connectionId: _connectionId, roomId: _roomId, ...player }) => player);
    } catch { /* Redis outage: serve this instance's active view. */ }
  }
  return [...active.values()].filter((p) => p.roomId === roomId && p.visibility !== "hidden").map((p) => ({ ...publicView(p), position: worldPosition(p) }));
}
function publicView(p: Player): PublicPlayer { const { socketId: _socketId, connectedAt: _connectedAt, sessionId: _sessionId, distanceTravelled: _distance, missionId: _missionId, ...safe } = p; return { ...safe, position: worldPosition(p) }; }
function emitError(socket: GameSocket, code: string, message: string) { wsErrors.labels(code).inc(); socket.emit("game:error", { code, message }); }
const channel = (roomId: string) => `room:${roomId}`;
function roomSummary(room: Room): RoomSummary { return { id: room.id, code: room.code, name: room.name, ownerId: room.ownerId, memberCount: room.members.size }; }
function isRoomMember(userId: string, player: Player): boolean { return roomIdByUser.get(userId) === player.roomId && !!rooms.get(player.roomId)?.members.has(userId); }
function emitToSharers(roomId: string, event: "destination:shared", payload: SharedDestination): void;
function emitToSharers(roomId: string, event: "destination:removed", payload: { destinationId: string }): void;
function emitToSharers(roomId: string, event: "destination:shared" | "destination:removed", payload: SharedDestination | { destinationId: string }) {
  for (const recipient of active.values()) if (recipient.roomId === roomId && recipient.visibility !== "hidden") {
    if (event === "destination:shared") io.to(recipient.socketId).emit(event, payload as SharedDestination);
    else io.to(recipient.socketId).emit(event, payload as { destinationId: string });
  }
}
function removeDestination(ownerId: string) {
  const existing = destinations.get(ownerId); if (!existing) return;
  destinations.delete(ownerId); const roomId = active.get(ownerId)?.roomId; if (roomId) emitToSharers(roomId, "destination:removed", { destinationId: existing.id });
}

io.on("connection", (rawSocket) => {
  const socket = rawSocket as GameSocket;
  const userId = (socket.data as { userId: string }).userId;
  const connectedSockets = userSockets.get(userId) ?? new Set<string>(); connectedSockets.add(socket.id); userSockets.set(userId, connectedSockets);
  wsConnections.inc();
  socket.onAny((event, ...args) => networkBytes.labels("inbound").inc(Buffer.byteLength(JSON.stringify([event, ...args]))));
  socket.onAnyOutgoing((event, ...args) => networkBytes.labels("outbound").inc(Buffer.byteLength(JSON.stringify([event, ...args]))));
  const prev = active.get(userId);
  if (prev) { active.delete(userId); void redis?.del(playerKey(userId)); prev.socketId !== socket.id && io.to(prev.socketId).disconnectSockets(true); reconnects.inc(); }
  let player: Player | undefined;
  let moveWindow = Date.now(); let moveCount = 0; let lastSequence = 0; let lastTimestamp = 0; let lastMoveAt = Date.now();
  let shareExpiryTimer: ReturnType<typeof setTimeout> | undefined;

  socket.on("room:create", (payload, ack) => {
    const parsed = z.object({ name: z.string().trim().min(2).max(40) }).safeParse(payload);
    if (!parsed.success) return ack({ ok: false, error: "Room names need 2–40 characters." });
    if (roomIdByUser.has(userId)) return ack({ ok: false, error: "Leave your current room before creating another." });
    const id = crypto.randomUUID(); let code = crypto.randomBytes(4).toString("hex").toUpperCase();
    while ([...rooms.values()].some((room) => room.code === code)) code = crypto.randomBytes(4).toString("hex").toUpperCase();
    const room: Room = { id, code, name: parsed.data.name, ownerId: userId, members: new Set([userId]), createdAt: Date.now() };
    rooms.set(id, room); roomIdByUser.set(userId, id); socket.join(channel(id)); ack({ ok: true, room: roomSummary(room) });
  });
  socket.on("room:join", async (payload, ack) => {
    const parsed = z.object({ code: z.string().trim().min(6).max(12) }).safeParse(payload);
    if (!parsed.success) return ack({ ok: false, error: "Enter a valid room invite code." });
    if (roomIdByUser.has(userId)) return ack({ ok: false, error: "Leave your current room before joining another." });
    const room = [...rooms.values()].find((candidate) => candidate.code === parsed.data.code.toUpperCase());
    if (!room) return ack({ ok: false, error: "That room code is invalid or the room has ended." });
    const isPublicRealm = room.id === "REALM-GLOBAL" || room.code === "REALM001";
    if (!isPublicRealm && room.ownerId !== userId && !(await usersAreFriends(room.ownerId, userId))) {
      return ack({ ok: false, error: "Only an accepted friend of the room owner can use this invite." });
    }
    const maxCapacity = isPublicRealm ? 1000 : 16;
    if (room.members.size >= maxCapacity) return ack({ ok: false, error: "That room has reached its capacity limit." });
    room.members.add(userId); roomIdByUser.set(userId, room.id); socket.join(channel(room.id)); ack({ ok: true, room: roomSummary(room) });
  });
  socket.on("room:rejoin", (payload, ack) => {
    const room = rooms.get(payload?.roomId);
    if (!room || roomIdByUser.get(userId) !== room.id || !room.members.has(userId)) return ack({ ok: false, error: "Your room membership has expired. Join with a current invite code." });
    socket.join(channel(room.id)); ack({ ok: true, room: roomSummary(room) });
  });
  socket.on("room:leave", () => {
    const roomId = roomIdByUser.get(userId); if (!roomId) return;
    if (shareExpiryTimer) clearTimeout(shareExpiryTimer); shareExpiryTimer = undefined;
    proximityPreferences.delete(userId); removeDestination(userId); userWorlds.delete(userId);
    if (player) { active.delete(userId); void redis?.del(playerKey(userId)); io.to(channel(roomId)).emit("player:left", { playerId: userId }); player = undefined; }
    const room = rooms.get(roomId); room?.members.delete(userId); roomIdByUser.delete(userId); socket.leave(channel(roomId));
    if (room && room.members.size === 0 && room.id !== "REALM-GLOBAL") rooms.delete(roomId);
    socket.emit("room:ended");
  });
  socket.on("room:end", () => {
    const roomId = roomIdByUser.get(userId); const room = roomId ? rooms.get(roomId) : undefined;
    if (!room || room.ownerId !== userId) return emitError(socket, "ROOM_OWNER_ONLY", "Only the room owner can end this gathering.");
    const roomChannel = channel(room.id);
    for (const memberId of room.members) { roomIdByUser.delete(memberId); proximityPreferences.delete(memberId); removeDestination(memberId); userWorlds.delete(memberId); if (active.get(memberId)?.roomId === room.id) { active.delete(memberId); void redis?.del(playerKey(memberId)); } }
    if (room.id !== "REALM-GLOBAL") rooms.delete(room.id);
    io.to(roomChannel).emit("room:ended"); setTimeout(() => io.in(roomChannel).disconnectSockets(true), 250);
  });
  socket.on("game:join", async (payload, ack) => {
    wsMessages.labels("game:join").inc();
    if (player) {
      const world = worldForPlayer(userId, player.roomId, player.position);
      ack({
        ok: true,
        players: await allPlayers(player.roomId),
        collectibles: world.collectibles,
        missions: world.missions,
        spires: world.spires,
        traps: world.traps,
        snitch: world.snitch,
        feed: world.feed.slice(-10),
      });
      return;
    }
    if (!validPosition(payload.position)) { ack({ ok: false, error: "Choose a valid map position." }); return; }
    try {
      const assignedRoomId = roomIdByUser.get(userId); const room = assignedRoomId ? rooms.get(assignedRoomId) : undefined;
      if (!room || !room.members.has(userId)) { ack({ ok: false, error: "Create a private room or join one with an invite code first." }); return; }
      const roomId = room.id;
      let user: Pick<LocalUser, "id" | "username" | "avatar" | "score"> | undefined;
      let sessionId: number;
      if (localDemoMode) { user = localUsers.get(userId); sessionId = ++localSessionId; }
      else {
        const result = await db.query("SELECT id,username,avatar,score FROM users WHERE id=$1", [userId]);
        user = result.rows[0];
        const session = await db.query("INSERT INTO game_sessions(user_id,server_id) VALUES($1,$2) RETURNING id", [userId, SERVER_ID]);
        sessionId = Number(session.rows[0].id);
      }
      if (!user) { ack({ ok: false, error: "Player profile was not found." }); return; }
      const position = payload.position;
      const world = worldForPlayer(userId, roomId, position);
      const requestedVisibility: Visibility = "hidden";
      const joinedPlayer: Player = { id: userId, username: user.username, avatar: user.avatar, position, status: "exploring", visibility: requestedVisibility, serverId: SERVER_ID, lastSeen: Date.now(), sequence: 0, socketId: socket.id, connectedAt: Date.now(), sessionId, distanceTravelled: 0, roomId, score: user.score };
      player = joinedPlayer; active.set(userId, joinedPlayer); await savePlayer(joinedPlayer); socket.join(channel(roomId));
      ack({
        ok: true,
        players: await allPlayers(roomId),
        collectibles: world.collectibles,
        missions: world.missions,
        spires: world.spires,
        traps: world.traps,
        snitch: world.snitch,
        feed: world.feed.slice(-10),
      });
      if (joinedPlayer.visibility !== "hidden") socket.broadcast.to(channel(roomId)).emit("player:joined", publicView(joinedPlayer));
      console.info(JSON.stringify({ event: "PLAYER_JOIN", playerId: userId, serverId: SERVER_ID, timestamp: new Date().toISOString() }));
    } catch { ack({ ok: false, error: "Game state is temporarily unavailable." }); }
  });
  socket.on("player:move", async (payload) => {
    wsMessages.labels("player:move").inc(); if (!player || !isRoomMember(userId, player)) return emitError(socket, "NOT_JOINED", "Join an active private room before moving.");
    if (player.visibility === "hidden") return emitError(socket, "SHARING_OFF", "Start a location-sharing session before publishing your position.");
    const now = Date.now(); if (now - moveWindow >= 1000) { moveWindow = now; moveCount = 0; }
    moveCount += 1;
    if (moveCount > 6) { invalidMoves.inc(); return emitError(socket, "RATE_LIMIT", "You're moving too quickly. Take a breath and try again."); }
    if (!validPosition(payload?.position) || !Number.isInteger(payload.sequence) || payload.sequence <= lastSequence || !Number.isFinite(payload.timestamp) || Math.abs(now - payload.timestamp) > 30_000) { invalidMoves.inc(); return emitError(socket, "INVALID_PACKET", "That movement update could not be verified."); }
    const elapsed = Math.max(0.15, (now - lastMoveAt) / 1000); const distance = distanceMeters(player.position, payload.position);
    if (distance / elapsed > 15) { invalidMoves.inc(); console.warn(JSON.stringify({ event: "MOVE_REJECTED", reason: "speed", playerId: userId, distance, elapsed, serverId: SERVER_ID })); return emitError(socket, "MOVE_TOO_FAST", "That step is too far. Move a little closer and try again."); }
    lastSequence = payload.sequence; lastTimestamp = payload.timestamp; void lastTimestamp; lastMoveAt = now; player.distanceTravelled += distance; player.position = payload.position; player.sequence = payload.sequence; player.lastSeen = now; moves.inc();
    try { await savePlayer(player); } catch { /* Redis outage */ }
    if ((player.visibility as Visibility) !== "hidden") io.to(channel(player.roomId)).emit("player:moved", { playerId: player.id, position: worldPosition(player), sequence: player.sequence, timestamp: now });
    
    // ── .io Mechanics Hook ──
    const world = userWorlds.get(userId);
    if (world && world.roomId === player.roomId) {
      // 1. Check Rune Traps
      for (let i = world.traps.length - 1; i >= 0; i--) {
        const trap = world.traps[i];
        if (trap.ownerId !== userId && distanceMeters(player.position, trap.position) <= 25) {
          world.traps.splice(i, 1);
          const trapper = active.get(trap.ownerId);
          if (trapper) {
            void grantXpInDemoOrDb(trapper.id, 50, "trap", trap.id).then((g) => {
              if (g) io.to(trapper.socketId).emit("xp:granted", g);
            });
          }
          io.to(channel(player.roomId)).emit("trap:triggered", {
            trapId: trap.id,
            victimId: player.id,
            victimName: player.username,
            trapperId: trap.ownerId,
            xpAwarded: 50,
          });
          const feedItem: GameEventFeedItem = {
            id: crypto.randomUUID(),
            text: `💥 ${player.username} triggered ${trap.ownerName}'s Rune Trap! (+50 XP)`,
            kind: "trap",
            timestamp: now,
          };
          world.feed.push(feedItem);
          io.to(channel(player.roomId)).emit("feed:item", feedItem);
          break;
        }
      }

      // 2. Check Spires Conquest
      if (player.faction) {
        let spiresChanged = false;
        for (const spire of world.spires) {
          if (distanceMeters(player.position, spire.position) <= spire.radiusM) {
            if (spire.controllingFaction !== player.faction) {
              spire.captureProgress = Math.min(100, spire.captureProgress + 25);
              spiresChanged = true;
              if (spire.captureProgress >= 100) {
                spire.controllingFaction = player.faction;
                io.to(channel(player.roomId)).emit("spire:captured", {
                  spireId: spire.id,
                  spireName: spire.name,
                  faction: player.faction,
                  capturerName: player.username,
                });
                const feedItem: GameEventFeedItem = {
                  id: crypto.randomUUID(),
                  text: `🚩 ${player.username} conquered ${spire.name} for House ${player.faction.toUpperCase()}!`,
                  kind: "spire",
                  timestamp: now,
                };
                world.feed.push(feedItem);
                io.to(channel(player.roomId)).emit("feed:item", feedItem);
                void grantXpInDemoOrDb(userId, 100, "spire", spire.id).then((g) => {
                  if (g) socket.emit("xp:granted", g);
                });
              }
            }
          }
        }
        if (spiresChanged) {
          io.to(channel(player.roomId)).emit("spires:update", world.spires);
        }
      }

      // 3. Check Golden Snitch Catch
      if (world.snitch && !world.snitch.caughtAt && distanceMeters(player.position, world.snitch.position) <= 35) {
        world.snitch.caughtAt = now;
        const pts = world.snitch.points;
        io.to(channel(player.roomId)).emit("snitch:caught", {
          snitchId: world.snitch.id,
          catcherId: player.id,
          catcherName: player.username,
          points: pts,
        });
        const feedItem: GameEventFeedItem = {
          id: crypto.randomUUID(),
          text: `✨ ${player.username} captured the Golden Snitch! (+${pts} XP)`,
          kind: "snitch",
          timestamp: now,
        };
        world.feed.push(feedItem);
        io.to(channel(player.roomId)).emit("feed:item", feedItem);
        void grantXpInDemoOrDb(userId, pts, "snitch", world.snitch.id).then((g) => {
          if (g) socket.emit("xp:granted", g);
        });
      }

      // 4. Update Bounty Crown
      let topP: Player | undefined;
      let topScore = -1;
      for (const p of active.values()) {
        if (p.roomId === player.roomId && p.score > topScore) {
          topScore = p.score;
          topP = p;
        }
      }
      if (topP && !topP.isCrowned && topScore > 50) {
        for (const p of active.values()) {
          if (p.roomId === player.roomId) p.isCrowned = p.id === topP.id;
        }
        io.to(channel(player.roomId)).emit("bounty:crowned", { playerId: topP.id, username: topP.username });
      }
    }

    if ((player.visibility as Visibility) !== "hidden") for (const watcher of active.values()) {
      if (watcher.roomId !== player.roomId) continue;
      const radius = proximityPreferences.get(watcher.id); if (!radius || watcher.id === player.id || watcher.visibility === "hidden") continue;
      const meters = distanceMeters(watcher.position, player.position); const key = `${watcher.id}:${player.id}`; const lastAlert = proximityCooldown.get(key) ?? 0;
      if (meters <= radius && now - lastAlert >= 5 * 60_000) { proximityCooldown.set(key, now); io.to(watcher.socketId).emit("proximity:alert", { username: player.username, distanceMeters: Math.round(meters / 10) * 10 }); }
    }
    for (const [key, timestamp] of proximityCooldown) if (now - timestamp > 15 * 60_000) proximityCooldown.delete(key);
  });
  socket.on("player:share", (payload) => {
    wsMessages.labels("player:share").inc();
    if (!player || !isRoomMember(userId, player)) return emitError(socket, "NOT_JOINED", "Join an active private room before sharing location.");
    if (payload.enabled === false) {
      if (shareExpiryTimer) clearTimeout(shareExpiryTimer);
      shareExpiryTimer = undefined; player.visibility = "hidden"; player.lastSeen = Date.now(); void savePlayer(player);
      proximityPreferences.delete(userId); removeDestination(userId);
      socket.broadcast.to(channel(player.roomId)).emit("player:left", { playerId: player.id }); socket.emit("player:updated", { id: player.id, visibility: "hidden" });
      return;
    }
    if (!payload.position || !validPosition(payload.position)) return emitError(socket, "INVALID_POSITION", "The device returned an invalid map position.");
    if (payload.visibility !== "visible" && payload.visibility !== "approximate") return emitError(socket, "INVALID_SHARING_MODE", "Choose precise or approximate sharing.");
    if (payload.durationMs !== 15 * 60_000 && payload.durationMs !== 60 * 60_000) return emitError(socket, "INVALID_SHARING_DURATION", "Choose a 15-minute or 1-hour sharing session.");
    if (shareExpiryTimer) clearTimeout(shareExpiryTimer);
    player.position = payload.position; player.visibility = payload.visibility; player.lastSeen = Date.now(); void savePlayer(player);
    for (const destination of destinations.values()) if (active.get(destination.ownerId)?.roomId === player.roomId) socket.emit("destination:shared", destination);
    socket.broadcast.to(channel(player.roomId)).emit("player:joined", publicView(player));
    shareExpiryTimer = setTimeout(() => {
      if (!player) return;
      player.visibility = "hidden"; player.lastSeen = Date.now(); shareExpiryTimer = undefined; void savePlayer(player);
      proximityPreferences.delete(userId); removeDestination(userId);
      socket.broadcast.to(channel(player.roomId)).emit("player:left", { playerId: player.id }); socket.emit("player:share-expired");
    }, payload.durationMs);
    shareExpiryTimer.unref?.();
  });
  socket.on("player:proximity", (payload) => {
    wsMessages.labels("player:proximity").inc();
    if (!player || !isRoomMember(userId, player) || player.visibility === "hidden") return emitError(socket, "SHARING_OFF", "Start sharing in an active room before opting into proximity alerts.");
    if (!payload.enabled) { proximityPreferences.delete(userId); return; }
    if (![100, 250, 500].includes(payload.radiusMeters ?? 0)) return emitError(socket, "INVALID_RADIUS", "Choose a radius of 100, 250, or 500 meters.");
    proximityPreferences.set(userId, payload.radiusMeters as 100 | 250 | 500);
  });
  socket.on("destination:share", (payload, ack) => {
    wsMessages.labels("destination:share").inc();
    const parsed = z.object({ position: z.object({ lat: z.number().min(-85).max(85), lng: z.number().min(-180).max(180) }), label: z.string().trim().min(1).max(60) }).safeParse(payload);
    if (!player || !isRoomMember(userId, player) || player.visibility === "hidden") return ack({ ok: false, error: "Start temporary sharing in an active room before placing a shared pin." });
    if (!parsed.success) return ack({ ok: false, error: "Choose a valid destination and a name under 60 characters." });
    removeDestination(userId);
    const destination: SharedDestination = { id: crypto.randomUUID(), ownerId: userId, ownerName: player.username, label: parsed.data.label, position: parsed.data.position, createdAt: Date.now() };
    destinations.set(userId, destination); emitToSharers(player.roomId, "destination:shared", destination); ack({ ok: true, destination });
  });
  socket.on("destination:clear", (payload) => {
    wsMessages.labels("destination:clear").inc();
    const existing = destinations.get(userId);
    if (existing?.id === payload?.destinationId) removeDestination(userId);
  });
  socket.on("player:status", (payload) => { wsMessages.labels("player:status").inc(); if (!player || !isRoomMember(userId, player) || !["exploring", "on-mission", "resting"].includes(payload.status)) return; player.status = payload.status as PlayerStatus; player.lastSeen = Date.now(); void savePlayer(player); io.to(channel(player.roomId)).emit("player:updated", { id: player.id, status: player.status }); });
  socket.on("player:visibility", (payload) => { wsMessages.labels("player:visibility").inc(); if (!player || !isRoomMember(userId, player) || payload?.visibility !== "hidden") return emitError(socket, "USE_SHARE_SESSION", "Use a temporary sharing session to publish your location."); if (shareExpiryTimer) clearTimeout(shareExpiryTimer); shareExpiryTimer = undefined; player.visibility = "hidden"; player.lastSeen = Date.now(); proximityPreferences.delete(userId); removeDestination(userId); void savePlayer(player); socket.broadcast.to(channel(player.roomId)).emit("player:left", { playerId: player.id }); });
  socket.on("mission:start", (payload) => { wsMessages.labels("mission:start").inc(); const world = userWorlds.get(userId); if (!player || !isRoomMember(userId, player) || !world || world.roomId !== player.roomId || !world.missions.some((m) => m.id === payload?.missionId)) return emitError(socket, "MISSION_UNKNOWN", "That quest is unavailable in your current map."); player.missionId = payload.missionId; player.status = "on-mission"; void savePlayer(player); io.to(channel(player.roomId)).emit("mission:updated", { missionId: payload.missionId, playerId: userId, state: "started" }); io.to(channel(player.roomId)).emit("player:updated", { id: userId, status: "on-mission" }); });
  socket.on("mission:complete", async (payload) => {
    wsMessages.labels("mission:complete").inc(); const world = userWorlds.get(userId); const mission = player && world?.roomId === player.roomId ? world.missions.find((m) => m.id === payload?.missionId) : undefined;
    if (!player || !isRoomMember(userId, player) || !mission || player.missionId !== mission.id) return emitError(socket, "MISSION_NOT_ACTIVE", "Start this mission in an active room before checking in.");
    if (distanceMeters(player.position, mission.target) > mission.radiusM) return emitError(socket, "MISSION_TOO_FAR", "Get closer to the mission marker to check in.");
    if (localDemoMode) {
      const key = `${userId}:${mission.id}`; if (localMissionCompletions.has(key)) return emitError(socket, "MISSION_ALREADY_COMPLETE", "You have already completed this route."); localMissionCompletions.add(key);
      const user = localUsers.get(userId); if (user) user.score += mission.reward;
      player.missionId = undefined; player.status = "exploring"; void savePlayer(player);
      socket.emit("mission:updated", { missionId: mission.id, playerId: userId, state: "completed" });
      io.to(channel(player.roomId)).emit("player:updated", { id: player.id, status: "exploring" });
      const grant: XpGrant = { amount: mission.reward, source: "quest", sourceId: mission.id, totalXp: user?.score ?? 0 };
      socket.emit("xp:granted", grant);
      return;
    }
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const completion = await client.query("INSERT INTO quest_completions(user_id,quest_id,reward) VALUES($1,$2,$3) ON CONFLICT(user_id,quest_id) DO NOTHING RETURNING id", [userId, mission.id, mission.reward]);
      if (!completion.rowCount) { await client.query("ROLLBACK"); return emitError(socket, "MISSION_ALREADY_COMPLETE", "You have already completed this route."); }
      const grant = await grantXpInTransaction(client, userId, mission.reward, "quest", mission.id);
      await client.query("INSERT INTO player_statistics(user_id,missions_completed,updated_at) VALUES($1,1,NOW()) ON CONFLICT(user_id) DO UPDATE SET missions_completed=player_statistics.missions_completed+1,updated_at=NOW()", [userId]);
      await client.query("COMMIT");
      player.missionId = undefined; player.status = "exploring"; void savePlayer(player);
      socket.emit("mission:updated", { missionId: mission.id, playerId: userId, state: "completed" });
      io.to(channel(player.roomId)).emit("player:updated", { id: player.id, status: "exploring" });
      socket.emit("xp:granted", grant);
      if (grant.newLevel) socket.emit("level:up", { previousLevel: grant.previousLevel!, newLevel: grant.newLevel, newTitle: "", totalXp: grant.totalXp });
      void checkAndGrantAchievements(userId);
    } catch { await client.query("ROLLBACK"); emitError(socket, "MISSION_SAVE_FAILED", "The mission could not be saved. Please retry shortly."); }
    finally { client.release(); }
  });
  socket.on("item:collect", async (payload) => {
    wsMessages.labels("item:collect").inc();
    const world = userWorlds.get(userId); const item = player && world?.roomId === player.roomId ? world.collectibles.find((x) => x.id === payload?.itemId) : undefined;
    if (!player || !isRoomMember(userId, player) || !item) return emitError(socket, "ITEM_UNKNOWN", "That collectible is no longer available in this room.");
    if (distanceMeters(player.position, item.position) > 45) return emitError(socket, "ITEM_TOO_FAR", "Move closer to the collectible.");
    let claimed = false;
    try { claimed = redis?.isReady ? (await redis.set(`wayfinder:collected:${item.id}`, userId, { NX: true, EX: 86400 })) === "OK" : !localCollected.has(item.id); }
    catch { claimed = !localCollected.has(item.id); }
    if (!claimed) return emitError(socket, "ITEM_COLLECTED", "Another explorer found this one first.");
    localCollected.add(item.id);
    if (localDemoMode) {
      const key = `${userId}:${item.id}`;
      if (localUserCollectibles.has(key)) return emitError(socket, "ITEM_ALREADY_CLAIMED", "You have already collected this one.");
      localUserCollectibles.add(key); const user = localUsers.get(userId); if (user) user.score += item.points;
      io.to(channel(player.roomId)).emit("item:collected", { itemId: item.id, playerId: userId, username: player.username, points: item.points });
      const grant: XpGrant = { amount: item.points, source: "artifact", sourceId: item.id, totalXp: user?.score ?? 0 };
      socket.emit("xp:granted", grant);
      return;
    }
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const claim = await client.query("INSERT INTO collectible_claims(user_id,collectible_id,points) VALUES($1,$2,$3) ON CONFLICT(user_id,collectible_id) DO NOTHING RETURNING id", [userId, item.id, item.points]);
      if (!claim.rowCount) { await client.query("ROLLBACK"); return emitError(socket, "ITEM_ALREADY_CLAIMED", "You have already collected this one."); }
      const grant = await grantXpInTransaction(client, userId, item.points, "artifact", item.id);
      await client.query("INSERT INTO player_statistics(user_id,collectibles_found,updated_at) VALUES($1,1,NOW()) ON CONFLICT(user_id) DO UPDATE SET collectibles_found=player_statistics.collectibles_found+1,updated_at=NOW()", [userId]);
      await client.query("COMMIT");
      io.to(channel(player.roomId)).emit("item:collected", { itemId: item.id, playerId: userId, username: player.username, points: item.points });
      socket.emit("xp:granted", grant);
      if (grant.newLevel) socket.emit("level:up", { previousLevel: grant.previousLevel!, newLevel: grant.newLevel, newTitle: "", totalXp: grant.totalXp });
    } catch { await client.query("ROLLBACK"); emitError(socket, "ITEM_SAVE_FAILED", "The collectible could not be saved. Please retry shortly."); }
    finally { client.release(); }
  });

  // ── Quest Socket Events ──────────────────────────────────────
  socket.on("quest:accept", async (payload, ack) => {
    wsMessages.labels("quest:accept").inc();
    const questId = z.string().min(1).max(100).safeParse(payload?.questId);
    if (!questId.success) return ack({ ok: false, error: "Invalid quest ID." });
    if (localDemoMode) {
      const stored = localQuestStore.get(questId.data);
      if (stored?.state === "active") return ack({ ok: false, error: "Already accepted." });
      if (stored?.state === "completed") return ack({ ok: false, error: "Already completed." });
      localQuestStore.set(questId.data, { state: "active", acceptedAt: new Date().toISOString(), objectivesCompleted: 0 });
      const quests = getLocalQuests();
      const quest = quests.find((q) => q.id === questId.data);
      if (!quest) return ack({ ok: false, error: "Quest not found." });
      return ack({ ok: true, quest });
    }
    try {
      const quest = await db.query("SELECT * FROM quest_definitions WHERE id=$1 AND is_active=TRUE", [questId.data]);
      if (!quest.rowCount) return ack({ ok: false, error: "Quest not found or unavailable." });
      const existing = await db.query("SELECT state FROM user_quests WHERE user_id=$1 AND quest_id=$2", [userId, questId.data]);
      if (existing.rows[0]?.state === "active") return ack({ ok: false, error: "Already accepted." });
      if (existing.rows[0]?.state === "completed" && !quest.rows[0].repeatable) return ack({ ok: false, error: "Already completed." });
      await db.query("INSERT INTO user_quests(user_id,quest_id,state) VALUES($1,$2,'active') ON CONFLICT(user_id,quest_id) DO UPDATE SET state='active',accepted_at=NOW()", [userId, questId.data]);
      socket.emit("quest:accepted", { id: questId.data, title: quest.rows[0].title, description: quest.rows[0].description, category: quest.rows[0].category, difficulty: quest.rows[0].difficulty, xpReward: quest.rows[0].xp_reward, maxParticipants: quest.rows[0].max_participants, minParticipants: quest.rows[0].min_participants, state: "active", objectives: [], objectivesCompleted: 0, objectivesTotal: 0, rewardClaimed: false });
      return ack({ ok: true });
    } catch { return ack({ ok: false, error: "Could not accept quest." }); }
  });

  // ── .io Action & Spell Handlers ───────────────────────────────
  socket.on("player:faction", (payload) => {
    if (!player) return;
    player.faction = payload.faction;
    io.to(channel(player.roomId)).emit("player:updated", { id: player.id, faction: payload.faction });
  });

  socket.on("spell:cast", async (payload, ack) => {
    wsMessages.labels("spell:cast").inc();
    if (!player || !isRoomMember(userId, player)) return ack({ ok: false, error: "Join an active room before casting spells." });
    const spell = payload?.spell;
    if (!["lumos", "cloak", "trap", "ping"].includes(spell)) return ack({ ok: false, error: "Unknown spell." });

    const cooldowns = [
      { type: "lumos", cdMs: 15_000 },
      { type: "cloak", cdMs: 25_000 },
      { type: "trap", cdMs: 20_000 },
      { type: "ping", cdMs: 12_000 },
    ];
    const cdInfo = cooldowns.find((c) => c.type === spell)!;
    let pCd = spellCooldowns.get(userId);
    if (!pCd) { pCd = new Map(); spellCooldowns.set(userId, pCd); }
    const lastCast = pCd.get(spell) ?? 0;
    const now = Date.now();
    if (now - lastCast < cdInfo.cdMs) {
      return ack({ ok: false, error: "Spell is recharging.", cooldownRemainingMs: cdInfo.cdMs - (now - lastCast) });
    }
    pCd.set(spell, now);

    const world = userWorlds.get(userId);
    const spellEvent: SpellCastEvent = {
      spell,
      casterId: userId,
      casterName: player.username,
      position: player.position,
      expiresAt: now + (spell === "cloak" ? 15_000 : spell === "lumos" ? 12_000 : 8_000),
    };

    if (spell === "lumos") {
      spellEvent.radiusM = 350;
      io.to(channel(player.roomId)).emit("spell:casted", spellEvent);
      if (world) {
        const item: GameEventFeedItem = { id: crypto.randomUUID(), text: `✨ ${player.username} cast Lumos Reveal Pulse!`, kind: "spell", timestamp: now };
        world.feed.push(item);
        io.to(channel(player.roomId)).emit("feed:item", item);
      }
    } else if (spell === "cloak") {
      player.isCloaked = true;
      io.to(channel(player.roomId)).emit("player:updated", { id: player.id, isCloaked: true });
      io.to(channel(player.roomId)).emit("spell:casted", spellEvent);
      if (world) {
        const item: GameEventFeedItem = { id: crypto.randomUUID(), text: `👤 ${player.username} cast Invisibility Cloak!`, kind: "spell", timestamp: now };
        world.feed.push(item);
        io.to(channel(player.roomId)).emit("feed:item", item);
      }
      setTimeout(() => {
        if (player) {
          player.isCloaked = false;
          io.to(channel(player.roomId)).emit("player:updated", { id: player.id, isCloaked: false });
        }
      }, 15_000);
    } else if (spell === "trap") {
      if (world) {
        const trap: RuneTrap = {
          id: `trap-${crypto.randomUUID().slice(0, 8)}`,
          ownerId: userId,
          ownerName: player.username,
          position: player.position,
          createdAt: now,
        };
        world.traps.push(trap);
        io.to(channel(player.roomId)).emit("trap:placed", trap);
        const item: GameEventFeedItem = { id: crypto.randomUUID(), text: `⚡ ${player.username} placed an Arcane Rune Trap!`, kind: "trap", timestamp: now };
        world.feed.push(item);
        io.to(channel(player.roomId)).emit("feed:item", item);
      }
    } else if (spell === "ping") {
      let targetPos: Position = offsetPosition(player.position, 100, 100);
      if (world?.snitch && !world.snitch.caughtAt) {
        targetPos = world.snitch.position;
      } else if (world?.spires?.length) {
        targetPos = world.spires[0].position;
      }
      spellEvent.targetPosition = targetPos;
      socket.emit("spell:casted", spellEvent);
    }

    ack({ ok: true, spellEvent });
  });

  socket.on("snitch:catch", async (payload, ack) => {
    if (!player || !isRoomMember(userId, player)) return ack({ ok: false, error: "Not in an active room." });
    const world = userWorlds.get(userId);
    if (!world?.snitch || world.snitch.id !== payload?.snitchId || world.snitch.caughtAt) {
      return ack({ ok: false, error: "The Golden Snitch escaped!" });
    }
    if (distanceMeters(player.position, world.snitch.position) > 45) {
      return ack({ ok: false, error: "Move closer to catch the Snitch!" });
    }
    world.snitch.caughtAt = Date.now();
    const pts = world.snitch.points;
    io.to(channel(player.roomId)).emit("snitch:caught", {
      snitchId: world.snitch.id,
      catcherId: player.id,
      catcherName: player.username,
      points: pts,
    });
    const grant = await grantXpInDemoOrDb(userId, pts, "snitch", world.snitch.id);
    if (grant) socket.emit("xp:granted", grant);
    ack({ ok: true, points: pts });
  });

  socket.on("bounty:tag", async (payload, ack) => {
    if (!player || !isRoomMember(userId, player)) return ack({ ok: false, error: "Not in an active room." });
    const target = active.get(payload?.targetPlayerId);
    if (!target || target.roomId !== player.roomId || !target.isCrowned) {
      return ack({ ok: false, error: "Target is not the Crowned Marauder." });
    }
    if (distanceMeters(player.position, target.position) > 30) {
      return ack({ ok: false, error: "Move closer to tag the Crowned Marauder!" });
    }
    const stolen = 75;
    const grant = await grantXpInDemoOrDb(userId, stolen, "bounty", target.id);
    if (grant) socket.emit("xp:granted", grant);
    const world = userWorlds.get(userId);
    if (world) {
      const item: GameEventFeedItem = { id: crypto.randomUUID(), text: `🎯 ${player.username} tagged Crowned Marauder ${target.username} (+${stolen} XP)!`, kind: "bounty", timestamp: Date.now() };
      world.feed.push(item);
      io.to(channel(player.roomId)).emit("feed:item", item);
    }
    ack({ ok: true, xpStolen: stolen });
  });

  socket.on("duel:challenge", (payload, ack) => {
    if (!player || !isRoomMember(userId, player)) return ack?.({ ok: false, error: "Not in an active room." });
    const target = active.get(payload?.targetPlayerId);
    if (!target) return ack?.({ ok: false, error: "Target wizard is not active in this chamber." });
    io.to(target.socketId).emit("duel:invitation", {
      fromId: userId,
      fromName: player.username,
      fromFaction: player.faction,
      fromAvatar: player.avatar,
    });
    ack?.({ ok: true });
  });

  socket.on("duel:action", (payload) => {
    if (!player || !isRoomMember(userId, player)) return;
    const target = active.get(payload?.targetPlayerId);
    if (!target) return;
    io.to(target.socketId).emit("duel:opponent_action", {
      fromId: userId,
      spell: payload.spell,
      damage: payload.damage,
      shield: payload.shield,
      message: payload.message,
    });
  });

  socket.on("duel:win", async (payload, ack) => {
    if (!player || !isRoomMember(userId, player)) return ack?.({ ok: false });
    const rewardXp = 80;
    const grant = await grantXpInDemoOrDb(userId, rewardXp, "duel", payload?.opponentName ?? "rival");
    if (grant) socket.emit("xp:granted", grant);
    const world = userWorlds.get(userId);
    if (world) {
      const item: GameEventFeedItem = {
        id: crypto.randomUUID(),
        text: `⚔️ ${player.username} emerged victorious in a magical duel against ${payload?.opponentName ?? "their rival"} (+${rewardXp} XP)!`,
        kind: "duel",
        timestamp: Date.now(),
      };
      world.feed.push(item);
      io.to(channel(player.roomId)).emit("feed:item", item);
    }
    ack?.({ ok: true, rewardXp });
  });

  socket.on("net:ping", ({ sentAt }) => { if (!Number.isFinite(sentAt)) return; const rtt = Math.max(0, Date.now() - sentAt); latency.observe(rtt); recentRtt.push(rtt); if (recentRtt.length > 100) recentRtt.shift(); averageLatency.set(recentRtt.reduce((sum, n) => sum + n, 0) / recentRtt.length); if (player && isRoomMember(userId, player)) { player.lastSeen = Date.now(); void savePlayer(player); } socket.emit("net:pong", { sentAt, serverAt: Date.now() }); });
  socket.on("disconnect", (reason) => {
    wsConnections.dec(); disconnects.inc();
    connectedSockets.delete(socket.id); if (connectedSockets.size === 0) userSockets.delete(userId);
    if (shareExpiryTimer) clearTimeout(shareExpiryTimer);
    proximityPreferences.delete(userId); removeDestination(userId);
    if (player && active.get(userId)?.socketId === socket.id) {
      active.delete(userId);
      if (player.sessionId && !localDemoMode) {
        void db.query("UPDATE game_sessions SET ended_at=NOW() WHERE id=$1", [player.sessionId]).catch(() => {});
        void db.query("INSERT INTO player_statistics(user_id,total_distance_m,updated_at) VALUES($1,$2,NOW()) ON CONFLICT(user_id) DO UPDATE SET total_distance_m=player_statistics.total_distance_m+EXCLUDED.total_distance_m,updated_at=NOW()", [userId, player.distanceTravelled]).catch(() => {});
      }
      void (async () => {
        let ownsPresence = true;
        if (redis?.isReady) {
          try { const value = await redis.get(playerKey(userId)); ownsPresence = !!value && JSON.parse(value).connectionId === socket.id; if (ownsPresence) await redis.del(playerKey(userId)); }
          catch { ownsPresence = false; }
        }
        if (ownsPresence) io.to(channel(player!.roomId)).emit("player:left", { playerId: userId });
      })();
    }
    console.info(JSON.stringify({ event: "PLAYER_DISCONNECT", playerId: userId, serverId: SERVER_ID, reason, timestamp: new Date().toISOString() }));
  });
});

async function initialize() {
  if (process.env.DATABASE_URL) {
    try {
      await db.query("SELECT 1");
    } catch (error) {
      if (process.env.REQUIRE_POSTGRES === "true") {
        console.error("PostgreSQL is unavailable at startup", error);
        throw error;
      }
      localDemoMode = true;
      console.warn("PostgreSQL connection failed; running in standalone in-memory mode.");
    }
  } else {
    localDemoMode = true;
    console.info("No DATABASE_URL configured; running in standalone in-memory mode with instant guest access and live duels.");
  }
  if (!localDemoMode) {
    const migrations = ["001_init.sql", "002_gamification_core.sql", "003_quests.sql", "004_cooperative_guilds.sql"];
    for (const migration of migrations) {
      try {
        const schema = readFileSync(path.resolve(process.cwd(), `backend/migrations/${migration}`), "utf8");
        await db.query(schema);
        console.info(JSON.stringify({ event: "MIGRATION_APPLIED", migration }));
      } catch (err: any) { console.error(JSON.stringify({ event: "MIGRATION_FAILED", migration, message: err?.message })); }
    }
    await db.query("CREATE UNIQUE INDEX IF NOT EXISTS users_username_ci_idx ON users (lower(username))");
  }
  if (process.env.REDIS_URL) {
    try {
      redis = createClient({ url: process.env.REDIS_URL, ...(process.env.REDIS_TLS_CA ? { socket: { tls: true, ca: readFileSync(process.env.REDIS_TLS_CA) } } : {}) }); redis.on("error", (error) => console.warn(JSON.stringify({ event: "REDIS_ERROR", message: error.message, serverId: SERVER_ID })));
      await redis.connect(); const pub = redis.duplicate(); const sub = redis.duplicate(); await Promise.all([pub.connect(), sub.connect()]); io.adapter(createAdapter(pub, sub)); console.info(JSON.stringify({ event: "REDIS_ADAPTER_READY", serverId: SERVER_ID }));
    } catch (error) { console.warn("Redis is unavailable; this instance will run in single-node mode", error); redis = undefined; }
  }
  server.listen(PORT, "0.0.0.0", () => console.info(JSON.stringify({ event: "SERVER_READY", port: PORT, serverId: SERVER_ID })));
}
process.on("SIGTERM", () => { console.info("Shutting down gracefully"); io.close(); void db.end(); void redis?.quit(); });
void initialize().catch((error) => { console.error("Startup failed", error); process.exit(1); });
