import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle, Code, Download, ExternalLink, Info, Languages, List, Loader2, Shield, Trash2, Tv, Users, Zap,
  type LucideIcon,
} from 'lucide-react';
import type { DownloadSettings, MediaPreferences } from '@motflix/shared';
import { api } from '../api.ts';
import { useAuthState, useServices } from '../hooks.ts';
import { ServiceIcon } from '../icons.tsx';
import { Layout } from '../Layout.tsx';
import { ConfirmDialog, originalUiUrl, useToast } from '../ui.tsx';
import { AccessInfo } from './ServicesPage.tsx';
import { IndexersStep } from './wizard/IndexersStep.tsx';
import { PlexCard } from './wizard/PlaybackStep.tsx';
import { PreferencesStep } from './wizard/PreferencesStep.tsx';
import { VpnStep } from './wizard/VpnStep.tsx';

const SECTIONS: { id: string; label: string; icon: LucideIcon }[] = [
  { id: 'langue', label: 'Langue et qualité', icon: Languages },
  { id: 'telechargements', label: 'Téléchargements', icon: Download },
  { id: 'vpn', label: 'VPN', icon: Shield },
  { id: 'sites', label: "Sites d'indexation", icon: List },
  { id: 'lecture', label: 'Lecture', icon: Tv },
  { id: 'utilisateurs', label: 'Utilisateurs et rôles', icon: Users },
  { id: 'avance', label: 'Mode avancé', icon: Code },
];

// ─── Éléments communs ────────────────────────────────────────────────────

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
      <span />
    </label>
  );
}

function Header({ title, text, applies }: { title: string; text: string; applies?: string[] }) {
  return (
    <header>
      <h2>{title}</h2>
      <p>{text}</p>
      {applies && <div className="applies">{applies.map((a, i) => <span key={a} className="badge accent">{i === 0 ? `Appliqué à : ${a}` : a}</span>)}</div>}
    </header>
  );
}

function SettingRow({ title, text, children }: { title: string; text: string; children: ReactNode }) {
  return (
    <div className="setting">
      <div className="txt"><b>{title}</b><p>{text}</p></div>
      <div className="ctl">{children}</div>
    </div>
  );
}

/** Barre « Modifications non enregistrées » : apparaît dès qu'un réglage change. */
function SaveBar({ dirty, saving, onSave, onCancel }: { dirty: boolean; saving: boolean; onSave: () => void; onCancel: () => void }) {
  return (
    <div className={`savebar ${dirty || saving ? 'show' : ''}`} role="region" aria-label="Enregistrement">
      <span className="dot warn flat" /><b>Modifications non enregistrées</b>
      <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={saving}>Annuler</button>
      <button type="button" className="btn btn-primary" onClick={onSave} disabled={saving}>
        {saving && <Loader2 className="ic ic-sm spin" />}Enregistrer
      </button>
    </div>
  );
}

/** Brouillon modifiable d'un réglage chargé depuis le serveur. */
function useDraft<T>(data: T | undefined) {
  const [draft, setDraft] = useState<T | undefined>(data);
  useEffect(() => { if (data !== undefined) setDraft(data); }, [data]);
  const dirty = data !== undefined && draft !== undefined && JSON.stringify(data) !== JSON.stringify(draft);
  return { draft, setDraft, dirty, reset: () => setDraft(data) };
}

function Failure({ error }: { error: unknown }) {
  return <div className="alert"><AlertCircle className="ic ic-sm" />{(error as Error).message}</div>;
}

// ─── Langue et qualité ───────────────────────────────────────────────────

function LanguageSection() {
  const q = useQuery({ queryKey: ['prefs'], queryFn: api.settings.preferences });
  const { draft, setDraft, dirty, reset } = useDraft<MediaPreferences>(q.data);
  const [saving, setSaving] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      const r = await api.settings.savePreferences(draft);
      toast({ title: 'Réglages enregistrés', detail: r.detail });
    } catch (e) {
      toast({ title: 'Réglages non appliqués', detail: (e as Error).message, error: true });
    } finally {
      await qc.invalidateQueries({ queryKey: ['prefs'] });
      setSaving(false);
    }
  }

  if (q.error) return <Failure error={q.error} />;
  if (!draft) return <div className="empty">Chargement…</div>;
  const set = (patch: Partial<MediaPreferences>) => setDraft({ ...draft, ...patch });

  return (
    <div className="spanel">
      <Header title="Langue et qualité" text="Ce que Motflix cherche en priorité quand vous ajoutez un film ou une série." applies={['Films', 'Séries']} />
      <div className="card"><div className="setting col"><PreferencesStep prefs={draft} onChange={setDraft} embedded /></div></div>
      <div className="card">
        <SettingRow title="Accepter la VFQ comme VF" text="Doublage québécois. Désactivé, il est traité comme une langue non désirée.">
          <Toggle label="Accepter la VFQ" checked={draft.acceptVfq} onChange={(v) => set({ acceptVfq: v })} />
        </SettingRow>
        <SettingRow title="Remplacer quand une meilleure langue sort" text="Exemple : un film en VOSTFR est remplacé automatiquement dès qu'une VF est disponible.">
          <Toggle label="Remplacer automatiquement" checked={draft.upgradeLanguage} onChange={(v) => set({ upgradeLanguage: v })} />
        </SettingRow>
        <SettingRow title="Refuser les autres langues" text="Ignore tout ce qui n'est pas dans la liste ci-dessus.">
          <Toggle label="Refuser les autres langues" checked={draft.rejectOthers} onChange={(v) => set({ rejectOthers: v })} />
        </SettingRow>
        <SettingRow title="Accepter le HDR" text="Couleurs plus riches si votre télé le supporte. Fichiers un peu plus lourds.">
          <Toggle label="Accepter le HDR" checked={draft.allowHdr} onChange={(v) => set({ allowHdr: v })} />
        </SettingRow>
        <SettingRow title="Éviter les « remux »" text="Copies intégrales du disque Blu-ray : qualité maximale, mais 20 à 40 Go par film.">
          <Toggle label="Éviter les remux" checked={draft.avoidRemux} onChange={(v) => set({ avoidRemux: v })} />
        </SettingRow>
      </div>
      <SaveBar dirty={dirty} saving={saving} onSave={save} onCancel={reset} />
    </div>
  );
}

// ─── Téléchargements ─────────────────────────────────────────────────────

function NumberInput({ value, onChange, unit, min = 0, step = 0.5, width = 90, label }: {
  value: number; onChange: (v: number) => void; unit?: string; min?: number; step?: number; width?: number; label: string;
}) {
  return (
    <span className="input-unit">
      <input className="input num" type="number" min={min} step={step} style={{ width }} aria-label={label}
        value={Number.isFinite(value) ? value : ''} onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))} />
      {unit && <span className="dim">{unit}</span>}
    </span>
  );
}

function DownloadsSection() {
  const q = useQuery({ queryKey: ['downloads'], queryFn: api.settings.downloads });
  const { draft, setDraft, dirty, reset } = useDraft<DownloadSettings>(q.data);
  const [saving, setSaving] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      qc.setQueryData(['downloads'], await api.settings.saveDownloads(draft));
      toast({ title: 'Réglages enregistrés', detail: 'Appliqués à qBittorrent' });
    } catch (e) {
      toast({ title: 'Réglages non enregistrés', detail: (e as Error).message, error: true });
    } finally {
      setSaving(false);
    }
  }

  if (q.error) return <Failure error={q.error} />;
  if (!draft) return <div className="empty">Chargement…</div>;
  const set = (patch: Partial<DownloadSettings>) => setDraft({ ...draft, ...patch });

  return (
    <div className="spanel">
      <Header title="Téléchargements" text="Vitesse, horaires et partage." applies={['qBittorrent']} />
      <div className="card">
        <div className="card-head"><h3>Vitesse</h3></div>
        <SettingRow title="Vitesse maximale de réception" text="0 = illimitée.">
          <NumberInput label="Vitesse de réception" value={draft.maxDownloadMBps} onChange={(v) => set({ maxDownloadMBps: v })} unit="Mo/s" />
        </SettingRow>
        <SettingRow title="Vitesse maximale d'envoi" text="Garder un peu de marge évite de ralentir votre connexion. 0 = illimitée.">
          <NumberInput label="Vitesse d'envoi" value={draft.maxUploadMBps} onChange={(v) => set({ maxUploadMBps: v })} unit="Mo/s" />
        </SettingRow>
        <SettingRow title="Téléchargements simultanés" text="Les autres attendent leur tour.">
          <NumberInput label="Téléchargements simultanés" value={draft.maxActiveDownloads} min={1} step={1} width={70}
            onChange={(v) => set({ maxActiveDownloads: Math.max(1, Math.round(v)) })} />
        </SettingRow>
      </div>

      <div className="card">
        <div className="card-head"><h3>Ralentir sur une plage horaire</h3></div>
        <SettingRow title="Activer la vitesse réduite" text="Par exemple en journée, pour ne pas gêner le reste de la maison.">
          <Toggle label="Vitesse réduite" checked={draft.scheduleEnabled} onChange={(v) => set({ scheduleEnabled: v })} />
        </SettingRow>
        <div className={draft.scheduleEnabled ? '' : 'locked'}>
          <SettingRow title="Plage horaire" text="Tous les jours.">
            <input className="input num" type="time" value={draft.scheduleFrom} aria-label="Début" style={{ width: 110 }}
              onChange={(e) => set({ scheduleFrom: e.target.value })} />
            <span className="dim">à</span>
            <input className="input num" type="time" value={draft.scheduleTo} aria-label="Fin" style={{ width: 110 }}
              onChange={(e) => set({ scheduleTo: e.target.value })} />
          </SettingRow>
          <SettingRow title="Vitesse pendant la plage" text="Réception / envoi. 0 = illimitée.">
            <NumberInput label="Réception réduite" value={draft.altDownloadMBps} onChange={(v) => set({ altDownloadMBps: v })} unit="Mo/s" width={80} />
            <NumberInput label="Envoi réduit" value={draft.altUploadMBps} onChange={(v) => set({ altUploadMBps: v })} unit="Mo/s" width={80} />
          </SettingRow>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h3>Partage</h3></div>
        <SettingRow title="Arrêter de partager après un ratio" text="1,0 = vous avez renvoyé autant que reçu.">
          <Toggle label="Limite de ratio" checked={draft.seedRatio !== null} onChange={(v) => set({ seedRatio: v ? 1 : null })} />
          {draft.seedRatio !== null && <NumberInput label="Ratio" value={draft.seedRatio} step={0.1} width={70} onChange={(v) => set({ seedRatio: v })} />}
        </SettingRow>
        <SettingRow title="… ou après une durée" text="Le premier des deux qui est atteint.">
          <Toggle label="Limite de durée" checked={draft.seedDays !== null} onChange={(v) => set({ seedDays: v ? 3 : null })} />
          {draft.seedDays !== null && <NumberInput label="Jours" value={draft.seedDays} step={1} width={70} unit="jours" onChange={(v) => set({ seedDays: v })} />}
        </SettingRow>
        <SettingRow title="Retirer le torrent après le partage" text="Le fichier reste dans votre bibliothèque.">
          <Toggle label="Retirer après le partage" checked={draft.removeAfterSeeding} onChange={(v) => set({ removeAfterSeeding: v })} />
        </SettingRow>
      </div>
      <SaveBar dirty={dirty} saving={saving} onSave={save} onCancel={reset} />
    </div>
  );
}

// ─── VPN ─────────────────────────────────────────────────────────────────

function VpnSection() {
  const info = useQuery({ queryKey: ['setup'], queryFn: api.setup.info });
  return (
    <div className="spanel">
      <Header title="VPN" text="Masque votre adresse IP pendant les téléchargements. Facultatif." applies={['qBittorrent']} />
      {info.error ? <Failure error={info.error} /> : info.data
        ? <div className="card"><div className="setting col"><VpnStep info={info.data} embedded /></div></div>
        : <div className="empty">Chargement…</div>}
    </div>
  );
}

// ─── Sites d'indexation ──────────────────────────────────────────────────

function SitesSection() {
  const q = useQuery({ queryKey: ['indexers'], queryFn: api.settings.indexers });
  const [busy, setBusy] = useState<number | null>(null);
  const [toDelete, setToDelete] = useState<{ id: number; name: string } | null>(null);
  const qc = useQueryClient();
  const toast = useToast();

  async function run(id: number, fn: () => Promise<unknown>, done: string) {
    setBusy(id);
    try {
      await fn();
      toast({ title: done });
    } catch (e) {
      toast({ title: 'Action impossible', detail: (e as Error).message, error: true });
    } finally {
      setBusy(null);
      await qc.invalidateQueries({ queryKey: ['indexers'] });
    }
  }

  return (
    <div className="spanel">
      <Header title="Sites d'indexation" text="Les sites où Motflix cherche les fichiers. Ils sont partagés automatiquement avec Films, Séries et Livres."
        applies={['Prowlarr', 'FlareSolverr']} />
      <div className="card">
        <div className="card-head"><h3>Vos sites</h3></div>
        {q.error && <div className="setting col"><Failure error={q.error} /></div>}
        {q.data && !q.data.length && <div className="empty">Aucun site pour l'instant : ajoutez-en ci-dessous.</div>}
        {q.data?.map((i) => (
          <div key={i.id} className="row">
            <div className="row-main">
              <b>{i.name}</b>
              <span>{i.language}{i.flaresolverr ? ' · via FlareSolverr' : ''}</span>
            </div>
            {i.flaresolverr && <span className="badge accent hide-sm"><Zap className="ic ic-sm" />FlareSolverr</span>}
            {busy === i.id && <Loader2 className="ic ic-sm spin dim" />}
            <Toggle label={`Activer ${i.name}`} checked={i.enabled}
              onChange={(v) => run(i.id, () => api.settings.setIndexer(i.id, v), v ? `${i.name} activé` : `${i.name} désactivé`)} />
            <button type="button" className="btn btn-ghost btn-sm" aria-label={`Retirer ${i.name}`} title="Retirer"
              onClick={() => setToDelete({ id: i.id, name: i.name })}><Trash2 className="ic ic-sm" /></button>
          </div>
        ))}
      </div>
      <div className="card">
        <div className="card-head"><h3>Ajouter des sites</h3></div>
        <div className="setting col"><IndexersStep info={{ indexers: q.data ?? [] }} embedded /></div>
      </div>
      {toDelete && (
        <ConfirmDialog title={`Retirer ${toDelete.name} ?`}
          message="Le site ne sera plus utilisé par Films, Séries et Livres. Vous pourrez le rajouter plus tard."
          confirmLabel="Retirer" danger onCancel={() => setToDelete(null)}
          onConfirm={() => { const d = toDelete; setToDelete(null); void run(d.id, () => api.settings.deleteIndexer(d.id), `${d.name} retiré`); }} />
      )}
    </div>
  );
}

// ─── Lecture ─────────────────────────────────────────────────────────────

function PlaybackSection() {
  const info = useQuery({ queryKey: ['setup'], queryFn: api.setup.info });
  const [applying, setApplying] = useState(false);
  const toast = useToast();

  async function applyPlex() {
    setApplying(true);
    try {
      const r = await api.settings.applyPlex();
      toast({ title: r.ok ? 'Plex configuré' : 'Plex non configuré', detail: r.detail, error: !r.ok });
    } finally {
      setApplying(false);
    }
  }

  const abs = info.data?.audiobookshelf;
  return (
    <div className="spanel">
      <Header title="Lecture" text="Où regarder vos films et séries, et écouter vos livres audio." />
      {info.error && <Failure error={info.error} />}
      {info.data && (
        <>
          <PlexCard info={info.data} onLinked={applyPlex} />
          {info.data.plex.linked && (
            <div>
              <button type="button" className="btn" onClick={applyPlex} disabled={applying}>
                {applying ? <Loader2 className="ic ic-sm spin" /> : <Tv className="ic ic-sm" />}Vérifier Plex et ses bibliothèques
              </button>
            </div>
          )}
          <div className="card">
            <SettingRow title="Livres et livres audio" text={abs?.managed
              ? `Audiobookshelf · compte « ${abs.username} » (identifiants dans Mode avancé).`
              : abs?.initialized ? 'Audiobookshelf, configuré en dehors de Motflix.' : 'Audiobookshelf n’est pas encore configuré : lancez l’assistant.'}>
              <span className={`badge ${abs?.initialized ? 'ok' : 'warn'}`}>{abs?.initialized ? 'Prêt' : 'À configurer'}</span>
            </SettingRow>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Utilisateurs ────────────────────────────────────────────────────────

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
          <input id="adm-user" className="input" autoComplete="username" required value={username} onChange={(e) => setUsername(e.target.value)} />
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
        <button className="btn btn-primary" disabled={busy}>{busy && <Loader2 className="ic ic-sm spin" />}Activer les comptes</button>
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
      <Header title="Utilisateurs et rôles" text="Facultatif. Par défaut, le panel s'ouvre directement : seul l'administrateur l'utilise, les autres regardent via Plex." />
      <div className="card">
        <SettingRow title="Activer les comptes utilisateurs" text={enabled
          ? `Activés. Administrateur : ${auth?.user?.username ?? '—'}. Le panel demande une connexion.`
          : 'Désactivés : toute personne sur votre réseau local peut ouvrir le panel.'}>
          <Toggle label="Activer les comptes utilisateurs" checked={enabled || enabling}
            onChange={(on) => (on ? setEnabling(true) : enabled ? setConfirmDisable(true) : setEnabling(false))} />
        </SettingRow>
        {!enabled && enabling && <EnableAccountsForm onCancel={() => setEnabling(false)} />}
      </div>
      <div className={`card ${enabled ? '' : 'locked'}`}>
        <div className="card-head"><h3>Rôles</h3><span className="badge right">Bientôt</span></div>
        <SettingRow title="Membre et Lecture seule" text="Inviter d'autres personnes avec des droits limités (demandes de films, consultation) arrivera dans une prochaine version.">
          <span />
        </SettingRow>
      </div>
      <p className="dim" style={{ fontSize: 12.5, margin: 0 }}>
        Mot de passe oublié : <code className="mono">docker exec motflix-panel node src/reset-auth.ts</code> désactive les comptes.
      </p>
      {confirmDisable && (
        <ConfirmDialog title="Désactiver les comptes ?"
          message="Le panel ne demandera plus de mot de passe : toute personne sur votre réseau local pourra l'ouvrir."
          confirmLabel="Désactiver" danger onCancel={() => setConfirmDisable(false)} onConfirm={disable} />
      )}
    </div>
  );
}

// ─── Mode avancé ─────────────────────────────────────────────────────────

function AdvancedSection() {
  const { data } = useServices();
  const tools = data?.services.filter((s) => s.ui && s.state !== 'missing') ?? [];
  return (
    <div className="spanel">
      <Header title="Mode avancé" text="Les interfaces d'origine de chaque outil, pour les réglages que Motflix ne propose pas." />
      <div className="hint"><Info className="ic ic-sm" /><span>
        Les réglages de Motflix restent la référence : un réglage fait ici peut être écrasé si vous changez ensuite
        le réglage correspondant dans Motflix (langue, qualité, téléchargements…).
      </span></div>
      {tools.map((s) => {
        const url = data ? originalUiUrl(s, data.toolsExposed) : null;
        return (
          <div key={s.id} className="card">
            <div className="svc-detail-head" style={{ padding: '16px 20px' }}>
              <span className="svc-icon"><ServiceIcon name={s.icon} /></span>
              <div><h2 style={{ fontSize: 15 }}>{s.name}</h2><span className="dim">{s.tool}</span></div>
              <div className="actions">
                {url
                  ? <a className="btn" href={url} target="_blank" rel="noreferrer"><ExternalLink className="ic ic-sm" />Ouvrir {s.tool}</a>
                  : <span className="dim" style={{ fontSize: 12.5 }}>Joignable seulement depuis le serveur</span>}
                <Link className="btn btn-ghost" to={`/services/${s.id}`}>Console</Link>
              </div>
            </div>
            <AccessInfo service={s} />
          </div>
        );
      })}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────

export function SettingsPage() {
  const { section } = useParams();
  const navigate = useNavigate();
  if (!SECTIONS.some((s) => s.id === section)) return <Navigate to="/reglages/langue" replace />;

  return (
    <Layout title="Réglages">
      <div className="settings">
        <nav className="settings-nav" aria-label="Sections des réglages">
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" className={id === section ? 'active' : ''} onClick={() => navigate(`/reglages/${id}`)}>
              <Icon className="ic ic-sm" />{label}
            </button>
          ))}
        </nav>
        {section === 'langue' && <LanguageSection />}
        {section === 'telechargements' && <DownloadsSection />}
        {section === 'vpn' && <VpnSection />}
        {section === 'sites' && <SitesSection />}
        {section === 'lecture' && <PlaybackSection />}
        {section === 'utilisateurs' && <UsersSection />}
        {section === 'avance' && <AdvancedSection />}
      </div>
    </Layout>
  );
}
