// Prowlarr : partage des sites d'indexation avec Radarr, Sonarr et LazyLibrarian,
// FlareSolverr pour les sites protégés, et ajout de sites choisis dans l'assistant.
import type { ConfiguredIndexer, IndexerAddResult, IndexerDefinition } from '@motflix/shared';
import { setFields, ToolError, type FieldsObject, type JsonClient } from './http.ts';

const FLARE_TAG = 'flaresolverr';

interface App extends FieldsObject { id?: number; name: string; implementation: string; syncLevel?: string }
interface Indexer extends FieldsObject {
  id?: number; name: string; definitionName?: string; privacy?: string; protocol?: string;
  enable: boolean; appProfileId?: number; tags: number[]; description?: string; language?: string; indexerUrls?: string[];
}

export interface ProwlarrTargets {
  radarrKey: string; sonarrKey: string; lazylibrarianKey: string;
}

async function tagId(api: JsonClient, label: string): Promise<number> {
  const tags = await api.get<{ id: number; label: string }[]>('/tag');
  return tags.find((t) => t.label === label)?.id ?? (await api.post<{ id: number }>('/tag', { label })).id;
}

export async function wireProwlarr(api: JsonClient, keys: ProwlarrTargets): Promise<string> {
  const targets = [
    { implementation: 'Radarr', baseUrl: 'http://radarr:7878', apiKey: keys.radarrKey },
    { implementation: 'Sonarr', baseUrl: 'http://sonarr:8989', apiKey: keys.sonarrKey },
    { implementation: 'LazyLibrarian', baseUrl: 'http://lazylibrarian:5299', apiKey: keys.lazylibrarianKey },
  ];
  const apps = await api.get<App[]>('/applications');
  const schemas = await api.get<App[]>('/applications/schema');
  const done: string[] = [];
  for (const t of targets) {
    const current = apps.find((a) => a.implementation === t.implementation);
    const base = current ?? schemas.find((s) => s.implementation === t.implementation);
    if (!base) continue;
    const app = setFields({ ...base, name: t.implementation, syncLevel: 'fullSync' },
      { prowlarrUrl: 'http://prowlarr:9696', baseUrl: t.baseUrl, apiKey: t.apiKey });
    if (current) await api.put(`/applications/${current.id}`, app);
    else await api.post('/applications', app);
    done.push(t.implementation);
  }

  // FlareSolverr, appliqué aux sites portant l'étiquette « flaresolverr ».
  const tag = await tagId(api, FLARE_TAG);
  const proxies = await api.get<(FieldsObject & { id?: number; implementation: string; tags: number[] })[]>('/indexerProxy');
  const current = proxies.find((p) => p.implementation === 'FlareSolverr');
  const base = current ?? (await api.get<(FieldsObject & { implementation: string; tags: number[] })[]>('/indexerProxy/schema'))
    .find((s) => s.implementation === 'FlareSolverr')!;
  const proxy = setFields({ ...base, name: 'FlareSolverr', tags: [tag] }, { host: 'http://flaresolverr:8191/', requestTimeout: 60 });
  if (current) await api.put(`/indexerProxy/${current.id}`, proxy);
  else await api.post('/indexerProxy', proxy);

  return `Partagés avec ${done.join(', ')} · FlareSolverr prêt`;
}

// ─── Sites ───────────────────────────────────────────────────────────────

let definitionsCache: { at: number; list: Indexer[] } | null = null;

async function definitions(api: JsonClient): Promise<Indexer[]> {
  if (!definitionsCache || Date.now() - definitionsCache.at > 3_600_000) {
    definitionsCache = { at: Date.now(), list: await api.get<Indexer[]>('/indexer/schema') };
  }
  return definitionsCache.list;
}

/** Sites publics en torrent connus de Prowlarr (aucun compte nécessaire). */
export async function publicDefinitions(api: JsonClient): Promise<IndexerDefinition[]> {
  return (await definitions(api))
    .filter((d) => d.privacy === 'public' && d.protocol === 'torrent')
    .map((d) => ({ name: d.name, description: d.description ?? '', language: d.language ?? '' }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

export async function configuredIndexers(api: JsonClient): Promise<{ name: string; enabled: boolean }[]> {
  return (await api.get<Indexer[]>('/indexer')).map((i) => ({ name: i.name, enabled: i.enable }));
}

/** Sites configurés, pour la page Réglages. */
export async function listIndexers(api: JsonClient): Promise<ConfiguredIndexer[]> {
  const flare = (await api.get<{ id: number; label: string }[]>('/tag')).find((t) => t.label === FLARE_TAG)?.id;
  return (await api.get<Indexer[]>('/indexer'))
    .map((i) => ({
      id: i.id!, name: i.name, enabled: i.enable, language: i.language ?? '',
      flaresolverr: flare !== undefined && i.tags.includes(flare),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

export async function setIndexerEnabled(api: JsonClient, id: number, enabled: boolean): Promise<void> {
  const indexer = await api.get<Indexer>(`/indexer/${id}`);
  // forceSave : un site momentanément injoignable doit pouvoir être désactivé.
  await api.put(`/indexer/${id}?forceSave=true`, { ...indexer, enable: enabled });
}

export async function deleteIndexer(api: JsonClient, id: number): Promise<void> {
  await api.del(`/indexer/${id}`);
}

const needsFlareSolverr = (msg: string) => /cloudflare|flaresolverr|captcha|challenge/i.test(msg);

/** Ajoute les sites choisis ; réessaie avec FlareSolverr si le site est protégé. */
export async function addIndexers(api: JsonClient, names: string[]): Promise<IndexerAddResult[]> {
  const defs = await definitions(api);
  const existing = new Set((await api.get<Indexer[]>('/indexer')).map((i) => i.name));
  const flareTag = await tagId(api, FLARE_TAG);
  const results: IndexerAddResult[] = [];

  for (const name of names) {
    if (existing.has(name)) { results.push({ name, ok: true, message: 'Déjà ajouté' }); continue; }
    const def = defs.find((d) => d.name === name);
    if (!def) { results.push({ name, ok: false, message: 'Site inconnu de Prowlarr' }); continue; }
    const indexer: Indexer = { ...structuredClone(def), enable: true, appProfileId: 1, tags: [] };
    const url = def.indexerUrls?.[0];
    if (url && indexer.fields.some((f) => f.name === 'baseUrl') && !indexer.fields.find((f) => f.name === 'baseUrl')?.value) {
      setFields(indexer, { baseUrl: url });
    }
    try {
      await api.post('/indexer', indexer);
      results.push({ name, ok: true, message: 'Ajouté et testé' });
    } catch (e) {
      const msg = (e as Error).message;
      if (e instanceof ToolError && needsFlareSolverr(msg)) {
        try {
          await api.post('/indexer', { ...indexer, tags: [flareTag] });
          results.push({ name, ok: true, message: 'Ajouté, via FlareSolverr' });
          continue;
        } catch (e2) {
          results.push({ name, ok: false, message: (e2 as Error).message });
          continue;
        }
      }
      results.push({ name, ok: false, message: msg });
    }
  }
  return results;
}
