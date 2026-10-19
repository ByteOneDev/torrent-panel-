import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { openDb } from '../src/db.ts';
import type { DockerClient } from '../src/docker.ts';
import { isAllowedHost, isSameOrigin } from '../src/security.ts';

describe('protection contre le DNS rebinding', () => {
  it('accepte les adresses du réseau local', () => {
    for (const h of ['localhost:8088', '127.0.0.1:8088', '192.168.0.12:8088', '[::1]:8088', 'serveur:8088', 'motflix.local', 'nas.lan:8080', 'box.home.arpa']) {
      expect(isAllowedHost(h), h).toBe(true);
    }
  });

  it('refuse les noms de domaine publics, sauf déclarés', () => {
    expect(isAllowedHost('attaquant.example.com')).toBe(false);
    expect(isAllowedHost('192.168.0.12.nip.io')).toBe(false);
    expect(isAllowedHost(undefined)).toBe(false);
    expect(isAllowedHost('motflix.mondomaine.fr', ['motflix.mondomaine.fr'])).toBe(true);
  });

  it("refuse une origine différente ou « null »", () => {
    expect(isSameOrigin(undefined, 'localhost:8088')).toBe(true);
    expect(isSameOrigin('http://localhost:8088', 'localhost:8088')).toBe(true);
    expect(isSameOrigin('http://evil.example', 'localhost:8088')).toBe(false);
    expect(isSameOrigin('null', 'localhost:8088')).toBe(false);
  });

  it('le panel répond 421 à un nom de domaine inconnu, même sur les routes publiques', async () => {
    const docker = { listContainers: async () => [] } as unknown as DockerClient;
    const app = await buildApp({ config: { ...loadConfig(), webDir: '/inexistant' }, db: openDb(':memory:'), docker, logger: false });
    expect((await app.inject({ method: 'GET', url: '/api/services/qbittorrent/access', headers: { host: 'evil.example.com' } })).statusCode).toBe(421);
    expect((await app.inject({ method: 'GET', url: '/api/health', headers: { host: '192.168.1.20:8088' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { host: 'localhost:8088', origin: 'null' } })).statusCode).toBe(403);
    await app.close();
  });
});
