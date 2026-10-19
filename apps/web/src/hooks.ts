import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { LogLine, ServicesResponse } from '@motflix/shared';
import { api } from './api.ts';

const REFRESH_MS = 5_000;
const HISTORY_POINTS = 30;
const MAX_LOG_LINES = 2_000;

export const useAuthState = () =>
  useQuery({ queryKey: ['auth'], queryFn: api.authState, staleTime: Infinity, retry: 1 });

/** Historique CPU / mémoire par service, alimenté par les rafraîchissements successifs. */
const history = new Map<string, { cpu: number[]; mem: number[] }>();

function recordHistory(data: ServicesResponse) {
  for (const s of data.services) {
    const h = history.get(s.id) ?? { cpu: [], mem: [] };
    if (s.cpuPercent !== null) h.cpu = [...h.cpu, s.cpuPercent].slice(-HISTORY_POINTS);
    if (s.memoryBytes !== null) h.mem = [...h.mem, s.memoryBytes].slice(-HISTORY_POINTS);
    history.set(s.id, h);
  }
  return data;
}

export const serviceHistory = (id: string) => history.get(id) ?? { cpu: [], mem: [] };

export const useServices = () =>
  useQuery({
    queryKey: ['services'],
    queryFn: () => api.services().then(recordHistory),
    refetchInterval: REFRESH_MS,
  });

export const useDashboard = () =>
  useQuery({ queryKey: ['dashboard'], queryFn: api.dashboard, refetchInterval: REFRESH_MS });

export type LogStatus = 'connecting' | 'live' | 'ended' | 'error';

/** Logs en direct d'un service (Server-Sent Events). */
export function useLogs(serviceId: string | undefined, tail = 300) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [status, setStatus] = useState<LogStatus>('connecting');
  const buffer = useRef<LogLine[]>([]);

  useEffect(() => {
    if (!serviceId) return;
    buffer.current = [];
    setLines([]);
    setStatus('connecting');

    const source = new EventSource(`/api/services/${encodeURIComponent(serviceId)}/logs?tail=${tail}`);
    let flushTimer: number | null = null;
    const flush = () => {
      flushTimer = null;
      setLines(buffer.current.slice());
    };

    // Le serveur renvoie les dernières lignes à chaque (re)connexion : on repart de zéro.
    source.onopen = () => {
      buffer.current = [];
      setStatus('live');
    };
    source.onmessage = (e) => {
      buffer.current.push(JSON.parse(e.data) as LogLine);
      if (buffer.current.length > MAX_LOG_LINES) buffer.current.splice(0, buffer.current.length - MAX_LOG_LINES);
      flushTimer ??= window.setTimeout(flush, 100);
    };
    source.addEventListener('end', () => {
      setStatus('ended');
      source.close();
    });
    source.onerror = () => setStatus(source.readyState === EventSource.CLOSED ? 'error' : 'connecting');

    return () => {
      source.close();
      if (flushTimer) clearTimeout(flushTimer);
    };
  }, [serviceId, tail]);

  return { lines, status };
}
