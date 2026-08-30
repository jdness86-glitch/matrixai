import React, { useEffect, useState, useContext } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, fmtBytes } from '../api.js';
import PowerBadge from '../components/PowerBadge.jsx';
import EnergyPanel from '../components/EnergyPanel.jsx';
import { LiveContext } from '../App.jsx';

export default function Overview() {
  const live = useContext(LiveContext);
  const navigate = useNavigate();
  const [machines, setMachines] = useState(null);

  const load = () => api.machines().then(setMachines).catch(() => {});
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, []);

  if (!machines) return <div className="muted">Chargement…</div>;

  const totalW = machines.reduce((s, m) => s + (live[m.id]?.power_w ?? 0), 0);
  const online = machines.filter((m) => m.online).length;

  return (
    <div>
      <header className="page-heading"><div><p className="eyebrow">Vue d’ensemble</p><h1>Votre flotte</h1><p>État et consommation de vos machines en temps réel.</p></div><span className="fleet-health"><i />{online} en ligne</span></header>
      <div className="row summary-row" style={{ marginBottom: 16 }}>
        <div className="stat"><div className="v">{online}/{machines.length}</div><div className="l">machines en ligne</div></div>
        <div className="stat"><div className="v">{totalW.toFixed(1)} W</div><div className="l">conso actuelle</div></div>
      </div>
      <EnergyPanel />
      {machines.length === 0 && (
        <div className="card" style={{ cursor: 'default' }}>
          Aucune machine enregistrée. <button onClick={() => navigate('/settings')}>Ajouter des machines</button> (ou utilise le scanner réseau dans Réglages)
        </div>
      )}
      <div className="grid">
        {machines.map((m) => {
          const l = live[m.id] || m.last || {};
          const cpu = l.cpu ?? m.last?.cpu;
          const memPct = (l.mem_total ?? m.last?.mem_total) ? ((l.mem_used ?? m.last?.mem_used) / (l.mem_total ?? m.last?.mem_total)) * 100 : null;
          const pw = l.power_w ?? m.last?.power_w;
          const psrc = l.power_source ?? m.last?.power_source;
          const disks = (l.disks ?? m.disks) || [];
          const diskAvail = disks.length ? disks.reduce((s, d) => s + (d.avail || 0), 0) : null;
          const diskTotal = disks.length ? disks.reduce((s, d) => s + (d.size || 0), 0) : null;
          const botCount = (l.bots || []).length;
          return (
            <Link key={m.id} className="card machine-card" to={`/machine/${m.id}`} aria-label={`Ouvrir la machine ${m.name}`}> 
              <h3><span className={'dot' + (m.online ? ' on' : '')} />{m.name}
                <span className="muted" style={{ marginLeft: 'auto', fontWeight: 400 }}>
                  {m.online ? <PowerBadge w={pw} source={psrc} calibrated={!!m.calibrated_at} /> : 'offline'}
                </span>
              </h3>
              <Gauge label="CPU" value={cpu} unit="%" />
              <Gauge label="RAM" value={memPct} unit="%" sub={l.mem_used != null ? `${fmtBytes(l.mem_used)} / ${fmtBytes(l.mem_total ?? m.last?.mem_total)}` : null} />
              <div className="metrics" style={{ marginTop: 8 }}>
                <span>Temp <b>{l.temp ?? m.last?.temp ? `${(l.temp ?? m.last?.temp).toFixed(0)}°C` : '—'}</b></span>
                <span>Réseau <b>{fmtBytes(l.net_rx ?? m.last?.net_rx)}/s ↓</b></span>
                <span>Disque <b>{diskAvail != null ? `${fmtBytes(diskAvail)} libres` : (l.disk_used ?? m.last?.disk_used) != null ? fmtBytes(m.last?.disk_used ?? l.disk_used) : '—'}</b></span>
                <span>Load <b>{l.load1 ?? m.last?.load1 ?? '—'}</b></span>
                {botCount > 0 && <span>Bots <b>{botCount}</b></span>}
              </div>
              {diskTotal != null && diskTotal > 0 && <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>sur {fmtBytes(diskTotal)}</div>}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function Gauge({ label, value, unit, sub }) {
  const pct = value == null ? null : Math.max(0, Math.min(100, value));
  const cls = pct > 90 ? 'crit' : pct > 70 ? 'warn' : '';
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
        <span className="muted">{label}</span>
        <b>{pct == null ? '—' : `${pct.toFixed(0)}${unit}`}</b>
      </div>
      <div className="bar"><div className={cls} style={{ width: `${pct ?? 0}%` }} /></div>
      {sub && <div className="muted" style={{ fontSize: 11 }}>{sub}</div>}
    </div>
  );
}
