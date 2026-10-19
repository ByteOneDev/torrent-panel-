// Exécution de « Tout configurer » : une suite de tâches rejouables, chacune indépendante.
// Une tâche en erreur n'arrête pas les suivantes ; l'assistant affiche le détail.
import type { SetupRun, SetupTask } from '@motflix/shared';
import type { Config } from '../config.ts';
import { QbittorrentClient } from '../dashboard.ts';
import type { ServiceManager } from '../services.ts';
import type { Settings } from '../settings.ts';
import { ensurePlexNotification, wireArr } from './arr.ts';
import { AudiobookshelfClient } from './audiobookshelf.ts';
import { jsonClient } from './http.ts';
import { wireLazyLibrarian } from './lazylibrarian.ts';
import { PlexClient } from './plex.ts';
import { applyPreferences } from './profiles.ts';
import { wireProwlarr } from './prowlarr.ts';

export class Skip extends Error {}

interface TaskDef { id: string; label: string; run: () => Promise<string> }

export interface JobDeps {
  config: Config;
  settings: Settings;
  services: ServiceManager;
}

export function clients(config: Config) {
  return {
    radarr: jsonClient(`${config.urls.radarr}/api/v3`, { 'X-Api-Key': config.keys.radarr }),
    sonarr: jsonClient(`${config.urls.sonarr}/api/v3`, { 'X-Api-Key': config.keys.sonarr }),
    prowlarr: jsonClient(`${config.urls.prowlarr}/api/v1`, { 'X-Api-Key': config.keys.prowlarr }),
  };
}

export function buildTasks({ config, settings, services }: JobDeps): TaskDef[] {
  const api = clients(config);
  const qbt = config.qbittorrent;
  const plex = new PlexClient(settings, config.urls.plex);
  const abs = new AudiobookshelfClient(settings, config.urls.audiobookshelf);
  const installed = async (id: string) =>
    (await services.list()).services.some((s) => s.id === id && s.state !== 'missing');

  return [
    {
      id: 'qbittorrent', label: 'Téléchargement : un dossier par catégorie',
      run: async () => {
        await new QbittorrentClient(config).setPreferences({ auto_tmm_enabled: true });
        return 'films, séries et livres rangés séparément dans /data/torrents';
      },
    },
    { id: 'radarr', label: 'Films : dossier, téléchargement et renommage', run: () => wireArr(api.radarr, 'radarr', qbt) },
    { id: 'sonarr', label: 'Séries : dossier, téléchargement et renommage', run: () => wireArr(api.sonarr, 'sonarr', qbt) },
    {
      id: 'lazylibrarian', label: 'Livres et livres audio',
      run: () => wireLazyLibrarian({ url: config.urls.lazylibrarian, apiKey: config.keys.lazylibrarian, qbittorrent: qbt }),
    },
    {
      id: 'prowlarr', label: "Sites d'indexation partagés avec tous les outils",
      run: () => wireProwlarr(api.prowlarr, {
        radarrKey: config.keys.radarr, sonarrKey: config.keys.sonarr, lazylibrarianKey: config.keys.lazylibrarian,
      }),
    },
    {
      id: 'preferences', label: 'Langue, qualité et taille des fichiers',
      run: async () => {
        const prefs = settings.preferences();
        const films = await applyPreferences(api.radarr, 'radarr', prefs);
        await applyPreferences(api.sonarr, 'sonarr', prefs);
        return `Films et séries : ${films}`;
      },
    },
    {
      id: 'plex', label: 'Plex : compte, bibliothèques et actualisation',
      run: async () => {
        if (!(await installed('plex'))) throw new Skip('Plex non installé');
        if (!plex.accountToken) throw new Skip('Compte Plex non connecté : possible plus tard');
        const detail = await plex.setUpServer();
        const target = { ...plex.arrTarget(), token: plex.accountToken };
        await ensurePlexNotification(api.radarr, target);
        await ensurePlexNotification(api.sonarr, target);
        return `${detail} · actualisation après chaque import`;
      },
    },
    {
      id: 'audiobookshelf', label: 'Livres audio : compte et bibliothèques',
      run: async () => {
        const status = await abs.status();
        if (!status) throw new Error('Audiobookshelf ne répond pas.');
        if (status.initialized && !abs.credentials) throw new Skip('Déjà configuré en dehors de Motflix');
        return abs.setUp();
      },
    },
    {
      id: 'vpn', label: 'VPN',
      run: async () => {
        const vpn = (await services.list()).services.find((s) => s.id === 'gluetun');
        if (!vpn || vpn.state === 'missing') throw new Skip('Sans VPN');
        if (vpn.state !== 'online') throw new Error('Le VPN ne se connecte pas : vérifiez vos identifiants.');
        return 'Connecté : les téléchargements passent par le VPN';
      },
    },
  ];
}

/** Une seule exécution à la fois ; l'état reste consultable après la fin. */
export class SetupJob {
  private state: SetupRun = { running: false, startedAt: null, finishedAt: null, tasks: [] };

  status(): SetupRun {
    return structuredClone(this.state);
  }

  start(tasks: TaskDef[]): boolean {
    if (this.state.running) return false;
    this.state = {
      running: true,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      tasks: tasks.map((t): SetupTask => ({ id: t.id, label: t.label, state: 'pending' })),
    };
    void this.execute(tasks);
    return true;
  }

  private async execute(tasks: TaskDef[]) {
    for (const [i, def] of tasks.entries()) {
      const task = this.state.tasks[i]!;
      task.state = 'running';
      try {
        task.detail = await def.run();
        task.state = 'done';
      } catch (e) {
        task.detail = (e as Error).message;
        task.state = e instanceof Skip ? 'skipped' : 'error';
      }
    }
    this.state.running = false;
    this.state.finishedAt = new Date().toISOString();
  }
}
