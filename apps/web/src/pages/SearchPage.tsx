import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Check, Loader2, Search } from 'lucide-react';
import type { MediaKind, SearchResult } from '@motflix/shared';
import { api } from '../api.ts';
import { Layout } from '../Layout.tsx';
import { AddDialog, Poster } from '../media.tsx';

const TABS: { kind: MediaKind; label: string }[] = [
  { kind: 'movie', label: 'Films' },
  { kind: 'series', label: 'Séries' },
  { kind: 'book', label: 'Livres' },
];

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const kind = (TABS.some((t) => t.kind === params.get('kind')) ? params.get('kind') : 'movie') as MediaKind;
  const q = params.get('q') ?? '';
  const [text, setText] = useState(q);
  const [adding, setAdding] = useState<SearchResult | null>(null);

  useEffect(() => setText(q), [q]);

  const results = useQuery({
    queryKey: ['search', kind, q],
    queryFn: () => api.search(kind, q),
    enabled: q.trim().length >= 2,
    staleTime: 60_000,
  });

  const go = (next: { kind?: MediaKind; q?: string }) =>
    setParams({ kind: next.kind ?? kind, q: next.q ?? q }, { replace: !!next.kind });

  return (
    <Layout title="Rechercher">
      <div className="lib-toolbar">
        <form className="search-bar" onSubmit={(e) => { e.preventDefault(); go({ q: text.trim() }); }}>
          <Search className="ic ic-sm dim" />
          <input autoFocus placeholder="Titre d'un film, d'une série, d'un livre…" value={text} onChange={(e) => setText(e.target.value)} aria-label="Rechercher" />
          {results.isFetching && <Loader2 className="ic ic-sm spin dim" />}
        </form>
        <div className="chips">
          {TABS.map((t) => (
            <button key={t.kind} className={`chip ${t.kind === kind ? 'active' : ''}`} onClick={() => go({ kind: t.kind })}>{t.label}</button>
          ))}
        </div>
      </div>

      {q.length < 2 && <div className="empty">Tapez au moins deux lettres, puis Entrée.</div>}
      {results.error && <div className="alert">{(results.error as Error).message}</div>}
      {results.data && !results.data.length && <div className="empty">Aucun résultat pour « {q} ».</div>}

      <div className="posters">
        {results.data?.map((r) => (
          <button key={r.key} className="poster" onClick={() => !r.inLibrary && setAdding(r)} disabled={r.inLibrary}
            title={r.inLibrary ? 'Déjà dans votre bibliothèque' : `Ajouter ${r.title}`}>
            <Poster title={r.title} src={r.poster} badge={r.inLibrary ? { cls: 'ok', label: 'Dans la bibliothèque' } : undefined} />
            <div className="poster-meta">
              <b>{r.title}</b>
              <span>{[r.year, r.subtitle].filter(Boolean).join(' · ') || ' '}</span>
            </div>
            {r.inLibrary && <span className="sr-only"><Check /> déjà ajouté</span>}
          </button>
        ))}
      </div>

      {adding && <AddDialog item={adding} onClose={() => setAdding(null)} />}
    </Layout>
  );
}
