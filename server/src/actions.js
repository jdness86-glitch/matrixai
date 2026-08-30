import { exec } from './ssh.js';

const shQuote = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;

export async function listDocker(machine) {
  const r = await exec(machine, "docker ps -a --format '{{json .}}'", 12000);
  if (!r.ok) return { ok: false, error: r.error, containers: [] };
  const containers = r.out.trim().split('\n').filter(Boolean).map((l) => {
    try { const j = JSON.parse(l); return { id: j.ID, name: j.Names, image: j.Image, state: j.State, status: j.Status }; }
    catch { return null; }
  }).filter(Boolean);
  return { ok: true, containers };
}

export async function dockerStats(machine) {
  const r = await exec(machine, "docker stats --no-stream --format '{{json .}}'", 20000);
  if (!r.ok) return {};
  const stats = {};
  for (const l of r.out.trim().split('\n').filter(Boolean)) {
    try { const j = JSON.parse(l); stats[j.Name || j.Container] = { cpu: j.CPUPerc, mem: j.MemUsage, memPerc: j.MemPerc, net: j.NetIO }; } catch {}
  }
  return stats;
}

export async function listServices(machine) {
  const r = await exec(machine, "systemctl list-units --type=service --all --no-pager --no-legend | awk '{print $1, $3, $4, $5}'", 12000);
  if (!r.ok) return { ok: false, error: r.error, services: [] };
  const services = r.out.trim().split('\n').filter(Boolean).map((l) => {
    const p = l.trim().split(/\s+/);
    return { unit: p[0], state: p[1], sub: p[2], description: p.slice(3).join(' ') };
  });
  return { ok: true, services };
}

export function dockerAction(machine, container, action) {
  if (!['start', 'stop', 'restart'].includes(action)) return Promise.resolve({ ok: false, error: 'action invalide' });
  return exec(machine, `docker ${action} ${shQuote(container)}`, 30000);
}

export function serviceAction(machine, unit, action, sudoPassword) {
  if (!['start', 'stop', 'restart', 'status'].includes(action)) return Promise.resolve({ ok: false, error: 'action invalide' });
  const cmd = action === 'status'
    ? `systemctl status ${shQuote(unit)} --no-pager -l | head -30`
    : `echo ${shQuote(sudoPassword || '')} | sudo -S systemctl ${action} ${shQuote(unit)} 2>&1`;
  return exec(machine, cmd, 30000);
}

export function powerAction(machine, action, sudoPassword) {
  if (!['reboot', 'poweroff'].includes(action)) return Promise.resolve({ ok: false, error: 'action invalide' });
  const cmd = `echo ${shQuote(sudoPassword || '')} | sudo -S systemctl ${action} 2>&1`;
  return exec(machine, cmd, 15000);
}

export async function dockerLogs(machine, container, lines = 100) {
  const r = await exec(machine, `docker logs --tail ${parseInt(lines, 10) || 100} ${shQuote(container)} 2>&1`, 15000);
  return { ok: r.ok, logs: r.ok ? r.out : r.error };
}

export async function serviceStatus(machine, unit) {
  const r = await exec(machine, `systemctl status ${shQuote(unit)} --no-pager -l | head -30`, 10000);
  return { ok: r.ok, status: r.ok ? r.out : r.error };
}

export async function botAction(machine, botType, identifier, action, sudoPassword) {
  if (!['service', 'docker', 'pm2', 'proc'].includes(botType)) return { ok: false, error: 'type de bot inconnu' };
  if (!['start', 'stop', 'restart', 'status'].includes(action)) return { ok: false, error: 'action invalide' };

  if (botType === 'service') {
    const out = action === 'status'
      ? await exec(machine, `systemctl status ${shQuote(identifier)} --no-pager -l | head -30`, 10000)
      : await exec(machine, `echo ${shQuote(sudoPassword || '')} | sudo -S systemctl ${action} ${shQuote(identifier)} 2>&1`, 30000);
    return { ok: out.ok, output: out.ok ? (out.out || 'ok') : (out.error || out.err || 'échec') };
  }

  if (botType === 'docker') {
    if (action === 'status') {
      const r = await exec(machine, `docker ps -a --filter name=${shQuote(identifier)} --format '{{.Names}} {{.State}} {{.Status}}'`, 10000);
      return { ok: r.ok, output: r.ok ? r.out : (r.error || r.err || 'échec') };
    }
    const out = await exec(machine, `docker ${action} ${shQuote(identifier)} 2>&1`, 30000);
    return { ok: out.ok, output: out.ok ? (out.out || 'ok') : (out.error || out.err || 'échec') };
  }

  if (botType === 'pm2') {
    if (action === 'status') {
      const r = await exec(machine, `pm2 describe ${shQuote(identifier)} 2>&1`, 10000);
      return { ok: r.ok, output: r.ok ? r.out : (r.error || r.err || 'échec') };
    }
    const out = await exec(machine, `pm2 ${action} ${shQuote(identifier)} 2>&1`, 30000);
    return { ok: out.ok, output: out.ok ? (out.out || 'ok') : (out.error || out.err || 'échec') };
  }

  if (botType === 'proc') {
    // processus brut (pas de gestionnaire) : seuls stop (kill) et status sont possibles
    if (action === 'status') {
      const r = await exec(machine, `ps -p ${shQuote(identifier)} -o pid,etime,cmd --no-headers 2>&1`, 10000);
      return { ok: r.ok, output: r.ok ? (r.out || 'processus introuvable (déjà arrêté)') : (r.error || r.err || 'échec') };
    }
    if (action === 'stop') {
      const out = await exec(machine, `kill ${shQuote(identifier)} 2>&1`, 10000);
      return { ok: out.ok, output: out.ok ? 'signal d\u2019arrêt envoyé' : (out.error || out.err || 'échec') };
    }
    return { ok: false, error: 'processus brut : seuls « stop » et « status » sont supportés (pas de commande de démarrage connue)' };
  }
}
