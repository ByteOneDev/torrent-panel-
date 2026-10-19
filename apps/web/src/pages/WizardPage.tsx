import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, FolderCheck, FolderX, HardDrive, Info, Loader2, Minus, RotateCw, Wand2 } from 'lucide-react';
import type { MediaPreferences, SetupInfo, SetupRun } from '@motflix/shared';
import { api } from '../api.ts';
import { bytes } from '../format.ts';
import { Logo } from '../icons.tsx';
import { IndexersStep } from './wizard/IndexersStep.tsx';
import { generatePassword, PlaybackStep, type AbsDraft } from './wizard/PlaybackStep.tsx';
import { PreferencesStep } from './wizard/PreferencesStep.tsx';
import { VpnStep } from './wizard/VpnStep.tsx';

const STEPS = ['Bienvenue', 'Dossiers', 'VPN', 'Lecture', 'Préférences', 'Sites', 'Configuration'] as const;

function Welcome() {
  return (
    <>
      <h2>Bienvenue sur Motflix</h2>
      <p className="lead">En quelques étapes, Motflix relie entre eux tous les outils installés : vous n'aurez à ouvrir aucun d'entre eux.</p>
      <div className="checklist">
        {[
          ['Dossiers', 'Vérifie où sont rangés les films, séries et livres.'],
          ['VPN', 'Facultatif : masque votre adresse IP pendant les téléchargements.'],
          ['Lecture', 'Connecte Plex pour la télé, et prépare les livres audio.'],
          ['Préférences', 'Langue (VF d’abord), qualité, taille des fichiers.'],
          ['Sites', 'Les sites où chercher. Facultatif.'],
          ['Configuration', 'Motflix règle tout le reste automatiquement.'],
        ].map(([t, d]) => (
          <div key={t} className="check-row"><span className="st skipped"><Minus size={12} /></span><div className="lbl"><b>{t}</b><span>{d}</span></div></div>
        ))}
      </div>
    </>
  );
}

function Folders({ info }: { info: SetupInfo }) {
  const missing = info.media.folders.filter((f) => !f.exists);
  const disk = info.media.disk;
  return (
    <>
      <h2>Où sont rangés vos médias ?</h2>
      <p className="lead">Films, séries et livres ont chacun leur dossier, et les téléchargements le leur.</p>
      <div className="card">
        <div className="setting">
          <div className="txt"><b>Dossier des médias</b><p className="mono">{info.media.hostPath ?? '/data'}</p></div>
          {disk && <div className="ctl"><span className="badge ok"><HardDrive className="ic ic-sm" />{bytes(disk.freeBytes, 0)} libres</span></div>}
        </div>
        <div className="setting col">
          <div className="checklist">
            {info.media.folders.map((f) => (
              <div key={f.path} className={`check-row ${f.exists ? '' : 'error'}`} style={{ padding: '6px 0' }}>
                {f.exists ? <FolderCheck className="ic ic-sm" style={{ color: 'var(--ok)' }} /> : <FolderX className="ic ic-sm" style={{ color: 'var(--err)' }} />}
                <div className="lbl"><span className="mono">{f.path}</span></div>
              </div>
            ))}
          </div>
        </div>
      </div>
      {missing.length > 0 && <div className="alert"><AlertTriangle className="ic ic-sm" />Des dossiers manquent : relancez install.sh pour les recréer.</div>}
      <div className="hint"><Info className="ic ic-sm" /><span>
        Pour ranger les médias ailleurs (un disque dédié par exemple), relancez <code className="mono">install.sh --data-dir CHEMIN</code>.
      </span></div>
    </>
  );
}

function RunStep({ run, onStart }: { run: SetupRun | undefined; onStart: () => void }) {
  const started = !!run?.startedAt;
  const errors = run?.tasks.filter((t) => t.state === 'error').length ?? 0;
  return (
    <>
      <h2>{run?.finishedAt ? (errors ? 'Configuration terminée, avec des points à revoir' : 'Tout est configuré') : 'On s’occupe du reste'}</h2>
      <p className="lead">Motflix relie les outils entre eux et applique vos préférences. Ça prend quelques secondes.</p>
      {!started && (
        <div><button type="button" className="btn btn-primary btn-block" onClick={onStart}><Wand2 className="ic ic-sm" />Tout configurer</button></div>
      )}
      {started && (
        <div className="checklist">
          {run!.tasks.map((t) => (
            <div key={t.id} className={`check-row ${t.state}`}>
              <span className={`st ${t.state}`}>
                {t.state === 'done' && <Check size={13} strokeWidth={3} />}
                {t.state === 'error' && '!'}
                {t.state === 'skipped' && <Minus size={12} />}
              </span>
              <div className="lbl"><b>{t.label}</b>{t.detail && <span>{t.detail}</span>}</div>
            </div>
          ))}
        </div>
      )}
      {run?.finishedAt && errors > 0 && (
        <div><button type="button" className="btn" onClick={onStart}><RotateCw className="ic ic-sm" />Réessayer</button></div>
      )}
    </>
  );
}

export function WizardPage() {
  const [step, setStep] = useState(0);
  const info = useQuery({ queryKey: ['setup'], queryFn: api.setup.info });
  const run = useQuery({
    queryKey: ['setup-run'], queryFn: api.setup.runStatus,
    refetchInterval: (q) => (q.state.data?.running ? 1200 : false),
  });
  const [prefs, setPrefs] = useState<MediaPreferences | null>(null);
  const [abs, setAbs] = useState<AbsDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();

  // Valeurs de départ, une fois les informations chargées.
  useEffect(() => {
    if (!info.data) return;
    setPrefs((p) => p ?? info.data.preferences);
    setAbs((a) => a ?? {
      username: info.data.audiobookshelf.username ?? 'admin',
      password: info.data.audiobookshelf.password ?? generatePassword(),
    });
  }, [info.data]);

  useEffect(() => { document.title = 'Assistant · Motflix'; }, []);

  async function next() {
    setError(null);
    setSaving(true);
    try {
      const i = info.data!;
      // Identifiants Audiobookshelf : enregistrés tant que le compte n'existe pas encore.
      if (STEPS[step] === 'Lecture' && abs && !i.audiobookshelf.initialized) {
        await api.setup.audiobookshelf(abs.username, abs.password);
      }
      if (STEPS[step] === 'Préférences' && prefs) await api.setup.savePreferences(prefs);
      void qc.invalidateQueries({ queryKey: ['setup'] }); // rafraîchi en fond : on avance tout de suite
      setStep((s) => Math.min(s + 1, STEPS.length - 1));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function startRun() {
    setError(null);
    try {
      qc.setQueryData(['setup-run'], await api.setup.run());
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function finish() {
    await api.setup.finish();
    await qc.invalidateQueries({ queryKey: ['auth'] });
    navigate('/', { replace: true });
  }

  const last = step === STEPS.length - 1;
  const runState = run.data;
  const running = !!runState?.running;

  return (
    <div className="wizard-page">
      <div className="card wizard">
        <aside className="wiz-steps" aria-label="Étapes">
          <div className="brand"><div className="brand-logo"><Logo /></div><div className="brand-name">Motflix</div></div>
          {STEPS.map((s, i) => (
            <button key={s} type="button" className={`wiz-step ${i < step ? 'done' : i === step ? 'current' : ''}`}
              disabled={i > step || running} onClick={() => setStep(i)}>
              <i>{i < step ? <Check size={13} strokeWidth={3} /> : i + 1}</i><span>{s}</span>
            </button>
          ))}
          <button type="button" className="wiz-skip" onClick={finish}>Passer l'assistant</button>
        </aside>

        <div className="wiz-main">
          <div className="wiz-body">
            {!info.data || !prefs || !abs ? (
              info.error ? <div className="alert"><AlertTriangle className="ic ic-sm" />{(info.error as Error).message}</div>
                : <div className="empty">Chargement…</div>
            ) : (
              <>
                {STEPS[step] === 'Bienvenue' && <Welcome />}
                {STEPS[step] === 'Dossiers' && <Folders info={info.data} />}
                {STEPS[step] === 'VPN' && <VpnStep info={info.data} />}
                {STEPS[step] === 'Lecture' && <PlaybackStep info={info.data} abs={abs} onAbsChange={setAbs} />}
                {STEPS[step] === 'Préférences' && <PreferencesStep prefs={prefs} onChange={setPrefs} />}
                {STEPS[step] === 'Sites' && <IndexersStep info={info.data} />}
                {STEPS[step] === 'Configuration' && <RunStep run={runState} onStart={startRun} />}
              </>
            )}
            {error && <div className="alert" role="alert"><AlertTriangle className="ic ic-sm" />{error}</div>}
          </div>

          <div className="wiz-foot">
            <span className="dim">Étape {step + 1} sur {STEPS.length}</span>
            <div className="right">
              {step > 0 && <button type="button" className="btn btn-ghost" disabled={running} onClick={() => setStep((s) => s - 1)}>Retour</button>}
              {!last && (
                <button type="button" className="btn btn-primary" disabled={saving || !info.data} onClick={next}>
                  {saving && <Loader2 className="ic ic-sm spin" />}{step === 0 ? 'Commencer' : 'Continuer'}
                </button>
              )}
              {last && runState?.finishedAt && (
                <button type="button" className="btn btn-primary" onClick={finish}>Ouvrir le panel</button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
