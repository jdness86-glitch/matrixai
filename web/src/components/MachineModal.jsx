import React, { useState, useEffect } from 'react';
import { api, fmtBytes, fmtUptime } from '../api.js';

export default function MachineModal({ m, onClose, onSaved }) {
  const isNew = !m.id;
  const [f, setF] = useState({
    name: m.name || '', host: m.host || '', port: m.port || 22, user: m.user || 'timo',
    password: '', sudo_password: '', idle_w: m.idle_w ?? 5, max_w: m.max_w ?? 60,
    smartplug_url: m.smartplug_url || '', installKey: false, auto_calib: m.auto_calib !== 0,
    model: m.model || '',
  });
  const [calib, setCalib] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [detected, setDetected] = useState(null);
  const [detectErr, setDetectErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  useEffect(() => {
    if (!isNew) api.calibration(m.id).then(setCalib).catch(() => {});
  }, [m.id]);
  useEffect(() => {
    const key = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', key); document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = ''; };
  }, [busy, onClose]);

  const detect = () => {
    if (!f.host || !f.user || !f.password) { setDetectErr('Renseigne IP, utilisateur et mot de passe avant de détecter'); return; }
    setDetecting(true); setDetectErr(''); setDetected(null);
    api.detectMachine({ host: f.host, port: f.port, user: f.user, password: f.password })
      .then((r) => {
        setDetected(r.specs);
        setF((prev) => ({
          ...prev,
          name: prev.name || r.specs.hostname || prev.name,
          model: r.specs.model || r.specs.cpu_model || prev.model,
          idle_w: r.suggested?.idle_w ?? prev.idle_w,
          max_w: r.suggested?.max_w ?? prev.max_w,
        }));
      })
      .catch((e) => setDetectErr(`${e.message}${e.details ? ' — ' + e.details : ''}`))
      .finally(() => setDetecting(false));
  };

  const save = () => {
    setBusy(true); setErr('');
    const payload = { ...f, sudo_password: f.sudo_password || undefined, auto_calib: f.auto_calib ? 1 : 0 };
    const prep = f.installKey
      ? api.setupKey({ host: f.host, port: f.port, user: f.user, password: f.password || m.password, sudo_password: f.sudo_password || f.password || m.sudo_password })
          .catch((e) => { throw new Error(`clé SSH : ${e.message}${e.details ? ' — ' + e.details : ''}`); })
      : Promise.resolve();
    prep
      .then(() => (isNew ? api.addMachine(payload) : api.updateMachine(m.id, payload)))
      .then(onSaved)
      .catch((e) => { setErr(e.message); setBusy(false); });
  };

  return (
    <div className="modal-bg" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="machine-modal-title">
        <div className="modal-head"><h3 id="machine-modal-title">{isNew ? 'Ajouter' : 'Éditer'} une machine</h3><button className="icon-button" onClick={onClose} aria-label="Fermer" disabled={busy}>×</button></div>
        <label>Nom</label><input value={f.name} onChange={set('name')} placeholder="nas" />
        <label>IP / hôte (LAN)</label><input value={f.host} onChange={set('host')} placeholder="192.168.1.x" />
        <label>Port SSH</label><input value={f.port} onChange={set('port')} />
        <label>Utilisateur SSH</label><input value={f.user} onChange={set('user')} />
        <label>Mot de passe SSH {isNew ? '' : '(vide = conserver)'}</label>
        <input type="password" value={f.password} onChange={set('password')} />
        <div className="row" style={{ marginTop: 6, marginBottom: 6 }}>
          <button type="button" className="button secondary" onClick={detect} disabled={detecting}>
            {detecting ? 'Détection…' : '🔍 Détecter les caractéristiques'}
          </button>
        </div>
        {detectErr && <div className="error" style={{ marginBottom: 8 }}>{detectErr}</div>}
        {detected && (
          <div className="card" style={{ cursor: 'default', marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
              <b>{detected.hostname || f.host}</b>
              <span className="muted">{detected.model || detected.arch || ''}</span>
            </div>
            <div className="metrics" style={{ marginTop: 6 }}>
              <span>OS <b>{detected.os || '—'}</b></span>
              <span>CPU <b>{detected.cpu_model ? `${detected.cpu_model}${detected.cpu_count ? ` (${detected.cpu_count}x)` : ''}` : (detected.cpu_count ? `${detected.cpu_count} cœurs` : '—')}</b></span>
              <span>RAM <b>{detected.mem_total_bytes ? fmtBytes(detected.mem_total_bytes) : '—'}</b></span>
              <span>Disque <b>{detected.disk_total_bytes ? fmtBytes(detected.disk_total_bytes) : '—'}</b></span>
              <span>Docker <b>{detected.has_docker ? 'oui' : 'non'}</b></span>
              <span>Systemd <b>{detected.has_systemd ? 'oui' : 'non'}</b></span>
              {detected.uptime_s != null && <span>Uptime <b>{fmtUptime(detected.uptime_s)}</b></span>}
              {detected.virt && detected.virt !== 'none' && <span>Virtualisation <b>{detected.virt}</b></span>}
            </div>
            <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>
              Conso suggérée appliquée ci-dessous d'après le matériel détecté (idle {f.idle_w} W · max {f.max_w} W) — ajustable.
            </p>
          </div>
        )}
        <label>Mot de passe sudo (services / reboot)</label>
        <input type="password" value={f.sudo_password} onChange={set('sudo_password')} placeholder={isNew ? '' : '(conserver)'} />
        <label>Conso estimée : idle (W)</label><input value={f.idle_w} onChange={set('idle_w')} />
        <label>Conso estimée : max (W)</label><input value={f.max_w} onChange={set('max_w')} />
        <label>URL prise connectée (optionnel, ex: Shelly http://ip/status)</label>
        <input value={f.smartplug_url} onChange={set('smartplug_url')} />
        {!isNew && calib && (
          <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
            Calibrage : {calib.samples} mesures réelles{calib.sources?.length ? ` (${calib.sources.join(', ')})` : ''}
            {calib.calibrated_at ? ` · dernier ajustement : ${new Date(calib.calibrated_at).toLocaleString('fr-FR')}` : ' · en attente de mesures suffisantes (≈30 min de variation de charge)'}
          </p>
        )}
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
          <input type="checkbox" checked={f.auto_calib} onChange={(e) => setF({ ...f, auto_calib: e.target.checked })} style={{ width: 'auto' }} />
          Auto-calibrer idle/max d'après la conso réelle observée
        </label>
        {isNew && (
          <>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
              <input type="checkbox" checked={f.installKey} onChange={(e) => setF({ ...f, installKey: e.target.checked })} style={{ width: 'auto' }} />
              Installer la clé SSH du hub (recommandé)
            </label>
            <p className="muted" style={{ fontSize: 12 }}>Utilise le mot de passe SSH une dernière fois pour autoriser la clé du hub — ensuite plus besoin de mot de passe.</p>
          </>
        )}
        {err && <div className="error" style={{ marginTop: 8 }}>{err}</div>}
        <div className="actions">
          <button onClick={onClose} className="button secondary">Annuler</button>
          <button onClick={save} disabled={busy} className="button">{busy ? 'En cours…' : 'Enregistrer'}</button>
        </div>
      </div>
    </div>
  );
}
