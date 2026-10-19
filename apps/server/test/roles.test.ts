import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { openDb } from '../src/db.ts';
import type { DockerClient } from '../src/docker.ts';
import { canAccess } from '../src/permissions.ts';

describe('permissions par rôle', () => {
  it('donne à chacun ce qu’il lui faut, et le reste à l’admin', () => {
    expect(canAccess('viewer', 'GET', '/api/library/movies')).toBe(true);
    expect(canAccess('viewer', 'GET', '/api/downloads')).toBe(true);
    expect(canAccess('viewer', 'GET', '/api/search?q=x')).toBe(false);
    expect(canAccess('viewer', 'POST', '/api/requests')).toBe(false);
    expect(canAccess('member', 'GET', '/api/search?q=x&kind=movie')).toBe(true);
    expect(canAccess('member', 'POST', '/api/requests')).toBe(true);
    expect(canAccess('member', 'POST', '/api/requests/3/approve')).toBe(false);
    expect(canAccess('member', 'POST', '/api/library')).toBe(false);
    expect(canAccess('member', 'GET', '/api/services/qbittorrent/access')).toBe(false);
    expect(canAccess('member', 'POST', '/api/downloads/all/pause')).toBe(false);
    expect(canAccess('member', 'GET', '/api/dashboard')).toBe(false);
    expect(canAccess('admin', 'POST', '/api/services/radarr/stop')).toBe(true);
  });
});

describe('comptes et demandes', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    const docker = { listContainers: async () => [] } as unknown as DockerClient;
    app = await buildApp({ config: { ...loadConfig(), webDir: '/inexistant', dataDir: '/tmp' }, db: openDb(':memory:'), docker, logger: false });
  });
  afterEach(() => app.close());

  const cookie = (res: { headers: Record<string, unknown> }) => String([res.headers['set-cookie']].flat()[0]).split(';')[0]!;
  const login = async (username: string, password: string) =>
    cookie(await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password } }));

  it('membre : demande, mais ne pilote rien ; admin : accepte ou refuse', async () => {
    const admin = cookie(await app.inject({ method: 'POST', url: '/api/auth/enable', payload: { username: 'admin', password: 'motdepasse-admin' } }));
    for (const [u, r] of [['ami', 'member'], ['famille', 'viewer']]) {
      const res = await app.inject({ method: 'POST', url: '/api/users', headers: { cookie: admin }, payload: { username: u, password: 'motdepasse-test', role: r } });
      expect(res.statusCode, u).toBe(200);
    }
    const ami = await login('ami', 'motdepasse-test');
    const famille = await login('famille', 'motdepasse-test');

    expect((await app.inject({ method: 'GET', url: '/api/auth/state', headers: { cookie: ami } })).json().user).toEqual({ username: 'ami', role: 'member' });
    expect((await app.inject({ method: 'GET', url: '/api/services', headers: { cookie: ami } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/users', headers: { cookie: ami } })).statusCode).toBe(403);

    const demande = { kind: 'movie', key: '358332', title: 'Cosmos Laundromat', year: 2015, poster: null };
    const created = await app.inject({ method: 'POST', url: '/api/requests', headers: { cookie: ami }, payload: demande });
    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({ status: 'pending', requestedBy: 'ami' });
    expect((await app.inject({ method: 'POST', url: '/api/requests', headers: { cookie: ami }, payload: demande })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: '/api/requests', headers: { cookie: famille }, payload: demande })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/api/requests/${created.json().id}/approve`, headers: { cookie: ami } })).statusCode).toBe(403);

    // Chacun ne voit que ses demandes ; l'admin les voit toutes.
    expect((await app.inject({ method: 'GET', url: '/api/requests', headers: { cookie: famille } })).json()).toEqual([]);
    expect((await app.inject({ method: 'GET', url: '/api/requests', headers: { cookie: admin } })).json()).toHaveLength(1);

    const rejected = await app.inject({ method: 'POST', url: `/api/requests/${created.json().id}/reject`, headers: { cookie: admin }, payload: { note: 'Pas ce soir' } });
    expect(rejected.json()).toMatchObject({ status: 'rejected', note: 'Pas ce soir' });
  });

  it('garde toujours au moins un administrateur', async () => {
    const admin = cookie(await app.inject({ method: 'POST', url: '/api/auth/enable', payload: { username: 'admin', password: 'motdepasse-admin' } }));
    const [me] = (await app.inject({ method: 'GET', url: '/api/users', headers: { cookie: admin } })).json();
    expect((await app.inject({ method: 'POST', url: `/api/users/${me.id}`, headers: { cookie: admin }, payload: { role: 'member' } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'DELETE', url: `/api/users/${me.id}`, headers: { cookie: admin } })).statusCode).toBe(409);
  });
});
