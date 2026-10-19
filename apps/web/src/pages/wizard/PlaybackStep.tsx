import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Headphones, Loader2, LogIn, Tv } from 'lucide-react';
import type { SetupInfo } from '@motflix/shared';
import { api } from '../../api.ts';
import { Logo } from '../../icons.tsx';

export interface AbsDraft { username: string; password: string }

/** Mot de passe lisible, sans caractères ambigus : il sera tapé sur un téléphone. */
export function generatePassword(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const s = Array.from(bytes, (b) => chars[b % chars.length]).join('');
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}

function PlexCard({ info }: { info: SetupInfo }) {
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const popup = useRef<Window | null>(null);
  const qc = useQueryClient();

  useEffect(() => () => popup.current?.close(), []);

  async function connect() {
    setError(null);
    // La fenêtre s'ouvre tout de suite (sinon le navigateur la bloque), puis reçoit l'adresse.
    popup.current = window.open('about:blank', 'plex-auth', 'width=520,height=720');
    try {
      const pin = await api.setup.plexPin();
      if (popup.current) popup.current.location.href = pin.authUrl;
      else window.open(pin.authUrl, '_blank');
      setWaiting(true);
      const started = Date.now();
      while (Date.now() - started < 5 * 60_000) {
        await new Promise((r) => setTimeout(r, 2000));
        const s = await api.setup.plexPinStatus(pin.id);
        if (s.linked) {
          popup.current?.close();
          await qc.invalidateQueries({ queryKey: ['setup'] });
          return;
        }
        if (popup.current?.closed && Date.now() - started > 10_000) {
          // Fenêtre fermée : dernière vérification puis abandon.
          if ((await api.setup.plexPinStatus(pin.id)).linked) { await qc.invalidateQueries({ queryKey: ['setup'] }); return; }
          throw new Error('Fenêtre fermée avant la fin de la connexion.');
        }
      }
      throw new Error('Délai dépassé. Réessayez.');
    } catch (e) {
      popup.current?.close();
      setError((e as Error).message);
    } finally {
      setWaiting(false);
    }
  }

  async function unlink() {
    await api.setup.plexUnlink();
    await qc.invalidateQueries({ queryKey: ['setup'] });
  }

  if (!info.plex.installed) {
    return <div className="hint"><Tv className="ic ic-sm" /><span>Plex n'est pas installé sur ce serveur (choix fait à l'installation).</span></div>;
  }
  return (
    <div className="card">
      <div className="setting">
        <div className="txt">
          <b>Plex</b>
          <p>{info.plex.linked
            ? `Connecté au compte ${info.plex.account}. Les bibliothèques Films et Séries seront créées.`
            : 'Connectez votre compte Plex : Motflix y rattache ce serveur et crée les bibliothèques Films et Séries.'}</p>
        </div>
        <div className="ctl">
          {info.plex.linked ? (
            <>
              <span className="badge ok"><Check className="ic ic-sm" />Connecté</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={unlink}>Changer</button>
            </>
          ) : (
            <button type="button" className="btn btn-primary" onClick={connect} disabled={waiting}>
              {waiting ? <Loader2 className="ic ic-sm spin" /> : <LogIn className="ic ic-sm" />}
              {waiting ? 'En attente de Plex…' : 'Se connecter avec Plex'}
            </button>
          )}
        </div>
      </div>
      {waiting && <div className="setting col"><div className="hint"><Loader2 className="ic ic-sm spin" /><span>Connectez-vous dans la fenêtre Plex qui vient de s'ouvrir, puis revenez ici.</span></div></div>}
      {error && <div className="setting col"><div className="alert"><AlertTriangle className="ic ic-sm" />{error}</div></div>}
    </div>
  );
}

function AbsCard({ info, draft, onChange }: { info: SetupInfo; draft: AbsDraft; onChange: (d: AbsDraft) => void }) {
  const abs = info.audiobookshelf;
  const external = abs.initialized && !abs.managed;
  return (
    <div className="card">
      <div className="setting">
        <div className="txt">
          <b>Livres audio (Audiobookshelf)</b>
          <p>{external
            ? 'Audiobookshelf a déjà été configuré en dehors de Motflix : il est laissé tel quel.'
            : 'Ces identifiants serviront à vous connecter depuis l’appli Audiobookshelf de votre téléphone. Notez-les.'}</p>
        </div>
        <div className="ctl"><Headphones className="ic dim" /></div>
      </div>
      {!external && (
        <div className="setting col">
          <div className="grid g2">
            <div className="field">
              <label htmlFor="abs-user">Nom d'utilisateur</label>
              <input id="abs-user" className="input" value={draft.username} disabled={abs.initialized}
                onChange={(e) => onChange({ ...draft, username: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="abs-pass">Mot de passe</label>
              <input id="abs-pass" className="input mono" value={draft.password} disabled={abs.initialized}
                onChange={(e) => onChange({ ...draft, password: e.target.value })} />
            </div>
          </div>
          {abs.initialized && <span className="hint-text">Compte déjà créé par Motflix. Son mot de passe se change dans Audiobookshelf.</span>}
        </div>
      )}
    </div>
  );
}

export function PlaybackStep({ info, abs, onAbsChange }: { info: SetupInfo; abs: AbsDraft; onAbsChange: (d: AbsDraft) => void }) {
  return (
    <>
      <h2>Où allez-vous regarder ?</h2>
      <p className="lead">Chaque film et série ajouté apparaîtra automatiquement ici.</p>
      <div className="choice-cards">
        <button type="button" className="choice active"><Tv className="ic" /><b>Plex</b><span>Sur la télé, le téléphone et l'ordinateur.</span></button>
        <button type="button" className="choice" disabled><Logo size={20} /><b>Motflix App</b><span>Bientôt disponible.</span></button>
      </div>
      <PlexCard info={info} />
      <AbsCard info={info} draft={abs} onChange={onAbsChange} />
    </>
  );
}
