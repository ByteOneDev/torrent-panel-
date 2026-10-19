// Identifiants des interfaces d'origine, affichés à côté du bouton « Interface d'origine ».
// Radarr, Sonarr, Prowlarr et LazyLibrarian n'en demandent pas depuis le réseau local
// (réglage posé à l'installation) ; qBittorrent, Audiobookshelf et Plex, si.
import type { ServiceAccess } from '@motflix/shared';
import type { Config } from './config.ts';
import type { Settings } from './settings.ts';

const NO_LOGIN = 'Aucun identifiant : accès direct depuis votre réseau local.';

export function serviceAccess(id: string, config: Config, settings: Settings): ServiceAccess | null {
  switch (id) {
    case 'radarr':
    case 'sonarr':
    case 'prowlarr':
    case 'lazylibrarian':
      return { username: null, password: null, note: NO_LOGIN };
    case 'qbittorrent':
      return config.qbittorrent.password
        ? { username: config.qbittorrent.username, password: config.qbittorrent.password, note: 'Créés à l’installation.' }
        : { username: config.qbittorrent.username, password: null,
            note: 'Mot de passe temporaire : affiché par « docker logs motflix-qbittorrent ».' };
    case 'audiobookshelf': {
      const username = settings.get('abs_username');
      const password = settings.get('abs_password');
      return username && password
        ? { username, password, note: 'Aussi valables dans l’appli Audiobookshelf du téléphone.' }
        : { username: null, password: null, note: 'Compte non créé par Motflix : lancez l’assistant, ou utilisez le vôtre.' };
    }
    case 'plex': {
      const account = settings.get('plex_account');
      return { username: account, password: null,
        note: account ? 'Connectez-vous avec votre compte Plex (mot de passe de plex.tv).' : 'Connectez votre compte Plex dans l’assistant.' };
    }
    default:
      return null;
  }
}
