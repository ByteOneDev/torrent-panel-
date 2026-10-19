// Routes : recherche, ajout, bibliothèque et téléchargements.
import type { FastifyInstance } from 'fastify';
import type { AddRequest, BookFormat, LanguagePreset, LibraryItem, SearchResult, TorrentAction, TorrentsResponse } from '@motflix/shared';
import type { Config } from './config.ts';
import { QbittorrentClient } from './dashboard.ts';
import { LibraryError, type Library } from './library.ts';
import { ToolError } from './setup/http.ts';
import { listTorrents, torrentAction, validHashes } from './torrents.ts';
import { createJournal } from './journal.ts';

const KINDS = new Set(['movie', 'series', 'book']);
const FORMATS = new Set<BookFormat>(['eBook', 'AudioBook']);
const PRESETS = new Set<LanguagePreset>(['default', 'original', 'french']);

export function registerLibrary(app: FastifyInstance, { config, library }: { config: Config; library: Library }) {
  const journal = createJournal(config.dataDir);
  const qbt = new QbittorrentClient(config);

  // Erreurs des outils : message lisible plutôt qu'une erreur interne.
  const guard = async <T>(reply: { code: (n: number) => { send: (b: unknown) => unknown } }, fn: () => Promise<T>) => {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof LibraryError) return reply.code(e.status).send({ error: e.message });
      if (e instanceof ToolError) return reply.code(e.status === 400 || e.status === 409 ? e.status : 502).send({ error: e.message });
      return reply.code(502).send({ error: (e as Error).message });
    }
  };

  app.get<{ Querystring: { q?: string; kind?: string } }>('/api/search', async (req, reply) => {
    const q = (req.query.q ?? '').trim();
    const kind = req.query.kind ?? 'movie';
    if (!KINDS.has(kind)) return reply.code(400).send({ error: 'Type inconnu.' });
    if (q.length < 2) return [];
    return guard<SearchResult[]>(reply, () => library.search(kind as 'movie', q.slice(0, 120)));
  });

  app.post('/api/library', async (req, reply) => {
    const b = (req.body ?? {}) as Partial<AddRequest>;
    if (!b.kind || !KINDS.has(b.kind) || typeof b.key !== 'string' || !b.key) return reply.code(400).send({ error: 'Demande invalide.' });
    const formats = Array.isArray(b.formats) ? b.formats.filter((f): f is BookFormat => FORMATS.has(f as BookFormat)) : undefined;
    return guard(reply, async () => {
      const language = PRESETS.has(b.language as LanguagePreset) ? b.language : 'default';
      const detail = await library.add({ kind: b.kind!, key: b.key!, search: b.search !== false, monitor: b.monitor === 'future' ? 'future' : 'all', formats, language });
      req.log.info({ kind: b.kind, key: b.key, user: req.user?.username }, `Bibliothèque : ajout (${detail})`);
      await journal(`Ajout ${b.kind} ${b.key} : ${detail}`, req.user?.username);
      return { detail };
    });
  });

  app.get('/api/library/movies', (_req, reply) => guard<LibraryItem[]>(reply, () => library.movies()));
  app.get('/api/library/series', (_req, reply) => guard<LibraryItem[]>(reply, () => library.series()));
  app.get<{ Querystring: { format?: string } }>('/api/library/books', (req, reply) =>
    guard<LibraryItem[]>(reply, () => library.books(req.query.format === 'AudioBook' ? 'AudioBook' : 'eBook')));

  app.get<{ Params: { id: string } }>('/api/library/books/:id/cover', async (req, reply) => {
    try {
      const res = await library.bookCover(req.params.id);
      if (!res.ok) return reply.code(404).send({ error: 'Pas de couverture.' });
      reply.header('Content-Type', res.headers.get('content-type') ?? 'image/jpeg');
      reply.header('Cache-Control', 'private, max-age=86400');
      return reply.send(Buffer.from(await res.arrayBuffer()));
    } catch {
      return reply.code(404).send({ error: 'Pas de couverture.' });
    }
  });

  app.post<{ Params: { kind: string; id: string }; Querystring: { format?: string } }>(
    '/api/library/:kind/:id/search', async (req, reply) => {
      if (!KINDS.has(req.params.kind)) return reply.code(404).send({ error: 'Type inconnu.' });
      const format = req.query.format === 'AudioBook' ? 'AudioBook' : 'eBook';
      return guard(reply, async () => { await library.searchAgain(req.params.kind as 'movie', req.params.id, format); return { ok: true }; });
    });

  app.put<{ Params: { kind: string; id: string } }>('/api/library/:kind/:id/language', async (req, reply) => {
    const language = (req.body as { language?: unknown })?.language as LanguagePreset;
    if (req.params.kind !== 'movie' && req.params.kind !== 'series') return reply.code(404).send({ error: 'Type inconnu.' });
    if (!PRESETS.has(language)) return reply.code(400).send({ error: 'Langue inconnue.' });
    return guard(reply, async () => {
      await library.setLanguage(req.params.kind as 'movie', req.params.id, language);
      await journal(`Langue de ${req.params.kind} ${req.params.id} : ${language}`, req.user?.username);
      return { ok: true };
    });
  });

  app.delete<{ Params: { kind: string; id: string }; Querystring: { deleteFiles?: string; format?: string } }>(
    '/api/library/:kind/:id', async (req, reply) => {
      if (!KINDS.has(req.params.kind)) return reply.code(404).send({ error: 'Type inconnu.' });
      const format = req.query.format === 'AudioBook' ? 'AudioBook' : 'eBook';
      return guard(reply, async () => {
        const deleteFiles = req.query.deleteFiles === 'true';
        await library.remove(req.params.kind as 'movie', req.params.id, deleteFiles, format);
        req.log.info({ kind: req.params.kind, id: req.params.id, deleteFiles, user: req.user?.username }, 'Bibliothèque : retrait');
        await journal(`Retrait ${req.params.kind} ${req.params.id}${deleteFiles ? ' avec suppression des fichiers' : ' (fichiers conservés)'}`, req.user?.username);
        return { ok: true };
      });
    });

  // ─── Téléchargements ───────────────────────────────────────────────────
  app.get('/api/downloads', (_req, reply) => guard<TorrentsResponse>(reply, () => listTorrents(qbt)));

  app.post<{ Params: { hash: string; action: string }; Querystring: { deleteFiles?: string } }>(
    '/api/downloads/:hash/:action', async (req, reply) => {
      const action = req.params.action as TorrentAction;
      if (!['pause', 'resume', 'delete'].includes(action)) return reply.code(404).send({ error: 'Action inconnue.' });
      if (!validHashes(req.params.hash)) return reply.code(400).send({ error: 'Torrent invalide.' });
      if (action === 'delete' && req.params.hash === 'all') return reply.code(400).send({ error: 'Suppression groupée refusée.' });
      return guard(reply, async () => {
        await torrentAction(qbt, req.params.hash, action, req.query.deleteFiles === 'true');
        if (action === 'delete') {
          req.log.info({ hash: req.params.hash, deleteFiles: req.query.deleteFiles === 'true', user: req.user?.username }, 'Téléchargement supprimé');
          await journal(`Téléchargement ${req.params.hash} supprimé${req.query.deleteFiles === 'true' ? ' avec ses fichiers' : ''}`, req.user?.username);
        }
        return { ok: true };
      });
    });
}
