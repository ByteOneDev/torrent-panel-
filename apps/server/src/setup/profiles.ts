// Préférences de langue, qualité et taille → objets de Radarr et Sonarr.
//
// Langues : un « custom format » par langue (VF, MULTi, VO, VOSTFR), noté selon l'ordre
// choisi (400 / 300 / 200 / 100). Le profil « Motflix » accepte toutes les langues côté
// filtre natif et laisse le score départager. Avec « refuser les autres langues »,
// un score minimum de 1 écarte tout ce qui ne correspond à aucune langue voulue.
import type { LanguagePreset, LanguageTag, MediaPreferences } from '@motflix/shared';
import type { JsonClient } from './http.ts';

export const PROFILE_NAME = 'Motflix';
export const CF_PREFIX = 'Motflix · ';
const HDR_NAME = `${CF_PREFIX}HDR`;
const REJECT_SCORE = -10_000;

// Étiquettes des sorties françaises (regex insensibles à la casse côté *arr).
const VF_TAGS = 'TRUE[ ._-]?FRENCH|VFF|VFI|VF2|VOF|FRENCH';
const VFQ_TAGS = 'VFQ|VQ';
const MULTI_RE = '\\bMULTI(?:[ ._-]?(?:VF[FIQ2]?|TRUEFRENCH|FRENCH))?\\b';
const SUB_RE = '\\b(?:VOSTFR|SUBFRENCH|STFR)\\b';
const HDR_RE = '\\b(?:HDR10\\+?|HDR|DV|DoVi|Dolby[ ._-]?Vision)\\b';

interface Spec {
  name: string;
  implementation: 'ReleaseTitleSpecification' | 'LanguageSpecification';
  negate: boolean;
  required: boolean;
  fields: { name: string; value: unknown }[];
}

export interface CustomFormat {
  id?: number;
  name: string;
  includeCustomFormatWhenRenaming: boolean;
  specifications: Spec[];
}

const title = (name: string, regex: string, negate = false): Spec => ({
  name, implementation: 'ReleaseTitleSpecification', negate, required: true, fields: [{ name: 'value', value: regex }],
});

/** Formats de langue, selon l'acceptation ou non du doublage québécois. */
export function languageFormats(acceptVfq: boolean): Record<LanguageTag, CustomFormat> {
  const vf = acceptVfq ? `${VF_TAGS}|${VFQ_TAGS}` : VF_TAGS;
  const allFrench = `${VF_TAGS}|${VFQ_TAGS}|MULTI|VOSTFR|SUBFRENCH|STFR`;
  const cf = (tag: LanguageTag, specs: Spec[]): CustomFormat => ({
    name: CF_PREFIX + tag, includeCustomFormatWhenRenaming: false, specifications: specs,
  });
  return {
    VF: cf('VF', [
      title('Version française', `\\b(?:${vf})\\b`),
      title('Pas MULTi', '\\bMULTI', true),
      title('Pas sous-titrée', SUB_RE, true),
      // « FRENCH.VFQ » est un doublage québécois : exclu sauf si on l'accepte.
      ...(acceptVfq ? [] : [title('Pas québécoise', `\\b(?:${VFQ_TAGS})\\b`, true)]),
    ]),
    MULTi: cf('MULTi', [title('MULTi', MULTI_RE)]),
    VO: cf('VO', [
      { name: 'Langue originale', implementation: 'LanguageSpecification', negate: false, required: true,
        fields: [{ name: 'value', value: -2 }, { name: 'exceptLanguage', value: false }] },
      title('Sans piste ni sous-titres français', `\\b(?:${allFrench})\\b`, true),
    ]),
    VOSTFR: cf('VOSTFR', [title('VOSTFR', SUB_RE)]),
  };
}

export const hdrFormat = (): CustomFormat => ({
  name: HDR_NAME, includeCustomFormatWhenRenaming: false, specifications: [title('HDR / Dolby Vision', HDR_RE)],
});

/** Score de chaque langue selon sa place : 400, 300, 200, 100. */
export function languageScores(prefs: MediaPreferences): Map<LanguageTag, number> {
  return new Map(prefs.languages.map((l, i) => [l, (prefs.languages.length - i) * 100]));
}

/** Équivalent JavaScript des regex des formats, pour tester sans Radarr. */
export function matchLanguage(release: string, acceptVfq: boolean, originalIsFrench = false): LanguageTag | null {
  const re = (s: string) => new RegExp(s, 'i');
  const vf = acceptVfq ? `${VF_TAGS}|${VFQ_TAGS}` : VF_TAGS;
  if (re(MULTI_RE).test(release)) return 'MULTi';
  if (re(SUB_RE).test(release)) return 'VOSTFR';
  const quebec = re(`\\b(?:${VFQ_TAGS})\\b`).test(release);
  if (re(`\\b(?:${vf})\\b`).test(release) && (acceptVfq || !quebec)) return 'VF';
  const anyFrench = re(`\\b(?:${VF_TAGS}|${VFQ_TAGS}|MULTI|VOSTFR|SUBFRENCH|STFR)\\b`).test(release);
  return !anyFrench && !originalIsFrench ? 'VO' : null;
}

// ─── Qualités ────────────────────────────────────────────────────────────

interface Quality { id: number; name: string; resolution: number; source: string; modifier?: string }
export interface ProfileItem {
  id?: number;
  name?: string;
  quality?: Quality;
  items: ProfileItem[];
  allowed: boolean;
}

export interface QualityProfile {
  id?: number;
  name: string;
  upgradeAllowed: boolean;
  cutoff: number;
  items: ProfileItem[];
  minFormatScore: number;
  cutoffFormatScore: number;
  minUpgradeFormatScore?: number;
  formatItems: { format: number; name?: string; score: number }[];
  language?: { id: number; name: string };
}

const RESOLUTION = { '720p': 720, '1080p': 1080, '2160p': 2160 } as const;
const EXCLUDED_MODIFIERS = new Set(['remux', 'brdisk', 'rawhd', 'regional', 'screener']);
const EXCLUDED_SOURCES = new Set(['blurayRaw', 'televisionRaw', 'cam', 'telesync', 'telecine', 'workprint']);

export function qualityAllowed(q: Quality, prefs: MediaPreferences): boolean {
  const max = RESOLUTION[prefs.resolution];
  const min = prefs.resolution === '720p' ? 480 : 720;
  if (q.resolution < min || q.resolution > max) return false;
  if (EXCLUDED_SOURCES.has(q.source)) return false;
  const remux = q.modifier === 'remux' || /remux/i.test(q.name);
  if (remux) return !prefs.avoidRemux && q.modifier !== 'brdisk';
  return !EXCLUDED_MODIFIERS.has(q.modifier ?? 'none');
}

/** Coche les qualités voulues et renvoie l'élément « cible » (le meilleur coché). */
export function applyQualities(items: ProfileItem[], prefs: MediaPreferences): number {
  let cutoff: number | null = null;
  for (const it of items) {
    if (it.items.length) {
      for (const sub of it.items) sub.allowed = !!sub.quality && qualityAllowed(sub.quality, prefs);
      it.allowed = it.items.some((s) => s.allowed);
      if (it.allowed && it.id !== undefined) cutoff = it.id;
    } else if (it.quality) {
      it.allowed = qualityAllowed(it.quality, prefs);
      if (it.allowed) cutoff = it.quality.id;
    }
  }
  if (cutoff === null) throw new Error('Aucune qualité ne correspond à ces préférences.');
  return cutoff;
}

/** Taille maximale en Mo par minute, comme l'attendent les « quality definitions ». */
export function maxMbPerMinute(gb: number, minutes: number): number {
  return Math.round(((gb * 1024) / minutes) * 10) / 10;
}

// ─── Application à Radarr / Sonarr ───────────────────────────────────────

interface QualityDefinition { id: number; quality: Quality; minSize: number; maxSize: number | null; preferredSize: number | null }

export async function applyPreferences(api: JsonClient, kind: 'radarr' | 'sonarr', prefs: MediaPreferences): Promise<string> {
  // 1. Formats personnalisés (créés ou mis à jour par nom).
  const existing = await api.get<CustomFormat[]>('/customformat');
  const wanted = [...Object.values(languageFormats(prefs.acceptVfq)), hdrFormat()];
  const ids = new Map<string, number>();
  for (const cf of wanted) {
    const current = existing.find((e) => e.name === cf.name);
    const saved = current
      ? await api.put<CustomFormat>(`/customformat/${current.id}`, { ...cf, id: current.id })
      : await api.post<CustomFormat>('/customformat', cf);
    ids.set(cf.name, saved.id!);
  }

  // 2. Profil « Motflix » (vos préférences) et ses variantes de langue.
  const allFormats = await api.get<CustomFormat[]>('/customformat');
  let profiles = await api.get<QualityProfile[]>('/qualityprofile');
  const savedProfile = await upsertProfile(api, kind, PROFILE_NAME, prefs, allFormats, profiles);
  for (const preset of ['original', 'french'] as const) {
    profiles = await api.get<QualityProfile[]>('/qualityprofile');
    await upsertProfile(api, kind, PRESET_PROFILES[preset], presetPreferences(prefs, preset), allFormats, profiles);
  }

  // 3. Taille maximale des qualités cochées.
  const minutes = kind === 'radarr' ? 120 : 45;
  const max = maxMbPerMinute(kind === 'radarr' ? prefs.maxMovieGb : prefs.maxEpisodeGb, minutes);
  const defs = await api.get<QualityDefinition[]>('/qualitydefinition');
  const updated = defs.map((d) => {
    if (!qualityAllowed(d.quality, prefs)) return d;
    const preferred = Math.round(max * 0.95 * 10) / 10;
    return { ...d, minSize: Math.min(d.minSize, preferred), preferredSize: preferred, maxSize: max };
  });
  await api.put('/qualitydefinition/update', updated);

  // 4. Les films / séries déjà suivis passent sur ce profil.
  const path = kind === 'radarr' ? '/movie' : '/series';
  const media = await api.get<{ id: number; qualityProfileId: number }[]>(path);
  // Les titres réglés sur une variante (« VO d'abord »…) la gardent.
  const motflixIds = new Set((await api.get<QualityProfile[]>('/qualityprofile'))
    .filter((p) => p.name === PROFILE_NAME || p.name.startsWith(`${PROFILE_NAME} · `)).map((p) => p.id));
  const toMove = media.filter((m) => !motflixIds.has(m.qualityProfileId)).map((m) => m.id);
  if (toMove.length) {
    const body = kind === 'radarr'
      ? { movieIds: toMove, qualityProfileId: savedProfile.id }
      : { seriesIds: toMove, qualityProfileId: savedProfile.id };
    await api.put(`${path}/editor`, body);
  }

  const order = prefs.languages.join(' › ');
  return `${order} · ${prefs.resolution} · max ${max} Mo/min${toMove.length ? ` · ${toMove.length} titre(s) mis à jour` : ''}`;
}

// ─── Variantes de langue ─────────────────────────────────────────────────

/** Profil de chaque choix de langue proposé à l'ajout d'un film ou d'une série. */
export const PRESET_PROFILES: Record<LanguagePreset, string> = {
  default: PROFILE_NAME,
  original: `${PROFILE_NAME} · VO d'abord`,
  french: `${PROFILE_NAME} · Français seulement`,
};

/** Préférences d'une variante : même qualité et mêmes tailles, autres langues. */
export function presetPreferences(prefs: MediaPreferences, preset: LanguagePreset): MediaPreferences {
  if (preset === 'original') return { ...prefs, languages: ['VO', 'VOSTFR', 'MULTi', 'VF'], rejectOthers: true };
  if (preset === 'french') return { ...prefs, languages: ['VF', 'MULTi'], rejectOthers: true };
  return prefs;
}

async function upsertProfile(api: JsonClient, kind: 'radarr' | 'sonarr', name: string, prefs: MediaPreferences,
  allFormats: CustomFormat[], profiles: QualityProfile[]): Promise<QualityProfile> {
  const scores = languageScores(prefs);
  const base = profiles.find((p) => p.name === name) ?? (await api.get<QualityProfile>('/qualityprofile/schema'));
  const cutoff = applyQualities(base.items, prefs);
  const topScore = Math.max(...scores.values());
  const minScore = Math.min(...scores.values());
  const profile: QualityProfile = {
    ...base,
    name,
    upgradeAllowed: true,
    cutoff,
    minFormatScore: prefs.rejectOthers ? 1 : 0,
    cutoffFormatScore: prefs.upgradeLanguage ? topScore : minScore,
    minUpgradeFormatScore: 1,
    formatItems: allFormats.map((f) => {
      const tag = f.name.startsWith(CF_PREFIX) ? (f.name.slice(CF_PREFIX.length) as LanguageTag) : null;
      const score = f.name === HDR_NAME
        ? (prefs.allowHdr ? 0 : REJECT_SCORE)
        : tag && scores.has(tag) ? scores.get(tag)! : 0;
      return { format: f.id!, name: f.name, score };
    }),
  };
  if (kind === 'radarr') profile.language = { id: -1, name: 'Any' };
  return profile.id
    ? api.put<QualityProfile>(`/qualityprofile/${profile.id}`, profile)
    : api.post<QualityProfile>('/qualityprofile', profile);
}

/** Identifiant du profil d'un choix de langue (repli : profil Motflix, puis le premier). */
export async function profileIdFor(api: JsonClient, preset: LanguagePreset = 'default'): Promise<number | null> {
  const profiles = await api.get<QualityProfile[]>('/qualityprofile');
  return profiles.find((p) => p.name === PRESET_PROFILES[preset])?.id
    ?? profiles.find((p) => p.name === PROFILE_NAME)?.id ?? null;
}

/** Choix de langue correspondant à un profil (null : profil étranger à Motflix). */
export function presetOfProfile(profiles: { id: number; name: string }[], id: number): LanguagePreset | null {
  const name = profiles.find((p) => p.id === id)?.name;
  const entry = Object.entries(PRESET_PROFILES).find(([, n]) => n === name);
  return entry ? (entry[0] as LanguagePreset) : null;
}

/** Identifiant du profil Motflix (pour ajouter des films ou séries plus tard). */
export async function motflixProfileId(api: JsonClient): Promise<number | null> {
  return profileIdFor(api, 'default');
}
