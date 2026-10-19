// Routes de la page Réglages : chaque réglage est appliqué tout de suite dans l'outil concerné.
import type { FastifyInstance } from 'fastify';
import type { ApplyResult, ConfiguredIndexer, DownloadSettings, MediaPreferences } from '@motflix/shared';
import type { Config } from './config.ts';
import { QbittorrentClient } from './dashboard.ts';
import { parsePreferences, type Settings } from './settings.ts';
import { fromQbt, toQbt, type QbtPreferences } from './setup/downloads.ts';
import { buildTasks, clients, Skip } from './setup/job.ts';
import type { ServiceManager } from './services.ts';
import { applyPreferences } from './setup/profiles.ts';
import { deleteIndexer, listIndexers, setIndexerEnabled } from './setup/prowlarr.ts';

export function registerSettings(app: FastifyInstance, { config, settings, services }: { config: Config; settings: Settings; services: ServiceManager }) {
  const api = clients(config);
  const qbt = new QbittorrentClient(config);
  const fail = (reply: { code: (n: number) => { send: (b: unknown) => unknown } }, status: number, e: unknown) =>
    reply.code(status).send({ error: (e as Error).message });

  // ─── Langue, qualité, taille ───────────────────────────────────────────
  app.get('/api/settings/preferences', async (): Promise<MediaPreferences> => settings.preferences());

  app.post('/api/settings/preferences', async (req, reply): Promise<ApplyResult | unknown> => {
    let prefs: MediaPreferences;
    try {
      prefs = parsePreferences(req.body);
    } catch (e) {
      return fail(reply, 400, e);
    }
    settings.setJson('preferences', prefs);
    try {
      const films = await applyPreferences(api.radarr, 'radarr', prefs);
      await applyPreferences(api.sonarr, 'sonarr', prefs);
      return { ok: true, detail: `Appliqué aux films et séries : ${films}` };
    } catch (e) {
      req.log.warn({ err: e }, 'Préférences non appliquées');
      return fail(reply, 502, new Error(`Enregistré, mais pas encore appliqué : ${(e as Error).message}`));
    }
  });

  // ─── Téléchargements (qBittorrent) ─────────────────────────────────────
  app.get('/api/settings/downloads', async (_req, reply): Promise<DownloadSettings | unknown> => {
    try {
      return fromQbt(await qbt.get<QbtPreferences>('/api/v2/app/preferences'));
    } catch (e) {
      return fail(reply, 502, new Error(`qBittorrent ne répond pas (${(e as Error).message})`));
    }
  });

  app.post('/api/settings/downloads', async (req, reply): Promise<DownloadSettings | unknown> => {
    let prefs: Partial<QbtPreferences>;
    try {
      prefs = toQbt(req.body);
    } catch (e) {
      return fail(reply, 400, e);
    }
    try {
      await qbt.setPreferences(prefs);
      return fromQbt(await qbt.get<QbtPreferences>('/api/v2/app/preferences'));
    } catch (e) {
      return fail(reply, 502, e);
    }
  });

  // ─── Plex : rattache le serveur et crée les bibliothèques ──────────────
  app.post('/api/settings/plex', async (): Promise<ApplyResult> => {
    const task = buildTasks({ config, settings, services }).find((t) => t.id === 'plex')!;
    try {
      return { ok: true, detail: await task.run() };
    } catch (e) {
      return { ok: e instanceof Skip, detail: (e as Error).message };
    }
  });

  // ─── Sites d'indexation (Prowlarr) ─────────────────────────────────────
  app.get('/api/settings/indexers', async (_req, reply): Promise<ConfiguredIndexer[] | unknown> => {
    try {
      return await listIndexers(api.prowlarr);
    } catch (e) {
      return fail(reply, 502, e);
    }
  });

  app.post<{ Params: { id: string } }>('/api/settings/indexers/:id', async (req, reply) => {
    const enabled = (req.body as { enabled?: unknown })?.enabled;
    if (typeof enabled !== 'boolean') return reply.code(400).send({ error: 'Valeur « enabled » attendue.' });
    try {
      await setIndexerEnabled(api.prowlarr, Number(req.params.id), enabled);
      return { ok: true };
    } catch (e) {
      return fail(reply, 502, e);
    }
  });

  app.delete<{ Params: { id: string } }>('/api/settings/indexers/:id', async (req, reply) => {
    try {
      await deleteIndexer(api.prowlarr, Number(req.params.id));
      return { ok: true };
    } catch (e) {
      return fail(reply, 502, e);
    }
  });
}
