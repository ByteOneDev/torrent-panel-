// Éléments communs à la recherche et à la bibliothèque : affiche, ajout, fiche d'un titre.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, RotateCw, Trash2, X } from 'lucide-react';
import type { BookFormat, LanguagePreset, LibraryItem, LibraryStatus, MediaKind, SearchResult } from '@motflix/shared';
import { api } from './api.ts';
import { useRole } from './hooks.ts';
import { bytes, percent } from './format.ts';
import { useToast } from './ui.tsx';

export const KIND_LABEL: Record<MediaKind, { one: string; add: string }> = {
  movie: { one: 'film', add: 'Ajouter un film' },
  series: { one: 'série', add: 'Ajouter une série' },
  book: { one: 'livre', add: 'Ajouter un livre' },
};

export const STATUS_BADGE: Record<LibraryStatus, { cls: string; label: string }> = {
  available: { cls: 'ok', label: 'Disponible' },
  partial: { cls: 'warn', label: 'En partie' },
  downloading: { cls: '', label: 'Téléchargement' },
  missing: { cls: 'warn', label: 'Recherché' },
  unreleased: { cls: '', label: 'Pas encore sorti' },
};

/** Choix de langue pour un titre : vos préférences, ou une variante ponctuelle. */
export function LanguageSelect({ value, onChange, id, disabled }: {
  value: LanguagePreset; onChange: (v: LanguagePreset) => void; id: string; disabled?: boolean;
}) {
  const prefs = useQuery({ queryKey: ['prefs'], queryFn: api.settings.preferences, staleTime: 60_000 });
  const order = prefs.data?.languages.join(' › ');
  return (
    <select id={id} className="input" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as LanguagePreset)}>
      <option value="default">Mes préférences{order ? ` (${order})` : ''}</option>
      <option value="original">Version originale d'abord (VO › VOSTFR › MULTi › VF)</option>
      <option value="french">Français seulement (VF › MULTi)</option>
    </select>
  );
}

/** Affiche avec repli sur un dégradé titré si l'image manque. */
export function Poster({ title, src, badge, progress }: {
  title: string; src: string | null; badge?: { cls: string; label: string }; progress?: number | null;
}) {
  const [broken, setBroken] = useState(false);
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="poster-art">
      {src && !broken && (
        <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" className={loaded ? 'loaded' : ''}
          onLoad={() => setLoaded(true)} onError={() => setBroken(true)} />
      )}
      {badge && <span className={`badge ${badge.cls}`}>{badge.label}</span>}
      {(!src || broken || !loaded) && <strong>{title}</strong>}
      {progress !== null && progress !== undefined && <div className="prog"><i style={{ width: `${progress * 100}%` }} /></div>}
    </div>
  );
}

function Dialog({ onClose, children, label }: { onClose: () => void; children: React.ReactNode; label: string }) {
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={label}
      onClick={(e) => e.target === e.currentTarget && onClose()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="card modal media-dialog">{children}</div>
    </div>
  );
}

// ─── Ajout ───────────────────────────────────────────────────────────────

export function AddDialog({ item, onClose }: { item: SearchResult; onClose: () => void }) {
  const [search, setSearch] = useState(true);
  const [monitor, setMonitor] = useState<'all' | 'future'>('all');
  const [formats, setFormats] = useState<BookFormat[]>(['eBook']);
  const [language, setLanguage] = useState<LanguagePreset>('default');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const requesting = useRole() !== 'admin';

  const toggleFormat = (f: BookFormat) =>
    setFormats((all) => (all.includes(f) ? all.filter((x) => x !== f) : [...all, f]));

  async function add() {
    setBusy(true);
    setError(null);
    try {
      if (requesting) {
        // Membre : la demande attend la validation de l'administrateur (sauf validation automatique).
        const r = await api.requests.create({ kind: item.kind, key: item.key, title: item.title, year: item.year, poster: item.poster, language, formats });
        toast({ title: r.status === 'approved' ? 'Demande acceptée' : 'Demande envoyée', detail: r.status === 'approved' ? item.title : `${item.title} · en attente de validation` });
        await qc.invalidateQueries({ queryKey: ['requests'] });
        onClose();
        return;
      }
      const r = await api.library.add({ kind: item.kind, key: item.key, search, monitor, formats, language });
      toast({ title: r.detail, detail: item.title });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['library'] }),
        qc.invalidateQueries({ queryKey: ['search'] }),
        qc.invalidateQueries({ queryKey: ['dashboard'] }),
      ]);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog onClose={onClose} label={`Ajouter ${item.title}`}>
      <div className="card-head">
        <h3>{requesting ? `Demander ${item.kind === 'series' ? 'cette série' : item.kind === 'movie' ? 'ce film' : 'ce livre'}` : KIND_LABEL[item.kind].add}</h3>
        <div className="right"><button className="icon-btn sm" onClick={onClose} aria-label="Fermer"><X className="ic ic-sm" /></button></div>
      </div>
      <div className="modal-body">
        <div className="media-hero">
          <Poster title={item.title} src={item.poster} />
          <div style={{ minWidth: 0 }}>
            <h3>{item.title} {item.year && <span className="dim" style={{ fontWeight: 400 }}>({item.year})</span>}</h3>
            {item.subtitle && <span className="dim">{item.subtitle}</span>}
            {item.overview && <p className="overview">{item.overview}</p>}
          </div>
        </div>

        {item.kind !== 'book' && (
          <div className="field">
            <label htmlFor="add-lang">Langue</label>
            <LanguageSelect id="add-lang" value={language} onChange={setLanguage} />
            <span className="hint-text">Qualité et taille : selon vos Réglages. La langue peut être changée plus tard.</span>
          </div>
        )}
        {item.kind === 'series' && (
          <div className="field">
            <label htmlFor="monitor">Épisodes à récupérer</label>
            <select id="monitor" className="input" value={monitor} onChange={(e) => setMonitor(e.target.value as 'all' | 'future')}>
              <option value="all">Tous les épisodes</option>
              <option value="future">Seulement les prochains épisodes</option>
            </select>
          </div>
        )}
        {item.kind === 'book' && (
          <div className="field">
            <label>Formats</label>
            <div className="checks">
              <label><input type="checkbox" checked={formats.includes('eBook')} onChange={() => toggleFormat('eBook')} />Livre (EPUB)</label>
              <label><input type="checkbox" checked={formats.includes('AudioBook')} onChange={() => toggleFormat('AudioBook')} />Livre audio</label>
            </div>
          </div>
        )}
        {!requesting && <label className="setting" style={{ padding: 0, border: 0 }}>
          <span className="txt"><b>Lancer la recherche maintenant</b>
            <p>Sinon, {KIND_LABEL[item.kind].one === 'série' ? 'elle' : 'il'} sera cherché{KIND_LABEL[item.kind].one === 'série' ? 'e' : ''} lors du prochain passage automatique.</p></span>
          <span className="toggle"><input type="checkbox" checked={search} onChange={(e) => setSearch(e.target.checked)} /><span /></span>
        </label>}
        {requesting && <span className="hint-text">L'administrateur reçoit votre demande et l'ajoute à la bibliothèque.</span>}
        {error && <div className="alert" role="alert">{error}</div>}
      </div>
      <div className="modal-foot">
        <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
        <button className="btn btn-primary" onClick={add} disabled={busy || (item.kind === 'book' && !formats.length)}>
          {busy ? <Loader2 className="ic ic-sm spin" /> : <Plus className="ic ic-sm" />}{requesting ? 'Demander' : 'Ajouter'}
        </button>
      </div>
    </Dialog>
  );
}

// ─── Fiche d'un titre de la bibliothèque ─────────────────────────────────

export function ItemDialog({ item, format, onClose }: { item: LibraryItem; format?: BookFormat; onClose: () => void }) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [deleteFiles, setDeleteFiles] = useState(false);
  const [busy, setBusy] = useState<'search' | 'remove' | 'language' | null>(null);
  const [language, setLanguage] = useState<LanguagePreset | null>(item.language);
  const qc = useQueryClient();
  const toast = useToast();
  const badge = STATUS_BADGE[item.status];
  const admin = useRole() === 'admin';

  async function searchAgain() {
    setBusy('search');
    try {
      await api.library.searchAgain(item.kind, item.id, format);
      toast({ title: 'Recherche lancée', detail: item.title });
    } catch (e) {
      toast({ title: 'Recherche impossible', detail: (e as Error).message, error: true });
    } finally {
      setBusy(null);
    }
  }

  async function changeLanguage(next: LanguagePreset) {
    setBusy('language');
    try {
      await api.library.setLanguage(item.kind, item.id, next);
      setLanguage(next);
      toast({ title: 'Langue changée', detail: 'Lancez « Rechercher à nouveau » pour trouver une version dans cette langue.' });
      await qc.invalidateQueries({ queryKey: ['library'] });
    } catch (e) {
      toast({ title: 'Langue non changée', detail: (e as Error).message, error: true });
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy('remove');
    try {
      await api.library.remove(item.kind, item.id, deleteFiles, format);
      toast({ title: `${item.title} retiré`, detail: deleteFiles ? 'Fichiers supprimés' : 'Fichiers conservés' });
      await qc.invalidateQueries({ queryKey: ['library'] });
      onClose();
    } catch (e) {
      toast({ title: 'Impossible de retirer ce titre', detail: (e as Error).message, error: true });
      setBusy(null);
    }
  }

  return (
    <Dialog onClose={onClose} label={item.title}>
      <div className="card-head">
        <h3>{item.title}</h3>
        <div className="right"><button className="icon-btn sm" onClick={onClose} aria-label="Fermer"><X className="ic ic-sm" /></button></div>
      </div>
      <div className="modal-body">
        <div className="media-hero">
          <Poster title={item.title} src={item.poster} progress={item.progress} />
          <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className="dim">{[item.year, item.subtitle].filter(Boolean).join(' · ')}</span>
            <span><span className={`badge ${badge.cls}`}>{badge.label}</span></span>
            <span className="muted">{item.detail}{item.progress !== null ? ` · ${percent(item.progress * 100)}` : ''}</span>
            {item.sizeBytes > 0 && <span className="dim">{bytes(item.sizeBytes)} sur le disque</span>}
            {item.overview && <p className="overview">{item.overview}</p>}
          </div>
        </div>
        {admin && item.kind !== 'book' && (
          <div className="field">
            <label htmlFor="item-lang">Langue voulue</label>
            {language === null
              ? <span className="dim">Réglée en dehors de Motflix. Choisissez-en une pour la gérer ici :</span> : null}
            <LanguageSelect id="item-lang" value={language ?? 'default'} onChange={changeLanguage} disabled={busy !== null} />
          </div>
        )}
        {confirmRemove && (
          <div className="alert" style={{ flexDirection: 'column' }}>
            <b>Retirer « {item.title} » de la bibliothèque ?</b>
            {item.kind !== 'book' ? (
              <label className="checks"><label><input type="checkbox" checked={deleteFiles} onChange={(e) => setDeleteFiles(e.target.checked)} />
                Supprimer aussi les fichiers du disque</label></label>
            ) : <span>Le livre ne sera plus recherché ; les fichiers déjà téléchargés restent en place.</span>}
          </div>
        )}
      </div>
      {admin && <div className="modal-foot">
        {!confirmRemove ? (
          <>
            <button className="btn btn-ghost btn-err" onClick={() => setConfirmRemove(true)} style={{ marginRight: 'auto' }}>
              <Trash2 className="ic ic-sm" />Retirer
            </button>
            <button className="btn" onClick={searchAgain} disabled={busy !== null}>
              {busy === 'search' ? <Loader2 className="ic ic-sm spin" /> : <RotateCw className="ic ic-sm" />}Rechercher à nouveau
            </button>
          </>
        ) : (
          <>
            <button className="btn btn-ghost" onClick={() => setConfirmRemove(false)}>Annuler</button>
            <button className="btn btn-danger" onClick={remove} disabled={busy !== null}>
              {busy === 'remove' && <Loader2 className="ic ic-sm spin" />}Retirer
            </button>
          </>
        )}
      </div>}
    </Dialog>
  );
}
