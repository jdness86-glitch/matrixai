import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function Events() {
  const [events, setEvents] = useState([]);
  useEffect(() => {
    const load = () => api.events(200).then(setEvents).catch(() => {});
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []);
  const color = { info: 'var(--green)', warn: 'var(--yellow)', error: 'var(--red)' };
  return (
    <div>
      <header className="page-heading"><div><p className="eyebrow">Journal d’activité</p><h1>Événements</h1><p>Suivez les changements d’état et les actions de la flotte.</p></div></header>
      <h2>Activité récente</h2>
      <div className="table-wrap">
        <table className="row-cards">
          <thead><tr><th style={{ width: 160 }}>Date</th><th style={{ width: 120 }}>Machine</th><th style={{ width: 70 }}>Niveau</th><th>Message</th></tr></thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td><span className="cell-label">Date</span><span className="muted">{new Date(e.ts * 1000).toLocaleString('fr-FR')}</span></td>
                <td><span className="cell-label">Machine</span>{e.machine || '—'}</td>
                <td><span className="cell-label">Niveau</span><span style={{ color: color[e.level] }}>{e.level}</span></td>
                <td><span className="cell-label">Message</span>{e.message}</td>
              </tr>
            ))}
            {events.length === 0 && <tr><td colSpan={4} className="muted">Aucun événement</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
