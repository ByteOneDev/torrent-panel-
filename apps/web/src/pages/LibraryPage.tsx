import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import type { BookFormat, LibraryItem, LibraryStatus, MediaKind } from '@motflix/shared';
import { api } from '../api.ts';
import { useRole } from '../hooks.ts';
import { Layout } from '../Layout.tsx';
import { ItemDialog, KIND_LABEL, Poster, STATUS_BADGE } from '../media.tsx';

type Filter = 'all' | 'available' | 'downloading' | 'missing';
const FILTERS: { id: Filter; label: string; match: (s: LibraryStatus) => boolean }[] = [
  { id: 'all', label: 'Tous', match: () => true },
  { id: 'available', label: 'Disponibles', match: (s) => s === 'available' || s === 'partial' },
  { id: 'downloading', label: 'En téléchargement', match: (s) => s === 'downloading' },
  { id: 'missing', label: 'Recherchés', match: (s) => s === 'missing' || s === 'unreleased' },
];

export function LibraryPage({ kind, format, title }: { kind: MediaKind; format?: BookFormat; title: string }) {
  const q = useQuery({
    queryKey: ['library', kind, format ?? ''],
    queryFn: () => (kind === 'movie' ? api.library.movies() : kind === 'series' ? api.library.series() : api.library.books(format!)),
    refetchInterval: 15_000,
  });
  const [filter, setFilter] = useState<Filter>('all');
  const [text, setText] = useState('');
  const [open, setOpen] = useState<LibraryItem | null>(null);
  const role = useRole();
  const canAdd = role !== 'viewer';

  const items = useMemo(() => {
    const t = text.trim().toLowerCase();
    const f = FILTERS.find((x) => x.id === filter)!;
    return (q.data ?? []).filter((i) => f.match(i.status) && (!t || i.title.toLowerCase().includes(t) || (i.subtitle ?? '').toLowerCase().includes(t)));
  }, [q.data, filter, text]);

  const count = (f: (typeof FILTERS)[number]) => (q.data ?? []).filter((i) => f.match(i.status)).length;

  return (
    <Layout title={title}>
      <div className="lib-toolbar">
        <div className="chips">
          {FILTERS.map((f) => (
            <button key={f.id} className={`chip ${filter === f.id ? 'active' : ''}`} onClick={() => setFilter(f.id)}>
              {f.label}{q.data ? ` · ${count(f)}` : ''}
            </button>
          ))}
        </div>
        <div className="right">
          <label className="top-search" style={{ margin: 0 }}>
            <Search className="ic ic-sm dim" />
            <input placeholder="Filtrer…" value={text} onChange={(e) => setText(e.target.value)} aria-label="Filtrer la bibliothèque" />
          </label>
          {canAdd && <Link className="btn btn-primary" to={`/recherche?kind=${kind}`}><Plus className="ic ic-sm" />{role === 'admin' ? 'Ajouter' : 'Demander'}</Link>}
        </div>
      </div>

      {q.error && <div className="alert">{(q.error as Error).message}</div>}
      {q.isLoading && <div className="posters">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="skeleton" style={{ aspectRatio: '2 / 3' }} />)}</div>}

      <div className="posters">
        {items.map((i) => (
          <button key={i.id} className="poster" onClick={() => setOpen(i)} title={i.title}>
            <Poster title={i.title} src={i.poster} badge={STATUS_BADGE[i.status]} progress={i.progress} />
            <div className="poster-meta">
              <b>{i.title}</b>
              <span>{[i.year, i.kind === 'book' ? i.subtitle : i.detail].filter(Boolean).join(' · ') || ' '}</span>
            </div>
          </button>
        ))}
        {q.data && canAdd && (
          <Link className="poster-add" to={`/recherche?kind=${kind}`}>
            <div><Plus className="ic" /><div style={{ marginTop: 6, fontWeight: 550 }}>
              {role === 'admin' ? KIND_LABEL[kind].add : KIND_LABEL[kind].add.replace('Ajouter', 'Demander')}</div></div>
          </Link>
        )}
      </div>
      {q.data && !q.data.length && <div className="empty">Votre bibliothèque est vide pour l'instant.</div>}

      {open && <ItemDialog item={open} format={format} onClose={() => setOpen(null)} />}
    </Layout>
  );
}
