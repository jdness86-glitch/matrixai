import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

export const fmtNum = (n, d = 1) => {
  if (n == null) return '—';
  return n.toLocaleString('fr-FR', { maximumFractionDigits: d, minimumFractionDigits: n % 1 === 0 ? 0 : d });
};

export default function EnergyPanel() {
  const [e, setE] = useState(null);
  useEffect(() => {
    const load = () => api.energy().then(setE).catch(() => {});
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);
  if (!e) return null;
  return (
    <section className="energy">
      <h2 style={{ marginTop: 6 }}>Énergie (flotte)</h2>
      <div className="row energy-row">
        <div className="stat"><div className="v">{fmtNum(e.fleet_avg_w, 0)} W</div><div className="l">conso moyenne</div></div>
        <div className="stat"><div className="v">{fmtNum(e.kwh.day, 2)} kWh</div><div className="l">par jour</div></div>
        <div className="stat"><div className="v">{fmtNum(e.kwh.month, 1)} kWh</div><div className="l">par mois</div></div>
        <div className="stat"><div className="v">{fmtNum(e.kwh.year, 0)} kWh</div><div className="l">par an (proj.)</div></div>
        <div className="stat"><div className="v">{fmtNum(e.cost.day, 2)} €</div><div className="l">par jour</div></div>
        <div className="stat"><div className="v">{fmtNum(e.cost.month, 2)} €</div><div className="l">par mois</div></div>
        <div className="stat"><div className="v">{fmtNum(e.cost.ytd, 0)} €</div><div className="l">depuis le 1er janvier</div></div>
        <div className="stat"><div className="v">{fmtNum(e.cost.year, 0)} €</div><div className="l">année (proj.)</div></div>
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>Coût basé sur {fmtNum(e.price_per_kwh, 3)} €/kWh (règlable dans Réglages) · moyenne des 24 dernières heures · kWh = conso × 24 h.</p>
    </section>
  );
}