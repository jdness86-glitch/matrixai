import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(__dirname, '..');
export const WEB_DIST = path.resolve(process.env.MATRIXAI_WEB_DIST || path.join(ROOT, '..', 'web', 'dist'));
export const DATA_DIR = path.resolve(process.env.MATRIXAI_DATA_DIR || path.join(ROOT, 'data'));
export const KEY_DIR = path.join(DATA_DIR, 'keys');
export const DB_FILE = path.resolve(process.env.MATRIXAI_DB_FILE || path.join(DATA_DIR, 'fleetdash.db'));
export const PORT = Number.parseInt(process.env.PORT || '3000', 10);
export const HOST = process.env.HOST || '0.0.0.0';
export const TRUST_PROXY = process.env.MATRIXAI_TRUST_PROXY === '1';
export const COLLECT_INTERVAL_MS = Math.max(2000, Number.parseInt(process.env.COLLECT_INTERVAL_MS || '5000', 10));
export const HISTORY_RAW_HOURS = Math.max(1, Number.parseInt(process.env.HISTORY_RAW_HOURS || '24', 10));
export const LAN_CIDR = process.env.MATRIXAI_LAN || process.env.FLEETDASH_LAN || '192.168.1.0/24';
export const ENABLE_REMOTE_EXEC = process.env.MATRIXAI_ENABLE_REMOTE_EXEC === '1';

fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
try { fs.chmodSync(DATA_DIR, 0o700); } catch {}

const secretPath = path.join(DATA_DIR, '.secret');
const legacyDbExists = fs.existsSync(DB_FILE);
let generatedSecret = null;

function loadOrCreateSecret() {
  if (process.env.MATRIXAI_SECRET || process.env.FLEETDASH_SECRET) {
    return process.env.MATRIXAI_SECRET || process.env.FLEETDASH_SECRET;
  }
  if (fs.existsSync(secretPath)) return fs.readFileSync(secretPath, 'utf8').trim();
  if (legacyDbExists) {
    throw new Error(`Base existante sans secret de chiffrement. Définissez MATRIXAI_SECRET ou restaurez ${secretPath}.`);
  }
  generatedSecret = crypto.randomBytes(48).toString('base64url');
  fs.writeFileSync(secretPath, `${generatedSecret}\n`, { mode: 0o600, flag: 'wx' });
  return generatedSecret;
}

const SECRET = loadOrCreateSecret();
export const getSecretKey = () => SECRET;

export function encrypt(plain) {
  if (!plain) return '';
  const key = crypto.createHash('sha256').update(SECRET).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join('.');
}

export function decrypt(payload) {
  if (!payload) return '';
  try {
    const parts = String(payload).split('.');
    const versioned = parts[0] === 'v1';
    const [ivB64, tagB64, dataB64] = versioned ? parts.slice(1) : parts;
    const key = crypto.createHash('sha256').update(SECRET).digest();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

export const DEFAULT_USER = process.env.MATRIXAI_ADMIN_USER || process.env.FLEETDASH_USER || 'admin';
export const DEFAULT_PASSWORD = process.env.MATRIXAI_ADMIN_PASSWORD || process.env.FLEETDASH_PASSWORD || null;
export const GENERATED_SECRET = generatedSecret;
