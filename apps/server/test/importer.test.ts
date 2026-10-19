import { mkdirSync, mkdtempSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.ts';
import { bestMatch, episodeInfo, listSources, normalizeTitle, scanVideos } from '../src/importer.ts';

/** Fichier creux de la taille voulue (ne consomme pas d'espace disque). */
function fakeVideo(p: string, mb: number) {
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, '');
  truncateSync(p, mb * 1024 * 1024);
}

let dir = '';
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });

describe('reconnaissance des épisodes', () => {
  it('repère les épisodes, mais pas les films avec une année', () => {
    expect(episodeInfo('/x/Kaamelott.S01E03.FRENCH.720p.mkv')).toEqual({ season: 1, episodes: [3] });
    expect(episodeInfo('/x/Show.s02e05e06.mkv')).toEqual({ season: 2, episodes: [5, 6] });
    expect(episodeInfo('/x/Show.1x07.avi')).toEqual({ season: 1, episodes: [7] });
    expect(episodeInfo('/Série/Saison 2/Episode 04.mkv')).toEqual({ season: 2, episodes: [4] });
    expect(episodeInfo('/x/Intouchables.2011.FRENCH.1080p.mkv')).toBeNull();
    expect(episodeInfo('/x/Le.Diner.de.Cons.1998.mkv')).toBeNull();
  });

  it('compare les titres sans accents ni articles', () => {
    expect(normalizeTitle('Le Dîner de cons')).toBe(normalizeTitle('Diner de Cons'));
    expect(normalizeTitle('Les Visiteurs')).toBe('visiteurs');
  });

  it("choisit la fiche du bon titre et de la bonne année", () => {
    const c = [
      { title: 'La Cité de la peur', year: 1948 },
      { title: 'La Cité de la peur', year: 1994 },
      { title: 'Autre chose', year: 1994 },
    ];
    expect(bestMatch(c, 'La Cite de la Peur', 1994)).toEqual({ title: 'La Cité de la peur', year: 1994 });
    expect(bestMatch(c, 'Inconnu', null)).toEqual(c[0]);
    expect(bestMatch([], 'x', null)).toBeNull();
  });
});

describe('parcours des dossiers', () => {
  it('garde les vidéos, ignore extraits, petits fichiers et dossiers cachés', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'motflix-import-'));
    fakeVideo(path.join(dir, 'Film (2010)/Film.2010.1080p.mkv'), 40);
    fakeVideo(path.join(dir, 'Film (2010)/sample.mkv'), 40);
    fakeVideo(path.join(dir, 'Film (2010)/trailer.mp4'), 5);
    fakeVideo(path.join(dir, '.Trashes/old.mkv'), 40);
    writeFileSync(path.join(dir, 'notes.txt'), 'x');
    const found = await scanVideos(dir);
    expect(found.map((f) => path.relative(dir, f.path))).toEqual(['Film (2010)/Film.2010.1080p.mkv']);
  });

  it('liste les disques branchés, sans le disque système ni les liens', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'motflix-volumes-'));
    mkdirSync(path.join(dir, 'MonDisque'));
    mkdirSync(path.join(dir, 'Recovery'));
    symlinkSync('/', path.join(dir, 'Macintosh HD'));
    const sources = await listSources({ ...loadConfig(), importPath: dir, importLayout: 'flat', mediaPath: dir });
    expect(sources.map((s) => s.id)).toEqual(['library', 'inbox', 'disk:MonDisque']);
    expect(sources.find((s) => s.id === 'library')?.forcedMode).toBe('move');
    expect(sources.find((s) => s.id === 'disk:MonDisque')?.defaultMode).toBe('copy');
  });

  it('sous Linux, trouve les disques dans /media/<utilisateur>/', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'motflix-media-'));
    mkdirSync(path.join(dir, 'mat/DisqueFilms'), { recursive: true });
    const sources = await listSources({ ...loadConfig(), importPath: dir, importLayout: 'user', mediaPath: dir });
    expect(sources.at(-1)?.id).toBe('disk:mat/DisqueFilms');
  });
});
