import { db } from './db.js';
import { listDocker, dockerStats, dockerAction, serviceAction, powerAction, dockerLogs, serviceStatus, botAction } from './actions.js';
import { exec, execStream } from './ssh.js';
import { decrypt, ENABLE_REMOTE_EXEC } from './config.js';

const shQuote = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;

export function registerControlRoutes(app) {
  const getMachine = (id) => db.prepare('SELECT * FROM machines WHERE id = ?').get(id);

  // ---------- Docker ----------
  app.get('/api/machines/:id/docker', async (req, reply) => {
    const m = getMachine(req.params.id);
    if (!m) return reply.code(404).send({ error: 'machine inconnue' });
    const list = await listDocker(m);
    if (list.ok) list.stats = await dockerStats(m);
    return list;
  });
  app.post('/api/machines/:id/docker/:action', async (req, reply) => {
    const m = getMachine(req.params.id);
    const { container } = req.body || {};
    if (!m || !container) return reply.code(400).send({ error: 'paramètres manquants' });
    const r = await dockerAction(m, container, req.params.action);
    return { ok: r.ok, error: r.ok ? null : (r.error || r.err) };
  });
  app.get('/api/machines/:id/docker/:name/logs', async (req) => {
    const m = getMachine(req.params.id);
    if (!m) return { ok: false, logs: 'machine inconnue' };
    return dockerLogs(m, req.params.name, req.query.lines || 100);
  });

  // ---------- Services systemd ----------
  app.get('/api/machines/:id/services', async (req) => {
    const m = getMachine(req.params.id);
    if (!m) return { ok: false, error: 'machine inconnue', services: [] };
    return listServicesSafe(m);
  });
  app.post('/api/machines/:id/services/:action', async (req, reply) => {
    const m = getMachine(req.params.id);
    const { unit } = req.body || {};
    if (!m || !unit) return reply.code(400).send({ error: 'paramètres manquants' });
    const r = await serviceAction(m, unit, req.params.action, decrypt(m.sudo_password));
    return { ok: r.ok, output: r.ok ? (r.out || r.err || 'ok') : (r.error || r.err || 'échec') };
  });
  app.get('/api/machines/:id/services/:unit/status', async (req) => {
    const m = getMachine(req.params.id);
    if (!m) return { ok: false, status: 'machine inconnue' };
    return serviceStatus(m, req.params.unit);
  });

  // ---------- Bots ----------
  app.get('/api/machines/:id/bots', async (req, reply) => {
    const m = getMachine(req.params.id);
    if (!m) return reply.code(404).send({ error: 'machine inconnue' });
    const { scanBots } = await import('./collector.js');
    const bots = await scanBots(m);
    return { bots };
  });
  app.post('/api/machines/:id/bots/:type/:identifier/:action', async (req, reply) => {
    const m = getMachine(req.params.id);
    if (!m) return reply.code(404).send({ error: 'machine inconnue' });
    const { type, identifier, action } = req.params;
    if (!['service', 'docker', 'pm2', 'proc'].includes(type) || !['start', 'stop', 'restart', 'status'].includes(action)) {
      return reply.code(400).send({ error: 'paramètres invalides' });
    }
    const r = await botAction(m, type, decodeURIComponent(identifier), action, decrypt(m.sudo_password));
    return { ok: r.ok, output: r.ok ? (r.output || 'ok') : (r.error || r.output || 'échec') };
  });

  // Logs en temps réel (SSE) d'un bot, quel que soit son type
  app.get('/api/machines/:id/bots/:type/:identifier/logs', (req, reply) => {
    const m = getMachine(req.params.id);
    if (!m) return reply.code(404).send({ error: 'machine inconnue' });
    const { type } = req.params;
    const identifier = decodeURIComponent(req.params.identifier);

    let cmd;
    if (type === 'service') cmd = `journalctl -u ${shQuote(identifier)} -n 150 -f --no-pager -o cat 2>&1`;
    else if (type === 'docker') cmd = `docker logs -f --tail 150 ${shQuote(identifier)} 2>&1`;
    else if (type === 'pm2') cmd = `pm2 logs ${shQuote(identifier)} --lines 150 --raw 2>&1`;
    else if (type === 'proc') cmd = `tail -f -n 150 /proc/${shQuote(identifier)}/fd/1 /proc/${shQuote(identifier)}/fd/2 2>&1`;
    else return reply.code(400).send({ error: 'type invalide' });

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write(': connect\n\n');

    const send = (line) => { try { reply.raw.write(`data: ${line.replace(/\r/g, '')}\n\n`); } catch {} };
    let buf = '';
    const ctrl = execStream(m, cmd, {
      onData: (chunk) => {
        buf += chunk;
        const parts = buf.split('\n');
        buf = parts.pop();
        for (const l of parts) send(l);
      },
      onError: (msg) => { try { reply.raw.write(`event: error\ndata: ${msg}\n\n`); } catch {} },
      onEnd: () => { if (buf) send(buf); try { reply.raw.write('event: end\ndata: flux termin\u00e9\n\n'); } catch {} },
    });

    req.raw.on('close', () => ctrl.stop());
    reply.hijack();
  });

  // ---------- Power ----------
  app.post('/api/machines/:id/power/:action', async (req, reply) => {
    const m = getMachine(req.params.id);
    if (!m) return reply.code(404).send({ error: 'machine inconnue' });
    const r = await powerAction(m, req.params.action, decrypt(m.sudo_password));
    await new Promise((res) => setTimeout(res, 1000));
    return { ok: r.ok, output: ((r.out || '') + (r.err || r.error || '')).slice(-300) };
  });

  // ---------- Exec brut (debug) ----------
  app.post('/api/machines/:id/exec', async (req, reply) => {
    if (!ENABLE_REMOTE_EXEC) return reply.code(404).send({ error: 'exécution distante désactivée' });
    const m = getMachine(req.params.id);
    const { command } = req.body || {};
    if (!m || !command || typeof command !== 'string' || command.length > 4000) return reply.code(400).send({ error: 'paramètres invalides' });
    const r = await exec(m, command, 20000);
    return { ok: r.ok, out: r.out, err: r.err };
  });
}

async function listServicesSafe(m) {
  const { listServices } = await import('./actions.js');
  return listServices(m);
}
