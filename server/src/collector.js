import { exec } from './ssh.js';

// Script exécuté à distance : lignes "clé valeur(s)" facilement parsables.
const METRICS_SCRIPT = `
echo "host $(hostname)"
[ -f /etc/os-release ] && . /etc/os-release && echo "os $PRETTY_NAME"
echo "uptime $(cut -d' ' -f1 /proc/uptime)"
echo "load $(cut -d' ' -f1-3 /proc/loadavg)"
r1=$(sudo -n cat /sys/class/powercap/intel-rapl:0/energy_uj 2>/dev/null || cat /sys/class/powercap/intel-rapl:0/energy_uj 2>/dev/null)
rmax=$(cat /sys/class/powercap/intel-rapl:0/max_energy_range_uj 2>/dev/null)
[ -n "$rmax" ] || rmax=0
d1=$(sudo -n cat /sys/class/powercap/intel-rapl:0:0/energy_uj 2>/dev/null || cat /sys/class/powercap/intel-rapl:0:0/energy_uj 2>/dev/null)
a=$(grep '^cpu ' /proc/stat | awk '{print $2+$3+$4+$6+$7+$8, $2+$3+$4+$5+$6+$7+$8}')
sleep 0.4
b=$(grep '^cpu ' /proc/stat | awk '{print $2+$3+$4+$6+$7+$8, $2+$3+$4+$5+$6+$7+$8}')
r2=$(sudo -n cat /sys/class/powercap/intel-rapl:0/energy_uj 2>/dev/null || cat /sys/class/powercap/intel-rapl:0/energy_uj 2>/dev/null)
d2=$(sudo -n cat /sys/class/powercap/intel-rapl:0:0/energy_uj 2>/dev/null || cat /sys/class/powercap/intel-rapl:0:0/energy_uj 2>/dev/null)
if [ -n "$d1" ] && [ -n "$d2" ]; then r1=$((r1 + d1)); r2=$((r2 + d2)); fi
[ -n "$r1" ] && [ -n "$r2" ] && echo "rapl $r1 $r2 $rmax"
echo "cpu $a $b"
awk '/^MemTotal/{t=$2}/^MemAvailable/{a=$2}END{print "mem", t, a}' /proc/meminfo
echo "diskroot $(df -lkP | awk '$6=="/" && $1!~/:/ {print $2, $3; exit}')"
if command -v findmnt >/dev/null 2>&1; then
  findmnt -b -e -rn -o TARGET,SOURCE,FSTYPE,SIZE,USED,AVAIL 2>/dev/null | \
    awk '$3 ~ /^(ext[234]|btrfs|xfs|f2fs|vfat|exfat|ntfs|ntfs3|zfs|reiserfs|jfs|hfsplus)$/ {print "dfs", $1, $2, $3, $4, $5, $6}'
fi
cat /proc/net/dev | awk 'NR>2 && $1!~/lo:/ {gsub(":","",$1); print "net", $1, $2, $10}'
t=$(cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null); [ -n "$t" ] && echo "temp $t"
batst=$(cat /sys/class/power_supply/BAT*/status 2>/dev/null | head -1)
[ "$batst" = "Discharging" ] && {
  bp=$(cat /sys/class/power_supply/BAT*/power_now 2>/dev/null | head -1)
  if [ -z "$bp" ]; then
    bc=$(cat /sys/class/power_supply/BAT*/current_now 2>/dev/null | head -1)
    bv=$(cat /sys/class/power_supply/BAT*/voltage_now 2>/dev/null | head -1)
    [ -n "$bc" ] && [ -n "$bv" ] && bp=$(( bc * bv / 1000000 ))
  fi
  [ -n "$bp" ] && echo "bat $bp"
}
command -v docker >/dev/null 2>&1 && echo "docker yes" || echo "docker no"
command -v systemctl >/dev/null 2>&1 && echo "systemd yes" || echo "systemd no"
`;

// On ne cible QUE les bots Telegram (le mot-clé « bot » seul est trop générique et
// remonte des faux positifs : reboot, robot, sabotage, etc.)
const BOT_SCAN_SCRIPT = `
echo "bots_start"
systemctl list-units --type=service --all --no-pager --no-legend 2>/dev/null | awk 'tolower($0) ~ /telegram/ {print "svc", $1, $3, $4}'
docker ps -a --format '{{.Names}} {{.State}} {{.Status}}' 2>/dev/null | awk 'tolower($0) ~ /telegram/ {print "docker", $1, $2, $3}'
pm2 jlist 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin) if sys.stdin.read(1) else []; print(''.join([f\"pm2 {p['name']} {p['pm2_env']['status']}\n\" for p in d if 'telegram' in p['name'].lower()]))" 2>/dev/null
ps -eo pid,args --no-headers 2>/dev/null | awk 'tolower($0) ~ /telegram/ && tolower($0) !~ /vitest|jest|mocha|eslint|tsserver|language-server|ts-node|playwright|webpack|biome|prettier|zed\\/external_agents|grep /{ pid=$1; cmd=$0; sub(/^[ \t]*[0-9]+[ \t]+/,"",cmd); print "proc", pid, cmd }'
echo "bots_end"
`;

const botCache = new Map();

function parseBots(out) {
  const bots = [];
  let inSection = false;
  for (const line of out.split('\n')) {
    const t = line.trim();
    if (t === 'bots_start') { inSection = true; continue; }
    if (t === 'bots_end') { inSection = false; continue; }
    if (!inSection || !t) continue;
    const p = t.split(/\s+/);
    if (p[0] === 'svc' && p[1]) {
      // systemctl list-units : UNIT ACTIVE SUB -> p[2]=ACTIVE p[3]=SUB (running/dead/exited)
      const name = p[1].replace(/\.service$/, '').replace(/\./g, ' ');
      const active = p[2] || 'unknown', sub = p[3] || '';
      bots.push({ type: 'service', id: p[1], name, status: sub || active, sub: active, running: sub === 'running' });
    } else if (p[0] === 'docker' && p[1]) {
      const state = p[2] || 'unknown';
      bots.push({ type: 'docker', id: p[1], name: p[1], status: state, sub: p[3] || '', running: state === 'running' });
    } else if (p[0] === 'pm2' && p[1]) {
      const status = p[2] || 'unknown';
      bots.push({ type: 'pm2', id: p[1], name: p[1], status, sub: '', running: status === 'online' });
    } else if (p[0] === 'proc' && p[1]) {
      const pid = p[1];
      const cmd = p.slice(2).join(' ');
      // nom parlant : le segment de chemin contenant "telegram" (ex: cline-telegram-bot), sinon le dernier mot
      const tokens = cmd.split(/[\s/]+/).filter(Boolean);
      const seg = [...tokens].reverse().find((s) => /telegram/i.test(s));
      const name = (seg || tokens[tokens.length - 1] || cmd).replace(/\.(js|mjs|ts|py|sh)$/i, '').slice(0, 48);
      bots.push({ type: 'proc', id: pid, name, status: 'running', sub: `pid ${pid} · ${cmd.slice(0, 70)}`, running: true });
    }
  }
  // Dédoublonnage : si un service/conteneur/pm2 gère déjà ce bot, on ignore le
  // processus brut correspondant (le contrôle doit passer par son gestionnaire).
  const managedNames = bots.filter((b) => b.type !== 'proc').map((b) => b.name.toLowerCase());
  return bots.filter((b) => {
    if (b.type !== 'proc') return true;
    const n = b.name.toLowerCase();
    return !managedNames.some((mn) => mn.includes(n) || n.includes(mn));
  });
}

export async function scanBots(machine) {
  const prev = botCache.get(machine.id);
  if (prev && Date.now() - prev.ts < 30000) return prev.bots;
  const r = await exec(machine, BOT_SCAN_SCRIPT, 10000);
  const bots = r.ok ? parseBots(r.out) : [];
  botCache.set(machine.id, { bots, ts: Date.now() });
  return bots;
}

const prevNet = new Map(); // machine_id -> { ts, rx, tx }

function parseMetrics(machineId, out) {
  const m = { host: null, os: null, uptime: null, load: [null, null, null], cpu: null,
    mem_total: null, mem_used: null, disk_total: null, disk_used: null, disk_avail: null,
    net_rx: 0, net_tx: 0, temp: null, has_docker: false, has_systemd: false, ifaces: {},
    rapl_w: null, bat_w: null, disks: [] };
  for (const line of out.split('\n')) {
    const p = line.trim().split(/\s+/);
    switch (p[0]) {
      case 'host': m.host = p[1]; break;
      case 'os': m.os = line.slice(3); break;
      case 'uptime': m.uptime = parseFloat(p[1]); break;
      case 'load': m.load = [parseFloat(p[1]), parseFloat(p[2]), parseFloat(p[3])]; break;
      case 'rapl': {
        // p[1]=e1(µJ) p[2]=e2(µJ) p[3]=range(µJ) — mesure sur ~0.4 s
        let e1 = parseFloat(p[1]), e2 = parseFloat(p[2]);
        const range = parseFloat(p[3]) || 0;
        if (isFinite(e1) && isFinite(e2)) {
          if (e2 < e1 && range > 0) e2 += range; // compteur cyclique
          m.rapl_w = (e2 - e1) / 0.4 / 1e6;
        }
        break;
      }
      case 'cpu': {
        // le script renvoie : busy1 tot1 busy2 tot2 (valeurs cumulées depuis boot)
        const busy1 = parseFloat(p[1]), tot1 = parseFloat(p[2]), busy2 = parseFloat(p[3]), tot2 = parseFloat(p[4]);
        const dt = tot2 - tot1, db = busy2 - busy1;
        if (dt > 0) m.cpu = Math.min(100, Math.max(0, (db / dt) * 100));
        break;
      }
      case 'mem': {
        const total = parseFloat(p[1]), avail = parseFloat(p[2]);
        m.mem_total = total * 1024; m.mem_used = (total - avail) * 1024; break;
      }
      case 'diskroot': { m.disk_total = parseFloat(p[1]) * 1024; m.disk_used = parseFloat(p[2]) * 1024; break; }
      case 'dfs': {
        const clean = (s) => s.replace(/\\040/g, ' ');
        m.disks.push({ target: clean(p[1]), source: clean(p[2]), fstype: p[3], size: parseFloat(p[4]), used: parseFloat(p[5]), avail: parseFloat(p[6]) });
        break;
      }
      case 'net': { m.ifaces[p[1]] = { rx: parseFloat(p[2]), tx: parseFloat(p[3]) }; break; }
      case 'temp': m.temp = parseFloat(p[1]) / 1000; break;
      case 'bat': m.bat_w = parseFloat(p[1]) / 1e6; break; // power_now est en µW
      case 'docker': m.has_docker = p[1] === 'yes'; break;
      case 'systemd': m.has_systemd = p[1] === 'yes'; break;
    }
  }
  // Débit réseau (octets/s) vs échantillon précédent
  const now = Date.now();
  const prev = prevNet.get(machineId);
  const totRx = Object.values(m.ifaces).reduce((s, i) => s + i.rx, 0);
  const totTx = Object.values(m.ifaces).reduce((s, i) => s + i.tx, 0);
  if (prev) {
    const dt = (now - prev.ts) / 1000;
    if (dt > 0 && totRx >= prev.rx) { m.net_rx = (totRx - prev.rx) / dt; m.net_tx = (totTx - prev.tx) / dt; }
  }
  prevNet.set(machineId, { ts: now, rx: totRx, tx: totTx });
  return m;
}

async function readSmartplug(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
  const j = await res.json();
  return j.apower ?? j.power ?? null; // Shelly Gen2 apower / Gen1 power
}

export async function collectOnce(machine) {
  const r = await exec(machine, METRICS_SCRIPT, 12000);
  if (!r.ok) return { online: false, error: r.error };
  const m = parseMetrics(machine.id, r.out);
  m.online = true;

  // Dédoublonnage par source (bind mounts) + totaux machine
  const seen = new Set();
  m.disks = m.disks.filter((d) => (d.source && !seen.has(d.source) && seen.add(d.source)) || (!d.source && d.target === '/'));
  if (m.disks.length) {
    m.disk_avail = m.disks.reduce((s, d) => s + (d.avail || 0), 0);
    m.disk_total = m.disks.reduce((s, d) => s + (d.size || 0), 0);
    m.disk_used = m.disks.reduce((s, d) => s + (d.used || 0), 0);
  }

  // --- Conso : source réelle par priorité (prise > batterie > RAPL), sinon modèle estimé
  let realW = null, source = null;
  if (machine.smartplug_url) {
    realW = await readSmartplug(machine.smartplug_url).catch(() => null);
    if (realW != null) source = 'plug';
  }
  if (realW == null && m.bat_w != null && m.bat_w > 0) { realW = m.bat_w; source = 'battery'; }
  if (realW == null && m.rapl_w != null && m.rapl_w >= 0) { realW = m.rapl_w; source = 'rapl'; }
  m.power_real_w = realW;
  m.power_source = source;
  m.power_w = realW != null ? +realW.toFixed(1)
    : m.cpu != null ? +(machine.idle_w + (machine.max_w - machine.idle_w) * (m.cpu / 100)).toFixed(1)
    : null;
  const bots = await scanBots(machine);
  return { ...m, bots };
}
