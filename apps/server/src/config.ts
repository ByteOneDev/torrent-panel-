// Configuration lue dans les variables d'environnement.
// Les valeurs par défaut correspondent au panel lancé dans Docker, sur le réseau « motflix ».
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function env(name: string, fallback = ''): string {
  return process.env[name]?.trim() || fallback;
}

export interface Config {
  host: string;
  port: number;
  dataDir: string;      // base SQLite du panel
  webDir: string;       // interface compilée (vide en développement)
  mediaPath: string;    // dossier /data partagé avec les outils
  mediaHostPath: string | null;  // le même dossier, vu depuis la machine (affichage)
  hostDir: string | null;        // dossier d'installation sur la machine (commandes à afficher)
  importPath: string;            // disques branchés, vus dans les conteneurs (/import)
  importHostPath: string | null; // le même dossier sur la machine (/Volumes ou /media)
  importLayout: 'flat' | 'user'; // macOS : /Volumes/<disque> ; Linux : /media/<utilisateur>/<disque>
  importExclude: string[];       // noms à ignorer (Windows : le disque système « c »)
  dockerHost: string;   // unix:///… ou http://socket-proxy:2375
  composeProject: string;
  secureCookies: boolean;
  /** Noms de domaine supplémentaires acceptés (en plus des IP et noms du réseau local). */
  allowedHostnames: string[];
  toolsExposed: boolean;
  urls: {
    radarr: string; sonarr: string; prowlarr: string; lazylibrarian: string;
    flaresolverr: string; qbittorrent: string; audiobookshelf: string;
    plex: string; gluetun: string;
  };
  keys: { radarr: string; sonarr: string; prowlarr: string; lazylibrarian: string };
  qbittorrent: { username: string; password: string };
}

export function loadConfig(): Config {
  return {
    host: env('HOST', '0.0.0.0'),
    port: Number(env('PORT', '8080')),
    dataDir: env('MOTFLIX_DATA_DIR', path.resolve(here, '../data')),
    webDir: env('MOTFLIX_WEB_DIR', path.resolve(here, '../../web/dist')),
    mediaPath: env('MEDIA_PATH', '/data'),
    mediaHostPath: env('MEDIA_HOST_PATH') || null,
    hostDir: env('MOTFLIX_HOST_DIR') || null,
    importPath: env('IMPORT_PATH', '/import'),
    importHostPath: env('IMPORT_HOST_PATH') || null,
    importLayout: env('IMPORT_LAYOUT') === 'user' ? 'user' : 'flat',
    importExclude: env('IMPORT_EXCLUDE').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    dockerHost: env('DOCKER_HOST', 'unix:///var/run/docker.sock'),
    composeProject: env('COMPOSE_PROJECT', 'motflix'),
    secureCookies: env('SECURE_COOKIES') === 'true',
    allowedHostnames: env('PANEL_HOSTNAMES').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean),
    toolsExposed: env('TOOLS_BIND', '127.0.0.1') !== '127.0.0.1',
    urls: {
      radarr: env('RADARR_URL', 'http://radarr:7878'),
      sonarr: env('SONARR_URL', 'http://sonarr:8989'),
      prowlarr: env('PROWLARR_URL', 'http://prowlarr:9696'),
      lazylibrarian: env('LAZYLIBRARIAN_URL', 'http://lazylibrarian:5299'),
      flaresolverr: env('FLARESOLVERR_URL', 'http://flaresolverr:8191'),
      qbittorrent: env('QBITTORRENT_URL', 'http://qbittorrent:8090'),
      audiobookshelf: env('AUDIOBOOKSHELF_URL', 'http://audiobookshelf:80'),
      plex: env('PLEX_URL', 'http://plex:32400'),
      gluetun: env('GLUETUN_URL', 'http://gluetun:8000'),
    },
    keys: {
      radarr: env('RADARR_API_KEY'),
      sonarr: env('SONARR_API_KEY'),
      prowlarr: env('PROWLARR_API_KEY'),
      lazylibrarian: env('LAZYLIBRARIAN_API_KEY'),
    },
    qbittorrent: {
      username: env('QBITTORRENT_USER', 'admin'),
      password: env('QBITTORRENT_PASSWORD'),
    },
  };
}
