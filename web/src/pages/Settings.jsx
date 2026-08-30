import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import MachineModal from '../components/MachineModal.jsx';

export default function Settings() {
  const [machines, setMachines] = useState([]);
  const [editing, setEditing] = useState(null);
  const [scan, setScan] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [pw, setPw] = useState({ old: '', new: '' });
  const [msg, setMsg] = useState('');
  const [settings, setSettings] = useState(null);
  const [price, setPrice] = useState('');
  useEffect(() => { api.settings().then((s) => { setSettings(s); setPrice(String(s.elec_price_per_kwh)); }).catch(() => {}); }, []);

  const load = () => api.machines().then(setMachines).catch(() => {});
  useEffect(() => { load(); }, []);

  const doScan = () => {
    setScanning(true); setScan(null);
    api.scan().then((d) => setScan(d.hosts.filter((h) => h.ip !== '192.168.1.1'))).catch((e) => setMsg(`Scan impossible : ${e.message}`)).finally(() => setScanning(false));
  };

  return (
    <div>
      <header className="page-heading"><div><p className="eyebrow">Configuration</p><h1>Réglages</h1><p>Gérez les machines, la sécurité et les préférences énergétiques.</p></div></header>
      <h2>Machines de la flotte</h2>
      <button className="button" onClick={() => setEditing({})} style={{ marginBottom: 12 }}>+ Ajouter une machine</button>
      <div className="table-wrap">
        <table className="row-cards">
          <thead><tr><th>Nom</th><th>Hôte</th><th>User</th><th>Conso (W)</th><th>État</th><th style={{ width: 190 }}></th></tr></thead>
          <tbody>
            {machines.map((m) => (
              <tr key={m.id}>
                <td><span className="cell-label">Nom</span><b>{m.name}</b></td>
                <td><span className="cell-label">Hôte</span><span className="muted">{m.host}:{m.port}</span></td>
                <td><span className="cell-label">User</span>{m.user}</td>
                <td><span className="cell-label">Conso (W)</span><span className="muted">{m.idle_w}–{m.max_w}</span></td>
                <td><span className="cell-label">État</span><span style={{ color: m.online ? 'var(--green)' : 'var(--dim)' }}>{m.online ? 'en ligne' : 'hors ligne'}</span></td>
                <td><span className="cell-label">Actions</span><span className="btns">
                  <button onClick={() => setEditing(m)}>Éditer</button>
                  <button title="Installe les règles sudo pour mesurer la conso CPU (RAPL) et permettre les actions sans mot de passe"
                    onClick={() => { setMsg('Installation des règles sudo sur ' + m.name + '…'); api.installSudoers(m.id).then((r) => setMsg(r.ok ? `Règles sudo installées sur ${m.name} ✅` : `Échec sur ${m.name} : vérifie le mot de passe sudo`)).catch((e) => setMsg(e.message)); }}>Sudo</button>
                  <button className="btn-danger" onClick={() => { if (window.confirm(`Supprimer ${m.name} ?`)) api.delMachine(m.id).then(load); }}>Suppr.</button>
                </span></td>
              </tr>
            ))}
            {machines.length === 0 && <tr><td colSpan={6} className="muted">Aucune machine</td></tr>}
          </tbody>
        </table>
      </div>

      <h2>Scanner le réseau local</h2>
      <button className="button secondary" onClick={doScan} disabled={scanning}>{scanning ? 'Scan en cours (~30 s)…' : 'Scanner 192.168.1.x'}</button>
      {scan && (
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="row-cards">
            <thead><tr><th>IP</th><th>Hostname</th><th>SSH</th><th></th></tr></thead>
            <tbody>
              {scan.map((h) => (
                <tr key={h.ip}>
                  <td><span className="cell-label">IP</span>{h.ip}</td>
                  <td><span className="cell-label">Hostname</span><span className="muted">{h.hostname || '—'}</span></td>
                  <td><span className="cell-label">SSH</span><span style={{ color: h.ssh_open ? 'var(--green)' : 'var(--dim)' }}>{h.ssh_open ? 'ouvert' : 'fermé'}</span></td>
                  <td><span className="cell-label">?</span><span className="btns"><button onClick={() => setEditing({ host: h.ip, user: 'timo', name: (h.hostname || '').replace('.local', '') || h.ip })}>Ajouter</button></span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Prix de l'électricité</h2>
      <div className="row">
        <label className="sr-only" htmlFor="energy-price">Prix en euros par kWh</label>
        <input id="energy-price" type="number" step="0.001" min="0" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.27" style={{ maxWidth: 180 }} />
        <span className="muted">€ / kWh</span>
        <button className="button" onClick={() => api.setSetting('elec_price_per_kwh', parseFloat(price)).then(() => { setMsg('Prix mis à jour ✅ (utilisé pour l\'énergie)'); setSettings({ elec_price_per_kwh: parseFloat(price) }); }).catch((e) => setMsg(e.message))}>Enregistrer le prix</button>
      </div>
      <p className="muted" style={{ fontSize: 12 }}>Prix indicatif France : ~0,25 €/kWh (base) à ~0,28 €/kWh en 2026 selon le tarif. Ajuste selon ton contrat.</p>

      <h2>Mot de passe de l'interface</h2>
      <div className="row">
        <label className="sr-only" htmlFor="old-password">Ancien mot de passe</label>
        <input id="old-password" type="password" autoComplete="current-password" placeholder="Ancien mot de passe" value={pw.old} onChange={(e) => setPw({ ...pw, old: e.target.value })} />
        <label className="sr-only" htmlFor="new-password">Nouveau mot de passe</label>
        <input id="new-password" type="password" autoComplete="new-password" minLength={10} placeholder="Nouveau mot de passe (10 caractères min.)" value={pw.new} onChange={(e) => setPw({ ...pw, new: e.target.value })} />
        <button className="button" onClick={() => api.password(pw).then(() => { setMsg('Mot de passe modifié ✅'); setPw({ old: '', new: '' }); }).catch((e) => setMsg(e.message))}>Changer</button>
      </div>
      {msg && <p className="muted">{msg}</p>}

      {editing && <MachineModal m={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}
