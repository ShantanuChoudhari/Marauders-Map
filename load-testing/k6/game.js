import http from 'k6/http';
import { check, sleep } from 'k6';
import ws from 'k6/ws';
import { Counter, Trend } from 'k6/metrics';

const base = __ENV.BASE_URL || 'http://localhost:8080';
const targetVus = Number(__ENV.TARGET_VUS || 50);
export const options = {
  stages: [
    { duration: '30s', target: targetVus },
    { duration: '2m', target: targetVus },
    { duration: '20s', target: 0 },
  ],
  thresholds: { http_req_failed: ['rate<0.03'], ws_connecting: ['p(95)<1500'] },
};
const wsConnectFailures = new Counter('game_ws_connect_failures');
const wsMessageLatency = new Trend('game_ws_rtt_ms', true);

export default function () {
  const username = `load${__VU}_${__ITER}_${Date.now()}`.slice(0, 20);
  const auth = http.post(`${base}/api/auth/register`, JSON.stringify({ username, password: 'LoadTest-Only-Password-9283', avatar: '🧭' }), { headers: { 'Content-Type': 'application/json' } });
  const created = check(auth, { 'account created': (r) => r.status === 201 });
  if (!created) return;
  const token = auth.json('token');
  const wsBase = base.replace(/^http/, 'ws');
  const response = ws.connect(`${wsBase}/socket.io/?EIO=4&transport=websocket`, {}, (socket) => {
    socket.on('open', () => socket.send(`40${JSON.stringify({ token })}`));
    socket.on('message', (data) => {
      if (String(data) === '2') socket.send('3');
      if (String(data).startsWith('40')) {
        socket.send(`42${JSON.stringify(['game:join', { position: { lat: 18.5204, lng: 73.8567 }, visibility: 'visible' }])}`);
      }
      if (String(data).startsWith('42')) {
        try {
          const [event, payload] = JSON.parse(String(data).slice(2));
          if (event === 'net:pong' && Number.isFinite(payload?.sentAt)) wsMessageLatency.add(Date.now() - payload.sentAt);
        } catch { /* Ignore non-JSON Socket.IO control messages. */ }
      }
    });
    socket.setInterval(() => socket.send(`42${JSON.stringify(['net:ping', { sentAt: Date.now() }])}`), 5000);
    socket.setTimeout(() => socket.close(), 15_000);
  });
  check(response, { 'websocket handshake accepted': (r) => r && r.status === 101 }) || wsConnectFailures.add(1);
  sleep(1);
}
