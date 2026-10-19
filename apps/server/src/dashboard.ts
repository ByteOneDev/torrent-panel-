// Données du tableau de bord : téléchargements, disque, VPN, bibliothèque, activité récente.
// Chaque source est facultative : si un outil ne répond pas, sa carte affiche « indisponible ».
import { statfs } from 'node:fs/promises';
import type { ActivityItem, DashboardResponse, DownloadItem } from '@motflix/shared';
import type { Config } from './config.ts';
import type { ServiceManager } from './services.ts';

const CACHE_MS = 3_000;
const TIMEOUT_MS = 5_000;

async function getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return (await res.json()) as T;
}

// ─── qBittorrent ─────────────────────────────────────────────────────────
// Depuis le réseau Docker, qBittorrent n'exige pas de mot de passe. Depuis l'hôte
// (développement), on se connecte avec les identifiants du .env.

interface QbtTorrent {
  name: string; category: string; progress: number; dlspeed: number;
  size: number; eta: number; state: string;
}
interface QbtTransfer { dl_info_speed: number; up_info_speed: number }

export class QbittorrentClient {
  private config: Config;
  private sid: string | null = null;

  constructor(config: Config) {
    this.config = config;
  }

  private async login(): Promise<void> {
    const { username, password } = this.config.qbittorrent;
    const res = await fetch(`${this.config.urls.qbittorrent}/api/v2/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: this.config.urls.qbittorrent },
      body: new URLSearchParams({ username, password }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    await res.body?.cancel();
    // « SID » jusqu'à qBittorrent 4, « QBT_SID_<port> » à partir de la version 5.
    const cookie = res.headers.getSetCookie().find((c) => /^(QBT_)?SID(_\d+)?=/.test(c));
    if (!cookie) throw new Error('Connexion à qBittorrent refusée');
    this.sid = cookie.split(';')[0]!;
  }

  async get<T>(path: string): Promise<T> {
    const doGet = () =>
      fetch(`${this.config.urls.qbittorrent}${path}`, {
        headers: this.sid ? { Cookie: this.sid } : {},
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    let res = await doGet();
    if (res.status === 403 && this.config.qbittorrent.password) {
      await res.body?.cancel();
      await this.login();
      res = await doGet();
    }
    if (!res.ok) throw new Error(`qBittorrent ${path} → ${res.status}`);
    return (await res.json()) as T;
  }

  async setPreferences(prefs: Record<string, unknown>): Promise<void> {
    const doPost = () =>
      fetch(`${this.config.urls.qbittorrent}/api/v2/app/setPreferences`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(this.sid ? { Cookie: this.sid } : {}) },
        body: new URLSearchParams({ json: JSON.stringify(prefs) }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    let res = await doPost();
    if (res.status === 403 && this.config.qbittorrent.password) {
      await res.body?.cancel();
      await this.login();
      res = await doPost();
    }
    await res.body?.cancel();
    if (!res.ok) throw new Error(`qBittorrent a refusé les réglages (${res.status})`);
  }
}

async function downloads(qbt: QbittorrentClient): Promise<DashboardResponse['downloads']> {
  const [transfer, torrents] = await Promise.all([
    qbt.get<QbtTransfer>('/api/v2/transfer/info'),
    qbt.get<QbtTorrent[]>('/api/v2/torrents/info?filter=downloading'),
  ]);
  const items: DownloadItem[] = torrents
    .sort((a, b) => b.dlspeed - a.dlspeed || b.progress - a.progress)
    .slice(0, 6)
    .map((t) => ({
      name: t.name,
      category: t.category,
      progress: t.progress,
      downloadSpeed: t.dlspeed,
      size: t.size,
      etaSeconds: t.eta > 0 && t.eta < 8_640_000 ? t.eta : null,
      state: t.state,
    }));
  return {
    available: true,
    active: torrents.length,
    downloadSpeed: transfer.dl_info_speed,
    uploadSpeed: transfer.up_info_speed,
    items,
  };
}

// ─── Disque ──────────────────────────────────────────────────────────────

async function disk(path: string): Promise<DashboardResponse['disk']> {
  const s = await statfs(path);
  return { available: true, totalBytes: s.blocks * s.bsize, freeBytes: s.bavail * s.bsize };
}

// ─── VPN (Gluetun) ───────────────────────────────────────────────────────

async function vpn(config: Config, services: ServiceManager): Promise<DashboardResponse['vpn']> {
  const gluetun = (await services.list()).services.find((s) => s.id === 'gluetun');
  const enabled = !!gluetun && gluetun.state !== 'missing';
  const result: DashboardResponse['vpn'] = {
    enabled, connected: gluetun?.state === 'online', publicIp: null, country: null, forwardedPort: null,
  };
  if (!result.connected) return result;

  const [ip, port] = await Promise.allSettled([
    getJson<{ public_ip?: string; country?: string }>(`${config.urls.gluetun}/v1/publicip/ip`),
    getJson<{ port?: number }>(`${config.urls.gluetun}/v1/portforward`)
      .catch(() => getJson<{ port?: number }>(`${config.urls.gluetun}/v1/openvpn/portforwarded`)),
  ]);
  if (ip.status === 'fulfilled') {
    result.publicIp = ip.value.public_ip || null;
    result.country = ip.value.country || null;
  }
  if (port.status === 'fulfilled' && port.value.port) result.forwardedPort = port.value.port;
  return result;
}

// ─── Radarr / Sonarr ─────────────────────────────────────────────────────

interface ArrHistoryRecord {
  date: string;
  eventType: string;
  sourceTitle: string;
  quality?: { quality?: { name?: string } };
  languages?: { name: string }[];
  movie?: { title: string; year?: number };
  series?: { title: string };
  episode?: { seasonNumber: number; episodeNumber: number };
  data?: { message?: string };
}

function activityKind(eventType: string): ActivityItem['kind'] {
  switch (eventType) {
    case 'grabbed': return 'grabbed';
    case 'downloadFolderImported':
    case 'movieFolderImported': return 'imported';
    case 'downloadFailed':
    case 'importFailed': return 'failed';
    case 'movieFileDeleted':
    case 'episodeFileDeleted': return 'deleted';
    default: return 'other';
  }
}

export function toActivity(r: ArrHistoryRecord, source: ActivityItem['source']): ActivityItem {
  let title = r.sourceTitle;
  if (r.movie) title = r.movie.year ? `${r.movie.title} (${r.movie.year})` : r.movie.title;
  if (r.series) {
    const ep = r.episode
      ? ` S${String(r.episode.seasonNumber).padStart(2, '0')}E${String(r.episode.episodeNumber).padStart(2, '0')}`
      : '';
    title = r.series.title + ep;
  }
  const kind = activityKind(r.eventType);
  const quality = r.quality?.quality?.name;
  const langs = r.languages?.map((l) => l.name).filter((n) => n && n !== 'Unknown').join(', ');
  const detail = kind === 'failed' && r.data?.message
    ? r.data.message
    : [quality, langs].filter(Boolean).join(' · ');
  return { date: r.date, kind, title, detail, source };
}

async function library(config: Config): Promise<DashboardResponse['library']> {
  const [movies, series] = await Promise.allSettled([
    getJson<{ hasFile: boolean }[]>(`${config.urls.radarr}/api/v3/movie`, { 'X-Api-Key': config.keys.radarr }),
    getJson<unknown[]>(`${config.urls.sonarr}/api/v3/series`, { 'X-Api-Key': config.keys.sonarr }),
  ]);
  return {
    movies: movies.status === 'fulfilled' ? movies.value.length : null,
    moviesOnDisk: movies.status === 'fulfilled' ? movies.value.filter((m) => m.hasFile).length : null,
    series: series.status === 'fulfilled' ? series.value.length : null,
  };
}

async function activity(config: Config): Promise<ActivityItem[]> {
  const q = 'page=1&pageSize=8&sortKey=date&sortDirection=descending';
  const [films, shows] = await Promise.allSettled([
    getJson<{ records: ArrHistoryRecord[] }>(`${config.urls.radarr}/api/v3/history?${q}&includeMovie=true`,
      { 'X-Api-Key': config.keys.radarr }),
    getJson<{ records: ArrHistoryRecord[] }>(`${config.urls.sonarr}/api/v3/history?${q}&includeSeries=true&includeEpisode=true`,
      { 'X-Api-Key': config.keys.sonarr }),
  ]);
  const items = [
    ...(films.status === 'fulfilled' ? films.value.records.map((r) => toActivity(r, 'Films')) : []),
    ...(shows.status === 'fulfilled' ? shows.value.records.map((r) => toActivity(r, 'Séries')) : []),
  ];
  return items.sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, 8);
}

// ─── Assemblage ──────────────────────────────────────────────────────────

export class Dashboard {
  private config: Config;
  private services: ServiceManager;
  private qbt: QbittorrentClient;
  private cache: { at: number; value: Promise<DashboardResponse> } | null = null;

  constructor(config: Config, services: ServiceManager) {
    this.config = config;
    this.services = services;
    this.qbt = new QbittorrentClient(config);
  }

  get(): Promise<DashboardResponse> {
    const now = Date.now();
    if (!this.cache || now - this.cache.at > CACHE_MS) {
      this.cache = { at: now, value: this.compute() };
    }
    return this.cache.value;
  }

  private async compute(): Promise<DashboardResponse> {
    const [dl, dk, vp, lib, act] = await Promise.allSettled([
      downloads(this.qbt),
      disk(this.config.mediaPath),
      vpn(this.config, this.services),
      library(this.config),
      activity(this.config),
    ]);
    return {
      downloads: dl.status === 'fulfilled' ? dl.value
        : { available: false, active: 0, downloadSpeed: 0, uploadSpeed: 0, items: [] },
      disk: dk.status === 'fulfilled' ? dk.value : { available: false, totalBytes: 0, freeBytes: 0 },
      vpn: vp.status === 'fulfilled' ? vp.value
        : { enabled: false, connected: false, publicIp: null, country: null, forwardedPort: null },
      library: lib.status === 'fulfilled' ? lib.value : { movies: null, moviesOnDisk: null, series: null },
      activity: act.status === 'fulfilled' ? act.value : [],
    };
  }
}
