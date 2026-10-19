// Réglages propres au panel, stockés dans la table « settings ».
import type { MediaPreferences } from '@motflix/shared';
import type { Db } from './db.ts';

export const DEFAULT_PREFERENCES: MediaPreferences = {
  languages: ['VF', 'MULTi', 'VO', 'VOSTFR'],
  acceptVfq: false,
  upgradeLanguage: true,
  rejectOthers: true,
  resolution: '1080p',
  allowHdr: false,
  avoidRemux: true,
  maxMovieGb: 4,
  maxEpisodeGb: 1.5,
};

export class Settings {
  private db: Db;
  constructor(db: Db) {
    this.db = db;
  }

  get(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  set(key: string, value: string | null): void {
    if (value === null) this.db.prepare('DELETE FROM settings WHERE key = ?').run(key);
    else this.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  }

  getJson<T>(key: string, fallback: T): T {
    const raw = this.get(key);
    if (!raw) return fallback;
    try { return { ...fallback, ...(JSON.parse(raw) as T) }; } catch { return fallback; }
  }

  setJson(key: string, value: unknown): void {
    this.set(key, JSON.stringify(value));
  }

  preferences(): MediaPreferences {
    return this.getJson('preferences', DEFAULT_PREFERENCES);
  }
}

/** Valide des préférences reçues de l'interface. */
export function parsePreferences(input: unknown): MediaPreferences {
  const p = (input ?? {}) as Partial<MediaPreferences>;
  const d = DEFAULT_PREFERENCES;
  const tags = ['VF', 'MULTi', 'VO', 'VOSTFR'] as const;
  const languages = Array.isArray(p.languages)
    ? p.languages.filter((l, i, all): l is (typeof tags)[number] => tags.includes(l as never) && all.indexOf(l) === i)
    : d.languages;
  if (!languages.length) throw new Error('Choisissez au moins une langue.');
  const num = (v: unknown, min: number, max: number, def: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def;
  const bool = (v: unknown, def: boolean) => (typeof v === 'boolean' ? v : def);
  return {
    languages,
    acceptVfq: bool(p.acceptVfq, d.acceptVfq),
    upgradeLanguage: bool(p.upgradeLanguage, d.upgradeLanguage),
    rejectOthers: bool(p.rejectOthers, d.rejectOthers),
    resolution: p.resolution === '720p' || p.resolution === '2160p' ? p.resolution : '1080p',
    allowHdr: bool(p.allowHdr, d.allowHdr),
    avoidRemux: bool(p.avoidRemux, d.avoidRemux),
    maxMovieGb: num(p.maxMovieGb, 0.5, 100, d.maxMovieGb),
    maxEpisodeGb: num(p.maxEpisodeGb, 0.2, 30, d.maxEpisodeGb),
  };
}
