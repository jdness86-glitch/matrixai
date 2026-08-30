import { db, logEvent } from './db.js';

// Auto-calibrage : régression linéaire conso réelle = a + b × cpu%
// → recalcule idle_w (=a) et max_w (=a + 100·b) de chaque machine.
export function calibrateAll() {
  const machines = db.prepare('SELECT * FROM machines WHERE auto_calib = 1').all();
  let updated = 0;
  for (const m of machines) {
    const rows = db.prepare(`SELECT cpu, power_real_w, power_source FROM metrics
      WHERE machine_id = ? AND power_real_w IS NOT NULL AND cpu IS NOT NULL AND online = 1 AND ts > ?`)
      .all(m.id, Date.now() - 24 * 3600 * 1000);
    if (rows.length < 30) continue; // pas assez d'échantillons

    const cpus = rows.map((r) => r.cpu);
    const range = Math.max(...cpus) - Math.min(...cpus);
    if (range < 15) continue; // il faut de la variance de charge pour caler la pente

    const n = rows.length;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const r of rows) { sx += r.cpu; sy += r.power_real_w; sxx += r.cpu * r.cpu; sxy += r.cpu * r.power_real_w; }
    const denom = n * sxx - sx * sx;
    if (denom <= 0) continue;
    const b = (n * sxy - sx * sy) / denom;       // W par % CPU
    const a = (sy - b * sx) / n;                  // conso au repos
    if (!isFinite(a) || !isFinite(b) || b < 0) continue;

    const idle = Math.max(0.5, Math.round(a * 10) / 10);
    const max = Math.min(500, Math.max(idle + 1, Math.round((a + 100 * b) * 10) / 10));

    // ne mettre à jour (et logger) que si changement significatif
    if (Math.abs(idle - m.idle_w) / m.idle_w < 0.05 && Math.abs(max - m.max_w) / m.max_w < 0.05) continue;

    db.prepare('UPDATE machines SET idle_w = ?, max_w = ?, calibrated_at = ? WHERE id = ?')
      .run(idle, max, Date.now(), m.id);
    const source = rows[rows.length - 1].power_source || 'inconnue';
    logEvent(m.id, 'info', `auto-calibrage (${source}) : modèle conso ajusté à ${idle}–${max} W sur ${n} mesures réelles`);
    updated++;
  }
  return updated;
}
