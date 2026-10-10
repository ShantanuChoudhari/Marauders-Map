import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { after, before, test } from "node:test";
import { io } from "socket.io-client";

let child;
let baseUrl;
let childOutput = "";
const sockets = [];

async function freePort() {
  const probe = net.createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const { port } = probe.address();
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForServer() {
  const deadline = Date.now() + 20_000;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Backend exited early.\n${childOutput}`);
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch (error) { lastError = error; }
    await delay(150);
  }
  throw new Error(`Backend did not become healthy: ${lastError}\n${childOutput}`);
}

async function api(path, { token, ...options } = {}) {
  const headers = { ...(options.body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...options.headers };
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
  let body = {};
  try { body = await response.json(); } catch { /* preserve the status assertion below */ }
  return { response, body };
}

async function register(username) {
  const { response, body } = await api("/api/auth/register", { method: "POST", body: JSON.stringify({ username, password: "LocalSmokePassword2026!" }) });
  assert.equal(response.status, 201, JSON.stringify(body));
  return body;
}

function connect(token) {
  const socket = io(baseUrl, { transports: ["websocket"], auth: { token }, reconnection: false, timeout: 4000 });
  sockets.push(socket);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Socket connection timed out")), 5000);
    socket.once("connect", () => { clearTimeout(timer); resolve(socket); });
    socket.once("connect_error", (error) => { clearTimeout(timer); reject(error); });
  });
}

function ack(socket, event, payload) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} acknowledgement timed out`)), 5000);
    socket.emit(event, payload, (reply) => { clearTimeout(timer); resolve(reply); });
  });
}

function eventOnce(socket, event, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, listener); reject(new Error(`Timed out waiting for ${event}`)); }, timeoutMs);
    const listener = (payload) => { clearTimeout(timer); resolve(payload); };
    socket.once(event, listener);
  });
}

before(async () => {
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ["--import", "tsx", "backend/src/server.ts"], {
    cwd: new URL("../..", import.meta.url),
    env: { ...process.env, NODE_ENV: "development", PORT: String(port), SERVER_ID: "social-room-test", JWT_SECRET: "local-social-room-test-secret-32-chars", DATABASE_URL: "postgres://wayfinder:wayfinder-local@127.0.0.1:1/wayfinder", REDIS_URL: "", AUTH_RATE_LIMIT_MAX: "100", API_RATE_LIMIT_MAX: "1000", CLIENT_ORIGIN: "http://localhost:5173" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.setEncoding("utf8").on("data", (chunk) => { childOutput += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { childOutput += chunk; });
  await waitForServer();
});

after(async () => {
  for (const socket of sockets) socket.disconnect();
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), delay(4000)]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
});

test("signup, friendship, private room, consent, destinations, and emergency stop", async () => {
  const suffix = Math.random().toString(36).slice(2, 9);
  const alice = await register(`alice${suffix}`);
  const bob = await register(`bobby${suffix}`);
  const login = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username: `alice${suffix}`, password: "LocalSmokePassword2026!" }) });
  assert.equal(login.response.status, 200);

  const aliceSocket = await connect(alice.token);
  const bobSocket = await connect(bob.token);
  const requestNotice = eventOnce(bobSocket, "friend:request-received");
  const requestResult = await api("/api/friends/requests", { token: alice.token, method: "POST", body: JSON.stringify({ userId: bob.player.id }) });
  assert.equal(requestResult.response.status, 201, JSON.stringify(requestResult.body));
  const notice = await requestNotice;
  assert.equal(notice.sender.username, `alice${suffix}`);

  const incoming = await api("/api/friends/requests/incoming", { token: bob.token });
  assert.equal(incoming.body.requests.length, 1);
  const requestId = incoming.body.requests[0].id;
  const unauthorizedAccept = await api(`/api/friends/requests/${requestId}/accept`, { token: alice.token, method: "POST" });
  assert.equal(unauthorizedAccept.response.status, 404);
  const accept = await api(`/api/friends/requests/${requestId}/accept`, { token: bob.token, method: "POST" });
  assert.equal(accept.response.status, 200, JSON.stringify(accept.body));
  assert.equal((await api("/api/friends", { token: alice.token })).body.friends[0].id, bob.player.id);

  const room = await ack(aliceSocket, "room:create", { name: "Smoke-test gathering" });
  assert.equal(room.ok, true, room.error);
  const joined = await ack(bobSocket, "room:join", { code: room.room.code });
  assert.equal(joined.ok, true, joined.error);
  const position = { lat: 40.7128, lng: -74.0060 };
  const bobPosition = { lat: 40.7131, lng: -74.0060 };
  const aliceMap = await ack(aliceSocket, "game:join", { position, visibility: "visible" });
  const bobMap = await ack(bobSocket, "game:join", { position: bobPosition, visibility: "visible" });
  assert.equal(aliceMap.ok, true); assert.equal(aliceMap.missions.length, 3); assert.equal(aliceMap.collectibles.length, 5);
  const questApi = await api("/api/missions", { token: alice.token }); assert.equal(questApi.body.missions.length, 3);
  assert.ok(aliceMap.missions.every((mission) => Math.abs(mission.target.lat - position.lat) < 0.01 && Math.abs(mission.target.lng - position.lng) < 0.01), "quests should spawn near the player's real starting area");
  assert.ok(bobMap.missions.every((mission) => Math.abs(mission.target.lat - bobPosition.lat) < 0.01 && Math.abs(mission.target.lng - bobPosition.lng) < 0.01), "each player's quest coordinates should stay centered on their own map");
  const hiddenSnapshot = await ack(bobSocket, "game:join", { position: bobPosition, visibility: "visible" });
  assert.ok(hiddenSnapshot.players.every((player) => player.visibility === "hidden"), "joining the map must not enable sharing");

  const share = { enabled: true, position, visibility: "approximate", durationMs: 900_000 };
  const destinationNotice = eventOnce(bobSocket, "destination:shared");
  aliceSocket.emit("player:share", share);
  bobSocket.emit("player:share", { ...share, position: { lat: position.lat + 0.00001, lng: position.lng + 0.00001 } });
  const destination = await ack(aliceSocket, "destination:share", { position: { lat: 18.521, lng: 73.857 }, label: "Meet at the square" });
  assert.equal(destination.ok, true, destination.error);
  assert.equal((await destinationNotice).label, "Meet at the square");
  bobSocket.emit("player:proximity", { enabled: true, radiusMeters: 250 });
  const proximityNotice = eventOnce(bobSocket, "proximity:alert");
  aliceSocket.emit("player:move", { position: { lat: position.lat + 0.000005, lng: position.lng }, sequence: 1, timestamp: Date.now() });
  assert.equal((await proximityNotice).username, `alice${suffix}`);

  const removedNotice = eventOnce(bobSocket, "player:left");
  aliceSocket.emit("player:share", { enabled: false });
  assert.equal((await removedNotice).playerId, alice.player.id);
  const endNotice = eventOnce(bobSocket, "room:ended");
  aliceSocket.emit("room:end");
  await endNotice;

  const removeFriend = await api(`/api/friends/${bob.player.id}`, { token: alice.token, method: "DELETE" });
  assert.equal(removeFriend.response.status, 200);
  assert.deepEqual((await api("/api/friends", { token: alice.token })).body.friends, []);
});
