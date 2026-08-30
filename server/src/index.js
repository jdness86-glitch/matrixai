import fs from 'node:fs';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { WebSocketServer } from 'ws';

import { PORT, HOST, WEB_DIST, DATA_DIR, TRUST_PROXY } from './config.js';
import { registerBaseRoutes, requireAuth, isSessionTokenValid } from './routes.js';
import { registerControlRoutes } from './routes-control.js';
import { startCollector } from './ws.js';
import { closeAll } from './ssh.js';
import { db } from './db.js';

fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL || 'info', redact: ['req.headers.cookie', 'req.body.password', 'req.body.sudo_password'] },
  bodyLimit: 2 * 1024 * 1024,
  trustProxy: TRUST_PROXY,
});
await app.register(cookie);

app.addHook('onRequest', (req, reply, done) => {
  if (!req.url.startsWith('/api/') || req.url === '/api/login' || req.url === '/api/health') return done();
  requireAuth(req, reply, done);
});
app.addHook('onRequest', (req, reply, done) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) || req.url === '/api/login') return done();
  const site = req.headers['sec-fetch-site'];
  if (site && !['same-origin', 'same-site', 'none'].includes(site)) return reply.code(403).send({ error: 'requête intersite refusée' });
  done();
});

app.get('/api/health', async () => ({ ok: true, service: 'matrixai', version: process.env.npm_package_version || '1.0.0' }));
registerBaseRoutes(app);
registerControlRoutes(app);

if (fs.existsSync(WEB_DIST)) {
  await app.register(fastifyStatic, {
    root: WEB_DIST,
    prefix: '/',
    setHeaders(res, filePath) {
      if (/\/assets\//.test(filePath)) res.header('Cache-Control', 'public, max-age=31536000, immutable');
      else res.header('Cache-Control', 'no-cache');
    },
  });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not found' });
    if (req.method !== 'GET' || /\.[a-z0-9]{2,8}(?:\?|$)/i.test(req.url)) return reply.code(404).send('Not found');
    return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
  });
} else {
  app.log.warn({ path: WEB_DIST }, 'frontend absent — lancez npm run build');
}

const server = app.server;
const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (request, socket, head) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname !== '/ws') return socket.destroy();
    const cookies = Object.fromEntries(String(request.headers.cookie || '').split(';').map((v) => v.trim().split('=').map(decodeURIComponent)).filter((p) => p.length === 2));
    if (!isSessionTokenValid(cookies.fleetdash_session)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      return socket.destroy();
    }
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
  } catch {
    socket.destroy();
  }
});

const timers = startCollector(wss);
await app.listen({ port: PORT, host: HOST });
app.log.info(`MatrixAI démarré sur http://${HOST}:${PORT}`);

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'arrêt gracieux');
  clearInterval(timers.metrics);
  clearInterval(timers.calib);
  for (const client of wss.clients) client.close(1001, 'server shutdown');
  wss.close();
  closeAll();
  await app.close().catch(() => {});
  try { db.pragma('wal_checkpoint(TRUNCATE)'); db.close(); } catch {}
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
