import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, Check, Copy, FolderInput, HardDrive, Info, Loader2, MoveRight, RotateCw, ScanSearch, Usb,
} from 'lucide-react';
import type { ImportMode, ImportSource } from '@motflix/shared';
import { api } from '../api.ts';
import { bytes } from '../format.ts';
import { Layout } from '../Layout.tsx';
import { Poster } from '../media.tsx';
import { Bar, ConfirmDialog, useToast } from '../ui.tsx';

function SourceCard({ source, onAnalyze, disabled }: { source: ImportSource; onAnalyze: () => void; disabled: boolean }) {
  const Icon = source.id.startsWith('disk:') ? Usb : source.id === 'inbox' ? FolderInput : HardDrive;
  return (
    <div className="card svc">
      <div className="svc-head">
        <span className="svc-icon"><Icon className="ic" /></span>
        <div className="svc-name"><b>{source.label}</b><span>{source.id.startsWith('disk:') ? 'Disque branché' : 'Sur ce serveur'}</span></div>
      </div>
      <span className="dim" style={{ fontSize: 13 }}>{source.description}</span>
      {source.hostPath && <code className="mono" style={{ alignSelf: 'flex-start', fontSize: 12 }}>{source.hostPath}</code>}
      <div className="svc-actions">
        {source.freeBytes !== null && <span className="dim" style={{ fontSize: 12 }}>{bytes(source.freeBytes, 0)} libres</span>}
        <button className="btn btn-primary btn-sm" onClick={onAnalyze} disabled={disabled}><ScanSearch className="ic ic-sm" />Analyser</button>
      </div>
    </div>
  );
}

export function ImportPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const sources = useQuery({ queryKey: ['import-sources'], queryFn: api.import.sources, refetchInterval: 10_000 });
  const status = useQuery({
    queryKey: ['import-status'], queryFn: api.import.status,
    refetchInterval: (q) => (q.state.data && ['analyzing', 'importing'].includes(q.state.data.phase) ? 1000 : false),
  });
  const s = status.data;
  const analysis = s?.analysis ?? null;
  const source = sources.data?.find((x) => x.id === s?.sourceId) ?? null;

  const [movies, setMovies] = useState<Set<string>>(new Set());
  const [series, setSeries] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<ImportMode>('copy');
  const [upgrade, setUpgrade] = useState(false);
  const [confirmMove, setConfirmMove] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Nouvelle analyse : tout est coché, mode par défaut de la source.
  useEffect(() => {
    if (s?.phase !== 'ready' || !analysis) return;
    setMovies(new Set(analysis.movies.map((m) => m.key)));
    setSeries(new Set(analysis.series.map((x) => x.key)));
    if (source) setMode(source.forcedMode ?? source.defaultMode);
  }, [s?.phase, analysis?.sourceId, analysis?.movies.length, analysis?.series.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedBytes = useMemo(() => {
    if (!analysis) return 0;
    return analysis.movies.filter((m) => movies.has(m.key)).reduce((a, m) => a + m.file.size, 0)
      + analysis.series.filter((x) => series.has(x.key)).reduce((a, x) => a + x.sizeBytes, 0);
  }, [analysis, movies, series]);
  const count = movies.size + series.size;

  async function analyze(id: string) {
    setError(null);
    try {
      qc.setQueryData(['import-status'], await api.import.analyze(id));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function run() {
    setConfirmMove(false);
    setError(null);
    try {
      qc.setQueryData(['import-status'], await api.import.run([...movies], [...series], mode, upgrade));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function reset() {
    qc.setQueryData(['import-status'], await api.import.reset());
    await qc.invalidateQueries({ queryKey: ['library'] });
  }

  const toggle = (set: Set<string>, setter: (v: Set<string>) => void, key: string) => {
    const n = new Set(set);
    if (n.has(key)) n.delete(key); else n.add(key);
    setter(n);
  };

  useEffect(() => {
    if (s?.phase === 'done') {
      const ok = s.results.filter((r) => r.ok).length;
      toast({ title: 'Import terminé', detail: `${ok} titre(s) sur ${s.results.length} rangé(s) dans la bibliothèque` });
      void qc.invalidateQueries({ queryKey: ['library'] });
    }
  }, [s?.phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const busy = s?.phase === 'analyzing' || s?.phase === 'importing';
  const fromDisk = !!source?.id.startsWith('disk:');

  return (
    <Layout title="Importer">
      {(!s || s.phase === 'idle' || s.phase === 'error') && (
        <>
          <div className="hint" style={{ marginBottom: 16 }}><Info className="ic ic-sm" /><span>
            Motflix reconnaît vos films et séries existants et les range dans la bibliothèque (renommés, visibles dans Plex).
            Branchez un disque : il apparaît ici en quelques secondes.
          </span></div>
          {s?.phase === 'error' && <div className="alert" style={{ marginBottom: 16 }}><AlertTriangle className="ic ic-sm" />{s.error}</div>}
          {error && <div className="alert" style={{ marginBottom: 16 }}><AlertTriangle className="ic ic-sm" />{error}</div>}
          <div className="grid g3">
            {sources.data?.map((src) => <SourceCard key={src.id} source={src} disabled={busy} onAnalyze={() => analyze(src.id)} />)}
          </div>
          {sources.data && !sources.data.some((x) => x.id.startsWith('disk:')) && (
            <p className="dim" style={{ fontSize: 13, marginTop: 16 }}>Aucun disque branché détecté pour l'instant.</p>
          )}
        </>
      )}

      {busy && s && (
        <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <b><Loader2 className="ic ic-sm spin" /> {s.phase === 'analyzing' ? `Analyse de « ${source?.label ?? ''} »` : `Import ${s.mode === 'move' ? '(déplacement)' : '(copie)'} en cours`}</b>
          <span className="dim">{s.progress.label} {s.progress.total ? `· ${s.progress.done} / ${s.progress.total}` : ''}</span>
          <Bar value={s.progress.total ? (s.progress.done / s.progress.total) * 100 : 5} />
          {s.phase === 'importing' && <span className="dim" style={{ fontSize: 12.5 }}>Une copie de gros fichiers peut prendre du temps : vous pouvez quitter cette page, l'import continue.</span>}
          {s.results.length > 0 && <Results results={s.results} />}
        </div>
      )}

      {s?.phase === 'ready' && analysis && (
        <>
          <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <b style={{ fontSize: 16 }}>« {source?.label} » : {analysis.movies.length} film(s), {analysis.series.length} série(s)</b>
              <span className="badge">{bytes(analysis.totalBytes)}</span>
              {analysis.skippedKnown > 0 && <span className="badge ok">{analysis.skippedKnown} fichier(s) déjà dans la bibliothèque</span>}
              {analysis.unrecognized.length > 0 && <span className="badge warn">{analysis.unrecognized.length} non reconnu(s)</span>}
              <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={reset}><RotateCw className="ic ic-sm" />Changer de source</button>
            </div>

            {source?.forcedMode ? (
              <div className="hint"><Info className="ic ic-sm" /><span>Ces fichiers sont déjà dans la bibliothèque : ils seront simplement renommés et rangés dans le bon dossier.</span></div>
            ) : (
              <div className="choice-cards">
                <button type="button" className={`choice ${mode === 'copy' ? 'active' : ''}`} onClick={() => setMode('copy')}>
                  <Copy className="ic" /><b>Copier</b><span>{fromDisk ? 'Le disque reste intact.' : 'Les fichiers d’origine restent en place.'}</span>
                </button>
                <button type="button" className={`choice ${mode === 'move' ? 'active' : ''}`} onClick={() => setMode('move')}>
                  <MoveRight className="ic" /><b>Déplacer (couper-coller)</b><span>Les fichiers sont retirés de « {source?.label} » une fois rangés.</span>
                </button>
              </div>
            )}
            {mode === 'move' && fromDisk && (
              <div className="alert"><AlertTriangle className="ic ic-sm" />Attention : avec « Déplacer », les fichiers seront effacés du disque après avoir été rangés. Gardez « Copier » si ce disque vous sert de sauvegarde.</div>
            )}
            <label className="setting" style={{ padding: 0, border: 0 }}>
              <span className="txt"><b>Chercher de meilleures versions</b>
                <p>Désactivé : vos fichiers sont gardés tels quels. Activé : Motflix remplacera ceux qui ne correspondent pas
                  à vos préférences (langue, qualité) par de meilleures versions, ce qui lance des téléchargements.</p></span>
              <span className="toggle"><input type="checkbox" checked={upgrade} onChange={(e) => setUpgrade(e.target.checked)} /><span /></span>
            </label>
            {error && <div className="alert"><AlertTriangle className="ic ic-sm" />{error}</div>}
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <button className="btn btn-primary" disabled={!count}
                onClick={() => (mode === 'move' && fromDisk ? setConfirmMove(true) : run())}>
                <FolderInput className="ic ic-sm" />{mode === 'move' ? 'Déplacer' : 'Importer'} {count} titre(s) · {bytes(selectedBytes)}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => { setMovies(new Set(analysis.movies.map((m) => m.key))); setSeries(new Set(analysis.series.map((x) => x.key))); }}>Tout cocher</button>
              <button className="btn btn-ghost btn-sm" onClick={() => { setMovies(new Set()); setSeries(new Set()); }}>Tout décocher</button>
            </div>
          </div>

          {analysis.movies.length > 0 && <div className="section-title"><h2>Films</h2></div>}
          <div className="posters">
            {analysis.movies.map((m) => (
              <label key={m.key} className="poster" style={{ cursor: 'pointer' }} title={m.file.path}>
                <Poster title={m.title} src={m.poster} badge={movies.has(m.key) ? { cls: 'ok', label: 'À importer' } : { cls: '', label: 'Ignoré' }} />
                <div className="poster-meta">
                  <b><input type="checkbox" checked={movies.has(m.key)} onChange={() => toggle(movies, setMovies, m.key)} style={{ accentColor: 'var(--accent)', marginRight: 6 }} />{m.title}</b>
                  <span>{[m.year, bytes(m.file.size), m.inLibrary ? 'déjà suivi' : null, m.extraFiles.length ? `+${m.extraFiles.length} doublon(s) ignoré(s)` : null].filter(Boolean).join(' · ')}</span>
                </div>
              </label>
            ))}
          </div>

          {analysis.series.length > 0 && <div className="section-title"><h2>Séries</h2></div>}
          <div className="posters">
            {analysis.series.map((x) => {
              const seasons = [...new Set(x.episodes.map((e) => e.season))].sort((a, b) => a - b);
              return (
                <label key={x.key} className="poster" style={{ cursor: 'pointer' }}>
                  <Poster title={x.title} src={x.poster} badge={series.has(x.key) ? { cls: 'ok', label: 'À importer' } : { cls: '', label: 'Ignorée' }} />
                  <div className="poster-meta">
                    <b><input type="checkbox" checked={series.has(x.key)} onChange={() => toggle(series, setSeries, x.key)} style={{ accentColor: 'var(--accent)', marginRight: 6 }} />{x.title}</b>
                    <span>{x.episodes.length} épisode(s) · saison{seasons.length > 1 ? 's' : ''} {seasons.join(', ')} · {bytes(x.sizeBytes)}</span>
                  </div>
                </label>
              );
            })}
          </div>

          {analysis.unrecognized.length > 0 && (
            <details className="card" style={{ marginTop: 24 }}>
              <summary style={{ padding: '14px 20px', cursor: 'pointer' }}><b>{analysis.unrecognized.length} fichier(s) non reconnu(s)</b> <span className="dim">— renommez-les « Titre (Année) » puis relancez l'analyse</span></summary>
              {analysis.unrecognized.map((u) => (
                <div key={u.path} className="row"><div className="row-main"><b className="mono" style={{ fontSize: 12 }}>{u.path}</b><span>{u.reason} · {bytes(u.size)}</span></div></div>
              ))}
            </details>
          )}
          {!analysis.movies.length && !analysis.series.length && <div className="empty">Rien de nouveau à importer ici.</div>}
        </>
      )}

      {s?.phase === 'done' && (
        <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <b><Check className="ic ic-sm" style={{ color: 'var(--ok)' }} /> Import terminé</b>
          <Results results={s.results} />
          <div><button className="btn" onClick={reset}><RotateCw className="ic ic-sm" />Nouvel import</button></div>
        </div>
      )}

      {confirmMove && (
        <ConfirmDialog title="Déplacer les fichiers ?"
          message={`${count} titre(s) seront retirés de « ${source?.label} » une fois rangés dans la bibliothèque. Cette action ne peut pas être annulée.`}
          confirmLabel="Déplacer" danger onCancel={() => setConfirmMove(false)} onConfirm={run} />
      )}
    </Layout>
  );
}

function Results({ results }: { results: { title: string; ok: boolean; message: string }[] }) {
  return (
    <div className="checklist">
      {results.map((r, i) => (
        <div key={i} className={`check-row ${r.ok ? '' : 'error'}`}>
          <span className={`st ${r.ok ? 'done' : 'error'}`}>{r.ok ? <Check size={13} strokeWidth={3} /> : '!'}</span>
          <div className="lbl"><b>{r.title}</b><span>{r.message}</span></div>
        </div>
      ))}
    </div>
  );
}
