import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Loader2 } from 'lucide-react';
import { api } from '../api.ts';
import { Logo } from '../icons.tsx';

/** Connexion — affichée seulement si les comptes ont été activés dans les Réglages. */
export function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.login(username, password);
      await qc.invalidateQueries({ queryKey: ['auth'] });
      navigate('/', { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <form className="card auth-card" onSubmit={submit}>
        <div className="brand">
          <div className="brand-logo"><Logo /></div>
          <div className="brand-name">Motflix</div>
        </div>
        <h1>Connexion</h1>
        <p>Connectez-vous pour accéder au panel.</p>

        <div className="field">
          <label htmlFor="username">Nom d'utilisateur</label>
          <input id="username" className="input" autoComplete="username" required autoFocus
            value={username} onChange={(e) => setUsername(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="password">Mot de passe</label>
          <input id="password" className="input" type="password" required autoComplete="current-password"
            value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>

        {error && <div className="alert" role="alert"><AlertCircle className="ic ic-sm" />{error}</div>}

        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy && <Loader2 className="ic ic-sm spin" />}Se connecter
        </button>
      </form>
    </div>
  );
}
