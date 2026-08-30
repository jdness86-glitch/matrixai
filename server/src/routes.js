import crypto from 'node:crypto';
import { db, verifyPassword, changePassword, logEvent, getEvents } from './db.js';
import { encrypt } from './config.js';
import { scanLan, setupMachineKey } from './scanner.js';
import { publicKey } from './keys.js';
import { LAN_CIDR } from './config.js';

const sessions = new Map(); // token -> { username, expires }
const loginAttempts = new Map();

export function isSessionTokenValid(token) {
  const session = token && sessions.get(token);
  if (!session || session.expires < Date.now()) {
    if (token) sessions.delete(token);
    return false;
  }
  return true;
}

export function requireAuth(req, reply, done) {
  const token = req.cookies.fleetdash_session;
  const session = token && sessions.get(token);
  if (!session || session.expires < Date.now()) {
    if (token) sessions.delete(token);
    return reply.code(401).send({ error: 'non authentifié' });
  }
  req.username = session.username;
  done();
}

export function registerBaseRoutes(app) {
  // ---------- Auth ----------
  app.post('/api/login', (req, reply) => {
    const key = req.ip || 'unknown';
    const attempt = loginAttempts.get(key) || { count: 0, reset: 0 };
    if (attempt.reset > Date.now() && attempt.count >= 8) return reply.code(429).send({ error: 'trop de tentatives, réessaie dans quelques minutes' });
    const { username, password } = req.body || {};
    if (!verifyPassword(username || '', password || '')) {
      loginAttempts.set(key, { count: attempt.reset > Date.now() ? attempt.count + 1 : 1, reset: Date.now() + 5 * 60_000 });
      return reply.code(401).send({ error: 'identifiants invalides' });
    }
    loginAttempts.delete(key);
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { username, expires: Date.now() + 7 * 24 * 3600 * 1000 });
    reply.setCookie('fleetdash_session', token, { httpOnly: true, sameSite: 'strict', secure: req.protocol === 'https', path: '/', maxAge: 7 * 24 * 3600 });
    return { ok: true, username };
  });
  app.post('/api/logout', (req, reply) => {
    sessions.delete(req.cookies.fleetdash_session);
    reply.clearCookie('fleetdash_session', { path: '/' });
    return { ok: true };
  });
  app.get('/api/me', (req, reply) => reply.send({ username: req.username }));
  app.post('/api/password', (req, reply) => {
    const { old: oldP, new: newP } = req.body || {};
    if (!verifyPassword(req.username, oldP || '')) return reply.code(403).send({ error: 'ancien mot de passe incorrect' });
    if (!newP || newP.length < 10) return reply.code(400).send({ error: 'le nouveau mot de passe doit contenir au moins 10 caractères' });
    changePassword(req.username, newP);
    for (const [token, session] of sessions) if (session.username === req.username && token !== req.cookies.fleetdash_session) sessions.delete(token);
    return { ok: true };
  });
  app.get('/api/pubkey', () => ({ ok: true, key: publicKey.trim() }));

  // ---------- Machines ----------
  const machineFields = (b) => ({
    name: b.name, host: b.host, port: b.port || 22, user: b.user || 'root',
    auth_type: b.auth_type || 'password',
    password: b.password ? encrypt(b.password) : null,
    sudo_password: b.sudo_password ? encrypt(b.sudo_password) : null,
    key_path: b.key_path || null,
    idle_w: b.idle_w ?? 5, max_w: b.max_w ?? 60,
    smartplug_url: b.smartplug_url || null, tags: b.tags || '',
    auto_calib: (b.auto_calib === 0 || b.auto_calib === false) ? 0 : 1,
    model: b.model || null,
  });

  app.get('/api/machines', async () => {
    const machines = db.prepare('SELECT * FROM machines ORDER BY name').all()
      .map(({ password, sudo_password, ...m }) => m);
    const latest = db.prepare('SELECT * FROM metrics WHERE machine_id = ? ORDER BY ts DESC LIMIT 1');
    const diskQ = db.prepare('SELECT data, ts FROM machine_disks WHERE machine_id = ?');
    return machines.map((m) => {
      const last = latest.get(m.id);
      const online = last && last.online && Date.now() - last.ts < 10000;
      const d = diskQ.get(m.id);
      return { ...m, online: !!online, last: last || null, disks: d ? JSON.parse(d.data) : null, disks_ts: d?.ts || null };
    });
  });

  app.post('/api/machines', async (req, reply) => {
    const b = req.body || {};
    if (!b.name || !b.host) return reply.code(400).send({ error: 'name et host requis' });
    try {
      const info = db.prepare(`INSERT INTO machines (name, host, port, user, auth_type, password, sudo_password, key_path, idle_w, max_w, smartplug_url, tags, auto_calib, model)
        VALUES (@name, @host, @port, @user, @auth_type, @password, @sudo_password, @key_path, @idle_w, @max_w, @smartplug_url, @tags, @auto_calib, @model)`).run(machineFields(b));
      logEvent(info.lastInsertRowid, 'info', `machine ${b.name} ajoutée`);
      return { ok: true, id: info.lastInsertRowid };
    } catch (e) {
      return reply.code(400).send({ error: e.message });
    }
  });

  app.put('/api/machines/:id', async (req, reply) => {
    const m = db.prepare('SELECT * FROM machines WHERE id = ?').get(req.params.id);
    if (!m) return reply.code(404).send({ error: 'machine inconnue' });
    const b = req.body || {};
    const f = machineFields(b);
    if (!b.password) f.password = m.password;
    if (!b.sudo_password) f.sudo_password = m.sudo_password;
    if (!b.model) f.model = m.model;
    db.prepare(`UPDATE machines SET name=@name, host=@host, port=@port, user=@user, auth_type=@auth_type,
      password=@password, sudo_password=@sudo_password, key_path=@key_path, idle_w=@idle_w, max_w=@max_w,
      smartplug_url=@smartplug_url, tags=@tags, auto_calib=@auto_calib, model=@model WHERE id=${m.id}`).run(f);
    return { ok: true };
  });

  app.delete('/api/machines/:id', async (req) => {
    db.prepare('DELETE FROM machines WHERE id = ?').run(req.params.id);
    db.prepare('DELETE FROM metrics WHERE machine_id = ?').run(req.params.id);
    return { ok: true };
  });

  app.get('/api/machines/:id/history', async (req) => {
    const since = Date.now() - (parseInt(req.query.hours || '6', 10) * 3600 * 1000);
    return db.prepare(`SELECT ts, cpu, mem_used, mem_total, net_rx, net_tx, temp, power_w, online
      FROM metrics WHERE machine_id = ? AND ts > ? ORDER BY ts`).all(req.params.id, since);
  });

  // ---------- Scan réseau ----------
  app.post('/api/scan', async () => ({ ok: true, hosts: await scanLan(LAN_CIDR) }));

  // Détection des caractéristiques d'une machine avant ajout (hostname, OS, modèle, CPU, RAM, disque…)
  app.post('/api/machines/detect', async (req, reply) => {
    const b = req.body || {};
    if (!b.host || !b.user || !b.password) return reply.code(400).send({ error: 'IP, utilisateur et mot de passe requis' });
    const { detectMachine } = await import('./scanner.js');
    const r = await detectMachine({ host: b.host, port: b.port || 22, user: b.user, password: b.password });
    if (!r.ok) return reply.code(400).send({ error: r.error || 'détection échouée', details: (r.details || '').slice(-300) });
    return { ok: true, specs: r.specs, suggested: r.suggested };
  });

  // Installation de la clé SSH du hub sur une machine cible (une seule fois, via mot de passe)
  app.post('/api/machines/setup-key', async (req, reply) => {
    const b = req.body || {};
    if (!b.host || !b.user || !b.password) return reply.code(400).send({ error: 'host, user, password requis' });
    const r = await setupMachineKey({ host: b.host, port: b.port || 22, user: b.user, password: b.password }, publicKey);
    if (!r.ok) return reply.code(400).send({ error: 'échec installation clé', details: (r.err || '').slice(-300) });
    return { ok: true };
  });

  // ---------- Événements ----------
  app.get('/api/events', async (req) => getEvents(parseInt(req.query.limit || '100', 10)));

  // ---------- Réglages ----------
  app.get('/api/settings', async () => {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'elec_price_per_kwh'").get();
    return { elec_price_per_kwh: parseFloat(row?.value || '0.27') };
  });
  app.put('/api/settings', async (req, reply) => {
    const b = req.body || {};
    if (b.elec_price_per_kwh != null) {
      const v = parseFloat(b.elec_price_per_kwh);
      if (!isFinite(v) || v <= 0 || v > 10) return reply.code(400).send({ error: 'prix invalide (€/kWh)' });
      db.prepare("INSERT INTO settings (key, value) VALUES ('elec_price_per_kwh', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(v));
    }
    return { ok: true };
  });

  // ---------- Énergie : conso kWh + coût (année courante) ----------
  app.get('/api/energy', async () => {
    const price = parseFloat(db.prepare("SELECT value FROM settings WHERE key = 'elec_price_per_kwh'").get()?.value || '0.27');
    const since = Date.now() - 24 * 3600 * 1000;
    const machines = db.prepare('SELECT id, name FROM machines ORDER BY name').all();
    const avgQ = db.prepare('SELECT AVG(power_w) a, COUNT(*) n FROM metrics WHERE machine_id = ? AND online = 1 AND ts > ? AND power_w IS NOT NULL');
    let fleet = 0;
    const perMachine = [];
    for (const m of machines) {
      const r = avgQ.get(m.id, since);
      if (r.n >= 3 && r.a != null) {
        fleet += r.a;
        perMachine.push({ id: m.id, name: m.name, avg_w: +r.a.toFixed(1) });
      }
    }
    const kday = (fleet * 24) / 1000;
    const now = new Date();
    const ytdDays = Math.round((Date.now() - new Date(now.getFullYear(), 0, 1).getTime()) / 86400000);
    const kMonth = kday * 30.44, kYear = kday * 365, kYtd = kday * ytdDays;
    return {
      price_per_kwh: price,
      fleet_avg_w: +fleet.toFixed(1),
      machines: perMachine,
      kwh: { day: +kday.toFixed(2), month: +kMonth.toFixed(1), year: +kYear.toFixed(1), ytd: +kYtd.toFixed(1) },
      cost: {
        day: +(kday * price).toFixed(2),
        month: +(kMonth * price).toFixed(2),
        year: +(kYear * price).toFixed(2),
        ytd: +(kYtd * price).toFixed(2),
      },
      days_ytd: ytdDays,
    };
  });

  // ---------- Calibrage conso ----------
  app.get('/api/machines/:id/calibration', async (req) => {
    const rows = db.prepare(`SELECT cpu, power_real_w, power_source FROM metrics
      WHERE machine_id = ? AND power_real_w IS NOT NULL AND cpu IS NOT NULL AND online = 1 AND ts > ?`)
      .all(req.params.id, Date.now() - 24 * 3600 * 1000);
    const m = db.prepare('SELECT idle_w, max_w, calibrated_at, auto_calib FROM machines WHERE id = ?').get(req.params.id) || {};
    const sources = [...new Set(rows.map((r) => r.power_source).filter(Boolean))];
    return {
      samples: rows.length,
      sources,
      cpu_range: rows.length ? +(Math.max(...rows.map((r) => r.cpu)) - Math.min(...rows.map((r) => r.cpu))).toFixed(1) : 0,
      idle_w: m.idle_w, max_w: m.max_w, calibrated_at: m.calibrated_at || null, auto_calib: m.auto_calib,
    };
  });

  // Installer les règles sudo (RAPL/systemctl) sur une machine existante
  app.post('/api/machines/:id/install-sudoers', async (req, reply) => {
    const m = db.prepare('SELECT * FROM machines WHERE id = ?').get(req.params.id);
    if (!m) return reply.code(404).send({ error: 'machine inconnue' });
    const { installSudoers } = await import('./scanner.js');
    const r = await installSudoers(m);
    if (r.ok) logEvent(m.id, 'info', 'règles sudo installées (RAPL/systemctl)');
    return r;
  });
}
