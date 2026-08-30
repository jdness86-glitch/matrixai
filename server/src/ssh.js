import { Client } from 'ssh2';
import fs from 'node:fs';
import { decrypt } from './config.js';

const sessions = new Map(); // machine_id -> { client, ready, lastError }

export function getConnection(machine) {
  let entry = sessions.get(machine.id);
  if (entry && entry.ready) return entry;
  if (entry && entry.connecting) return entry;
  if (entry) { try { entry.client.end(); } catch {} }

  const client = new Client();
  entry = { client, ready: false, connecting: true, lastError: null };
  sessions.set(machine.id, entry);

  const cfg = {
    host: machine.host,
    port: machine.port || 22,
    username: machine.user,
    readyTimeout: 8000,
    keepaliveInterval: 15000,
  };
  if (machine.auth_type === 'key' && machine.key_path && fs.existsSync(machine.key_path)) {
    cfg.privateKey = fs.readFileSync(machine.key_path);
  } else {
    cfg.password = decrypt(machine.password);
  }

  client.on('ready', () => { entry.ready = true; entry.connecting = false; entry.lastError = null; });
  client.on('error', (err) => { entry.ready = false; entry.connecting = false; entry.lastError = err.message; });
  client.on('close', () => { entry.ready = false; entry.connecting = false; });
  client.connect(cfg);
  return entry;
}

export function exec(machine, command, timeoutMs = 10000) {
  return new Promise((resolve) => {
    let entry;
    try { entry = getConnection(machine); } catch (e) {
      return resolve({ ok: false, error: e.message });
    }
    if (!entry.ready) {
      // attend brièvement la connexion
      const t0 = Date.now();
      const wait = setInterval(() => {
        if (entry.ready) { clearInterval(wait); run(); }
        else if (Date.now() - t0 > 9000) { clearInterval(wait); resolve({ ok: false, error: entry.lastError || 'SSH non connecté' }); }
      }, 100);
      return;
    }
    run();

    function run() {
      let done = false;
      const timer = setTimeout(() => { if (!done) { done = true; resolve({ ok: false, error: 'timeout' }); } }, timeoutMs);
      entry.client.exec(command, (err, stream) => {
        if (err) { clearTimeout(timer); if (!done) { done = true; resolve({ ok: false, error: err.message }); } return; }
        let out = '', errOut = '';
        stream.on('data', (d) => { out += d.toString(); });
        stream.stderr.on('data', (d) => { errOut += d.toString(); });
        stream.on('close', (code) => {
          clearTimeout(timer);
          if (!done) { done = true; resolve({ ok: code === 0, out, err: errOut, code, error: code === 0 ? null : `commande distante terminée avec le code ${code}` }); }
        });
      });
    }
  });
}

// Exécution d'une commande longue durée (ex: journalctl -f) avec diffusion progressive
// des données via callbacks. Retourne un contrôleur { stop() } pour couper le flux.
export function execStream(machine, command, { onData, onError, onEnd } = {}) {
  let stopped = false;
  let activeStream = null;
  const t0 = Date.now();

  const tryStart = () => {
    if (stopped) return;
    let entry;
    try { entry = getConnection(machine); } catch (e) { onError && onError(e.message); return; }
    if (!entry.ready) {
      if (Date.now() - t0 > 10000) { onError && onError(entry.lastError || 'SSH non connecté'); return; }
      setTimeout(tryStart, 200);
      return;
    }
    entry.client.exec(command, (err, stream) => {
      if (stopped) { try { stream && stream.close(); } catch {} return; }
      if (err) { onError && onError(err.message); return; }
      activeStream = stream;
      stream.on('data', (d) => onData && onData(d.toString()));
      stream.stderr.on('data', (d) => onData && onData(d.toString()));
      stream.on('close', () => { if (!stopped) onEnd && onEnd(); });
    });
  };
  tryStart();

  return {
    stop() {
      stopped = true;
      try { activeStream && activeStream.close(); } catch {}
    },
  };
}

// Connexion SSH ponctuelle (identifiants fournis directement, non stockés) : utilisée
// pour tester/détecter une machine avant son ajout à la flotte.
export function execOnce({ host, port = 22, user, password, privateKey }, command, timeoutMs = 12000) {
  return new Promise((resolve) => {
    const client = new Client();
    let done = false;
    let out = '', err = '';
    const finish = (result) => {
      if (done) return;
      done = true;
      try { client.end(); } catch {}
      resolve(result);
    };
    const timer = setTimeout(() => finish({ ok: false, error: 'timeout de connexion' }), timeoutMs);
    client.on('ready', () => {
      client.exec(command, (execErr, stream) => {
        if (execErr) { clearTimeout(timer); return finish({ ok: false, error: execErr.message }); }
        stream.on('data', (d) => { out += d.toString(); });
        stream.stderr.on('data', (d) => { err += d.toString(); });
        stream.on('close', (code) => { clearTimeout(timer); finish({ ok: true, out, err, code }); });
      });
    });
    client.on('error', (e) => { clearTimeout(timer); finish({ ok: false, error: e.message }); });
    try {
      const cfg = { host, port, username: user, readyTimeout: 8000 };
      if (privateKey) cfg.privateKey = privateKey; else cfg.password = password;
      client.connect(cfg);
    } catch (e) {
      clearTimeout(timer);
      finish({ ok: false, error: e.message });
    }
  });
}

export function closeAll() {
  for (const [, e] of sessions) { try { e.client.end(); } catch {} }
  sessions.clear();
}
