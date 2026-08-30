import React, { useState } from 'react';
import { api } from '../api.js';
import Logo from '../components/Logo.jsx';

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event) => {
    event.preventDefault(); setError(''); setBusy(true);
    try { await api.login(username, password); onLogin(); }
    catch (e) { setError(e.message || 'Connexion impossible'); }
    finally { setBusy(false); }
  };
  return <main className="login-page">
    <section className="login-panel" aria-labelledby="login-title">
      <div className="login-brand"><Logo size="large"/><div><p className="eyebrow">Centre de contrôle</p><h1 id="login-title">Matrix<span>AI</span></h1><p>Supervisez et pilotez votre flotte depuis n’importe où.</p></div></div>
      <div className="login-card">
        <div><h2>Bon retour</h2><p className="muted">Connectez-vous à votre espace sécurisé.</p></div>
        <form onSubmit={submit}>
          {error && <div className="error" role="alert">{error}</div>}
          <label htmlFor="username">Identifiant</label>
          <input id="username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
          <label htmlFor="password">Mot de passe</label>
          <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <button type="submit" className="button full" disabled={busy}>{busy ? 'Connexion…' : 'Se connecter'}<span aria-hidden="true">→</span></button>
        </form>
      </div>
      <p className="login-foot">Connexion chiffrée recommandée via HTTPS ou Tailscale.</p>
    </section>
  </main>;
}
