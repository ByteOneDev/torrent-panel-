// Assemblage de l'application Fastify : API + interface compilée.
import { existsSync } from 'node:fs';
import path from 'node:path';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import type { ServiceAction } from '@motflix/shared';
import { AuthStore, registerAuth } from './auth.ts';
import type { Config } from './config.ts';
import { Dashboard } from './dashboard.ts';
import type { Db } from './db.ts';
import { createLogParser, DockerClient, DockerError } from './docker.ts';
import { ServiceError, ServiceManager } from './services.ts';
import { Settings } from './settings.ts';
import { registerSetup } from './setup/routes.ts';
import { serviceAccess } from './access.ts';
import { registerSettings } from './settings-routes.ts';
import { registerLibrary } from './library-routes.ts';

export interface AppDeps {
  config: Config;
  db: Db;
  docker?: DockerClient;
  logger?: boolean;
}

const ACTIONS: ServiceAction[] = ['start', 'stop', 'restart'];
const MAX_TAIL = 1000;

export async function buildApp({ config, db, docker = new DockerClient(config.dockerHost), logger = true }: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: logger ? { level: 'info' } : false,
    trustProxy: false,
  });

  await app.register(fastifyCookie);

  app.addHook('onSend', async (_req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'same-origin');
  });

  const auth = new AuthStore(db);
  registerAuth(app, auth, config);

  const services = new ServiceManager(docker, config);
  const dashboard = new Dashboard(config, services);

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ServiceError) return reply.code(err.status).send({ error: err.message });
    if (err instanceof DockerError) {
      req.log.warn({ err }, 'Erreur Docker');
      return reply.code(502).send({ error: `Docker : ${err.message}` });
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) req.log.error({ err }, 'Erreur interne');
    return reply.code(status).send({ error: status >= 500 ? 'Erreur interne du panel.' : (err as Error).message });
  });

  app.get('/api/health', async () => ({ ok: true }));

  app.get('/api/services', () => services.list());

  app.post<{ Params: { id: string; action: string } }>('/api/services/:id/:action', async (req, reply) => {
    const action = req.params.action as ServiceAction;
    if (!ACTIONS.includes(action)) return reply.code(404).send({ error: 'Action inconnue.' });
    req.log.info({ service: req.params.id, action, user: req.user?.username }, 'Action sur un service');
    await services.act(req.params.id, action);
    return { ok: true };
  });

  app.get('/api/dashboard', () => dashboard.get());

  const settings = new Settings(db);
  registerSetup(app, { config, settings, services });
  registerSettings(app, { config, settings, services });
  registerLibrary(app, { config });

  app.get<{ Params: { id: string } }>('/api/services/:id/access', async (req, reply) => {
    const access = serviceAccess(req.params.id, config, settings);
    if (!access) return reply.code(404).send({ error: "Ce service n'a pas d'interface à ouvrir." });
    reply.header('Cache-Control', 'no-store');
    return access;
  });

  // Logs en direct, en Server-Sent Events.
  app.get<{ Params: { id: string }; Querystring: { tail?: string } }>('/api/services/:id/logs', async (req, reply) => {
    const tail = Math.min(Math.max(Number(req.query.tail) || 300, 1), MAX_TAIL);
    const container = await services.containerFor(req.params.id);

    const abort = new AbortController();
    const stream = await docker.logs(container.Id, tail, abort.signal);

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');

    const parser = createLogParser(container.Config.Tty, (line) => {
      res.write(`data: ${JSON.stringify(line)}\n\n`);
    });
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);

    const close = () => {
      clearInterval(heartbeat);
      abort.abort();
      if (!res.writableEnded) res.end();
    };
    req.raw.on('close', close);

    stream.on('data', (chunk: Buffer) => parser.push(chunk));
    stream.on('end', async () => {
      parser.flush();
      // Le flux se termine aussi quand le proxy Docker coupe une connexion inactive (10 min).
      // Si le conteneur tourne encore, on ferme sans « end » : le navigateur se reconnecte seul.
      const stillRunning = await docker.inspect(container.Id).then((i) => i.State.Status === 'running', () => false);
      if (!stillRunning && !res.writableEnded) res.write('event: end\ndata: {}\n\n');
      close();
    });
    stream.on('error', () => close());
  });

  // Interface compilée (absente en développement : Vite la sert lui-même).
  const indexHtml = path.join(config.webDir, 'index.html');
  if (existsSync(indexHtml)) {
    await app.register(fastifyStatic, { root: config.webDir, wildcard: false, index: ['index.html'] });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.method !== 'GET') {
        return reply.code(404).send({ error: 'Introuvable.' });
      }
      return reply.type('text/html').sendFile('index.html');
    });
  } else {
    app.log.warn(`Interface introuvable (${config.webDir}) : seule l'API est servie.`);
  }

  return app;
}
