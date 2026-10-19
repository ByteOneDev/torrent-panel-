// État des services : conteneur Docker + réponse du service lui-même + ressources.
import type { Service, ServiceAction, ServiceState, ServicesResponse } from '@motflix/shared';
import { CATALOG, findEntry, type CatalogEntry } from './catalog.ts';
import type { Config } from './config.ts';
import { cpuPercent, memoryUsage, type ContainerInspect, type ContainerSummary, type DockerClient } from './docker.ts';

/** Délai pendant lequel un conteneur qui ne répond pas encore est « en démarrage ». */
const STARTUP_GRACE_MS = 120_000;
const CACHE_MS = 3_000;

export async function httpResponds(url: string, timeoutMs = 3_000): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' });
    await res.body?.cancel();
    return res.status < 500;
  } catch {
    return false;
  }
}

export function deriveState(
  entry: CatalogEntry,
  info: ContainerInspect | null,
  responds: boolean | null,
  now = Date.now(),
): ServiceState {
  if (!info) return 'missing';
  const status = info.State.Status;
  if (status === 'restarting') return 'starting';
  if (status !== 'running') return 'stopped';

  const health = info.State.Health?.Status;
  const recent = now - Date.parse(info.State.StartedAt) < STARTUP_GRACE_MS;

  if (entry.healthUrl && responds !== null) {
    if (responds) return 'online';
    return recent || health === 'starting' ? 'starting' : 'unhealthy';
  }
  if (health === 'starting') return 'starting';
  if (health === 'unhealthy') return recent ? 'starting' : 'unhealthy';
  return 'online';
}

export class ServiceManager {
  private docker: DockerClient;
  private config: Config;
  private cache: { at: number; value: Promise<ServicesResponse> } | null = null;

  constructor(docker: DockerClient, config: Config) {
    this.docker = docker;
    this.config = config;
  }

  invalidate() {
    this.cache = null;
  }

  list(): Promise<ServicesResponse> {
    const now = Date.now();
    if (!this.cache || now - this.cache.at > CACHE_MS) {
      const value = this.compute();
      this.cache = { at: now, value };
      value.catch(() => { this.cache = null; });
    }
    return this.cache.value;
  }

  private async containersByService(): Promise<Map<string, ContainerSummary>> {
    const containers = await this.docker.listContainers(this.config.composeProject);
    const map = new Map<string, ContainerSummary>();
    for (const c of containers) {
      const svc = c.Labels['com.docker.compose.service'];
      if (!svc) continue;
      // Si les deux variantes existent (VPN activé puis désactivé), on garde celle qui tourne.
      const prev = map.get(svc);
      if (!prev || (prev.State !== 'running' && c.State === 'running')) map.set(svc, c);
    }
    return map;
  }

  private pickContainer(entry: CatalogEntry, byService: Map<string, ContainerSummary>): ContainerSummary | null {
    const candidates = entry.composeServices.map((s) => byService.get(s)).filter((c): c is ContainerSummary => !!c);
    return candidates.find((c) => c.State === 'running') ?? candidates[0] ?? null;
  }

  private async compute(): Promise<ServicesResponse> {
    const byService = await this.containersByService();

    const services = await Promise.all(
      CATALOG.map(async (entry): Promise<Service> => {
        const container = this.pickContainer(entry, byService);
        const running = container?.State === 'running';

        const [info, responds, stats] = await Promise.all([
          container ? this.docker.inspect(container.Id).catch(() => null) : Promise.resolve(null),
          running && entry.healthUrl ? httpResponds(entry.healthUrl(this.config)) : Promise.resolve(null),
          running ? this.docker.stats(container.Id).catch(() => null) : Promise.resolve(null),
        ]);

        const state = entry.id === 'motflix' && !container ? 'online' : deriveState(entry, info, responds);
        return {
          id: entry.id,
          name: entry.name,
          tool: entry.tool,
          icon: entry.icon,
          description: entry.description,
          state,
          containerName: info?.Name.replace(/^\//, '') ?? null,
          startedAt: running && info ? info.State.StartedAt : null,
          cpuPercent: stats ? cpuPercent(stats) : null,
          memoryBytes: stats ? memoryUsage(stats) : null,
          memoryLimitBytes: stats?.memory_stats.limit ?? null,
          ui: entry.ui ?? null,
          protected: !!entry.protected,
          optional: !!entry.optional,
        };
      }),
    );

    return { services, toolsExposed: this.config.toolsExposed };
  }

  async act(id: string, action: ServiceAction): Promise<void> {
    const entry = findEntry(id);
    if (!entry) throw new ServiceError(404, 'Service inconnu.');
    if (entry.protected && action !== 'start') {
      throw new ServiceError(403, `${entry.name} ne peut pas être arrêté depuis le panel.`);
    }
    const byService = await this.containersByService();
    const container = this.pickContainer(entry, byService);
    if (!container) throw new ServiceError(404, `${entry.name} n'est pas installé.`);

    try {
      await this.docker.action(container.Id, action);
      // qBittorrent utilise le réseau du VPN : après un redémarrage du VPN, il faut le relancer.
      if (action !== 'stop') {
        for (const dep of entry.dependents ?? []) {
          const c = byService.get(dep);
          if (c) await this.docker.action(c.Id, 'restart');
        }
      }
    } finally {
      this.invalidate();
    }
  }

  /** Conteneur à suivre pour les logs. */
  async containerFor(id: string): Promise<ContainerInspect> {
    const entry = findEntry(id);
    if (!entry) throw new ServiceError(404, 'Service inconnu.');
    const container = this.pickContainer(entry, await this.containersByService());
    if (!container) throw new ServiceError(404, `${entry.name} n'est pas installé.`);
    return this.docker.inspect(container.Id);
  }
}

export class ServiceError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
