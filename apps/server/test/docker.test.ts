import { describe, expect, it } from 'vitest';
import type { LogLine } from '@motflix/shared';
import { cpuPercent, createLogParser, detectLevel, memoryUsage, parseLogLine, type ContainerStats } from '../src/docker.ts';

function frame(stream: number, text: string): Buffer {
  const payload = Buffer.from(text, 'utf8');
  const header = Buffer.alloc(8);
  header[0] = stream;
  header.writeUInt32BE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

describe('createLogParser', () => {
  it('décode les blocs multiplexés, même coupés au milieu', () => {
    const lines: LogLine[] = [];
    const parser = createLogParser(false, (l) => lines.push(l));
    const data = Buffer.concat([
      frame(1, '2026-10-19T10:00:00.123456789Z [Info] Démarrage\n2026-10-19T10:00:01Z [Warn] Lent'),
      frame(2, '\n2026-10-19T10:00:02Z [Error] Échec\n'),
    ]);
    // Coupé en morceaux arbitraires, y compris au milieu d'un en-tête.
    for (let i = 0; i < data.length; i += 5) parser.push(data.subarray(i, i + 5));
    parser.flush();

    expect(lines.map((l) => [l.level, l.text])).toEqual([
      ['info', '[Info] Démarrage'],
      ['error', '[Error] Échec'],
      ['warn', '[Warn] Lent'],
    ]);
    expect(lines[0]!.time).toBe('2026-10-19T10:00:00.123Z');
  });

  it('lit un flux TTY sans en-têtes', () => {
    const lines: LogLine[] = [];
    const parser = createLogParser(true, (l) => lines.push(l));
    parser.push(Buffer.from('ligne 1\nlig'));
    parser.push(Buffer.from('ne 2\n'));
    expect(lines.map((l) => l.text)).toEqual(['ligne 1', 'ligne 2']);
  });
});

describe('parseLogLine', () => {
  it('retire les codes couleur et garde le texte sans horodatage', () => {
    const l = parseLogLine('\u001b[32mINFO\u001b[0m [vpn] connecté');
    expect(l).toEqual({ time: null, level: 'info', text: 'INFO [vpn] connecté' });
  });

  it('reconnaît les niveaux des différents outils', () => {
    expect(detectLevel('[Fatal] crash')).toBe('error');
    expect(detectLevel('2026/10/19 ERROR vpn down')).toBe('error');
    expect(detectLevel('WARN [healthcheck] slow')).toBe('warn');
    expect(detectLevel('Terrorist movie imported')).toBe('info');
  });
});

describe('statistiques', () => {
  const stats: ContainerStats = {
    cpu_stats: { cpu_usage: { total_usage: 2_000_000 }, system_cpu_usage: 20_000_000, online_cpus: 4 },
    precpu_stats: { cpu_usage: { total_usage: 1_000_000 }, system_cpu_usage: 10_000_000 },
    memory_stats: { usage: 300, limit: 1000, stats: { inactive_file: 100 } },
  };

  it('calcule le CPU comme docker stats', () => {
    expect(cpuPercent(stats)).toBeCloseTo(40);
  });

  it('retire le cache de la mémoire', () => {
    expect(memoryUsage(stats)).toBe(200);
  });

  it("renvoie null pour un conteneur arrêté", () => {
    expect(cpuPercent({ ...stats, cpu_stats: { cpu_usage: { total_usage: 0 } } })).toBeNull();
  });
});
