import React from 'react';

export function DockerTable({ docker, onLogs, onAct }) {
  return (
    <div className="table-wrap">
      <table className="row-cards">
        <thead><tr><th>Conteneur</th><th>Image</th><th>État</th><th>Stats</th><th style={{ width: 280 }}>Actions</th></tr></thead>
        <tbody>
          {docker.containers.map((c) => (
            <tr key={c.id}>
              <td><span className="cell-label">Conteneur</span><b>{c.name}</b></td>
              <td><span className="cell-label">Image</span><span className="muted">{c.image}</span></td>
              <td><span className="cell-label">État</span><span style={{ color: c.state === 'running' ? 'var(--green)' : 'var(--dim)' }}>{c.status}</span></td>
              <td><span className="cell-label">Stats</span><span className="muted">{docker.stats?.[c.name] ? `${docker.stats[c.name].cpu} · ${docker.stats[c.name].mem}` : '—'}</span></td>
              <td><span className="cell-label">Actions</span><span className="btns">
                <button onClick={() => onLogs(c.name)}>Logs</button>
                {c.state === 'running' ? (
                  <>
                    <button onClick={() => onAct('docker', c.name, 'restart')}>Restart</button>
                    <button className="btn-danger" onClick={() => onAct('docker', c.name, 'stop')}>Stop</button>
                  </>
                ) : (
                  <button onClick={() => onAct('docker', c.name, 'start')}>Start</button>
                )}
              </span></td>
            </tr>
          ))}
          {docker.containers.length === 0 && <tr><td colSpan={5} className="muted">Aucun conteneur (ou Docker inaccessible)</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export function ServiceTable({ services, onAct }) {
  return (
    <div className="table-wrap">
      <table className="row-cards">
        <thead><tr><th>Unité</th><th>État</th><th style={{ width: 220 }}>Actions</th></tr></thead>
        <tbody>
          {services.services.slice(0, 200).map((s) => (
            <tr key={s.unit}>
              <td><span className="cell-label">Unité</span><b>{s.unit}</b> <span className="muted">{s.description}</span></td>
              <td><span className="cell-label">État</span><span style={{ color: s.sub === 'running' ? 'var(--green)' : 'var(--dim)' }}>{s.state}/{s.sub}</span></td>
              <td><span className="cell-label">Actions</span><span className="btns">
                <button onClick={() => onAct('svc', s.unit, 'restart')}>Restart</button>
                {s.sub === 'running'
                  ? <button className="btn-danger" onClick={() => onAct('svc', s.unit, 'stop')}>Stop</button>
                  : <button onClick={() => onAct('svc', s.unit, 'start')}>Start</button>}
              </span></td>
            </tr>
          ))}
          {services.services.length === 0 && <tr><td colSpan={3} className="muted">Aucun service (ou systemctl inaccessible)</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

const BOT_TYPE_LABEL = { service: 'Systemd', docker: 'Docker', pm2: 'PM2', proc: 'Processus' };

export function BotTable({ bots, onAct, onLogs }) {
  return (
    <div className="table-wrap">
      <table className="row-cards">
        <thead><tr><th>Bot</th><th>Type</th><th>État</th><th style={{ width: 360 }}>Actions</th></tr></thead>
        <tbody>
          {bots.map((b) => {
            const running = b.running ?? (b.status === 'running');
            const manageable = b.type !== 'proc';
            return (
              <tr key={`${b.type}-${b.id}`}>
                <td><span className="cell-label">Bot</span><b>{b.name}</b></td>
                <td><span className="cell-label">Type</span><span className="muted">{BOT_TYPE_LABEL[b.type] || b.type}</span></td>
                <td><span className="cell-label">État</span><span style={{ color: running ? 'var(--green)' : 'var(--dim)' }}>{b.status} {b.sub ? `· ${b.sub}` : ''}</span></td>
                <td><span className="cell-label">Actions</span><span className="btns">
                  <button onClick={() => onLogs(b)}>Logs</button>
                  {manageable && <button onClick={() => onAct(b, 'restart')}>Restart</button>}
                  {manageable && (running
                    ? <button className="btn-danger" onClick={() => onAct(b, 'stop')}>Stop</button>
                    : <button onClick={() => onAct(b, 'start')}>Start</button>)}
                  {!manageable && running && <button className="btn-danger" onClick={() => onAct(b, 'stop')}>Stop (kill)</button>}
                  <button onClick={() => onAct(b, 'status')}>Status</button>
                </span></td>
              </tr>
            );
          })}
          {bots.length === 0 && <tr><td colSpan={4} className="muted">Aucun bot Telegram détecté (service/docker/pm2/processus contenant « telegram »)</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export function Modal({ title, children, onClose, wide }) {
  const titleId = React.useId();
  React.useEffect(() => {
    const key = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', key); document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = ''; };
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} style={wide ? { width: 700 } : null}>
        <div className="modal-head"><h3 id={titleId}>{title}</h3><button className="icon-button" onClick={onClose} aria-label="Fermer">×</button></div>
        {children}
      </div>
    </div>
  );
}
