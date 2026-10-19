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
}

export interface ApiError {
  error: string;
}
