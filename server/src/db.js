import Database from 'better-sqlite3';
import fs from 'node:fs';
import { DB_FILE, DATA_DIR, DEFAULT_USER, DEFAULT_PASSWORD } from './config.js';
import crypto from 'node:crypto';

fs.mkdirSync(DATA_DIR, { recursive: true });
export const db = new Database(DB_FILE);
try { fs.chmodSync(DB_FILE, 0o600); } catch {}
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

db.exec(`
CREATE TABLE IF NOT EXISTS machines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  host TEXT NOT NULL,
  port INTEGER NOT NULL DEFAULT 22,
  user TEXT NOT NULL,
  auth_type TEXT NOT NULL DEFAULT 'password', -- password | key
  password TEXT,                              -- chiffré
  sudo_password TEXT,                         -- chiffré
  key_path TEXT,
  idle_w REAL NOT NULL DEFAULT 5,
  max_w REAL NOT NULL DEFAULT 60,
  smartplug_url TEXT,                         -- optionnel : URL locale d'une prise Shelly
  tags TEXT DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  machine_id INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  cpu REAL, mem_used REAL, mem_total REAL,
  net_rx REAL, net_tx REAL,                 -- octets/s
  temp REAL, load1 REAL,
  disk_used REAL, disk_total REAL,
  power_w REAL,
  online INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_metrics_machine_ts ON metrics(machine_id, ts);
CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL DEFAULT (unixepoch()),
  machine_id INTEGER,
  level TEXT NOT NULL,                       -- info | warn | error
  message TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS machine_disks (
  machine_id INTEGER PRIMARY KEY,
  data TEXT NOT NULL,
  ts INTEGER NOT NULL
);
`);

// Migrations (colonnes ajoutées après coup)
const addCol = (t, c, d) => { try { db.prepare(`ALTER TABLE ${t} ADD COLUMN ${c} ${d}`).run(); } catch {} };
addCol('metrics', 'power_real_w', 'REAL');     // conso réelle observée (W)
addCol('metrics', 'power_source', 'TEXT');     // plug | battery | rapl
addCol('machines', 'auto_calib', 'INTEGER NOT NULL DEFAULT 1');
addCol('machines', 'calibrated_at', 'INTEGER');
addCol('machines', 'model', 'TEXT'); // modèle matériel détecté à l'ajout (ex: « Raspberry Pi 5 Model B »)

// Valeurs par défaut des réglages (prix de l'électricité en €/kWh, France)
db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run('elec_price_per_kwh', '0.27');


const legacyHash = (s) => crypto.createHash('sha256').update(`fleetdash:${s}`).digest('hex');
const passwordHash = (password) => {
  const salt = crypto.randomBytes(16).toString('base64url');
  const derived = crypto.scryptSync(String(password), salt, 64).toString('base64url');
  return `scrypt$${salt}$${derived}`;
};
const passwordMatches = (stored, password) => {
  if (!stored) return false;
  if (!stored.startsWith('scrypt$')) return stored === legacyHash(password);
  const [, salt, expected] = stored.split('$');
  const actual = crypto.scryptSync(String(password), salt, 64);
  const expectedBuffer = Buffer.from(expected, 'base64url');
  return actual.length === expectedBuffer.length && crypto.timingSafeEqual(actual, expectedBuffer);
};

const userCount = db.prepare('SELECT COUNT(*) c FROM users').get().c;
if (userCount === 0) {
  const bootstrapPassword = DEFAULT_PASSWORD || crypto.randomBytes(12).toString('base64url');
  db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(DEFAULT_USER, passwordHash(bootstrapPassword));
  const bootstrapFile = `${DATA_DIR}/bootstrap-credentials.txt`;
  fs.writeFileSync(bootstrapFile, `Utilisateur: ${DEFAULT_USER}\nMot de passe: ${bootstrapPassword}\nSupprimez ce fichier après la première connexion.\n`, { mode: 0o600 });
  console.log(`[db] compte administrateur créé. Identifiants initiaux : ${bootstrapFile}`);
}

export const verifyPassword = (username, password) => {
  const row = db.prepare('SELECT password_hash FROM users WHERE username = ?').get(username);
  if (!row || !passwordMatches(row.password_hash, password)) return false;
  if (!row.password_hash.startsWith('scrypt$')) {
    db.prepare('UPDATE users SET password_hash = ? WHERE username = ?').run(passwordHash(password), username);
  }
  return true;
};
export const changePassword = (username, newPassword) => {
  db.prepare('UPDATE users SET password_hash = ? WHERE username = ?').run(passwordHash(newPassword), username);
};
export const logEvent = (machine_id, level, message) => {
  db.prepare('INSERT INTO events (machine_id, level, message) VALUES (?, ?, ?)').run(machine_id, level, message);
};
export const getEvents = (limit = 100) =>
  db.prepare('SELECT e.*, m.name as machine FROM events e LEFT JOIN machines m ON m.id = e.machine_id ORDER BY e.id DESC LIMIT ?').all(limit);
