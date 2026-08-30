import React, { createContext, useContext, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, NavLink, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import Logo from './components/Logo.jsx';
import Login from './pages/Login.jsx';
import Settings from './pages/Settings.jsx';
import Events from './pages/Events.jsx';
import Overview from './pages/Overview.jsx';
import Machine from './pages/Machine.jsx';
import { api, connectWS, registerServiceWorker } from './api.js';
import './style.css';

export const LiveContext = createContext({});
const NAV = [
  { to: '/overview', icon: '◫', label: 'Flotte' },
  { to: '/events', icon: '◎', label: 'Événements' },
  { to: '/settings', icon: '⚙', label: 'Réglages' },
];

const OverviewPage = () => <Overview />;
const MachinePage = () => { const nav = useNavigate(); const { id } = useParams(); return <Machine id={id} back={() => nav('/overview')} />; };

function NotFound() {
  return <section className="empty-state"><div className="empty-icon">404</div><h1>Page introuvable</h1><p>Cette page n’existe pas ou a été déplacée.</p><NavLink className="button" to="/overview">Retour à la flotte</NavLink></section>;
}

function AuthenticatedApp({ onLogout }) {
  const [live, setLive] = useState({});
  const [wsState, setWsState] = useState('connecting');
  const [online, setOnline] = useState(navigator.onLine);
  const [updateWorker, setUpdateWorker] = useState(null);

  useEffect(() => {
    const conn = connectWS((m) => {
      if (m.type === 'metrics') setLive((prev) => ({ ...prev, [m.machine.id]: m.metrics }));
    }, setWsState);
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    registerServiceWorker(setUpdateWorker).catch(() => {});
    return () => { conn.close(); window.removeEventListener('online', goOnline); window.removeEventListener('offline', goOffline); };
  }, []);

  const logout = async () => { try { await api.logout(); } catch {} finally { onLogout(); } };
  const liveOk = online && wsState === 'connected';

  return <LiveContext.Provider value={live}>
    <a className="skip-link" href="#main-content">Aller au contenu</a>
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <NavLink to="/overview" className="brand" aria-label="MatrixAI, accueil">
            <Logo size="small"/><span>Matrix<span>AI</span></span>
          </NavLink>
          <nav className="desktop-nav" aria-label="Navigation principale">
            {NAV.map((n) => <NavLink key={n.to} to={n.to} className={({ isActive }) => isActive ? 'active' : ''}><span aria-hidden="true">{n.icon}</span>{n.label}</NavLink>)}
          </nav>
          <div className="top-actions">
            <span className={`connection-pill ${liveOk ? 'is-online' : ''}`} title={`Temps réel : ${wsState}`}><i />{liveOk ? 'Temps réel' : online ? 'Reconnexion…' : 'Hors ligne'}</span>
            <button className="icon-button logout-button" onClick={logout} aria-label="Se déconnecter" title="Se déconnecter">↪</button>
          </div>
        </div>
      </header>

      {!online && <div className="status-banner warning" role="status">Mode hors ligne — les commandes sont temporairement indisponibles.</div>}
      {updateWorker && <div className="status-banner update" role="status">Une nouvelle version est disponible.<button onClick={() => { updateWorker.postMessage({ type: 'SKIP_WAITING' }); location.reload(); }}>Mettre à jour</button></div>}

      <main id="main-content" className="container" tabIndex="-1">
        <Routes>
          <Route path="/" element={<Navigate to="/overview" replace/>}/>
          <Route path="/overview" element={<OverviewPage/>}/>
          <Route path="/machine/:id" element={<MachinePage/>}/>
          <Route path="/settings" element={<Settings/>}/>
          <Route path="/events" element={<Events/>}/>
          <Route path="*" element={<NotFound/>}/>
        </Routes>
      </main>

      <nav className="bottom-nav" aria-label="Navigation principale mobile">
        {NAV.map((n) => <NavLink key={n.to} to={n.to} className={({ isActive }) => isActive ? 'active' : ''}><span aria-hidden="true">{n.icon}</span><small>{n.label}</small></NavLink>)}
      </nav>
    </div>
  </LiveContext.Provider>;
}

export default function App() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.me().then(() => setLoggedIn(true)).catch(() => setLoggedIn(false)).finally(() => setLoading(false));
    const unauthorized = () => setLoggedIn(false);
    window.addEventListener('matrixai:unauthorized', unauthorized);
    return () => window.removeEventListener('matrixai:unauthorized', unauthorized);
  }, []);
  if (loading) return <div className="splash" role="status"><Logo size="medium"/><span>Chargement de MatrixAI…</span></div>;
  return <BrowserRouter>{loggedIn ? <AuthenticatedApp onLogout={() => setLoggedIn(false)}/> : <Login onLogin={() => setLoggedIn(true)}/>}</BrowserRouter>;
}
