import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { openDb } from '../src/db.ts';
import type { DockerClient } from '../src/docker.ts';
import { torrentPhase, validHashes } from '../src/torrents.ts';

describe('téléchargements', () => {
  it('regroupe les états de qBittorrent 4 et 5', () => {
    expect(torrentPhase('downloading')).toBe('downloading');
    expect(torrentPhase('stalledDL')).toBe('waiting');
    expect(torrentPhase('stoppedDL')).toBe('paused');   // qBittorrent 5
    expect(torrentPhase('pausedDL')).toBe('paused');    // qBittorrent 4
    expect(torrentPhase('stalledUP')).toBe('seeding');
    expect(torrentPhase('stoppedUP')).toBe('done');
    expect(torrentPhase('checkingDL')).toBe('checking');
    expect(torrentPhase('missingFiles')).toBe('error');
  });

  it('accepte seulement des empreintes de torrent valides', () => {
    expect(validHashes('a'.repeat(40))).toBe(true);
    expect(validHashes('all')).toBe(true);
    expect(validHashes('abc|def')).toBe(false);
    expect(validHashes('../../etc')).toBe(false);
  });
});

describe('routes de la bibliothèque', () => {
  const docker = { listContainers: async () => [] } as unknown as DockerClient;

  it('valide les demandes avant de solliciter les outils', async () => {
    const app = await buildApp({ config: { ...loadConfig(), webDir: '/inexistant' }, db: openDb(':memory:'), docker, logger: false });
    expect((await app.inject({ method: 'GET', url: '/api/search?q=a&kind=movie' })).json()).toEqual([]);
    expect((await app.inject({ method: 'GET', url: '/api/search?q=dune&kind=jeu' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/library', payload: { kind: 'movie' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/downloads/all/delete' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/downloads/x;rm/pause' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/library/books/..%2Fetc/cover' })).statusCode).toBe(404);
    await app.close();
  });
});

describe('recherche', () => {
  it('reconnaît une panne passagère du service de métadonnées', async () => {
    const { isTransient } = await import('../src/library.ts');
    const { ToolError } = await import('../src/setup/http.ts');
    expect(isTransient(new ToolError(400, "Search for 'citizenfour' failed. Invalid response received from RadarrAPI. Resource temporarily unavailable"))).toBe(true);
    expect(isTransient(new ToolError(0, 'radarr:7878 met trop de temps à répondre'))).toBe(true);
    expect(isTransient(new ToolError(503, 'Service Unavailable'))).toBe(true);
    expect(isTransient(new ToolError(400, 'Invalid term'))).toBe(false);
  });
});
