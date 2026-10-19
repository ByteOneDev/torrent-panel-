// Réglages de téléchargement : qBittorrent ↔ unités humaines (Mo/s, heures, jours).
import type { DownloadSettings } from '@motflix/shared';

const MB = 1024 * 1024;

/** Préférences de qBittorrent utilisées ici (API v2, /app/preferences). */
export interface QbtPreferences {
  dl_limit: number; up_limit: number;
  alt_dl_limit: number; alt_up_limit: number;
  scheduler_enabled: boolean;
  schedule_from_hour: number; schedule_from_min: number;
  schedule_to_hour: number; schedule_to_min: number;
  scheduler_days: number;
  max_active_downloads: number;
  max_ratio_enabled: boolean; max_ratio: number;
  max_seeding_time_enabled: boolean; max_seeding_time: number; // minutes
  max_ratio_act: number; // 0 : arrêter, 1 : retirer le torrent
}

const toMB = (bytes: number) => Math.round((bytes / MB) * 10) / 10;
const toBytes = (mb: number) => Math.round(mb * MB);
const hhmm = (h: number, m: number) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

export function fromQbt(p: QbtPreferences): DownloadSettings {
  return {
    maxDownloadMBps: p.dl_limit > 0 ? toMB(p.dl_limit) : 0,
    maxUploadMBps: p.up_limit > 0 ? toMB(p.up_limit) : 0,
    scheduleEnabled: p.scheduler_enabled,
    scheduleFrom: hhmm(p.schedule_from_hour, p.schedule_from_min),
    scheduleTo: hhmm(p.schedule_to_hour, p.schedule_to_min),
    altDownloadMBps: p.alt_dl_limit > 0 ? toMB(p.alt_dl_limit) : 0,
    altUploadMBps: p.alt_up_limit > 0 ? toMB(p.alt_up_limit) : 0,
    maxActiveDownloads: p.max_active_downloads,
    seedRatio: p.max_ratio_enabled && p.max_ratio >= 0 ? Math.round(p.max_ratio * 100) / 100 : null,
    seedDays: p.max_seeding_time_enabled && p.max_seeding_time >= 0 ? Math.round((p.max_seeding_time / 1440) * 10) / 10 : null,
    removeAfterSeeding: p.max_ratio_act === 1,
  };
}

function parseTime(v: unknown, label: string): [number, number] {
  const m = typeof v === 'string' ? /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(v) : null;
  if (!m) throw new Error(`${label} : heure invalide (format HH:MM).`);
  return [Number(m[1]), Number(m[2])];
}

function num(v: unknown, label: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) {
    throw new Error(`${label} : valeur entre ${min} et ${max} attendue.`);
  }
  return v;
}

/** Valide les réglages reçus et les traduit pour qBittorrent. */
export function toQbt(input: unknown): Partial<QbtPreferences> {
  const s = (input ?? {}) as Partial<DownloadSettings>;
  const [fh, fm] = parseTime(s.scheduleFrom, 'Début de la plage');
  const [th, tm] = parseTime(s.scheduleTo, 'Fin de la plage');
  const ratio = s.seedRatio === null || s.seedRatio === undefined ? null : num(s.seedRatio, 'Ratio', 0, 100);
  const days = s.seedDays === null || s.seedDays === undefined ? null : num(s.seedDays, 'Durée de partage', 0, 365);
  return {
    dl_limit: toBytes(num(s.maxDownloadMBps, 'Vitesse de réception', 0, 10_000)),
    up_limit: toBytes(num(s.maxUploadMBps, "Vitesse d'envoi", 0, 10_000)),
    alt_dl_limit: toBytes(num(s.altDownloadMBps, 'Vitesse réduite (réception)', 0, 10_000)),
    alt_up_limit: toBytes(num(s.altUploadMBps, 'Vitesse réduite (envoi)', 0, 10_000)),
    scheduler_enabled: !!s.scheduleEnabled,
    schedule_from_hour: fh, schedule_from_min: fm,
    schedule_to_hour: th, schedule_to_min: tm,
    scheduler_days: 0, // tous les jours
    max_active_downloads: Math.round(num(s.maxActiveDownloads, 'Téléchargements simultanés', 1, 50)),
    max_ratio_enabled: ratio !== null,
    max_ratio: ratio ?? -1,
    max_seeding_time_enabled: days !== null,
    max_seeding_time: days !== null ? Math.round(days * 1440) : -1,
    max_ratio_act: s.removeAfterSeeding ? 1 : 0,
  };
}
