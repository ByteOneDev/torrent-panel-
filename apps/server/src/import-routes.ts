// Routes de l'import de fichiers existants (bibliothèque, « a-importer », disques branchés).
import type { FastifyInstance } from 'fastify';
import type { ImportMode } from '@motflix/shared';
import type { Config } from './config.ts';
import { Importer, listSources } from './importer.ts';
import { createJournal } from './journal.ts';

export function registerImport(app: FastifyInstance, { config }: { config: Config }) {
  const importer = new Importer(config);
  const journal = createJournal(config.dataDir);
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 5000) : []);

  app.get('/api/import/sources', () => listSources(config));
  app.get('/api/import/status', () => importer.status());

  app.post('/api/import/analyze', async (req, reply) => {
    const sourceId = (req.body as { sourceId?: unknown })?.sourceId;
    if (typeof sourceId !== 'string') return reply.code(400).send({ error: 'Source manquante.' });
    try {
      if (!(await importer.startAnalysis(sourceId))) return reply.code(409).send({ error: 'Une opération est déjà en cours.' });
      return importer.status();
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.post('/api/import/run', async (req, reply) => {
    const b = (req.body ?? {}) as { movies?: unknown; series?: unknown; mode?: unknown; upgrade?: unknown };
    const mode: ImportMode = b.mode === 'move' ? 'move' : 'copy';
    try {
      await importer.startImport(strings(b.movies), strings(b.series), mode, b.upgrade === true);
      const s = importer.status();
      req.log.info({ source: s.sourceId, mode: s.mode, titles: s.progress.total }, 'Import lancé');
      await journal(`Import depuis ${s.sourceId} (${s.mode === 'move' ? 'déplacement' : 'copie'}) : ${s.progress.total} titre(s)`, req.user?.username);
      return s;
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.post('/api/import/reset', async () => {
    importer.reset();
    return importer.status();
  });
}
