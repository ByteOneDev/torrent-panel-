// Les services de la stack Motflix, tels que présentés dans le panel.
import type { ServiceIcon } from '@motflix/shared';
import type { Config } from './config.ts';

export interface CatalogEntry {
  id: string;
  name: string;
  tool: string;
  icon: ServiceIcon;
  description: string;
  /** Services Compose possibles (qBittorrent change de nom avec ou sans VPN). */
  composeServices: string[];
  /** Adresse testée pour savoir si le service répond ; sinon on se fie à Docker. */
  healthUrl?: (c: Config) => string;
  ui?: { port: number; path: string; lan: boolean };
  protected?: boolean;
  optional?: boolean;
  /** Services à redémarrer après celui-ci (qBittorrent partage le réseau du VPN). */
  dependents?: string[];
}

export const CATALOG: CatalogEntry[] = [
  {
    id: 'radarr', name: 'Films', tool: 'Radarr', icon: 'film',
    description: 'Cherche, télécharge et range les films.',
    composeServices: ['radarr'],
    healthUrl: (c) => `${c.urls.radarr}/ping`,
    ui: { port: 7878, path: '/', lan: false },
  },
  {
    id: 'sonarr', name: 'Séries', tool: 'Sonarr', icon: 'tv',
    description: 'Suit les séries et récupère les nouveaux épisodes.',
    composeServices: ['sonarr'],
    healthUrl: (c) => `${c.urls.sonarr}/ping`,
    ui: { port: 8989, path: '/', lan: false },
  },
  {
    id: 'lazylibrarian', name: 'Livres', tool: 'LazyLibrarian', icon: 'book',
    description: 'Livres et livres audio.',
    composeServices: ['lazylibrarian'],
    healthUrl: (c) => `${c.urls.lazylibrarian}/`,
    ui: { port: 5299, path: '/', lan: false },
  },
  {
    id: 'prowlarr', name: "Sites d'indexation", tool: 'Prowlarr', icon: 'list',
    description: 'Les sites où chercher, partagés avec les autres outils.',
    composeServices: ['prowlarr'],
    healthUrl: (c) => `${c.urls.prowlarr}/ping`,
    ui: { port: 9696, path: '/', lan: false },
  },
  {
    id: 'qbittorrent', name: 'Téléchargement', tool: 'qBittorrent', icon: 'download',
    description: 'Télécharge et partage les fichiers.',
    composeServices: ['qbittorrent', 'qbittorrent-vpn'],
    healthUrl: (c) => `${c.urls.qbittorrent}/`,
    ui: { port: 8090, path: '/', lan: false },
  },
  {
    id: 'gluetun', name: 'VPN', tool: 'Gluetun', icon: 'shield',
    description: 'Fait passer les téléchargements par le VPN.',
    composeServices: ['gluetun'],
    optional: true,
    dependents: ['qbittorrent-vpn'],
  },
  {
    id: 'flaresolverr', name: 'Anti-bot', tool: 'FlareSolverr', icon: 'zap',
    description: 'Passe les protections de certains sites.',
    composeServices: ['flaresolverr'],
    healthUrl: (c) => `${c.urls.flaresolverr}/`,
  },
  {
    id: 'audiobookshelf', name: 'Livres audio', tool: 'Audiobookshelf', icon: 'headphones',
    description: 'Écoute des livres audio et lecture des livres.',
    composeServices: ['audiobookshelf'],
    healthUrl: (c) => `${c.urls.audiobookshelf}/healthcheck`,
    ui: { port: 13378, path: '/', lan: true },
  },
  {
    id: 'plex', name: 'Lecture', tool: 'Plex', icon: 'play',
    description: 'Films et séries sur la télé.',
    composeServices: ['plex'],
    healthUrl: (c) => `${c.urls.plex}/identity`,
    ui: { port: 32400, path: '/web', lan: true },
    optional: true,
  },
  {
    id: 'motflix', name: 'Panel', tool: 'Motflix', icon: 'panel',
    description: 'Cette interface.',
    composeServices: ['motflix'],
    protected: true,
  },
  {
    id: 'socket-proxy', name: 'Accès Docker', tool: 'Socket proxy', icon: 'lock',
    description: 'Accès limité à Docker pour le panel.',
    composeServices: ['socket-proxy'],
    protected: true,
  },
];

export function findEntry(id: string): CatalogEntry | undefined {
  return CATALOG.find((e) => e.id === id);
}
