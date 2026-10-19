// Client minimal de l'API Docker, via le socket local (développement)
// ou via le proxy restreint « socket-proxy » (dans Docker).
import { Agent, request, type Dispatcher } from 'undici';
import type { LogLevel, LogLine } from '@motflix/shared';

export interface ContainerSummary {
  Id: string;
  Names: string[];
  State: string; // running, exited, restarting, created, paused, dead
  Labels: Record<string, string>;
}

export interface ContainerInspect {
  Id: string;
  Name: string;
  Config: { Tty: boolean };
  State: {
    Status: string;
    StartedAt: string;
    Health?: { Status: 'starting' | 'healthy' | 'unhealthy' };
  };
}

export interface ContainerStats {
  cpu_stats: { cpu_usage: { total_usage: number; percpu_usage?: number[] }; system_cpu_usage?: number; online_cpus?: number };
  precpu_stats: { cpu_usage: { total_usage: number }; system_cpu_usage?: number };
  memory_stats: { usage?: number; limit?: number; stats?: Record<string, number> };
}

export class DockerError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export class DockerClient {
  private base: string;
  private dispatcher: Dispatcher | undefined;

  constructor(dockerHost: string) {
    if (dockerHost.startsWith('unix://')) {
      this.base = 'http://localhost';
      this.dispatcher = new Agent({ connect: { socketPath: dockerHost.slice('unix://'.length) } });
    } else {
      this.base = dockerHost.replace(/^tcp:/, 'http:').replace(/\/$/, '');
    }
  }

  private async call(method: Dispatcher.HttpMethod, path: string, opts: { signal?: AbortSignal; timeoutMs?: number } = {}) {
    const res = await request(this.base + path, {
      method,
      dispatcher: this.dispatcher,
      signal: opts.signal,
      headersTimeout: opts.timeoutMs ?? 15_000,
      bodyTimeout: opts.timeoutMs === 0 ? 0 : (opts.timeoutMs ?? 15_000),
    });
    if (res.statusCode >= 400) {
      const text = await res.body.text().catch(() => '');
      let message = text;
      try { message = (JSON.parse(text) as { message?: string }).message ?? text; } catch { /* texte brut */ }
      throw new DockerError(res.statusCode, message || `Docker a répondu ${res.statusCode}`);
    }
    return res;
  }

  private async json<T>(path: string, timeoutMs?: number): Promise<T> {
    const res = await this.call('GET', path, { timeoutMs });
    return (await res.body.json()) as T;
  }

  listContainers(project: string): Promise<ContainerSummary[]> {
    const filters = encodeURIComponent(JSON.stringify({ label: [`com.docker.compose.project=${project}`] }));
    return this.json(`/containers/json?all=1&filters=${filters}`);
  }

  inspect(id: string): Promise<ContainerInspect> {
    return this.json(`/containers/${encodeURIComponent(id)}/json`);
  }

  /** Une mesure : Docker attend environ une seconde pour calculer l'écart de CPU. */
  stats(id: string): Promise<ContainerStats> {
    return this.json(`/containers/${encodeURIComponent(id)}/stats?stream=false`, 8_000);
  }

  async action(id: string, action: 'start' | 'stop' | 'restart'): Promise<void> {
    const query = action === 'start' ? '' : '?t=30';
    const res = await this.call('POST', `/containers/${encodeURIComponent(id)}/${action}${query}`, { timeoutMs: 60_000 });
    await res.body.dump();
  }

  /** Flux brut des logs (à décoder avec createLogParser). */
  async logs(id: string, tail: number, signal: AbortSignal) {
    const res = await this.call(
      'GET',
      `/containers/${encodeURIComponent(id)}/logs?follow=1&stdout=1&stderr=1&timestamps=1&tail=${tail}`,
      { signal, timeoutMs: 0 },
    );
    return res.body;
  }
}

// ─── Statistiques ────────────────────────────────────────────────────────

export function cpuPercent(s: ContainerStats): number | null {
  const cpuDelta = s.cpu_stats.cpu_usage.total_usage - s.precpu_stats.cpu_usage.total_usage;
  const systemDelta = (s.cpu_stats.system_cpu_usage ?? 0) - (s.precpu_stats.system_cpu_usage ?? 0);
  if (!s.cpu_stats.system_cpu_usage) return null; // conteneur arrêté
  if (systemDelta <= 0 || cpuDelta < 0) return 0;
  const cpus = s.cpu_stats.online_cpus ?? s.cpu_stats.cpu_usage.percpu_usage?.length ?? 1;
  return (cpuDelta / systemDelta) * cpus * 100;
}

/** Mémoire réellement utilisée : comme « docker stats », sans le cache de fichiers. */
export function memoryUsage(s: ContainerStats): number | null {
  const usage = s.memory_stats.usage;
  if (usage === undefined) return null;
  const cache = s.memory_stats.stats?.inactive_file ?? s.memory_stats.stats?.total_inactive_file ?? 0;
  return Math.max(0, usage - cache);
}

// ─── Logs ────────────────────────────────────────────────────────────────

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\u001b\[[0-9;?]*[A-Za-z]/g;
const TIMESTAMP_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})) (.*)$/s;

export function detectLevel(text: string): LogLevel {
  if (/\b(error|err|fatal|exception|critical|crit)\b|\[(error|fatal)\]/i.test(text)) return 'error';
  if (/\b(warn|warning)\b|\[warn\]/i.test(text)) return 'warn';
  return 'info';
}

export function parseLogLine(raw: string): LogLine {
  const clean = raw.replace(ANSI_RE, '').replace(/\r$/, '');
  const m = TIMESTAMP_RE.exec(clean);
  const time = m ? new Date(m[1]!).toISOString() : null;
  const text = m ? m[2]! : clean;
  return { time, level: detectLevel(text), text };
}

/**
 * Décode le flux de logs de Docker et rend des lignes complètes.
 * Sans TTY, Docker multiplexe stdout/stderr : chaque bloc a un en-tête de 8 octets
 * (type de flux, 3 octets nuls, taille sur 4 octets big-endian).
 */
export function createLogParser(tty: boolean, onLine: (line: LogLine) => void) {
  let frameBuffer: Buffer = Buffer.alloc(0);
  const pending = new Map<number, string>(); // reste de ligne incomplète, par flux

  function emitText(stream: number, chunk: string) {
    const text = (pending.get(stream) ?? '') + chunk;
    const lines = text.split('\n');
    pending.set(stream, lines.pop() ?? '');
    for (const l of lines) if (l.length) onLine(parseLogLine(l));
  }

  return {
    push(chunk: Buffer) {
      if (tty) return emitText(1, chunk.toString('utf8'));
      frameBuffer = frameBuffer.length ? Buffer.concat([frameBuffer, chunk]) : chunk;
      while (frameBuffer.length >= 8) {
        const stream = frameBuffer[0]!;
        const size = frameBuffer.readUInt32BE(4);
        if (frameBuffer.length < 8 + size) break;
        emitText(stream, frameBuffer.subarray(8, 8 + size).toString('utf8'));
        frameBuffer = frameBuffer.subarray(8 + size);
      }
    },
    flush() {
      for (const [, rest] of pending) if (rest.length) onLine(parseLogLine(rest));
      pending.clear();
    },
  };
}
