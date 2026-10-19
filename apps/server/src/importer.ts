// Import de fichiers existants : ajoutés à la main dans la bibliothèque, déposés dans
// « a-importer », ou sur un disque branché à la machine.
//
// 1. Analyse : on parcourt le dossier, on classe chaque vidéo (film ou épisode),
//    Radarr / Sonarr reconnaissent le titre, puis on retrouve la fiche (TMDB / TVDB).
// 2. Import : on ajoute les titres manquants (sans lancer de recherche), puis Radarr /
//    Sonarr copient ou déplacent les fichiers, les renomment et préviennent Plex.
// Le panel ne copie ni ne supprime rien lui-même : ce sont Radarr et Sonarr qui le font.
import { readdir, stat, statfs } from 'node:fs/promises';
import path from 'node:path';
import type {
  Analysis, FoundEpisode, FoundFile, FoundMovie, FoundSeries, ImportJobState, ImportMode, ImportResult, ImportSource,
} from '@motflix/shared';
import type { Config } from './config.ts';
import { clients } from './setup/job.ts';
import type { JsonClient } from './setup/http.ts';
import { profileIdFor } from './setup/profiles.ts';

export const VIDEO_EXT = new Set(['.mkv', '.mp4', '.avi', '.m4v', '.mov', '.wmv', '.ts', '.m2ts', '.webm', '.mpg', '.mpeg']);
const MIN_SIZE = 30 * 1024 * 1024;         // en dessous : bande-annonce, extrait…
const SAMPLE_MAX = 300 * 1024 * 1024;       // « sample » de moins de 300 Mo ignoré
const MAX_FILES = 20_000;
const LOOKUP_TIMEOUT = 20_000;

// ─── Reconnaissance ──────────────────────────────────────────────────────

const EPISODE_RE = [
  /\bS(\d{1,2})[ ._-]?E(\d{1,3})(?:[ ._-]?E?(\d{1,3}))?\b/i,   // S01E03, S01E03E04
  /\b(\d{1,2})x(\d{2,3})\b/i,                                // 1x03
];
const SEASON_DIR_RE = /^(?:saison|season|s)[ ._-]?(\d{1,2})$/i;
const EPISODE_IN_NAME_RE = /(?:\b|_)(?:e|ep|episode|épisode)[ ._-]?(\d{1,3})\b/i;

/** Saison et épisodes d'un fichier, ou null si ce n'est visiblement pas un épisode. */
export function episodeInfo(filePath: string): { season: number; episodes: number[] } | null {
  const name = path.basename(filePath);
  for (const re of EPISODE_RE) {
    const m = re.exec(name);
    if (m) {
      const eps = [Number(m[2])];
      if (m[3]) for (let e = eps[0]! + 1; e <= Number(m[3]); e++) eps.push(e);
      return { season: Number(m[1]), episodes: eps };
    }
  }
  // « Saison 1/Episode 03.mkv »
  const dir = path.basename(path.dirname(filePath));
  const season = SEASON_DIR_RE.exec(dir);
  const ep = EPISODE_IN_NAME_RE.exec(name);
  if (season && ep) return { season: Number(season[1]), episodes: [Number(ep[1])] };
  return null;
}

export function normalizeTitle(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').replace(/\b(the|le|la|les|l)\b/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Meilleure fiche : même titre et même année si possible, sinon la première proposée. */
export function bestMatch<T extends { title: string; year?: number; originalTitle?: string }>(
  candidates: T[], title: string, year: number | null,
): T | null {
  if (!candidates.length) return null;
  const n = normalizeTitle(title);
  const sameTitle = (c: T) => normalizeTitle(c.title) === n || (c.originalTitle && normalizeTitle(c.originalTitle) === n);
  return candidates.find((c) => sameTitle(c) && (!year || c.year === year))
    ?? candidates.find((c) => !!year && c.year === year)
    ?? candidates.find((c) => sameTitle(c))
    ?? candidates[0]!;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  }));
  return out;
}

/** Vidéos d'un dossier (récursif, sans suivre les liens symboliques). */
export async function scanVideos(root: string, skipDirs: Set<string> = new Set()): Promise<FoundFile[]> {
  const found: FoundFile[] = [];
  async function walk(dir: string, depth: number) {
    if (depth > 10 || found.length >= MAX_FILES) return;
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name.startsWith('@') || e.name === '$RECYCLE.BIN' || e.name === 'System Volume Information') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!skipDirs.has(full)) await walk(full, depth + 1);
      } else if (e.isFile() && VIDEO_EXT.has(path.extname(e.name).toLowerCase())) {
        const s = await stat(full).catch(() => null);
        if (!s || s.size < MIN_SIZE) continue;
        if (/\bsample\b/i.test(e.name) && s.size < SAMPLE_MAX) continue;
        found.push({ path: full, size: s.size });
      }
    }
  }
  await walk(root, 0);
  return found;
}

// ─── Sources ─────────────────────────────────────────────────────────────

const MAC_SYSTEM_VOLUMES = new Set(['Macintosh HD', 'Macintosh HD - Data', 'Recovery', 'Preboot', 'VM', 'Update', 'com.apple.TimeMachine.localsnapshots']);

async function diskInfo(p: string) {
  try {
    const s = await statfs(p);
    return { freeBytes: s.bavail * s.bsize, totalBytes: s.blocks * s.bsize };
  } catch {
    return { freeBytes: null, totalBytes: null };
  }
}

export async function listSources(config: Config): Promise<ImportSource[]> {
  const host = config.mediaHostPath;
  const lib = await diskInfo(config.mediaPath);
  const sources: ImportSource[] = [
    {
      id: 'library', label: 'Fichiers ajoutés à la main',
      description: 'Films et séries copiés directement dans les dossiers de la bibliothèque, sans passer par Motflix.',
      roots: [path.join(config.mediaPath, 'media/films'), path.join(config.mediaPath, 'media/series')],
      hostPath: host ? `${host}/media` : null, ...lib, forcedMode: 'move', defaultMode: 'move',
    },
    {
      id: 'inbox', label: 'Dossier « a-importer »',
      description: 'Déposez-y n’importe quels films ou séries : Motflix les reconnaît et les range.',
      roots: [path.join(config.mediaPath, 'a-importer')],
      hostPath: host ? `${host}/a-importer` : null, ...lib, forcedMode: null, defaultMode: 'move',
    },
  ];

  // Disques branchés : /Volumes (macOS) ou /media/<utilisateur> (Linux), montés en /import.
  const disks: string[] = [];
  const entries = await readdir(config.importPath, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (e.isSymbolicLink() || !e.isDirectory() || e.name.startsWith('.') || MAC_SYSTEM_VOLUMES.has(e.name)) continue;
    const full = path.join(config.importPath, e.name);
    if (config.importLayout === 'user') {
      // Linux : /media/<utilisateur>/<disque> (montage automatique du bureau), ou un disque
      // monté à la main directement dans /media (reconnu à son propre périphérique).
      const [rootDev, ownDev] = await Promise.all([stat(config.importPath).then((s) => s.dev), stat(full).then((s) => s.dev)]);
      if (ownDev !== rootDev) { disks.push(full); continue; }
      const sub = await readdir(full, { withFileTypes: true }).catch(() => []);
      for (const d of sub) if (d.isDirectory() && !d.isSymbolicLink() && !d.name.startsWith('.')) disks.push(path.join(full, d.name));
    } else {
      disks.push(full);
    }
  }
  for (const d of disks) {
    const rel = path.relative(config.importPath, d);
    sources.push({
      id: `disk:${rel}`, label: path.basename(d), description: 'Disque branché à la machine.',
      roots: [d], hostPath: config.importHostPath ? `${config.importHostPath}/${rel}` : null,
      ...(await diskInfo(d)), forcedMode: null, defaultMode: 'copy',
    });
  }
  return sources;
}

// ─── Analyse ─────────────────────────────────────────────────────────────

interface RadarrParse {
  parsedMovieInfo?: { movieTitles?: string[]; year?: number; quality?: unknown; languages?: unknown; releaseGroup?: string } | null;
}
interface SonarrParse {
  parsedEpisodeInfo?: { seriesTitle?: string; quality?: unknown; languages?: unknown; releaseGroup?: string } | null;
}
interface Lookup { id?: number; title: string; year?: number; originalTitle?: string; tmdbId?: number; tvdbId?: number;
  images?: { coverType: string; remoteUrl?: string }[]; remotePoster?: string }

const posterOf = (l: Lookup) => {
  const url = l.remotePoster ?? l.images?.find((i) => i.coverType === 'poster')?.remoteUrl ?? null;
  return url ? url.replace('image.tmdb.org/t/p/original/', 'image.tmdb.org/t/p/w342/') : null;
};
const stripExt = (p: string) => path.basename(p, path.extname(p));

export class Importer {
  private config: Config;
  private api: ReturnType<typeof clients>;
  private state: ImportJobState = { phase: 'idle', sourceId: null, progress: { done: 0, total: 0, label: '' }, analysis: null, results: [], error: null, mode: null };

  constructor(config: Config) {
    this.config = config;
    this.api = clients(config);
  }

  status(): ImportJobState {
    return structuredClone(this.state);
  }

  private busy() {
    return this.state.phase === 'analyzing' || this.state.phase === 'importing';
  }

  async startAnalysis(sourceId: string): Promise<boolean> {
    if (this.busy()) return false;
    const source = (await listSources(this.config)).find((s) => s.id === sourceId);
    if (!source) throw new Error('Source inconnue (disque débranché ?).');
    this.state = { phase: 'analyzing', sourceId, progress: { done: 0, total: 0, label: 'Recherche des vidéos…' }, analysis: null, results: [], error: null, mode: null };
    void this.analyze(source).then(
      (analysis) => { this.state.analysis = analysis; this.state.phase = 'ready'; },
      (e) => { this.state.phase = 'error'; this.state.error = (e as Error).message; },
    );
    return true;
  }

  /** Fichiers déjà gérés par Radarr / Sonarr : ne pas les proposer à nouveau. */
  private async knownPaths(): Promise<Set<string>> {
    const known = new Set<string>();
    const movies = await this.api.radarr.get<{ movieFile?: { path?: string } }[]>('/movie').catch(() => []);
    for (const m of movies) if (m.movieFile?.path) known.add(m.movieFile.path);
    const series = await this.api.sonarr.get<{ id: number }[]>('/series').catch(() => []);
    await mapLimit(series, 4, async (s) => {
      const files = await this.api.sonarr.get<{ path?: string }[]>(`/episodefile?seriesId=${s.id}`).catch(() => []);
      for (const f of files) if (f.path) known.add(f.path);
    });
    return known;
  }

  private async analyze(source: ImportSource): Promise<Analysis> {
    const p = this.state.progress;
    const known = await this.knownPaths();
    const files: FoundFile[] = [];
    for (const root of source.roots) files.push(...await scanVideos(root));
    const fresh = files.filter((f) => !known.has(f.path));
    const analysis: Analysis = {
      sourceId: source.id, movies: [], series: [], unrecognized: [],
      skippedKnown: files.length - fresh.length, totalBytes: 0,
    };

    // 1. Classement et lecture des noms.
    p.total = fresh.length;
    p.label = 'Lecture des noms de fichiers…';
    type Parsed = { file: FoundFile; kind: 'movie'; title: string; year: number | null; parse: RadarrParse['parsedMovieInfo'] }
      | { file: FoundFile; kind: 'episode'; title: string; season: number; episodes: number[]; parse: SonarrParse['parsedEpisodeInfo'] }
      | { file: FoundFile; kind: 'unknown'; reason: string };
    const parsed: Parsed[] = await mapLimit(fresh, 6, async (file): Promise<Parsed> => {
      try {
        const ep = episodeInfo(file.path);
        if (ep) {
          const r = await this.api.sonarr.get<SonarrParse>(`/parse?title=${encodeURIComponent(stripExt(file.path))}`);
          let title = r.parsedEpisodeInfo?.seriesTitle;
          // « Saison 1/E03.mkv » : le nom de la série est dans le dossier parent.
          if (!title) title = path.basename(path.dirname(SEASON_DIR_RE.test(path.basename(path.dirname(file.path))) ? path.dirname(file.path) : file.path));
          return { file, kind: 'episode', title, season: ep.season, episodes: ep.episodes, parse: r.parsedEpisodeInfo };
        }
        let r = await this.api.radarr.get<RadarrParse>(`/parse?title=${encodeURIComponent(stripExt(file.path))}`);
        if (!r.parsedMovieInfo?.movieTitles?.length) {
          // Fichier mal nommé : souvent, le dossier s'appelle « Titre (Année) ».
          r = await this.api.radarr.get<RadarrParse>(`/parse?title=${encodeURIComponent(path.basename(path.dirname(file.path)))}`);
        }
        const info = r.parsedMovieInfo;
        if (!info?.movieTitles?.length) return { file, kind: 'unknown', reason: 'Nom de fichier non reconnu' };
        return { file, kind: 'movie', title: info.movieTitles[0]!, year: info.year || null, parse: info };
      } catch (e) {
        return { file, kind: 'unknown', reason: (e as Error).message };
      } finally {
        p.done++;
      }
    });

    // 2. Fiches des films (une recherche par titre).
    const movieGroups = new Map<string, Extract<Parsed, { kind: 'movie' }>[]>();
    const seriesGroups = new Map<string, Extract<Parsed, { kind: 'episode' }>[]>();
    for (const x of parsed) {
      if (x.kind === 'movie') {
        const k = `${normalizeTitle(x.title)}|${x.year ?? ''}`;
        movieGroups.set(k, [...(movieGroups.get(k) ?? []), x]);
      } else if (x.kind === 'episode') {
        const k = normalizeTitle(x.title);
        seriesGroups.set(k, [...(seriesGroups.get(k) ?? []), x]);
      } else {
        analysis.unrecognized.push({ ...x.file, reason: x.reason });
      }
    }

    p.done = 0;
    p.total = movieGroups.size + seriesGroups.size;
    p.label = 'Recherche des fiches (films et séries)…';

    await mapLimit([...movieGroups.values()], 3, async (group) => {
      const first = group[0]!;
      try {
        const term = first.year ? `${first.title} ${first.year}` : first.title;
        const results = await this.api.radarr.get<Lookup[]>(`/movie/lookup?term=${encodeURIComponent(term)}`, LOOKUP_TIMEOUT);
        const match = bestMatch(results, first.title, first.year);
        if (!match?.tmdbId) {
          for (const g of group) analysis.unrecognized.push({ ...g.file, reason: 'Film introuvable sur TMDB' });
          return;
        }
        const sorted = group.map((g) => g.file).sort((a, b) => b.size - a.size);
        const existing = analysis.movies.find((m) => m.key === String(match.tmdbId));
        if (existing) {
          existing.extraFiles.push(...sorted);
          return;
        }
        analysis.movies.push({
          key: String(match.tmdbId), title: match.title, year: match.year || null, poster: posterOf(match),
          inLibrary: !!match.id, file: sorted[0]!, extraFiles: sorted.slice(1),
          quality: first.parse?.quality, languages: first.parse?.languages, releaseGroup: first.parse?.releaseGroup ?? null,
        });
      } catch (e) {
        for (const g of group) analysis.unrecognized.push({ ...g.file, reason: (e as Error).message });
      } finally {
        p.done++;
      }
    });

    // 3. Fiches des séries.
    await mapLimit([...seriesGroups.values()], 3, async (group) => {
      const first = group[0]!;
      try {
        const results = await this.api.sonarr.get<Lookup[]>(`/series/lookup?term=${encodeURIComponent(first.title)}`, LOOKUP_TIMEOUT);
        const match = bestMatch(results, first.title, null);
        if (!match?.tvdbId) {
          for (const g of group) analysis.unrecognized.push({ ...g.file, reason: 'Série introuvable sur TVDB' });
          return;
        }
        const episodes: FoundEpisode[] = group.map((g) => ({
          ...g.file, season: g.season, episodes: g.episodes,
          quality: g.parse?.quality, languages: g.parse?.languages, releaseGroup: g.parse?.releaseGroup ?? null,
        })).sort((a, b) => a.season - b.season || a.episodes[0]! - b.episodes[0]!);
        const existing = analysis.series.find((s) => s.key === String(match.tvdbId));
        if (existing) {
          existing.episodes.push(...episodes);
          existing.sizeBytes += episodes.reduce((a, e) => a + e.size, 0);
          return;
        }
        analysis.series.push({
          key: String(match.tvdbId), title: match.title, year: match.year || null, poster: posterOf(match),
          inLibrary: !!match.id, episodes, sizeBytes: episodes.reduce((a, e) => a + e.size, 0),
        });
      } catch (e) {
        for (const g of group) analysis.unrecognized.push({ ...g.file, reason: (e as Error).message });
      } finally {
        p.done++;
      }
    });

    analysis.movies.sort((a, b) => a.title.localeCompare(b.title, 'fr'));
    analysis.series.sort((a, b) => a.title.localeCompare(b.title, 'fr'));
    analysis.totalBytes = analysis.movies.reduce((a, m) => a + m.file.size, 0) + analysis.series.reduce((a, s) => a + s.sizeBytes, 0);
    p.label = 'Analyse terminée';
    return analysis;
  }

  // ─── Import ───────────────────────────────────────────────────────────

  async startImport(movieKeys: string[], seriesKeys: string[], requestedMode: ImportMode, upgrade = false): Promise<void> {
    if (this.busy()) throw new Error('Une opération est déjà en cours.');
    const analysis = this.state.analysis;
    if (this.state.phase !== 'ready' || !analysis) throw new Error("Lancez d'abord l'analyse.");
    const source = (await listSources(this.config)).find((s) => s.id === analysis.sourceId);
    if (!source) throw new Error('La source a disparu (disque débranché ?).');
    const mode = source.forcedMode ?? requestedMode;

    const movies = analysis.movies.filter((m) => movieKeys.includes(m.key));
    const series = analysis.series.filter((s) => seriesKeys.includes(s.key));
    if (!movies.length && !series.length) throw new Error('Rien à importer : cochez au moins un titre.');

    // Place libre : seule une copie depuis un autre disque consomme de l'espace.
    const bytes = movies.reduce((a, m) => a + m.file.size, 0) + series.reduce((a, s) => a + s.sizeBytes, 0);
    if (mode === 'copy' && source.id.startsWith('disk:')) {
      const { freeBytes } = await diskInfo(this.config.mediaPath);
      if (freeBytes !== null && freeBytes < bytes + 1024 ** 3) {
        throw new Error(`Pas assez de place : ${Math.round(bytes / 1024 ** 3)} Go à copier, ${Math.round(freeBytes / 1024 ** 3)} Go libres.`);
      }
    }

    this.state.phase = 'importing';
    this.state.mode = mode;
    this.state.results = [];
    this.state.progress = { done: 0, total: movies.length + series.length, label: 'Import en cours…' };
    void this.runImport(movies, series, mode, upgrade).then(
      () => { this.state.phase = 'done'; this.state.progress.label = 'Import terminé'; },
      (e) => { this.state.phase = 'error'; this.state.error = (e as Error).message; },
    );
  }

  /** Attend la fin d'une commande de Radarr / Sonarr (une copie peut être longue). */
  private async waitCommand(api: JsonClient, id: number): Promise<{ ok: boolean; message: string }> {
    for (;;) {
      await new Promise((r) => setTimeout(r, 3000));
      const c = await api.get<{ status: string; message?: string; exception?: string }>(`/command/${id}`).catch(() => null);
      if (!c) continue;
      if (c.status === 'completed') return { ok: true, message: c.message ?? 'Importé' };
      if (c.status === 'failed' || c.status === 'aborted' || c.status === 'cancelled') {
        return { ok: false, message: c.exception ?? c.message ?? 'Échec' };
      }
    }
  }

  /**
   * Qualité et langue lues par Radarr / Sonarr dans le fichier lui-même (définition réelle),
   * plus fiables que le nom du fichier.
   */
  private async detected(api: JsonClient, filePath: string, owner: string): Promise<{ quality?: unknown; languages?: unknown } | null> {
    const list = await api.get<{ path: string; quality?: unknown; languages?: unknown }[]>(
      `/manualimport?folder=${encodeURIComponent(path.dirname(filePath))}&${owner}&filterExistingFiles=false`).catch(() => []);
    return list.find((c) => c.path === filePath) ?? null;
  }

  private async runImport(movies: FoundMovie[], series: FoundSeries[], mode: ImportMode, upgrade: boolean) {
    const importMode = mode === 'move' ? 'move' : 'copy';
    const radarr = this.api.radarr;
    const sonarr = this.api.sonarr;
    const done = (r: ImportResult) => { this.state.results.push(r); this.state.progress.done++; };

    for (const m of movies) {
      try {
        let movieId: number | undefined;
        const lookup = await radarr.get<Lookup & Record<string, unknown>>(`/movie/lookup/tmdb?tmdbId=${m.key}`, LOOKUP_TIMEOUT);
        movieId = lookup.id;
        if (!movieId) {
          // Non surveillé par défaut : sinon Radarr chercherait de meilleures versions de vos
          // propres fichiers et lancerait des téléchargements.
          const added = await radarr.post<{ id: number }>('/movie', {
            ...lookup, qualityProfileId: await profileIdFor(radarr), rootFolderPath: '/data/media/films',
            monitored: upgrade, minimumAvailability: 'released', addOptions: { searchForMovie: false, monitor: upgrade ? 'movieOnly' : 'none' },
          });
          movieId = added.id;
        }
        const seen = await this.detected(radarr, m.file.path, `movieId=${movieId}`);
        const cmd = await radarr.post<{ id: number }>('/command', {
          name: 'ManualImport', importMode,
          files: [{
            path: m.file.path, movieId, quality: seen?.quality ?? m.quality, languages: seen?.languages ?? m.languages ?? [],
            releaseGroup: m.releaseGroup ?? '', indexerFlags: 0,
          }],
        });
        const r = await this.waitCommand(radarr, cmd.id);
        done({ title: `${m.title}${m.year ? ` (${m.year})` : ''}`, ok: r.ok, message: r.ok ? (mode === 'move' ? 'Déplacé et rangé' : 'Copié et rangé') : r.message });
      } catch (e) {
        done({ title: m.title, ok: false, message: (e as Error).message });
      }
    }

    for (const s of series) {
      try {
        const [lookup] = await sonarr.get<(Lookup & Record<string, unknown>)[]>(`/series/lookup?term=tvdb:${s.key}`, LOOKUP_TIMEOUT);
        if (!lookup) throw new Error('Série introuvable');
        let seriesId = lookup.id;
        if (!seriesId) {
          const added = await sonarr.post<{ id: number }>('/series', {
            ...lookup, qualityProfileId: await profileIdFor(sonarr), rootFolderPath: '/data/media/series',
            monitored: upgrade, seasonFolder: true, seriesType: 'standard',
            addOptions: { monitor: upgrade ? 'existing' : 'none', searchForMissingEpisodes: false, searchForCutoffUnmetEpisodes: false },
          });
          seriesId = added.id;
        }
        // Sonarr charge la liste des épisodes juste après l'ajout : on l'attend.
        let episodes: { id: number; seasonNumber: number; episodeNumber: number }[] = [];
        for (let i = 0; i < 40 && !episodes.length; i++) {
          episodes = await sonarr.get<typeof episodes>(`/episode?seriesId=${seriesId}`).catch(() => []);
          if (!episodes.length) await new Promise((r) => setTimeout(r, 1500));
        }
        const files: unknown[] = [];
        let missing = 0;
        for (const e of s.episodes) {
          const ids = e.episodes
            .map((n) => episodes.find((x) => x.seasonNumber === e.season && x.episodeNumber === n)?.id)
            .filter((id): id is number => id !== undefined);
          if (!ids.length) { missing++; continue; }
          const seen = await this.detected(sonarr, e.path, `seriesId=${seriesId}`);
          files.push({
            path: e.path, seriesId, episodeIds: ids, quality: seen?.quality ?? e.quality, languages: seen?.languages ?? e.languages ?? [],
            releaseGroup: e.releaseGroup ?? '', indexerFlags: 0,
          });
        }
        if (!files.length) throw new Error('Aucun épisode ne correspond à la fiche de la série.');
        const cmd = await sonarr.post<{ id: number }>('/command', { name: 'ManualImport', importMode, files });
        const r = await this.waitCommand(sonarr, cmd.id);
        done({
          title: s.title, ok: r.ok,
          message: r.ok ? `${files.length} épisode(s) ${mode === 'move' ? 'déplacé(s)' : 'copié(s)'}${missing ? ` · ${missing} non reconnu(s)` : ''}` : r.message,
        });
      } catch (e) {
        done({ title: s.title, ok: false, message: (e as Error).message });
      }
    }
  }

  reset(): void {
    if (!this.busy()) this.state = { phase: 'idle', sourceId: null, progress: { done: 0, total: 0, label: '' }, analysis: null, results: [], error: null, mode: null };
  }
}
