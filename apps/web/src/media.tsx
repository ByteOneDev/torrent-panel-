// Éléments communs à la recherche et à la bibliothèque : affiche, ajout, fiche d'un titre.
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, RotateCw, Trash2, X } from 'lucide-react';
import type { BookFormat, LibraryItem, LibraryStatus, MediaKind, SearchResult } from '@motflix/shared';
import { api } from './api.ts';
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  const toast = useToast();

  const toggleFormat = (f: BookFormat) =>
    setFormats((all) => (all.includes(f) ? all.filter((x) => x !== f) : [...all, f]));

  async function add() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.library.add({ kind: item.kind, key: item.key, search, monitor, formats });
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
        <h3>{KIND_LABEL[item.kind].add}</h3>
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
          <span className="badge accent" style={{ alignSelf: 'flex-start' }}>Selon vos préférences de langue et de qualité (Réglages)</span>
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
        <label className="setting" style={{ padding: 0, border: 0 }}>
          <span className="txt"><b>Lancer la recherche maintenant</b>
            <p>Sinon, {KIND_LABEL[item.kind].one === 'série' ? 'elle' : 'il'} sera cherché{KIND_LABEL[item.kind].one === 'série' ? 'e' : ''} lors du prochain passage automatique.</p></span>
          <span className="toggle"><input type="checkbox" checked={search} onChange={(e) => setSearch(e.target.checked)} /><span /></span>
        </label>
        {error && <div className="alert" role="alert">{error}</div>}
      </div>
      <div className="modal-foot">
        <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
        <button className="btn btn-primary" onClick={add} disabled={busy || (item.kind === 'book' && !formats.length)}>
          {busy ? <Loader2 className="ic ic-sm spin" /> : <Plus className="ic ic-sm" />}Ajouter
        </button>
      </div>
    </Dialog>
  );
}

// ─── Fiche d'un titre de la bibliothèque ─────────────────────────────────

export function ItemDialog({ item, format, onClose }: { item: LibraryItem; format?: BookFormat; onClose: () => void }) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [deleteFiles, setDeleteFiles] = useState(false);
  const [busy, setBusy] = useState<'search' | 'remove' | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const badge = STATUS_BADGE[item.status];

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
      <div className="modal-foot">
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
      </div>
    </Dialog>
  );
}
