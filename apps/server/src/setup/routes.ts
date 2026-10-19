// Routes de l'assistant de configuration.
import { existsSync } from 'node:fs';
import { statfs } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { IndexerAddResult, SetupInfo, VpnSettings } from '@motflix/shared';
import type { Config } from '../config.ts';
import type { ServiceManager } from '../services.ts';
import { parsePreferences, type Settings } from '../settings.ts';
import { Agent, AgentError, VPN_PROVIDERS, vpnEnv } from './agent.ts';
import { AudiobookshelfClient } from './audiobookshelf.ts';
import { buildTasks, clients, SetupJob } from './job.ts';
import { PlexClient } from './plex.ts';
import { addIndexers, configuredIndexers, publicDefinitions } from './prowlarr.ts';

const KINDS = ['films', 'series', 'livres', 'livres-audio'];

export function registerSetup(app: FastifyInstance, deps: { config: Config; settings: Settings; services: ServiceManager }) {
  const { config, settings, services } = deps;
  const agent = new Agent(config.dataDir, config.hostDir);
  const plex = new PlexClient(settings, config.urls.plex);
  const abs = new AudiobookshelfClient(settings, config.urls.audiobookshelf);
  const job = new SetupJob();
  const api = clients(config);

  const badRequest = (reply: { code: (n: number) => { send: (b: unknown) => unknown } }, e: unknown) =>
    reply.code(400).send({ error: (e as Error).message });

  app.get('/api/setup', async (): Promise<SetupInfo> => {
    // État frais : l'assistant affiche l'effet d'un changement (VPN…) juste après coup.
    services.invalidate();
    const list = (await services.list()).services;
    const has = (id: string) => list.some((s) => s.id === id && s.state !== 'missing');
    const gluetun = list.find((s) => s.id === 'gluetun');
    const hostRoot = config.mediaHostPath ?? config.mediaPath;

    const [disk, plexId, absStatus, indexers] = await Promise.all([
      statfs(config.mediaPath).then((s) => ({ totalBytes: s.blocks * s.bsize, freeBytes: s.bavail * s.bsize }), () => null),
      has('plex') ? plex.identity() : Promise.resolve(null),
      abs.status(),
      configuredIndexers(api.prowlarr).catch(() => []),
    ]);
    const absCreds = abs.credentials;

    return {
      setupDone: settings.get('setup_done') === '1',
      media: {
        hostPath: config.mediaHostPath,
        folders: ['torrents', 'media'].flatMap((top) => KINDS.map((k) => ({
          path: `${hostRoot}/${top}/${k}`,
          exists: existsSync(path.join(config.mediaPath, top, k)),
        }))),
        disk,
      },
      vpn: {
        enabled: !!gluetun && gluetun.state !== 'missing',
        provider: settings.get('vpn_provider'),
        agentInstalled: agent.installed(),
        applyCommand: agent.applyCommand(),
        pending: agent.pending(),
        lastResult: agent.lastResult(),
      },
      plex: {
        installed: has('plex'),
        claimed: !!plexId?.claimed,
        linked: !!plex.accountToken,
        account: plex.accountName,
      },
      audiobookshelf: {
        initialized: !!absStatus?.initialized,
        managed: !!absCreds,
        username: absCreds?.username ?? null,
        password: absCreds?.password ?? null,
      },
      preferences: settings.preferences(),
      indexers,
    };
  });

  app.post('/api/setup/preferences', async (req, reply) => {
    try {
      const prefs = parsePreferences(req.body);
      settings.setJson('preferences', prefs);
      return prefs;
    } catch (e) {
      return badRequest(reply, e);
    }
  });

  // ─── Plex ──────────────────────────────────────────────────────────────
  app.post('/api/setup/plex/pin', () => plex.createPin());

  app.get<{ Params: { id: string } }>('/api/setup/plex/pin/:id', async (req) => ({
    linked: await plex.checkPin(Number(req.params.id)),
    account: plex.accountName,
  }));

  app.post('/api/setup/plex/unlink', async () => {
    settings.set('plex_token', null);
    settings.set('plex_account', null);
    return { ok: true };
  });

  // ─── Audiobookshelf ────────────────────────────────────────────────────
  app.post('/api/setup/audiobookshelf', async (req, reply) => {
    const b = (req.body ?? {}) as { username?: unknown; password?: unknown };
    const username = typeof b.username === 'string' ? b.username.trim() : '';
    const password = typeof b.password === 'string' ? b.password : '';
    if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username)) return reply.code(400).send({ error: "Nom d'utilisateur : 3 à 32 caractères." });
    if (password.length < 8) return reply.code(400).send({ error: 'Mot de passe : 8 caractères minimum.' });
    const status = await abs.status();
    if (status?.initialized && !abs.credentials) {
      return reply.code(409).send({ error: 'Audiobookshelf est déjà configuré avec un autre compte.' });
    }
    if (status?.initialized && abs.credentials && abs.credentials.password !== password) {
      return reply.code(409).send({ error: 'Le compte Audiobookshelf existe déjà : son mot de passe se change dans Audiobookshelf.' });
    }
    abs.saveCredentials(username, password);
    return { ok: true };
  });

  // ─── Sites d'indexation ────────────────────────────────────────────────
  app.get('/api/setup/indexers', () => publicDefinitions(api.prowlarr));

  app.post('/api/setup/indexers', async (req, reply): Promise<IndexerAddResult[] | unknown> => {
    const names = (req.body as { names?: unknown })?.names;
    if (!Array.isArray(names) || names.length === 0 || names.length > 20 || !names.every((n) => typeof n === 'string')) {
      return reply.code(400).send({ error: 'Choisissez entre 1 et 20 sites.' });
    }
    return addIndexers(api.prowlarr, names as string[]);
  });

  // ─── VPN (via l'agent hôte) ────────────────────────────────────────────
  app.get('/api/setup/vpn/providers', () => VPN_PROVIDERS);

  app.post('/api/setup/vpn', async (req, reply) => {
    try {
      const v = req.body as VpnSettings;
      const id = agent.submit(vpnEnv(v));
      if (v.enabled) settings.set('vpn_provider', v.provider);
      req.log.info({ enabled: v.enabled, provider: v.enabled ? v.provider : undefined }, 'Demande de changement du VPN');
      return { id, agentInstalled: agent.installed(), applyCommand: agent.applyCommand() };
    } catch (e) {
      if (e instanceof AgentError) return badRequest(reply, e);
      throw e;
    }
  });

  // ─── Tout configurer ───────────────────────────────────────────────────
  app.get('/api/setup/run', () => job.status());

  app.post('/api/setup/run', async (_req, reply) => {
    if (!job.start(buildTasks(deps))) return reply.code(409).send({ error: 'La configuration est déjà en cours.' });
    services.invalidate();
    return job.status();
  });

  app.post('/api/setup/finish', async () => {
    settings.set('setup_done', '1');
    return { ok: true };
  });
}
