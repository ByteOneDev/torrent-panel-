// Liaison de Radarr et Sonarr : dossier racine, qBittorrent, renommage, hardlinks, Plex.
// Chaque fonction est rejouable : ce qui existe déjà est mis à jour, pas dupliqué.
import { setFields, type FieldsObject, type JsonClient } from './http.ts';

export type ArrKind = 'radarr' | 'sonarr';

const SETTINGS: Record<ArrKind, { rootFolder: string; category: string; categoryField: string }> = {
  radarr: { rootFolder: '/data/media/films', category: 'films', categoryField: 'movieCategory' },
  sonarr: { rootFolder: '/data/media/series', category: 'series', categoryField: 'tvCategory' },
};

interface Provider extends FieldsObject {
  id?: number;
  name: string;
  implementation: string;
  enable?: boolean;
}

async function upsertProvider(api: JsonClient, path: string, implementation: string, name: string,
  prepare: (p: Provider) => Provider): Promise<'ajouté' | 'mis à jour'> {
  const existing = (await api.get<Provider[]>(path)).find((p) => p.implementation === implementation);
  if (existing) {
    await api.put(`${path}/${existing.id}`, prepare({ ...existing, name: existing.name }));
    return 'mis à jour';
  }
  const schema = (await api.get<Provider[]>(`${path}/schema`)).find((s) => s.implementation === implementation);
  if (!schema) throw new Error(`${implementation} inconnu de cet outil`);
  await api.post(path, prepare({ ...schema, name }));
  return 'ajouté';
}

export async function ensureRootFolder(api: JsonClient, kind: ArrKind): Promise<void> {
  const { rootFolder } = SETTINGS[kind];
  const folders = await api.get<{ path: string }[]>('/rootfolder');
  if (!folders.some((f) => f.path.replace(/\/$/, '') === rootFolder)) await api.post('/rootfolder', { path: rootFolder });
}

export async function ensureQbittorrent(api: JsonClient, kind: ArrKind, qbt: { username: string; password: string }) {
  const { category, categoryField } = SETTINGS[kind];
  return upsertProvider(api, '/downloadclient', 'QBittorrent', 'qBittorrent', (p) => ({
    ...setFields(p, {
      host: 'qbittorrent', port: 8090, useSsl: false,
      username: qbt.username, password: qbt.password,
      [categoryField]: category,
    }),
    enable: true,
    priority: 1,
    removeCompletedDownloads: true,
    removeFailedDownloads: true,
  }));
}

export async function ensureNamingAndHardlinks(api: JsonClient, kind: ArrKind): Promise<void> {
  const naming = await api.get<Record<string, unknown> & { id: number }>('/config/naming');
  if (kind === 'radarr') {
    Object.assign(naming, {
      renameMovies: true,
      replaceIllegalCharacters: true,
      standardMovieFormat: '{Movie Title} ({Release Year}) {Quality Full}',
      movieFolderFormat: '{Movie Title} ({Release Year})',
    });
  } else {
    Object.assign(naming, { renameEpisodes: true, replaceIllegalCharacters: true, seasonFolderFormat: 'Saison {season:00}' });
  }
  await api.put(`/config/naming/${naming.id}`, naming);

  // Corbeille : un fichier supprimé est gardé 7 jours avant d'être effacé pour de bon
  // (dossier créé par install.sh ; sans lui, la suppression reste définitive).
  const mm = await api.get<Record<string, unknown> & { id: number }>('/config/mediamanagement');
  const bin = `/data/media/.corbeille/${kind === 'radarr' ? 'films' : 'series'}`;
  try {
    await api.put(`/config/mediamanagement/${mm.id}`, { ...mm, copyUsingHardlinks: true, recycleBin: bin, recycleBinCleanupDays: 7 });
  } catch {
    await api.put(`/config/mediamanagement/${mm.id}`, { ...mm, copyUsingHardlinks: true });
  }
}

/** Après chaque import, Radarr / Sonarr demandent à Plex d'actualiser sa bibliothèque. */
export async function ensurePlexNotification(api: JsonClient, plex: { host: string; port: number; token: string }) {
  return upsertProvider(api, '/notification', 'PlexServer', 'Plex', (p) => ({
    ...setFields(p, { host: plex.host, port: plex.port, useSsl: false, authToken: plex.token, updateLibrary: true }),
    onDownload: true, onUpgrade: true, onRename: true,
    onMovieDelete: true, onMovieFileDelete: true, onMovieFileDeleteForUpgrade: true,
    onSeriesDelete: true, onEpisodeFileDelete: true, onEpisodeFileDeleteForUpgrade: true,
  }));
}

const FRENCH = 2; // identifiant de la langue « French » dans Radarr et Sonarr

/** Interface d'origine en français ; titres et résumés des films en français (Radarr). */
export async function ensureFrench(api: JsonClient, kind: ArrKind): Promise<void> {
  const ui = await api.get<Record<string, unknown> & { id: number; movieInfoLanguage?: number; uiLanguage?: number }>('/config/ui');
  const wanted = kind === 'radarr' ? { uiLanguage: FRENCH, movieInfoLanguage: FRENCH } : { uiLanguage: FRENCH };
  if (Object.entries(wanted).every(([k, v]) => ui[k] === v)) return;
  await api.put(`/config/ui/${ui.id}`, { ...ui, ...wanted });
  // Les titres déjà en bibliothèque sont rafraîchis pour passer en français.
  if (kind === 'radarr') await api.post('/command', { name: 'RefreshMovie' });
}

export async function wireArr(api: JsonClient, kind: ArrKind, qbt: { username: string; password: string }): Promise<string> {
  await ensureRootFolder(api, kind);
  const client = await ensureQbittorrent(api, kind, qbt);
  await ensureNamingAndHardlinks(api, kind);
  await ensureFrench(api, kind);
  return `${SETTINGS[kind].rootFolder} · qBittorrent ${client} (catégorie « ${SETTINGS[kind].category} ») · renommage, hardlinks, corbeille 7 jours · en français`;
}
