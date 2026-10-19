import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Loader2, Plus, Search, Zap } from 'lucide-react';
import type { IndexerAddResult, SetupInfo } from '@motflix/shared';
import { api } from '../../api.ts';

export function IndexersStep({ info }: { info: SetupInfo }) {
  const defs = useQuery({ queryKey: ['indexer-defs'], queryFn: api.setup.indexerDefinitions, staleTime: 3_600_000 });
  const [query, setQuery] = useState('');
  const [onlyFrench, setOnlyFrench] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<IndexerAddResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();

  const configured = new Set(info.indexers.map((i) => i.name));
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (defs.data ?? []).filter((d) =>
      !configured.has(d.name) &&
      (!onlyFrench || d.language.toLowerCase().startsWith('fr')) &&
      (!q || d.name.toLowerCase().includes(q) || d.description.toLowerCase().includes(q)));
  }, [defs.data, query, onlyFrench, info.indexers]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggle(name: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(name)) n.delete(name); else n.add(name);
      return n;
    });
  }

  async function add() {
    setBusy(true);
    setError(null);
    try {
      setResults(await api.setup.addIndexers([...selected]));
      setSelected(new Set());
      await qc.invalidateQueries({ queryKey: ['setup'] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h2>Sites d'indexation</h2>
      <p className="lead">Les sites où Motflix cherchera les fichiers. Étape facultative : vous pourrez en ajouter plus tard.</p>

      {info.indexers.length > 0 && (
        <div className="hint ok"><Check className="ic ic-sm" /><span>Déjà configurés : <b>{info.indexers.map((i) => i.name).join(', ')}</b></span></div>
      )}

      <div className="console-bar" style={{ padding: 0, border: 0 }}>
        <Search className="ic ic-sm dim" />
        <input placeholder={`Rechercher parmi ${defs.data?.length ?? '…'} sites publics`} value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Rechercher un site" />
        <button type="button" className={`chip ${onlyFrench ? 'active' : ''}`} onClick={() => setOnlyFrench((v) => !v)}>Français</button>
      </div>

      <div className="def-list" role="list">
        {defs.isLoading && <div className="empty">Chargement de la liste de Prowlarr…</div>}
        {defs.error && <div className="empty">{(defs.error as Error).message}</div>}
        {defs.data && !list.length && <div className="empty">Aucun site ne correspond.</div>}
        {list.map((d) => (
          <label key={d.name} className="def-row" role="listitem">
            <input type="checkbox" checked={selected.has(d.name)} onChange={() => toggle(d.name)} />
            <div className="txt"><b>{d.name}</b> <span className="badge" style={{ display: 'inline-flex' }}>{d.language}</span><span>{d.description}</span></div>
          </label>
        ))}
      </div>

      <div className="hint"><Zap className="ic ic-sm" /><span>Les sites protégés contre les robots passent automatiquement par FlareSolverr.</span></div>

      {error && <div className="alert"><AlertTriangle className="ic ic-sm" />{error}</div>}
      {results && (
        <div className="checklist">
          {results.map((r) => (
            <div key={r.name} className={`check-row ${r.ok ? '' : 'error'}`}>
              <span className={`st ${r.ok ? 'done' : 'error'}`}>{r.ok ? <Check size={13} strokeWidth={3} /> : '!'}</span>
              <div className="lbl"><b>{r.name}</b><span>{r.message}</span></div>
            </div>
          ))}
        </div>
      )}

      <div>
        <button type="button" className="btn" disabled={!selected.size || busy} onClick={add}>
          {busy ? <Loader2 className="ic ic-sm spin" /> : <Plus className="ic ic-sm" />}
          {busy ? 'Ajout et test en cours…' : `Ajouter ${selected.size || ''} site${selected.size > 1 ? 's' : ''}`}
        </button>
      </div>
    </>
  );
}
