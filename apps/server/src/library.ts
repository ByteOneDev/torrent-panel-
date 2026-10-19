// Recherche, ajout et bibliothèque : films (Radarr), séries (Sonarr), livres (LazyLibrarian).
import type { AddRequest, BookFormat, LibraryItem, LibraryStatus, SearchResult } from '@motflix/shared';
import type { Config } from './config.ts';
import { clients } from './setup/job.ts';
import { motflixProfileId } from './setup/profiles.ts';
import type { JsonClient } from './setup/http.ts';

interface ArrImage { coverType: string; remoteUrl?: string; url?: string }
interface ArrMovie {
  id?: number; title: string; year?: number; tmdbId: number; overview?: string; studio?: string;
  images?: ArrImage[]; remotePoster?: string; hasFile?: boolean; isAvailable?: boolean; sizeOnDisk?: number;
  movieFile?: { quality?: { quality?: { name?: string } }; languages?: { name: string }[]; size?: number };
  [k: string]: unknown;
}
interface ArrSeries {
  id?: number; title: string; year?: number; tvdbId: number; overview?: string; network?: string; images?: ArrImage[];
  remotePoster?: string; status?: string;
  statistics?: { episodeFileCount: number; episodeCount: number; totalEpisodeCount: number; sizeOnDisk: number; percentOfEpisodes: number };
  [k: string]: unknown;
}
interface QueueRecord { movieId?: number; seriesId?: number; size: number; sizeleft: number }
interface LLBook {
  BookID: string; BookName: string; AuthorName: string; BookDate?: string; BookImg?: string;
  Status: string; AudioStatus: string; BookAdded?: string;
}

/** Affiche en taille « vignette » : l'originale de TMDB pèse plusieurs Mo. */
const poster = (images?: ArrImage[], remote?: string) => {
  const url = remote ?? images?.find((i) => i.coverType === 'poster')?.remoteUrl ?? null;
  return url ? url.replace('image.tmdb.org/t/p/original/', 'image.tmdb.org/t/p/w342/') : null;
};

const yearOf = (date?: string | number | null) => {
  const y = Number(String(date ?? '').slice(0, 4));
  return y > 1000 ? y : null;
};

export class LibraryError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export class Library {
  private config: Config;
  private api: ReturnType<typeof clients>;

  constructor(config: Config) {
    this.config = config;
    this.api = clients(config);
  }

  // ─── LazyLibrarian (API « cmd=… ») ────────────────────────────────────

  private async ll<T>(params: Record<string, string>): Promise<T> {
    const qs = new URLSearchParams({ apikey: this.config.keys.lazylibrarian, ...params });
    const res = await fetch(`${this.config.urls.lazylibrarian}/api?${qs}`, { signal: AbortSignal.timeout(60_000) });
    const text = await res.text();
    if (!res.ok) throw new LibraryError(502, `LazyLibrarian a répondu ${res.status}`);
    try { return JSON.parse(text) as T; } catch { return text as T; }
  }

  async bookCover(bookId: string): Promise<Response> {
    if (!/^[\w.-]+$/.test(bookId)) throw new LibraryError(400, 'Identifiant invalide.');
    return fetch(`${this.config.urls.lazylibrarian}/cache/book/${bookId}.jpg`, { signal: AbortSignal.timeout(15_000) });
  }

  // ─── Recherche ────────────────────────────────────────────────────────

  async search(kind: 'movie' | 'series' | 'book', query: string): Promise<SearchResult[]> {
    const q = encodeURIComponent(query);
    if (kind === 'movie') {
      const list = await this.api.radarr.get<ArrMovie[]>(`/movie/lookup?term=${q}`);
      return list.slice(0, 30).map((m) => ({
        kind, key: String(m.tmdbId), title: m.title, year: m.year || null, overview: m.overview ?? '',
        poster: poster(m.images, m.remotePoster), subtitle: m.studio ?? null, inLibrary: !!m.id,
      }));
    }
    if (kind === 'series') {
      const list = await this.api.sonarr.get<ArrSeries[]>(`/series/lookup?term=${q}`);
      return list.slice(0, 30).map((s) => ({
        kind, key: String(s.tvdbId), title: s.title, year: s.year || null, overview: s.overview ?? '',
        poster: poster(s.images, s.remotePoster), subtitle: s.network ?? null, inLibrary: !!s.id,
      }));
    }
    const [found, owned] = await Promise.all([
      this.ll<{ bookid: string; bookname: string; authorname: string; bookimg?: string; bookdesc?: string; bookdate?: string }[] | string>(
        { cmd: 'findBook', name: query }),
      this.ll<LLBook[] | string>({ cmd: 'getAllBooks' }),
    ]);
    if (!Array.isArray(found)) return [];
    const wanted = new Set(Array.isArray(owned) ? owned.filter((b) => inBookLibrary(b)).map((b) => b.BookID) : []);
    return found.slice(0, 30).map((b) => ({
      kind, key: b.bookid, title: b.bookname, year: yearOf(b.bookdate), overview: b.bookdesc ?? '',
      poster: b.bookimg ? b.bookimg.replace(/^http:/, 'https:').replace(/-S\.jpg$/, '-M.jpg') : null,
      subtitle: b.authorname, inLibrary: wanted.has(b.bookid),
    }));
  }

  // ─── Ajout ────────────────────────────────────────────────────────────

  async add(req: AddRequest): Promise<string> {
    if (req.kind === 'movie') return this.addMovie(req);
    if (req.kind === 'series') return this.addSeries(req);
    return this.addBook(req);
  }

  private async profileId(api: JsonClient): Promise<number> {
    const id = await motflixProfileId(api);
    if (id !== null) return id;
    const profiles = await api.get<{ id: number }[]>('/qualityprofile');
    if (!profiles[0]) throw new LibraryError(409, "Aucun profil de qualité : lancez l'assistant.");
    return profiles[0].id;
  }

  private async addMovie(req: AddRequest): Promise<string> {
    const api = this.api.radarr;
    const movie = await api.get<ArrMovie>(`/movie/lookup/tmdb?tmdbId=${encodeURIComponent(req.key)}`);
    if (movie.id) throw new LibraryError(409, `${movie.title} est déjà dans votre bibliothèque.`);
    await api.post('/movie', {
      ...movie, qualityProfileId: await this.profileId(api), rootFolderPath: '/data/media/films',
      monitored: true, minimumAvailability: 'released',
      addOptions: { searchForMovie: req.search, monitor: 'movieOnly' },
    });
    return `${movie.title} ajouté${req.search ? ' : recherche lancée' : ''}`;
  }

  private async addSeries(req: AddRequest): Promise<string> {
    const api = this.api.sonarr;
    const [series] = await api.get<ArrSeries[]>(`/series/lookup?term=tvdb:${encodeURIComponent(req.key)}`);
    if (!series) throw new LibraryError(404, 'Série introuvable.');
    if (series.id) throw new LibraryError(409, `${series.title} est déjà dans votre bibliothèque.`);
    await api.post('/series', {
      ...series, qualityProfileId: await this.profileId(api), rootFolderPath: '/data/media/series',
      monitored: true, seasonFolder: true, seriesType: 'standard',
      addOptions: {
        monitor: req.monitor === 'future' ? 'future' : 'all',
        searchForMissingEpisodes: req.search, searchForCutoffUnmetEpisodes: false,
      },
    });
    return `${series.title} ajoutée${req.search ? ' : recherche des épisodes lancée' : ''}`;
  }

  private async addBook(req: AddRequest): Promise<string> {
    if (!/^[\w.-]+$/.test(req.key)) throw new LibraryError(400, 'Identifiant invalide.');
    const formats: BookFormat[] = req.formats?.length ? req.formats : ['eBook'];
    const added = await this.ll<boolean | string>({ cmd: 'addBook', id: req.key, wait: '1' });
    if (added !== true && added !== 'true' && added !== 'OK') throw new LibraryError(502, `LazyLibrarian : ${String(added).slice(0, 120)}`);
    for (const type of formats) {
      await this.ll({ cmd: 'queueBook', id: req.key, type });
      if (req.search) await this.ll({ cmd: 'searchBook', id: req.key, type });
    }
    const label = formats.map((f) => (f === 'eBook' ? 'livre' : 'livre audio')).join(' et ');
    return `Ajouté en ${label}${req.search ? ' : recherche lancée' : ''}`;
  }

  // ─── Bibliothèque ─────────────────────────────────────────────────────

  private async queue(api: JsonClient): Promise<QueueRecord[]> {
    try {
      return (await api.get<{ records: QueueRecord[] }>('/queue?pageSize=500')).records;
    } catch {
      return [];
    }
  }

  async movies(): Promise<LibraryItem[]> {
    const [movies, queue] = await Promise.all([this.api.radarr.get<ArrMovie[]>('/movie'), this.queue(this.api.radarr)]);
    return movies.map((m): LibraryItem => {
      const q = queue.find((r) => r.movieId === m.id);
      let status: LibraryStatus = m.hasFile ? 'available' : m.isAvailable === false ? 'unreleased' : 'missing';
      if (q && !m.hasFile) status = 'downloading';
      const f = m.movieFile;
      const langs = f?.languages?.map((l) => l.name).filter((n) => n && n !== 'Unknown').join(', ');
      return {
        kind: 'movie', id: String(m.id), title: m.title, year: m.year || null, subtitle: m.studio ?? null,
        poster: poster(m.images), overview: m.overview ?? '', status,
        progress: q && q.size > 0 ? 1 - q.sizeleft / q.size : null,
        detail: f ? [f.quality?.quality?.name, langs].filter(Boolean).join(' · ') : statusText(status),
        sizeBytes: m.sizeOnDisk ?? 0,
      };
    }).sort(byTitle);
  }

  async series(): Promise<LibraryItem[]> {
    const [list, queue] = await Promise.all([this.api.sonarr.get<ArrSeries[]>('/series'), this.queue(this.api.sonarr)]);
    return list.map((s): LibraryItem => {
      const st = s.statistics;
      const have = st?.episodeFileCount ?? 0;
      const total = st?.episodeCount ?? 0;
      const q = queue.filter((r) => r.seriesId === s.id);
      let status: LibraryStatus = total > 0 && have >= total ? 'available' : have > 0 ? 'partial' : s.status === 'upcoming' ? 'unreleased' : 'missing';
      if (q.length && status !== 'available') status = 'downloading';
      const size = q.reduce((a, r) => a + r.size, 0);
      const left = q.reduce((a, r) => a + r.sizeleft, 0);
      return {
        kind: 'series', id: String(s.id), title: s.title, year: s.year || null, subtitle: s.network ?? null,
        poster: poster(s.images), overview: s.overview ?? '', status,
        progress: size > 0 ? 1 - left / size : null,
        detail: total ? `${have} / ${total} épisodes` : statusText(status),
        sizeBytes: st?.sizeOnDisk ?? 0,
      };
    }).sort(byTitle);
  }

  async books(format: BookFormat): Promise<LibraryItem[]> {
    const list = await this.ll<LLBook[] | string>({ cmd: 'getAllBooks' });
    if (!Array.isArray(list)) return [];
    return list
      .filter((b) => BOOK_STATES.has(format === 'eBook' ? b.Status : b.AudioStatus))
      .map((b) => {
        const s = format === 'eBook' ? b.Status : b.AudioStatus;
        const status: LibraryStatus = s === 'Open' || s === 'Have' ? 'available' : s === 'Snatched' ? 'downloading' : 'missing';
        return {
          kind: 'book', id: b.BookID, title: b.BookName, year: yearOf(b.BookDate), subtitle: b.AuthorName,
          poster: b.BookImg ? `/api/library/books/${encodeURIComponent(b.BookID)}/cover` : null,
          overview: '', status, progress: null, detail: statusText(status), sizeBytes: 0,
        } satisfies LibraryItem;
      })
      .sort(byTitle);
  }

  // ─── Actions ──────────────────────────────────────────────────────────

  async searchAgain(kind: 'movie' | 'series' | 'book', id: string, format?: BookFormat): Promise<void> {
    if (kind === 'movie') await this.api.radarr.post('/command', { name: 'MoviesSearch', movieIds: [Number(id)] });
    else if (kind === 'series') await this.api.sonarr.post('/command', { name: 'SeriesSearch', seriesId: Number(id) });
    else await this.ll({ cmd: 'searchBook', id, type: format ?? 'eBook' });
  }

  async remove(kind: 'movie' | 'series' | 'book', id: string, deleteFiles: boolean, format?: BookFormat): Promise<void> {
    const flag = deleteFiles ? 'true' : 'false';
    if (kind === 'movie') await this.api.radarr.del(`/movie/${Number(id)}?deleteFiles=${flag}&addImportExclusion=false`);
    else if (kind === 'series') await this.api.sonarr.del(`/series/${Number(id)}?deleteFiles=${flag}&addImportListExclusion=false`);
    // LazyLibrarian ne supprime pas de fichiers par l'API : le livre n'est simplement plus recherché.
    else await this.ll({ cmd: 'unqueueBook', id, type: format ?? 'eBook' });
  }
}

const BOOK_STATES = new Set(['Wanted', 'Snatched', 'Open', 'Have']);
const inBookLibrary = (b: LLBook) => BOOK_STATES.has(b.Status) || BOOK_STATES.has(b.AudioStatus);
const byTitle = (a: LibraryItem, b: LibraryItem) => a.title.localeCompare(b.title, 'fr');

function statusText(s: LibraryStatus): string {
  return { available: 'Disponible', partial: 'En partie', downloading: 'En téléchargement', missing: 'Recherché', unreleased: 'Pas encore sorti' }[s];
}
