import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Loader2, Pause, Play, Trash2 } from 'lucide-react';
import type { Torrent, TorrentAction } from '@motflix/shared';
import { api } from '../api.ts';
import { ago, bytes, duration, percent, speed } from '../format.ts';
import { Layout } from '../Layout.tsx';
import { Bar, ConfirmDialog, useToast } from '../ui.tsx';

const PHASE: Record<Torrent['phase'], { cls: string; label: string }> = {
  downloading: { cls: 'accent', label: 'Téléchargement' },
  waiting: { cls: 'warn', label: 'En attente' },
  paused: { cls: '', label: 'En pause' },
  seeding: { cls: 'ok', label: 'En partage' },
  done: { cls: 'ok', label: 'Terminé' },
  checking: { cls: 'warn', label: 'Vérification' },
  error: { cls: 'err', label: 'Erreur' },
};

const CATEGORY: Record<string, string> = { films: 'Film', series: 'Série', livres: 'Livre' };

export function DownloadsPage() {
  const q = useQuery({ queryKey: ['downloads'], queryFn: api.downloads.list, refetchInterval: 2000 });
  const [busy, setBusy] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<Torrent | null>(null);
  const [deleteFiles, setDeleteFiles] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();

  async function act(hash: string, action: TorrentAction, files = false) {
    setBusy(hash + action);
    try {
      await api.downloads.act(hash, action, files);
      await qc.invalidateQueries({ queryKey: ['downloads'] });
    } catch (e) {
      toast({ title: 'Action impossible', detail: (e as Error).message, error: true });
    } finally {
      setBusy(null);
    }
  }

  const data = q.data;
  const running = data?.torrents.some((t) => t.phase !== 'paused' && t.phase !== 'done') ?? false;

  return (
    <Layout title="Téléchargements">
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="dl-head">
          <div className="speed"><ArrowDown className="ic" /><b className="num">{data ? speed(data.downloadSpeed) : '—'}</b><span className="dim">réception</span></div>
          <div className="speed up"><ArrowUp className="ic" /><b className="num">{data ? speed(data.uploadSpeed) : '—'}</b><span className="dim">envoi</span></div>
          <div className="right">
            {data && data.torrents.length > 0 && (running
              ? <button className="btn" onClick={() => act('all', 'pause')} disabled={busy !== null}><Pause className="ic ic-sm" />Tout mettre en pause</button>
              : <button className="btn" onClick={() => act('all', 'resume')} disabled={busy !== null}><Play className="ic ic-sm" />Tout reprendre</button>)}
          </div>
        </div>
      </div>

      {q.error && <div className="alert">{(q.error as Error).message}</div>}

      <div className="card table-wrap">
        {data && !data.torrents.length ? (
          <div className="empty">Aucun téléchargement. Ajoutez un film, une série ou un livre : il apparaîtra ici.</div>
        ) : (
          <table className="dl">
            <thead><tr><th>Nom</th><th>Progression</th><th className="hide-sm hide-md">Vitesse</th><th className="hide-sm">État</th><th /></tr></thead>
            <tbody>
              {data?.torrents.map((t) => {
                const phase = PHASE[t.phase];
                const paused = t.phase === 'paused' || t.phase === 'done';
                return (
                  <tr key={t.hash}>
                    <td className="name">
                      <b title={t.name}>{t.name}</b>
                      <span>{[CATEGORY[t.category] ?? t.category, bytes(t.sizeBytes), `ajouté ${ago(t.addedAt)}`].filter(Boolean).join(' · ')}</span>
                    </td>
                    <td className="prog-cell">
                      <div className="lbl num"><span>{percent(t.progress * 100)}</span><span>{t.etaSeconds !== null && t.progress < 1 ? duration(t.etaSeconds) : t.progress >= 1 ? `ratio ${t.ratio}` : ''}</span></div>
                      <Bar value={t.progress * 100} tone={t.progress >= 1 ? 'ok' : t.phase === 'error' ? 'err' : ''} />
                    </td>
                    <td className="hide-sm hide-md num" style={{ whiteSpace: 'nowrap' }}>
                      {t.downloadSpeed ? `↓ ${speed(t.downloadSpeed)}` : ''}{t.downloadSpeed && t.uploadSpeed ? ' · ' : ''}{t.uploadSpeed ? `↑ ${speed(t.uploadSpeed)}` : ''}
                      {!t.downloadSpeed && !t.uploadSpeed && '—'}
                    </td>
                    <td className="hide-sm"><span className={`badge ${phase.cls}`}>{phase.label}</span></td>
                    <td className="acts">
                      {busy?.startsWith(t.hash) ? <Loader2 className="ic ic-sm spin dim" /> : (
                        <>
                          <button className="btn btn-ghost btn-sm" onClick={() => act(t.hash, paused ? 'resume' : 'pause')}
                            aria-label={paused ? `Reprendre ${t.name}` : `Mettre en pause ${t.name}`} title={paused ? 'Reprendre' : 'Pause'}>
                            {paused ? <Play className="ic ic-sm" /> : <Pause className="ic ic-sm" />}
                          </button>
                          <button className="btn btn-ghost btn-sm" onClick={() => { setDeleteFiles(false); setToDelete(t); }}
                            aria-label={`Supprimer ${t.name}`} title="Supprimer"><Trash2 className="ic ic-sm" /></button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {toDelete && (
        <ConfirmDialog
          title="Supprimer ce téléchargement ?"
          message={`${toDelete.name}. ${deleteFiles
            ? 'Le fichier du dossier de téléchargement sera effacé ; la copie rangée dans la bibliothèque reste.'
            : 'Le téléchargement est retiré de la liste ; ses fichiers restent sur le disque.'}`}
          confirmLabel="Supprimer" danger
          onCancel={() => setToDelete(null)}
          onConfirm={() => { const t = toDelete; setToDelete(null); void act(t.hash, 'delete', deleteFiles); }}
        >
          <label className="checks"><label>
            <input type="checkbox" checked={deleteFiles} onChange={(e) => setDeleteFiles(e.target.checked)} />Effacer aussi le fichier téléchargé
          </label></label>
        </ConfirmDialog>
      )}
    </Layout>
  );
}
