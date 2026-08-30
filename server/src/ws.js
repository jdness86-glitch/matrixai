import { WebSocketServer } from 'ws';
import { COLLECT_INTERVAL_MS } from './config.js';
import { collectOnce } from './collector.js';
import { db, logEvent } from './db.js';
import { calibrateAll } from './calib.js';

export function startCollector(wss) {
  let running = false;
  const loop = async () => {
    if (running) return;
    running = true;
    const machines = db.prepare('SELECT * FROM machines').all();
    await Promise.all(machines.map(async (m) => {
      const metrics = await collectOnce(m);
      const wasOffline = !db.prepare(
        'SELECT 1 FROM metrics WHERE machine_id = ? AND online = 1 AND ts > ?'
      ).get(m.id, Date.now() - COLLECT_INTERVAL_MS * 3);

      // persistance
      db.prepare(`INSERT INTO metrics (machine_id, ts, cpu, mem_used, mem_total, net_rx, net_tx, temp, load1, disk_used, disk_total, power_w, power_real_w, power_source, online)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        m.id, Date.now(), metrics.cpu ?? null, metrics.mem_used ?? null, metrics.mem_total ?? null,
        metrics.net_rx ?? null, metrics.net_tx ?? null, metrics.temp ?? null, metrics.load?.[0] ?? null,
        metrics.disk_used ?? null, metrics.disk_total ?? null, metrics.power_w ?? null,
        metrics.power_real_w ?? null, metrics.power_source ?? null, metrics.online ? 1 : 0);

      // snapshot des disques (mis à jour seulement si contenu changé)
      if (metrics.disks?.length) {
        const h = JSON.stringify(metrics.disks);
        const prev = db.prepare('SELECT data FROM machine_disks WHERE machine_id = ?').get(m.id);
        if (!prev || prev.data !== h) {
          db.prepare('INSERT INTO machine_disks (machine_id, data, ts) VALUES (?, ?, ?) ON CONFLICT(machine_id) DO UPDATE SET data = excluded.data, ts = excluded.ts')
            .run(m.id, h, Date.now());
        }
      }

      // purge historique brut > 24h (1 fois sur 50)
      if (Math.random() < 0.02) {
        db.prepare('DELETE FROM metrics WHERE ts < ?').run(Date.now() - 24 * 3600 * 1000);
      }

      if (wasOffline && metrics.online) logEvent(m.id, 'info', `${m.name} en ligne`);
      if (!metrics.online && !wasOffline) logEvent(m.id, 'warn', `${m.name} hors ligne : ${metrics.error || 'inconnu'}`);

      broadcast(wss, { type: 'metrics', machine: { id: m.id, name: m.name, idle_w: m.idle_w, max_w: m.max_w }, metrics, bots: metrics.bots || [] });
    })).finally(() => { running = false; });
  };
  loop();
  // auto-calibrage toutes les 5 min (régression conso réelle vs CPU)
  const calibTimer = setInterval(() => { try { calibrateAll(); } catch (e) { console.error('[calib]', e.message); } }, 5 * 60 * 1000);
  return { metrics: setInterval(loop, COLLECT_INTERVAL_MS), calib: calibTimer };
}

export function broadcast(wss, obj) {
  const data = JSON.stringify(obj);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(data);
  }
}
