import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const requireServer = createRequire(new URL('../server/package.json', import.meta.url));

const checks = [];
const check = (name, ok, detail = '') => checks.push({ name, ok, detail });
const major = Number(process.versions.node.split('.')[0]);
check('Node.js >= 22', major >= 22, process.version);
for (const command of ['ssh-keygen', 'ping', 'getent']) {
  try { execFileSync('sh', ['-c', `command -v ${command}`], { stdio: 'ignore' }); check(command, true); }
  catch { check(command, false, 'commande absente'); }
}
try { requireServer('better-sqlite3'); check('better-sqlite3', true); }
catch (e) { check('better-sqlite3', false, e.message); }
const dist = process.env.MATRIXAI_WEB_DIST || new URL('../web/dist/index.html', import.meta.url).pathname;
check('frontend construit', fs.existsSync(dist.endsWith('index.html') ? dist : `${dist}/index.html`), dist);
const data = process.env.MATRIXAI_DATA_DIR || new URL('../server/data', import.meta.url).pathname;
try { fs.mkdirSync(data, { recursive: true }); fs.accessSync(data, fs.constants.W_OK); check('répertoire de données accessible', true, data); }
catch (e) { check('répertoire de données accessible', false, e.message); }

for (const c of checks) console.log(`${c.ok ? '✓' : '✗'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
if (checks.some((c) => !c.ok)) process.exitCode = 1;
