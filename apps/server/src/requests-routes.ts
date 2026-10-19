// Demandes des membres : un membre demande un titre, l'administrateur l'accepte
// (le titre est alors ajouté comme d'habitude) ou la refuse. Avec la validation
// automatique, la demande est acceptée tout de suite.
import type { FastifyInstance } from 'fastify';
import type { BookFormat, LanguagePreset, MediaKind, MediaRequest, NewRequest } from '@motflix/shared';
import type { Config } from './config.ts';
import type { Db } from './db.ts';
import { createJournal } from './journal.ts';
import { LibraryError, type Library } from './library.ts';
import type { Settings } from './settings.ts';

interface Row {
  id: number; username: string; kind: MediaKind; key: string; title: string; year: number | null; poster: string | null;
  language: LanguagePreset; formats: string; status: MediaRequest['status']; note: string | null;
  created_at: string; decided_at: string | null; user_id: number | null;
}

const KINDS = new Set(['movie', 'series', 'book']);
const PRESETS = new Set(['default', 'original', 'french']);
const toIso = (s: string | null) => (s ? `${s.replace(' ', 'T')}Z` : null);

function toRequest(r: Row): MediaRequest {
  return {
    id: r.id, kind: r.kind, key: r.key, title: r.title, year: r.year, poster: r.poster, language: r.language,
    formats: JSON.parse(r.formats) as BookFormat[], status: r.status, requestedBy: r.username,
    createdAt: toIso(r.created_at)!, decidedAt: toIso(r.decided_at), note: r.note,
  };
}

export function registerRequests(app: FastifyInstance, deps: { config: Config; db: Db; settings: Settings; library: Library }) {
  const { db, settings, library } = deps;
  const journal = createJournal(deps.config.dataDir);
  const get = (id: number) => db.prepare('SELECT * FROM requests WHERE id = ?').get(id) as Row | undefined;

  /** Ajoute le titre demandé ; « déjà dans la bibliothèque » compte comme un succès. */
  async function fulfil(r: Row): Promise<string> {
    try {
      return await library.add({
        kind: r.kind, key: r.key, search: true, language: r.language, formats: JSON.parse(r.formats) as BookFormat[],
      });
    } catch (e) {
      if (e instanceof LibraryError && e.status === 409) return 'Déjà dans la bibliothèque';
      throw e;
    }
  }

  function decide(id: number, status: 'approved' | 'rejected', note: string | null) {
    db.prepare("UPDATE requests SET status = ?, note = ?, decided_at = datetime('now') WHERE id = ?").run(status, note, id);
  }

  app.get('/api/requests', async (req) => {
    const admin = req.user?.role === 'admin';
    const rows = (admin
      ? db.prepare('SELECT * FROM requests ORDER BY created_at DESC LIMIT 300').all()
      : db.prepare('SELECT * FROM requests WHERE username = ? ORDER BY created_at DESC LIMIT 300').all(req.user?.username ?? '')) as unknown as Row[];
    return rows.map(toRequest);
  });

  app.post('/api/requests', async (req, reply) => {
    const b = (req.body ?? {}) as Partial<NewRequest>;
    if (!b.kind || !KINDS.has(b.kind) || typeof b.key !== 'string' || !/^[\w.-]{1,40}$/.test(b.key) || typeof b.title !== 'string') {
      return reply.code(400).send({ error: 'Demande invalide.' });
    }
    const user = req.user!;
    const pending = db.prepare("SELECT id FROM requests WHERE kind = ? AND key = ? AND status = 'pending'").get(b.kind, b.key);
    if (pending) return reply.code(409).send({ error: 'Ce titre a déjà été demandé : la demande attend la validation.' });

    const language = PRESETS.has(b.language as string) ? b.language! : 'default';
    const formats = Array.isArray(b.formats) ? b.formats.filter((f) => f === 'eBook' || f === 'AudioBook') : [];
    const poster = typeof b.poster === 'string' && /^(https:\/\/|\/api\/library\/books\/)/.test(b.poster) ? b.poster.slice(0, 500) : null;
    const id = Number(db.prepare(`INSERT INTO requests (user_id, username, kind, key, title, year, poster, language, formats)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      user.id || null, user.username, b.kind, b.key, b.title.slice(0, 200),
      typeof b.year === 'number' ? b.year : null, poster, language, JSON.stringify(formats),
    ).lastInsertRowid);
    await journal(`Demande ${b.kind} « ${b.title.slice(0, 80)} »`, user.username);

    // Administrateur, ou validation automatique : ajouté tout de suite.
    if (user.role === 'admin' || settings.get('auto_approve') === '1') {
      try {
        const detail = await fulfil(get(id)!);
        decide(id, 'approved', detail);
      } catch (e) {
        return reply.code(502).send({ error: `Demande enregistrée, mais l'ajout a échoué : ${(e as Error).message}` });
      }
    }
    return toRequest(get(id)!);
  });

  app.post<{ Params: { id: string } }>('/api/requests/:id/approve', async (req, reply) => {
    const r = get(Number(req.params.id));
    if (!r) return reply.code(404).send({ error: 'Demande introuvable.' });
    if (r.status !== 'pending') return reply.code(409).send({ error: 'Cette demande a déjà été traitée.' });
    try {
      const detail = await fulfil(r);
      decide(r.id, 'approved', detail);
      await journal(`Demande acceptée : « ${r.title} » (de ${r.username})`, req.user?.username);
      return toRequest(get(r.id)!);
    } catch (e) {
      return reply.code(502).send({ error: (e as Error).message });
    }
  });

  app.post<{ Params: { id: string } }>('/api/requests/:id/reject', async (req, reply) => {
    const r = get(Number(req.params.id));
    if (!r) return reply.code(404).send({ error: 'Demande introuvable.' });
    if (r.status !== 'pending') return reply.code(409).send({ error: 'Cette demande a déjà été traitée.' });
    const note = typeof (req.body as { note?: unknown })?.note === 'string' ? String((req.body as { note: string }).note).slice(0, 300) : null;
    decide(r.id, 'rejected', note);
    await journal(`Demande refusée : « ${r.title} » (de ${r.username})`, req.user?.username);
    return toRequest(get(r.id)!);
  });

  app.delete<{ Params: { id: string } }>('/api/requests/:id', async (req, reply) => {
    const r = get(Number(req.params.id));
    if (!r) return reply.code(404).send({ error: 'Demande introuvable.' });
    const admin = req.user?.role === 'admin';
    if (!admin && (r.username !== req.user?.username || r.status !== 'pending')) {
      return reply.code(403).send({ error: 'Vous ne pouvez annuler que vos demandes en attente.' });
    }
    db.prepare('DELETE FROM requests WHERE id = ?').run(r.id);
    return { ok: true };
  });

  // ─── Réglage : validation automatique ─────────────────────────────────
  app.get('/api/settings/requests', async () => ({ autoApprove: settings.get('auto_approve') === '1' }));
  app.post('/api/settings/requests', async (req) => {
    settings.set('auto_approve', (req.body as { autoApprove?: unknown })?.autoApprove === true ? '1' : '0');
    return { autoApprove: settings.get('auto_approve') === '1' };
  });
}
