// Contrat de l'API entre le serveur et l'interface.
// Uniquement des types : à importer avec « import type ».

export type ServiceState =
  | 'online'    // conteneur lancé et service qui répond
  | 'starting'  // conteneur lancé, service pas encore prêt
  | 'unhealthy' // conteneur lancé, service en erreur
  | 'stopped'   // conteneur arrêté
  | 'missing';  // conteneur absent (profil désactivé, pas encore créé)

export type ServiceIcon =
  | 'film' | 'tv' | 'book' | 'headphones' | 'list' | 'download'
  | 'shield' | 'play' | 'zap' | 'panel' | 'lock';

export interface Service {
  id: string;
  name: string;        // nom simple : « Films »
  tool: string;        // outil : « Radarr »
  icon: ServiceIcon;
  description: string;
  state: ServiceState;
  containerName: string | null;
  startedAt: string | null;  // ISO
  cpuPercent: number | null;
  memoryBytes: number | null;
  memoryLimitBytes: number | null;
  /**
   * Interface d'origine de l'outil. `lan` : publiée sur le réseau local ;
   * sinon joignable seulement depuis la machine qui héberge Motflix.
   */
  ui: { port: number; path: string; lan: boolean } | null;
  /** Le panel refuse d'arrêter ce service (le panel lui-même, l'accès Docker). */
  protected: boolean;
  /** Service facultatif (VPN, Plex) : masqué quand il n'est pas installé. */
  optional: boolean;
}

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogLine {
  time: string | null; // ISO
  level: LogLevel;
  text: string;
}

/** Comment se connecter à l'interface d'origine d'un outil. */
export interface ServiceAccess {
  username: string | null;
  password: string | null;
  note: string;
}

export interface ServicesResponse {
  services: Service[];
  toolsExposed: boolean;
}

export type ServiceAction = 'start' | 'stop' | 'restart';

export interface DownloadItem {
  name: string;
  category: string;
  progress: number;      // 0..1
  downloadSpeed: number; // octets/s
  size: number;          // octets
  etaSeconds: number | null;
  state: string;
}

export interface ActivityItem {
  date: string; // ISO
  kind: 'grabbed' | 'imported' | 'failed' | 'deleted' | 'other';
  title: string;
  detail: string;
  source: 'Films' | 'Séries';
}

export interface DashboardResponse {
  downloads: {
    available: boolean;
    active: number;
    downloadSpeed: number;
    uploadSpeed: number;
    items: DownloadItem[];
  };
  disk: { available: boolean; totalBytes: number; freeBytes: number };
  vpn: {
    enabled: boolean;
    connected: boolean;
    publicIp: string | null;
    country: string | null;
    forwardedPort: number | null;
  };
  library: { movies: number | null; moviesOnDisk: number | null; series: number | null };
  activity: ActivityItem[];
}

export interface AuthState {
  /**
   * Comptes activés dans Réglages › Utilisateurs. Désactivés par défaut :
   * le panel s'ouvre alors directement, en administrateur, sans connexion.
   */
  authEnabled: boolean;
  /** Utilisateur courant ; null seulement si les comptes sont activés et que personne n'est connecté. */
  user: { username: string; role: 'admin' } | null;
  /** L'assistant de première configuration a été terminé (ou passé). */
  setupDone: boolean;
}

export interface ApiError {
  error: string;
}

// ─── Assistant de configuration ──────────────────────────────────────────

export type LanguageTag = 'VF' | 'MULTi' | 'VO' | 'VOSTFR';
export type Resolution = '720p' | '1080p' | '2160p';

/** Préférences appliquées aux films et séries (profils de Radarr et Sonarr). */
export interface MediaPreferences {
  /** Ordre de préférence, de la plus voulue à la moins voulue. */
  languages: LanguageTag[];
  acceptVfq: boolean;
  upgradeLanguage: boolean;
  rejectOthers: boolean;
  resolution: Resolution;
  allowHdr: boolean;
  avoidRemux: boolean;
  maxMovieGb: number;
  maxEpisodeGb: number;
}

export type TaskState = 'pending' | 'running' | 'done' | 'error' | 'skipped';

export interface SetupTask {
  id: string;
  label: string;
  state: TaskState;
  detail?: string;
}

export interface SetupRun {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  tasks: SetupTask[];
}

export interface VpnSettings {
  enabled: boolean;
  provider: string;
  type: 'wireguard' | 'openvpn';
  wireguardPrivateKey: string;
  wireguardAddresses: string;
  openvpnUser: string;
  openvpnPassword: string;
  countries: string;
  portForwarding: boolean;
}

export interface AgentResult {
  id: string;
  ok: boolean;
  message: string;
  finishedAt: string;
}

export interface SetupInfo {
  setupDone: boolean;
  media: {
    hostPath: string | null;
    folders: { path: string; exists: boolean }[];
    disk: { totalBytes: number; freeBytes: number } | null;
  };
  vpn: {
    enabled: boolean;
    provider: string | null;
    agentInstalled: boolean;
    applyCommand: string;
    pending: boolean;
    lastResult: AgentResult | null;
  };
  plex: { installed: boolean; claimed: boolean; linked: boolean; account: string | null };
  audiobookshelf: { initialized: boolean; managed: boolean; username: string | null; password: string | null };
  preferences: MediaPreferences;
  indexers: { name: string; enabled: boolean }[];
}

export interface IndexerDefinition {
  name: string;
  description: string;
  language: string;
}

export interface IndexerAddResult {
  name: string;
  ok: boolean;
  message: string;
}

// ─── Recherche et bibliothèque ───────────────────────────────────────────

export type MediaKind = 'movie' | 'series' | 'book';
export type BookFormat = 'eBook' | 'AudioBook';

export interface SearchResult {
  kind: MediaKind;
  /** tmdbId (film), tvdbId (série) ou identifiant OpenLibrary (livre). */
  key: string;
  title: string;
  year: number | null;
  overview: string;
  poster: string | null;
  /** Auteur (livre), chaîne ou studio (série, film). */
  subtitle: string | null;
  inLibrary: boolean;
}

export type LibraryStatus = 'available' | 'partial' | 'downloading' | 'missing' | 'unreleased';

export interface LibraryItem {
  kind: MediaKind;
  /** Identifiant dans l'outil (Radarr, Sonarr) ou BookID (LazyLibrarian). */
  id: string;
  title: string;
  year: number | null;
  subtitle: string | null;
  poster: string | null;
  overview: string;
  status: LibraryStatus;
  /** 0..1 pendant un téléchargement. */
  progress: number | null;
  /** « WEBDL-1080p · French », « 12 / 24 épisodes »… */
  detail: string;
  sizeBytes: number;
}

export interface AddRequest {
  kind: MediaKind;
  key: string;
  /** Lancer la recherche tout de suite. */
  search: boolean;
  /** Séries : tous les épisodes ou seulement les prochains. */
  monitor?: 'all' | 'future';
  /** Livres : formats voulus. */
  formats?: BookFormat[];
}

export type TorrentAction = 'pause' | 'resume' | 'delete';

export interface Torrent {
  hash: string;
  name: string;
  category: string;
  sizeBytes: number;
  progress: number;
  downloadSpeed: number;
  uploadSpeed: number;
  etaSeconds: number | null;
  ratio: number;
  state: string;
  /** Regroupement lisible de l'état de qBittorrent. */
  phase: 'downloading' | 'waiting' | 'paused' | 'seeding' | 'done' | 'checking' | 'error';
  addedAt: string;
}

export interface TorrentsResponse {
  downloadSpeed: number;
  uploadSpeed: number;
  torrents: Torrent[];
}

// ─── Réglages ────────────────────────────────────────────────────────────

/** Réglages de téléchargement (qBittorrent), en unités humaines. */
export interface DownloadSettings {
  /** Mo/s ; 0 = illimité. */
  maxDownloadMBps: number;
  maxUploadMBps: number;
  /** Vitesse réduite sur une plage horaire. */
  scheduleEnabled: boolean;
  scheduleFrom: string; // HH:MM
  scheduleTo: string;   // HH:MM
  altDownloadMBps: number;
  altUploadMBps: number;
  maxActiveDownloads: number;
  /** Arrêter de partager après ce ratio (null = pas de limite). */
  seedRatio: number | null;
  /** … ou après ce nombre de jours (null = pas de limite). */
  seedDays: number | null;
  /** Retirer le torrent une fois le partage terminé (le fichier reste dans la bibliothèque). */
  removeAfterSeeding: boolean;
}

export interface ConfiguredIndexer {
  id: number;
  name: string;
  enabled: boolean;
  flaresolverr: boolean;
  language: string;
}

export interface ApplyResult {
  ok: boolean;
  detail: string;
}

export interface PlexPin {
  id: number;
  code: string;
  authUrl: string;
}
