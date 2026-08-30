import { exec as execCP } from 'node:child_process';
import net from 'node:net';
import { promisify } from 'node:util';
import dns from 'node:dns';

const execP = promisify(execCP);

// Scan LAN : ping sweep -> table voisins -> détection SSH (port 22) + mDNS
export async function scanLan(cidr = '192.168.1.0/24') {
  const base = cidr.replace(/\.\d+\/\d+$/, '');
  const ips = [];
  for (let i = 1; i < 255; i++) ips.push(`${base}.${i}`);

  // 1. Ping sweep en parallèle (par lots)
  const alive = new Set();
  const batch = (arr, size, fn) => Promise.all(
    Array.from({ length: Math.ceil(arr.length / size) }, (_, g) =>
      Promise.all(arr.slice(g * size, g * size + size).map(fn)))
  );
  await batch(ips, 60, async (ip) => {
    try {
      await execP(`ping -c1 -W1 ${ip}`, { timeout: 2500 });
      alive.add(ip);
    } catch {}
  });

  // 2. Détection port SSH + résolution mDNS sur les hôtes vivants
  const results = await Promise.all([...alive].map(async (ip) => {
    const ssh = await checkPort(ip, 22);
    let hostname = null;
    try {
      const r = await execP(`getent hosts ${ip} | awk '{print $2}'`, { timeout: 1500 });
      hostname = r.stdout.trim() || null;
    } catch {}
    if (!hostname) {
      try {
        const names = await dns.reverse(ip).catch(() => []);
        hostname = names[0] || null;
      } catch {}
    }
    return { ip, ssh_open: ssh, hostname };
  }));

  return results.sort((a, b) => a.ip.localeCompare(b.ip, undefined, { numeric: true }));
}

function checkPort(ip, port, timeout = 1200) {
  return new Promise((resolve) => {
    const s = net.connect({ host: ip, port, timeout });
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('error', () => resolve(false));
    s.on('timeout', () => { s.destroy(); resolve(false); });
  });
}

// Setup initial d'une machine : installer notre clé SSH + règles sudo (RAPL/systemctl)
export async function setupMachineKey({ host, port, user, password, sudo_password }, publicKey) {
  const { execOnce } = await import('./ssh.js');
  const sudoersLine = `${user} ALL=(ALL) NOPASSWD: /usr/bin/systemctl, /usr/bin/docker, /usr/bin/cat /sys/class/powercap/intel-rapl*, /usr/bin/cat /sys/class/powercap/amd-rapl*`;
  const sq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
  const cmd = `
mkdir -p ~/.ssh && chmod 700 ~/.ssh
touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys
grep -qF ${sq(publicKey.trim())} ~/.ssh/authorized_keys || echo ${sq(publicKey.trim())} >> ~/.ssh/authorized_keys
echo ${sq(sudo_password || password || '')} | sudo -S sh -c "echo ${sq(sudoersLine)} > /etc/sudoers.d/matrixai && chmod 440 /etc/sudoers.d/matrixai" 2>/dev/null && echo SUDOERS_OK
echo KEY_INSTALLED`;
  const r = await execOnce({ host, port: port || 22, user, password }, cmd, 25000);
  return { ...r, ok: r.ok && (r.out || '').includes('KEY_INSTALLED'), sudoers: (r.out || '').includes('SUDOERS_OK') };
}

// Détection des caractéristiques d'une machine avant son ajout à la flotte
// (hostname, OS, modèle matériel, CPU, RAM, disque, docker/systemd...) via SSH.
const DETECT_SCRIPT = `
echo "hostname $(hostname)"
[ -f /etc/os-release ] && . /etc/os-release && echo "os $PRETTY_NAME"
echo "kernel $(uname -r)"
echo "arch $(uname -m)"
model=$(tr -d '\\0' < /proc/device-tree/model 2>/dev/null)
[ -z "$model" ] && model=$(cat /sys/class/dmi/id/product_name 2>/dev/null)
[ -n "$model" ] && echo "model $model"
echo "cpucount $(nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo)"
cpumodel=$(grep -m1 '^model name' /proc/cpuinfo 2>/dev/null | cut -d: -f2 | sed 's/^ *//')
[ -z "$cpumodel" ] && cpumodel=$(lscpu 2>/dev/null | awk -F: '/Model name/{print $2}' | sed 's/^ *//')
[ -n "$cpumodel" ] && echo "cpumodel $cpumodel"
awk '/^MemTotal/{print "memtotal", $2}' /proc/meminfo 2>/dev/null
df -lkP / 2>/dev/null | awk 'NR==2{print "disktotal", $2}'
echo "uptime $(cut -d' ' -f1 /proc/uptime 2>/dev/null)"
command -v docker >/dev/null 2>&1 && echo "docker yes" || echo "docker no"
command -v systemctl >/dev/null 2>&1 && echo "systemd yes" || echo "systemd no"
virt=$(systemd-detect-virt 2>/dev/null)
[ -n "$virt" ] && [ "$virt" != "none" ] && echo "virt $virt"
`;

export function parseDetectOutput(out) {
  const specs = {};
  for (const line of (out || '').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const sp = t.indexOf(' ');
    if (sp === -1) continue;
    const key = t.slice(0, sp);
    const val = t.slice(sp + 1).trim();
    switch (key) {
      case 'hostname': specs.hostname = val; break;
      case 'os': specs.os = val; break;
      case 'kernel': specs.kernel = val; break;
      case 'arch': specs.arch = val; break;
      case 'model': specs.model = val; break;
      case 'cpucount': specs.cpu_count = parseInt(val, 10) || null; break;
      case 'cpumodel': specs.cpu_model = val; break;
      case 'memtotal': specs.mem_total_bytes = (parseInt(val, 10) || 0) * 1024; break;
      case 'disktotal': specs.disk_total_bytes = (parseInt(val, 10) || 0) * 1024; break;
      case 'uptime': specs.uptime_s = parseFloat(val) || null; break;
      case 'docker': specs.has_docker = val === 'yes'; break;
      case 'systemd': specs.has_systemd = val === 'yes'; break;
      case 'virt': specs.virt = val; break;
      default: break;
    }
  }
  return specs;
}

// Estimation idle/max (W) d'après le modèle matériel/CPU détecté (valeurs indicatives).
const WATT_PRESETS = [
  { re: /raspberry pi 5/i, idle: 3, max: 12 },
  { re: /raspberry pi 4/i, idle: 2.5, max: 8 },
  { re: /raspberry pi 3/i, idle: 1.7, max: 6 },
  { re: /raspberry pi zero/i, idle: 0.5, max: 2 },
  { re: /raspberry pi/i, idle: 2, max: 8 },
  { re: /nuc/i, idle: 6, max: 35 },
  { re: /macbook/i, idle: 4, max: 45 },
  { re: /thinkpad|latitude|elitebook|probook|inspiron|vivobook|zenbook|pavilion|ideapad|surface/i, idle: 6, max: 55 },
  { re: /optiplex|thinkcentre|elitedesk|prodesk/i, idle: 12, max: 65 },
];
export function suggestWatts(specs) {
  const label = `${specs.model || ''} ${specs.cpu_model || ''}`;
  for (const p of WATT_PRESETS) if (p.re.test(label)) return { idle_w: p.idle, max_w: p.max };
  if (specs.virt && specs.virt !== 'none') return { idle_w: 2, max_w: 10 };
  return { idle_w: 5, max_w: 60 };
}

export async function detectMachine({ host, port, user, password }) {
  const { execOnce } = await import('./ssh.js');
  const r = await execOnce({ host, port: port || 22, user, password }, DETECT_SCRIPT, 12000);
  if (!r.ok) return { ok: false, error: r.error || 'connexion SSH impossible' };
  const specs = parseDetectOutput(r.out);
  if (!specs.hostname) return { ok: false, error: 'connexion établie mais aucune réponse exploitable', details: (r.err || '').slice(-300) };
  return { ok: true, specs, suggested: suggestWatts(specs) };
}

// Installe les règles sudo sur une machine déjà enregistrée (via sa clé SSH + sudo_password stocké)
export async function installSudoers(machine) {
  const { exec } = await import('./ssh.js');
  const { decrypt } = await import('./config.js');
  const sudoersLine = `${machine.user} ALL=(ALL) NOPASSWD: /usr/bin/systemctl, /usr/bin/docker, /usr/bin/cat /sys/class/powercap/intel-rapl*, /usr/bin/cat /sys/class/powercap/amd-rapl*`;
  const sq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
  const pass = decrypt(machine.sudo_password) || '';
  const cmd = `echo ${sq(pass)} | sudo -S sh -c "echo ${sq(sudoersLine)} > /etc/sudoers.d/fleetdash && chmod 440 /etc/sudoers.d/fleetdash" 2>/dev/null; echo FLEETDASH_SUDOERS_DONE`;
  const r = await exec(machine, cmd, 15000);
  return { ok: r.ok && (r.out || '').includes('FLEETDASH_SUDOERS_DONE'), out: ((r.out || '') + (r.err || '')).slice(-200) };
}

