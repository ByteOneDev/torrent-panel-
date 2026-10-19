import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle, Code, Download, Info, Languages, List, Loader2, Shield, Tv, Users, type LucideIcon,
} from 'lucide-react';
import { api } from '../api.ts';
import { useAuthState } from '../hooks.ts';
import { Layout } from '../Layout.tsx';
import { ConfirmDialog, useToast } from '../ui.tsx';

const SECTIONS: { id: string; label: string; icon: LucideIcon; ready?: boolean }[] = [
  { id: 'langue', label: 'Langue et qualité', icon: Languages },
  { id: 'telechargements', label: 'Téléchargements', icon: Download },
  { id: 'vpn', label: 'VPN', icon: Shield },
  { id: 'indexeurs', label: "Sites d'indexation", icon: List },
  { id: 'lecture', label: 'Lecture', icon: Tv },
  { id: 'utilisateurs', label: 'Utilisateurs et rôles', icon: Users, ready: true },
  { id: 'avance', label: 'Mode avancé', icon: Code },
];

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
      <span />
    </label>
  );
}

/** Formulaire affiché quand on active les comptes : il définit l'administrateur. */
function EnableAccountsForm({ onCancel }: { onCancel: () => void }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) return setError('Les deux mots de passe ne correspondent pas.');
    setBusy(true);
    try {
      await api.enableAccounts(username, password);
      await qc.invalidateQueries({ queryKey: ['auth'] });
      toast({ title: 'Comptes activés', detail: `Connecté en tant que ${username}` });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="setting col" onSubmit={submit}>
      <div className="hint"><Info className="ic ic-sm" /><span>
        Définissez le compte administrateur. Le panel demandera ensuite ce mot de passe à chaque nouvel appareil.
      </span></div>
      <div className="grid g3">
        <div className="field">
          <label htmlFor="adm-user">Nom d'utilisateur</label>
          <input id="adm-user" className="input" autoComplete="username" required
            value={username} onChange={(e) => setUsername(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="adm-pass">Mot de passe</label>
          <input id="adm-pass" className="input" type="password" autoComplete="new-password" required minLength={8} autoFocus
            value={password} onChange={(e) => setPassword(e.target.value)} />
          <span className="hint-text">8 caractères minimum.</span>
        </div>
        <div className="field">
          <label htmlFor="adm-confirm">Confirmer</label>
          <input id="adm-confirm" className="input" type="password" autoComplete="new-password" required
            value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
      </div>
      {error && <div className="alert" role="alert"><AlertCircle className="ic ic-sm" />{error}</div>}
      <div className="form-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Annuler</button>
        <button className="btn btn-primary" disabled={busy}>
          {busy && <Loader2 className="ic ic-sm spin" />}Activer les comptes
        </button>
      </div>
    </form>
  );
}

function UsersSection() {
  const { data: auth } = useAuthState();
  const [enabling, setEnabling] = useState(false);
  const [confirmDisable, setConfirmDisable] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const enabled = !!auth?.authEnabled;

  async function disable() {
    setConfirmDisable(false);
    try {
      await api.disableAccounts();
      await qc.invalidateQueries({ queryKey: ['auth'] });
      toast({ title: 'Comptes désactivés', detail: 'Le panel est accessible sans connexion' });
      navigate('/reglages/utilisateurs');
    } catch (err) {
      toast({ title: 'Impossible de désactiver les comptes', detail: (err as Error).message, error: true });
    }
  }

  return (
    <div className="spanel">
      <header>
        <h2>Utilisateurs et rôles</h2>
        <p>Facultatif. Par défaut, le panel s'ouvre directement : seul l'administrateur l'utilise, les autres regardent via Plex.</p>
      </header>

      <div className="card">
        <div className="setting">
          <div className="txt">
            <b>Activer les comptes utilisateurs</b>
            <p>{enabled
              ? `Activés. Administrateur : ${auth?.user?.username ?? '—'}. Le panel demande une connexion.`
              : 'Désactivés : toute personne sur votre réseau local peut ouvrir le panel.'}</p>
          </div>
          <div className="ctl">
            <Toggle label="Activer les comptes utilisateurs" checked={enabled || enabling}
              onChange={(on) => (on ? setEnabling(true) : enabled ? setConfirmDisable(true) : setEnabling(false))} />
          </div>
        </div>
        {!enabled && enabling && <EnableAccountsForm onCancel={() => setEnabling(false)} />}
      </div>

      <div className={`card ${enabled ? '' : 'locked'}`}>
        <div className="card-head"><h3>Rôles</h3><span className="badge right">Bientôt</span></div>
        <div className="setting">
          <div className="txt">
            <b>Membre et Lecture seule</b>
            <p>Inviter d'autres personnes avec des droits limités (demandes de films, consultation) arrivera dans une prochaine version.</p>
          </div>
        </div>
      </div>

      <p className="dim" style={{ fontSize: 12.5, margin: 0 }}>
        Mot de passe oublié : <code className="mono">docker exec motflix-panel node src/reset-auth.ts</code> désactive les comptes.
      </p>

      {confirmDisable && (
        <ConfirmDialog
          title="Désactiver les comptes ?"
          message="Le panel ne demandera plus de mot de passe : toute personne sur votre réseau local pourra l'ouvrir."
          confirmLabel="Désactiver" danger
          onCancel={() => setConfirmDisable(false)}
          onConfirm={disable}
        />
      )}
    </div>
  );
}

export function SettingsPage() {
  return (
    <Layout title="Réglages">
      <div className="settings">
        <nav className="settings-nav" aria-label="Sections des réglages">
          {SECTIONS.map(({ id, label, icon: Icon, ready }) => (
            <button key={id} className={id === 'utilisateurs' ? 'active' : ''} disabled={!ready}
              title={ready ? undefined : 'Arrive dans une prochaine version'}>
              <Icon className="ic ic-sm" />{label}{!ready && <span className="count">bientôt</span>}
            </button>
          ))}
        </nav>
        <UsersSection />
      </div>
    </Layout>
  );
}
