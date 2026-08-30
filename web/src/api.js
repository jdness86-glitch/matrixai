export class ApiError extends Error {
  constructor(message, status = 0, details = '') { super(message); this.name = 'ApiError'; this.status = status; this.details = details; }
}

async function request(url, options = {}) {
  let response;
  try { response = await fetch(url, { credentials: 'same-origin', ...options }); }
  catch { throw new ApiError('Serveur injoignable. Vérifie ta connexion.', 0); }
  const type = response.headers.get('content-type') || '';
  const data = type.includes('json') ? await response.json().catch(() => ({})) : await response.text().catch(() => '');
  if (!response.ok) {
    if (response.status === 401 && url !== '/api/login') window.dispatchEvent(new CustomEvent('matrixai:unauthorized'));
    throw new ApiError(data?.error || data?.message || `Erreur HTTP ${response.status}`, response.status, data?.details || '');
  }
  return data;
}
const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export const api = {
  login: (username, password) => request('/api/login', json('POST', { username, password })),
  logout: () => request('/api/logout', { method: 'POST' }),
  me: () => request('/api/me'),
  password: ({ old, new: next }) => request('/api/password', json('POST', { old, new: next })),
  machines: () => request('/api/machines'),
  addMachine: (m) => request('/api/machines', json('POST', m)),
  updateMachine: (id, m) => request(`/api/machines/${id}`, json('PUT', m)),
  delMachine: (id) => request(`/api/machines/${id}`, { method: 'DELETE' }),
  history: (id, hours = 6) => request(`/api/machines/${id}/history?hours=${hours}`),
  scan: () => request('/api/scan', { method: 'POST' }),
  setupKey: (b) => request('/api/machines/setup-key', json('POST', b)),
  detectMachine: (b) => request('/api/machines/detect', json('POST', b)),
  docker: (id) => request(`/api/machines/${id}/docker`),
  dockerAction: (id, action, container) => request(`/api/machines/${id}/docker/${action}`, json('POST', { container })),
  dockerLogs: (id, name) => request(`/api/machines/${id}/docker/${encodeURIComponent(name)}/logs`),
  services: (id) => request(`/api/machines/${id}/services`),
  serviceAction: (id, action, unit) => request(`/api/machines/${id}/services/${action}`, json('POST', { unit })),
  power: (id, action) => request(`/api/machines/${id}/power/${action}`, { method: 'POST' }),
  events: (limit = 100) => request(`/api/events?limit=${limit}`),
  energy: () => request('/api/energy'),
  settings: () => request('/api/settings'),
  setSetting: (key, value) => request('/api/settings', json('PUT', { [key]: value })),
  calibration: (id) => request(`/api/machines/${id}/calibration`),
  installSudoers: (id) => request(`/api/machines/${id}/install-sudoers`, { method: 'POST' }),
  bots: (id) => request(`/api/machines/${id}/bots`),
  botAction: (id, type, identifier, action) => request(`/api/machines/${id}/bots/${encodeURIComponent(type)}/${encodeURIComponent(identifier)}/${action}`, { method: 'POST' }),
  botLogsUrl: (id, type, identifier) => `/api/machines/${id}/bots/${encodeURIComponent(type)}/${encodeURIComponent(identifier)}/logs`,
};

export function connectWS(onMessage, onState = () => {}) {
  let ws = null;
  let retry = null;
  let stopped = false;
  let delay = 1000;
  const open = () => {
    if (stopped || !navigator.onLine) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    onState('connecting');
    ws.onopen = () => { delay = 1000; onState('connected'); };
    ws.onmessage = (e) => { try { onMessage(JSON.parse(e.data)); } catch {} };
    ws.onerror = () => onState('error');
    ws.onclose = () => {
      onState('disconnected');
      if (!stopped) { retry = setTimeout(open, delay); delay = Math.min(delay * 1.8, 30000); }
    };
  };
  const online = () => { if (!ws || ws.readyState > 1) open(); };
  window.addEventListener('online', online);
  open();
  return {
    close() {
      stopped = true;
      clearTimeout(retry);
      window.removeEventListener('online', online);
      try { ws?.close(); } catch {}
    },
  };
}

export function registerServiceWorker(onUpdate = () => {}) {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return Promise.resolve(null);
  return navigator.serviceWorker.register('/sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) onUpdate(worker);
      });
    });
    return reg;
  });
}

export function fmtBytes(b) {
  if (b == null) return '—';
  const u = ['o', 'Ko', 'Mo', 'Go', 'To']; let i = 0; let v = b;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${u[i]}`;
}
export const fmtUptime = (s) => {
  if (s == null) return '—';
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}j ${h}h` : h > 0 ? `${h}h ${m}min` : `${m}min`;
};
