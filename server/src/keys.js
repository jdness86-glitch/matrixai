import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { KEY_DIR } from './config.js';

fs.mkdirSync(KEY_DIR, { recursive: true, mode: 0o700 });
try { fs.chmodSync(KEY_DIR, 0o700); } catch {}

const privKeyPath = `${KEY_DIR}/fleetdash_ed25519`;
const pubKeyPath = `${privKeyPath}.pub`;

if (!fs.existsSync(privKeyPath)) {
  execFileSync('ssh-keygen', ['-t', 'ed25519', '-N', '', '-f', privKeyPath, '-q'], { stdio: 'inherit' });
  console.log('[keys] paire SSH générée :', pubKeyPath);
}

export const publicKey = fs.existsSync(pubKeyPath) ? fs.readFileSync(pubKeyPath, 'utf8') : '';
export const privateKeyPath = privKeyPath;
