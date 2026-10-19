// Page Téléchargements : liste complète de qBittorrent et actions (pause, reprise, suppression).
import type { Torrent, TorrentAction, TorrentsResponse } from '@motflix/shared';
import type { QbittorrentClient } from './dashboard.ts';

interface QbtTorrent {
  hash: string; name: string; category: string; size: number; progress: number; dlspeed: number; upspeed: number;
  eta: number; ratio: number; state: string; added_on: number;
}

/** Regroupe les nombreux états de qBittorrent (4 et 5) en quelques phases lisibles. */
export function torrentPhase(state: string): Torrent['phase'] {
  if (/^(error|missingFiles|unknown)$/.test(state)) return 'error';
  if (/^(checking|moving)/.test(state) || state === 'checkingResumeData') return 'checking';
  if (/^(paused|stopped)DL$/.test(state)) return 'paused';
  if (/^(paused|stopped)UP$/.test(state)) return 'done';
  if (/^(uploading|stalledUP|forcedUP|queuedUP)$/.test(state)) return 'seeding';
  if (/^(stalledDL|queuedDL|metaDL|forcedMetaDL)$/.test(state)) return 'waiting';
  return 'downloading';
}

export async function listTorrents(qbt: QbittorrentClient): Promise<TorrentsResponse> {
  const [transfer, torrents] = await Promise.all([
    qbt.get<{ dl_info_speed: number; up_info_speed: number }>('/api/v2/transfer/info'),
    qbt.get<QbtTorrent[]>('/api/v2/torrents/info?sort=added_on&reverse=true'),
  ]);
  return {
    downloadSpeed: transfer.dl_info_speed,
    uploadSpeed: transfer.up_info_speed,
    torrents: torrents.map((t) => ({
      hash: t.hash, name: t.name, category: t.category, sizeBytes: t.size, progress: t.progress,
      downloadSpeed: t.dlspeed, uploadSpeed: t.upspeed,
      etaSeconds: t.eta > 0 && t.eta < 8_640_000 ? t.eta : null,
      ratio: Math.round(t.ratio * 100) / 100, state: t.state, phase: torrentPhase(t.state),
      addedAt: new Date(t.added_on * 1000).toISOString(),
    })),
  };
}

/** « all » ou une empreinte de torrent. */
export function validHashes(h: string): boolean {
  return h === 'all' || /^[a-f0-9]{40}$/i.test(h) || /^[a-f0-9]{64}$/i.test(h);
}

export async function torrentAction(qbt: QbittorrentClient, hashes: string, action: TorrentAction, deleteFiles = false) {
  if (action === 'delete') {
    await qbt.post('/api/v2/torrents/delete', { hashes, deleteFiles: String(deleteFiles) });
    return;
  }
  // qBittorrent 5 : stop / start ; qBittorrent 4 : pause / resume.
  const [v5, v4] = action === 'pause' ? ['stop', 'pause'] : ['start', 'resume'];
  if ((await qbt.post(`/api/v2/torrents/${v5}`, { hashes })) === 404) await qbt.post(`/api/v2/torrents/${v4}`, { hashes });
}
