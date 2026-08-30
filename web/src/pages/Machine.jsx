import React, { useEffect, useRef, useState, useContext } from 'react';
import { api, fmtBytes, fmtUptime } from '../api.js';
import PowerBadge from '../components/PowerBadge.jsx';
import { Stat, Chart, push } from '../components/ui.jsx';
import { DockerTable, ServiceTable, BotTable, Modal } from '../components/tables.jsx';
import { LiveContext } from '../App.jsx';

export default function Machine({ id, back }) {
  const live = useContext(LiveContext);
  const [machines, setMachines] = useState([]);
  const [tab, setTab] = useState('docker');
  const [docker, setDocker] = useState(null);
  const [services, setServices] = useState(null);
  const [bots, setBots] = useState(null);
  const [logs, setLogs] = useState(null);
  const [botLogs, setBotLogs] = useState(null);
  const botLogsEs = useRef(null);
  const [confirm, setConfirm] = useState(null);
  const [energy, setEnergy] = useState(null);
  const m = machines.find((x) => String(x.id) === String(id));
  const allDisks = (live[id] && live[id].disks) || (m && m.disks) || [];

  const series = useRef({ cpu: [], mem: [], rx: [], tx: [], w: [] });

  useEffect(() => {
    api.machines().then(setMachines).catch(() => {});
    const t = setInterval(() => api.machines().then(setMachines).catch(() => {}), 15000);
    return () => clearInterval(t);
  }, [id]);
  useEffect(() => { api.energy().then(setEnergy).catch(() => {}); }, [id]);
  const me = energy ? energy.machines.find((x) => x.id === Number(id)) : null;
  const fmt = (n) => (n == null || !isFinite(n) ? '—' : n.toLocaleString('fr-FR', { maximumFractionDigits: 1 }));
  const fmtEur = (n) => (n == null || !isFinite(n) ? '—' : `${n.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} €`);

  const l = live[id];
  useEffect(() => {
    if (!l || !l.online) return;
    series.current.cpu = push(series.current.cpu, l.cpu ?? null);
    series.current.mem = push(series.current.mem, l.mem_total ? (l.mem_used / l.mem_total) * 100 : null);
    series.current.rx = push(series.current.rx, l.net_rx ?? null);
    series.current.tx = push(series.current.tx, l.net_tx ?? null);
    series.current.w = push(series.current.w, l.power_w ?? null);
  }, [l]);

  const loadTab = () => {
    if (tab === 'docker') api.docker(id).then(setDocker).catch((e) => setDocker({ ok: false, error: e.message, containers: [] }));
    if (tab === 'services') api.services(id).then(setServices).catch((e) => setServices({ ok: false, error: e.message, services: [] }));
    if (tab === 'bots') api.bots(id).then((d) => setBots(d.bots || [])).catch(() => setBots([]));
  };
  useEffect(() => { loadTab(); }, [id, tab]);
  useEffect(() => { const t = setInterval(loadTab, 20000); return () => clearInterval(t); }, [id, tab]);

  const showLogs = (name) => api.dockerLogs(id, name).then((d) => setLogs({ name, text: d.logs || d.error }));
  const act = (kind, name, action) => {
    if (!window.confirm(`${action} ${name} sur ${m?.name} ?`)) return;
    (kind === 'docker' ? api.dockerAction(id, action, name) : api.serviceAction(id, action, name))
      .then(() => loadTab()).catch((e) => alert(e.message));
  };
  const botCtrl = (bot, action) => {
    if (!window.confirm(`${action} ${bot.name} sur ${m?.name} ?`)) return;
    api.botAction(id, bot.type, bot.id, action).then((r) => {
      if (!r.ok) alert(r.output || r.error || 'échec');
      loadTab();
    }).catch((e) => alert(e.message));
  };
  const closeBotLogs = () => {
    if (botLogsEs.current) { botLogsEs.current.close(); botLogsEs.current = null; }
    setBotLogs(null);
  };
  const openBotLogs = (bot) => {
    closeBotLogs();
    setBotLogs({ bot, lines: [] });
    const es = new EventSource(api.botLogsUrl(id, bot.type, bot.id));
    botLogsEs.current = es;
    es.onmessage = (e) => setBotLogs((s) => (s ? { ...s, lines: [...s.lines.slice(-500), e.data] } : s));
    es.addEventListener('error', () => setBotLogs((s) => (s ? { ...s, lines: [...s.lines, '⚠ erreur du flux distant'] } : s)));
    es.addEventListener('end', () => { setBotLogs((s) => (s ? { ...s, lines: [...s.lines, '— flux terminé —'] } : s)); es.close(); });
  };
  useEffect(() => () => { if (botLogsEs.current) botLogsEs.current.close(); }, [id]);
  const power = (action) => api.power(id, action).then(() => { setConfirm(null); alert(`${action} envoyé à ${m.name}`); }).catch((e) => alert(e.message));

  if (!m) return <div className="muted">Machine inconnue ou chargement… <button onClick={back}>Retour</button></div>;
  const cur = l || m.last || {};
  const online = m.online;

  return (
    <div>
      <div className="detail-head">
        <button onClick={back}>← Flotte</button>
        <h2 style={{ margin: 0 }}><span className={'dot' + (online ? ' on' : '')} /> {m.name} <span className="muted">{m.host}</span></h2>
        <span className="muted">{m.model ? `${m.model} · ` : ''}{cur.os || ''}</span>
        <span style={{ flex: 1 }} />
        <button className="btn-danger" onClick={() => setConfirm('reboot')} disabled={!online}>⟳ Redémarrer</button>
        <button className="btn-danger" onClick={() => setConfirm('poweroff')} disabled={!online}>⏻ Éteindre</button>
      </div>

      <div className="card" style={{display:'flex',flexWrap:'wrap',gap:14}}>
        <Stat label="CPU" v={cur.cpu != null ? `${cur.cpu.toFixed(0)} %` : '—'} />
        <Stat label="RAM" v={cur.mem_used != null ? fmtBytes(cur.mem_used) : '—'} sub={cur.mem_total != null ? `/ ${fmtBytes(cur.mem_total)}` : null} />
        <Stat label="Temp" v={cur.temp != null ? `${cur.temp.toFixed(0)} °C` : '—'} />
        <Stat label="Réseau" v={`${fmtBytes(cur.net_rx)}/s`} sub={`↑ ${fmtBytes(cur.net_tx)}/s`} />
        <Stat label="Conso" v={<PowerBadge w={cur.power_w} source={cur.power_source} calibrated={!!m.calibrated_at} />}
          sub={cur.power_source ? `source : ${cur.power_source}` : `modèle ${m.idle_w}–${m.max_w} W`} />
        <Stat label="Uptime" v={fmtUptime(cur.uptime)} />
        <Stat label="Load" v={cur.load1 ?? '—'} />
        {me && energy && (
          <>
            <Stat label="kWh / jour" v={fmt(me.avg_w * 24 / 1000)} />
            <Stat label="€ / jour" v={fmtEur(me.avg_w * 24 / 1000 * energy.price_per_kwh)} sub={`prix ${energy.price_per_kwh} €/kWh`} />
            <Stat label="€ / mois" v={fmtEur(me.avg_w * 24 * 30.44 / 1000 * energy.price_per_kwh)} />
          </>
        )}
      </div>

      {allDisks.length > 0 && <StorageSection disks={allDisks} />}

      <h2>Temps réel</h2>
      <div className="grid charts">
        <div className="chart-card"><Chart title="CPU %" data={series.current.cpu} /></div>
        <div className="chart-card"><Chart title="RAM %" data={series.current.mem} /></div>
        <div className="chart-card"><Chart title="Réseau ↓ Ko/s" data={series.current.rx} scale={1 / 1024} /></div>
        <div className="chart-card"><Chart title="Réseau ↑ Ko/s" data={series.current.tx} scale={1 / 1024} /></div>
        <div className="chart-card"><Chart title="Conso (W)" data={series.current.w} /></div>
      </div>

      <div className="tabs">
        <button className={tab === 'docker' ? 'active' : ''} onClick={() => setTab('docker')}>Docker</button>
        <button className={tab === 'services' ? 'active' : ''} onClick={() => setTab('services')}>Services systemd</button>
        <button className={tab === 'bots' ? 'active' : ''} onClick={() => setTab('bots')}>Bots</button>
      </div>

      {tab === 'docker' && docker && <DockerTable docker={docker} onLogs={showLogs} onAct={act} />}
      {tab === 'services' && services && <ServiceTable services={services} onAct={act} />}
      {tab === 'bots' && bots !== null && <BotTable bots={bots} onAct={botCtrl} onLogs={openBotLogs} />}

      {logs && (
        <Modal onClose={() => setLogs(null)} title={`Logs : ${logs.name}`} wide>
          <pre className="logs">{logs.text}</pre>
        </Modal>
      )}

      {botLogs && (
        <Modal onClose={closeBotLogs} title={`Logs temps réel : ${botLogs.bot.name}`} wide>
          <pre className="logs" style={{ maxHeight: 480, overflow: 'auto' }} ref={(el) => { if (el) el.scrollTop = el.scrollHeight; }}>
            {botLogs.lines.length ? botLogs.lines.join('\n') : 'En attente de logs…'}
          </pre>
        </Modal>
      )}

      {confirm && (
        <Modal onClose={() => setConfirm(null)} title={`${confirm === 'reboot' ? 'Redémarrer' : 'Éteindre'} ${m.name} ?`}>
          <p className="muted">Action immédiate. La machine sera indisponible quelques instants.</p>
          <div className="actions" style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button onClick={() => setConfirm(null)}>Annuler</button>
            <button className="btn-danger" onClick={() => power(confirm)}>Confirmer</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function StorageSection({ disks }) {
  const total = disks.reduce((s, d) => s + (d.size || 0), 0);
  const avail = disks.reduce((s, d) => s + (d.avail || 0), 0);
  const used = disks.reduce((s, d) => s + (d.used || 0), 0);
  const pct = total ? Math.round((used / total) * 100) : 0;
  const cls = pct > 90 ? 'crit' : pct > 70 ? 'warn' : '';
  return (
    <div>
      <h2>Stockage <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>· {fmtBytes(avail)} libres / {fmtBytes(total)}</span></h2>
      <div className="bar" style={{ height: 10, maxWidth: 500 }}><div className={cls} style={{ width: `${Math.min(100, pct)}%` }} /></div>
      <div className="grid" style={{ marginTop: 10 }}>
        {disks.map((d, i) => {
          const dp = d.size ? Math.round((d.used / d.size) * 100) : 0;
          const dcls = dp > 90 ? 'crit' : dp > 70 ? 'warn' : '';
          return (
            <div key={i} className="card" style={{ cursor: 'default' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <b>{d.target}</b>
                <span className="muted" style={{ fontSize: 12 }}>{d.source?.replace('/dev/', '') || ''}</span>
              </div>
              <div className="metrics" style={{ marginTop: 6 }}>
                <span>Utilisé <b>{fmtBytes(d.used)}</b></span>
                <span>Total <b>{fmtBytes(d.size)}</b></span>
                <span>Libre <b>{fmtBytes(d.avail)}</b></span>
                <span>FS <b>{d.fstype || '—'}</b></span>
              </div>
              <div className="bar"><div className={dcls} style={{ width: `${Math.min(100, dp)}%` }} /></div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
