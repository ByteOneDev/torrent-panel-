import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { findEntry } from '../src/catalog.ts';
import { loadConfig } from '../src/config.ts';
import { toActivity } from '../src/dashboard.ts';
import { openDb } from '../src/db.ts';
import type { ContainerInspect, ContainerSummary, DockerClient } from '../src/docker.ts';
import { deriveState } from '../src/services.ts';

/** Faux Docker : deux conteneurs, et la liste des actions demandées. */
function fakeDocker() {
  const actions: string[] = [];
  const containers: ContainerSummary[] = [
    { Id: 'radarr-id', Names: ['/motflix-radarr'], State: 'running', Labels: { 'com.docker.compose.service': 'radarr' } },
    { Id: 'proxy-id', Names: ['/motflix-socket-proxy'], State: 'running', Labels: { 'com.docker.compose.service': 'socket-proxy' } },
  ];
  const docker = {
    listContainers: async () => containers,
    inspect: async (id: string): Promise<ContainerInspect> => ({
      Id: id, Name: `/${id}`, Config: { Tty: false },
      State: { Status: 'running', StartedAt: new Date(Date.now() - 3_600_000).toISOString() },
    }),
    stats: async () => { throw new Error('pas de stats en test'); },
    action: async (id: string, action: string) => { actions.push(`${action}:${id}`); },
  };
  return { docker: docker as unknown as DockerClient, actions };
}

let app: FastifyInstance;
let actions: string[];

beforeEach(async () => {
  const fake = fakeDocker();
  actions = fake.actions;
  const config = { ...loadConfig(), webDir: '/inexistant' };
  app = await buildApp({ config, db: openDb(':memory:'), docker: fake.docker, logger: false });
});

afterEach(() => app.close());

function cookieFrom(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie'];
  const first = Array.isArray(raw) ? raw[0] : raw;
  return String(first).split(';')[0]!;
}

describe('authentification', () => {
  const enable = (payload: object, cookie?: string) =>
    app.inject({ method: 'POST', url: '/api/auth/enable', payload, headers: cookie ? { cookie } : {} });

  it("ouvre le panel sans connexion par défaut, en administrateur", async () => {
    const state = await app.inject({ method: 'GET', url: '/api/auth/state' });
    expect(state.json()).toEqual({ authEnabled: false, user: { username: 'admin', role: 'admin' }, setupDone: false });
    const services = await app.inject({ method: 'GET', url: '/api/services' });
    expect(services.statusCode).toBe(200);
  });

  it('active les comptes, puis exige une connexion', async () => {
    expect((await enable({ username: 'admin', password: 'court' })).statusCode).toBe(400);

    const res = await enable({ username: 'admin', password: 'motdepasse-test' });
    expect(res.statusCode).toBe(200);
    const cookie = cookieFrom(res);
    expect(cookie).toMatch(/^motflix_session=/);

    // Sans session : bloqué. Avec la session ouverte à l'activation : connecté.
    expect((await app.inject({ method: 'GET', url: '/api/services' })).statusCode).toBe(401);
    const state = await app.inject({ method: 'GET', url: '/api/auth/state', headers: { cookie } });
    expect(state.json()).toEqual({ authEnabled: true, user: { username: 'admin', role: 'admin' }, setupDone: false });

    // Personne ne peut redéfinir l'administrateur tant que les comptes sont actifs.
    expect((await enable({ username: 'pirate', password: 'motdepasse-test' })).statusCode).toBe(401);
    expect((await enable({ username: 'autre', password: 'motdepasse-test' }, cookie)).statusCode).toBe(409);
  });

  it('se connecte, se déconnecte', async () => {
    await enable({ username: 'admin', password: 'motdepasse-test' });
    const bad = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'faux-mot-de-passe' } });
    expect(bad.statusCode).toBe(401);

    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'ADMIN', password: 'motdepasse-test' } });
    expect(login.statusCode).toBe(200);
    const cookie = cookieFrom(login);
    expect((await app.inject({ method: 'GET', url: '/api/services', headers: { cookie } })).statusCode).toBe(200);

    await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
    expect((await app.inject({ method: 'GET', url: '/api/services', headers: { cookie } })).statusCode).toBe(401);
  });

  it('désactive les comptes : seulement une fois connecté', async () => {
    const cookie = cookieFrom(await enable({ username: 'admin', password: 'motdepasse-test' }));
    expect((await app.inject({ method: 'POST', url: '/api/auth/disable' })).statusCode).toBe(401);

    const res = await app.inject({ method: 'POST', url: '/api/auth/disable', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const state = await app.inject({ method: 'GET', url: '/api/auth/state' });
    expect(state.json().authEnabled).toBe(false);
    expect((await app.inject({ method: 'GET', url: '/api/services' })).statusCode).toBe(200);
  });

  it('bloque après trop de mauvais mots de passe', async () => {
    await enable({ username: 'admin', password: 'motdepasse-test' });
    let last = 0;
    for (let i = 0; i < 11; i++) {
      last = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'mauvais-mdp' } })).statusCode;
    }
    expect(last).toBe(429);
  });

  it("refuse une requête venant d'un autre site", async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/services/radarr/restart',
      headers: { origin: 'http://site-malveillant.example', host: 'localhost:8080' },
    });
    expect(res.statusCode).toBe(403);
    expect(actions).toEqual([]);
  });
});

describe('services', () => {
  it('liste les services et signale ceux qui manquent', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/services' });
    const { services } = res.json() as { services: { id: string; state: string }[] };
    expect(services.find((s) => s.id === 'sonarr')?.state).toBe('missing');
    expect(services.find((s) => s.id === 'socket-proxy')?.state).toBe('online');
  });

  it('redémarre un service, mais jamais l’accès Docker', async () => {
    const ok = await app.inject({ method: 'POST', url: '/api/services/radarr/restart' });
    expect(ok.statusCode).toBe(200);
    expect(actions).toEqual(['restart:radarr-id']);

    const refused = await app.inject({ method: 'POST', url: '/api/services/socket-proxy/stop' });
    expect(refused.statusCode).toBe(403);
    const unknown = await app.inject({ method: 'POST', url: '/api/services/radarr/delete' });
    expect(unknown.statusCode).toBe(404);
  });
});

describe('identifiants des interfaces', () => {
  it("donne ceux de qBittorrent et indique qu'il n'en faut pas pour Radarr", async () => {
    const radarr = await app.inject({ method: 'GET', url: '/api/services/radarr/access' });
    expect(radarr.json()).toMatchObject({ username: null, password: null });
    const qbt = await app.inject({ method: 'GET', url: '/api/services/qbittorrent/access' });
    expect(qbt.json().username).toBe('admin');
    expect(qbt.headers['cache-control']).toBe('no-store');
    expect((await app.inject({ method: 'GET', url: '/api/services/gluetun/access' })).statusCode).toBe(404);
  });
});

describe('deriveState', () => {
  const radarr = findEntry('radarr')!;
  const running = (startedMsAgo: number, health?: 'starting' | 'healthy' | 'unhealthy'): ContainerInspect => ({
    Id: 'x', Name: '/x', Config: { Tty: false },
    State: { Status: 'running', StartedAt: new Date(Date.now() - startedMsAgo).toISOString(), ...(health && { Health: { Status: health } }) },
  });

  it('distingue démarrage, en ligne et en erreur', () => {
    expect(deriveState(radarr, running(10_000), false)).toBe('starting');
    expect(deriveState(radarr, running(600_000), false)).toBe('unhealthy');
    expect(deriveState(radarr, running(600_000), true)).toBe('online');
    expect(deriveState(radarr, null, null)).toBe('missing');
  });

  it("se fie au healthcheck Docker quand le service n'a pas d'adresse de test", () => {
    const vpn = findEntry('gluetun')!;
    expect(deriveState(vpn, running(600_000, 'healthy'), null)).toBe('online');
    expect(deriveState(vpn, running(600_000, 'unhealthy'), null)).toBe('unhealthy');
  });
});

describe('activité', () => {
  it('présente un import de film et un échec', () => {
    expect(toActivity({
      date: '2026-10-19T10:00:00Z', eventType: 'downloadFolderImported', sourceTitle: 'Sintel.2010.720p',
      quality: { quality: { name: 'WEBDL-720p' } }, languages: [{ name: 'English' }],
      movie: { title: 'Sintel', year: 2010 },
    }, 'Films')).toEqual({
      date: '2026-10-19T10:00:00Z', kind: 'imported', title: 'Sintel (2010)', detail: 'WEBDL-720p · English', source: 'Films',
    });

    const failed = toActivity({
      date: '2026-10-19T10:00:00Z', eventType: 'downloadFailed', sourceTitle: 'X',
      series: { title: 'Pioneer One' }, episode: { seasonNumber: 1, episodeNumber: 2 }, data: { message: 'Disque plein' },
    }, 'Séries');
    expect(failed.title).toBe('Pioneer One S01E02');
    expect(failed.detail).toBe('Disque plein');
  });
});
