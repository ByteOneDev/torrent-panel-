import { ChevronDown, ChevronUp } from 'lucide-react';
import type { LanguageTag, MediaPreferences, Resolution } from '@motflix/shared';

const LANG_INFO: Record<LanguageTag, { name: string; detail: string }> = {
  VF: { name: 'VF — Version française', detail: 'TRUEFRENCH, VFF, VFI, FRENCH' },
  MULTi: { name: 'MULTi', detail: 'Piste française + version originale' },
  VO: { name: 'VO — Version originale', detail: 'Sans piste ni sous-titres français' },
  VOSTFR: { name: 'VOSTFR', detail: 'Version originale sous-titrée en français' },
};

const gb = (v: number) => `${v.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Go`;

export function PreferencesStep({ prefs, onChange, embedded = false }: { prefs: MediaPreferences; onChange: (p: MediaPreferences) => void; embedded?: boolean }) {
  const move = (i: number, delta: number) => {
    const languages = [...prefs.languages];
    const j = i + delta;
    [languages[i], languages[j]] = [languages[j]!, languages[i]!];
    onChange({ ...prefs, languages });
  };
  const perMinute = Math.round((prefs.maxMovieGb * 1024) / 120);

  return (
    <>
      {!embedded && <h2>Vos préférences</h2>}
      {!embedded && <p className="lead">Préremplies avec vos choix. Tout restera modifiable dans les Réglages.</p>}

      <div className="field">
        <label>Langues, de la plus voulue à la moins voulue</label>
        <div className="lang-list">
          {prefs.languages.map((l, i) => (
            <div className="lang-item" key={l}>
              <span className="lang-rank num">{i + 1}</span>
              <div className="txt"><b>{LANG_INFO[l].name}</b><span>{LANG_INFO[l].detail}</span></div>
              <div className="arrows">
                <button type="button" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Monter ${l}`}><ChevronUp className="ic ic-sm" /></button>
                <button type="button" disabled={i === prefs.languages.length - 1} onClick={() => move(i, 1)} aria-label={`Descendre ${l}`}><ChevronDown className="ic ic-sm" /></button>
              </div>
            </div>
          ))}
        </div>
        <span className="hint-text">Une version qui ne correspond à aucune de ces langues est ignorée. Si une meilleure langue sort plus tard, elle remplace l'ancienne automatiquement.</span>
      </div>

      <div className="field">
        <label>Qualité</label>
        <div className="seg">
          {(['720p', '1080p', '2160p'] as Resolution[]).map((r) => (
            <button key={r} type="button" className={prefs.resolution === r ? 'active' : ''} onClick={() => onChange({ ...prefs, resolution: r })}>
              {r === '2160p' ? '4K' : r}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label htmlFor="movie-size">Taille maximale d'un film</label>
        <div className="range-row">
          <input id="movie-size" type="range" min={1} max={40} step={0.5} value={prefs.maxMovieGb}
            onChange={(e) => onChange({ ...prefs, maxMovieGb: Number(e.target.value) })} />
          <span className="range-val num">{gb(prefs.maxMovieGb)}</span>
        </div>
        <span className="hint-text">Environ {perMinute} Mo par minute pour un film de 2 h. 1 To contient alors environ {Math.floor(1024 / prefs.maxMovieGb)} films.</span>
      </div>

      <div className="field">
        <label htmlFor="ep-size">Taille maximale d'un épisode</label>
        <div className="range-row">
          <input id="ep-size" type="range" min={0.5} max={10} step={0.5} value={prefs.maxEpisodeGb}
            onChange={(e) => onChange({ ...prefs, maxEpisodeGb: Number(e.target.value) })} />
          <span className="range-val num">{gb(prefs.maxEpisodeGb)}</span>
        </div>
      </div>
    </>
  );
}
