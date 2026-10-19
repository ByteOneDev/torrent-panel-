import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, ExternalLink, Loader2, Play, RotateCw, Square, X } from 'lucide-react';
import type { Service, ServiceAction, ServiceState } from '@motflix/shared';
import { api } from './api.ts';

// ─── État d'un service ───────────────────────────────────────────────────

const STATE_LABEL: Record<ServiceState, string> = {
  online: 'En ligne',
  starting: 'Démarrage',
  unhealthy: 'Erreur',
  stopped: 'Arrêté',
  missing: 'Non installé',
};
const STATE_TONE: Record<ServiceState, '' | 'ok' | 'warn' | 'err'> = {
  online: 'ok', starting: 'warn', unhealthy: 'err', stopped: '', missing: '',
};

export function stateDotClass(state: ServiceState): string {
  const tone = STATE_TONE[state];
  return `dot flat ${tone === 'ok' ? '' : tone || 'off'}`;
}

export function StateBadge({ state }: { state: ServiceState }) {
  return (
    <span className={`badge ${STATE_TONE[state]}`}>
      <span className={stateDotClass(state)} />
      {STATE_LABEL[state]}
    </span>
  );
}

export function Bar({ value, tone = '' }: { value: number; tone?: '' | 'ok' | 'warn' | 'err' }) {
  const pct = Math.max(0, Math.min(100, value));
  return <div className={`bar ${tone}`}><i style={{ width: `${pct}%` }} /></div>;
}

/** Petit graphique d'évolution (CPU, mémoire). */
export function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return <svg className="spark" viewBox="0 0 300 56" />;
  const max = Math.max(...values, 1) * 1.2;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 300},${56 - (v / max) * 52}`);
  const line = `M${pts.join(' L')}`;
  return (
    <svg className="spark" viewBox="0 0 300 56" preserveAspectRatio="none" aria-hidden>
      <path d={`${line} L300,56 L0,56Z`} fill="var(--accent-soft)" />
      <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// ─── Notifications ───────────────────────────────────────────────────────

interface Toast { id: number; title: string; detail?: string; error?: boolean }
const ToastContext = createContext<(t: Omit<Toast, 'id'>) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    setToasts((all) => [...all, { ...t, id }]);
    setTimeout(() => setToasts((all) => all.filter((x) => x.id !== id)), t.error ? 6000 : 3000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.error ? 'err' : ''}`}>
            <span className="t-ic">{t.error ? <X size={15} /> : <Check size={15} />}</span>
            <div><b>{t.title}</b>{t.detail && <span>{t.detail}</span>}</div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

// ─── Confirmation ────────────────────────────────────────────────────────

export function ConfirmDialog(props: {
  title: string; message: string; confirmLabel: string; danger?: boolean;
  onConfirm: () => void; onCancel: () => void; children?: ReactNode;
}) {
  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && props.onCancel()}
      onKeyDown={(e) => e.key === 'Escape' && props.onCancel()} role="dialog" aria-modal="true">
      <div className="card modal">
        <div className="modal-body">
          <h3>{props.title}</h3>
          <p>{props.message}</p>
          {props.children}
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={props.onCancel}>Annuler</button>
          <button className={`btn ${props.danger ? 'btn-danger' : 'btn-primary'}`} onClick={props.onConfirm} autoFocus>
            {props.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Actions sur un service ──────────────────────────────────────────────

const ACTION_TEXT: Record<ServiceAction, { done: string; verb: string }> = {
  start: { done: 'démarré', verb: 'Démarrer' },
  stop: { done: 'arrêté', verb: 'Arrêter' },
  restart: { done: 'redémarré', verb: 'Redémarrer' },
};

export function useServiceAction() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: ({ service, action }: { service: Service; action: ServiceAction }) => api.serviceAction(service.id, action),
    onSuccess: (_d, { service, action }) => toast({ title: `${service.name} ${ACTION_TEXT[action].done}`, detail: service.tool }),
    onError: (e, { service, action }) =>
      toast({ title: `Impossible de ${ACTION_TEXT[action].verb.toLowerCase()} ${service.name}`, detail: (e as Error).message, error: true }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['services'] }),
  });
}

/** Boutons Démarrer / Redémarrer / Arrêter, avec confirmation pour l'arrêt. */
export function ServiceActions({ service, compact = false }: { service: Service; compact?: boolean }) {
  const mutation = useServiceAction();
  const [confirm, setConfirm] = useState<ServiceAction | null>(null);
  const busy = mutation.isPending && mutation.variables?.service.id === service.id;
  const running = service.state !== 'stopped' && service.state !== 'missing';
  const run = (action: ServiceAction) => mutation.mutate({ service, action });
  const pendingIcon = <Loader2 className="ic ic-sm spin" />;

  const dialogs = confirm && (
    <ConfirmDialog
      title={`${ACTION_TEXT[confirm].verb} ${service.name} ?`}
      message={confirm === 'stop'
        ? `${service.tool} s'arrêtera jusqu'au prochain démarrage manuel ou redémarrage de la machine.`
        : `${service.tool} sera indisponible quelques secondes.`}
      confirmLabel={ACTION_TEXT[confirm].verb}
      danger={confirm === 'stop'}
      onCancel={() => setConfirm(null)}
      onConfirm={() => { run(confirm); setConfirm(null); }}
    />
  );

  if (service.state === 'missing') return null;

  if (compact) {
    return (
      <>
        <button className="btn btn-ghost btn-sm" title="Redémarrer" aria-label={`Redémarrer ${service.name}`}
          disabled={busy || service.protected || !running} onClick={() => setConfirm('restart')}>
          {busy ? pendingIcon : <RotateCw className="ic ic-sm" />}
        </button>
        {running
          ? <button className="btn btn-ghost btn-sm" title="Arrêter" aria-label={`Arrêter ${service.name}`}
              disabled={busy || service.protected} onClick={() => setConfirm('stop')}><Square className="ic ic-sm" /></button>
          : <button className="btn btn-ghost btn-sm btn-ok" title="Démarrer" aria-label={`Démarrer ${service.name}`}
              disabled={busy} onClick={() => run('start')}><Play className="ic ic-sm" /></button>}
        {dialogs}
      </>
    );
  }

  return (
    <>
      <button className="btn btn-ok" disabled={busy || running} onClick={() => run('start')}>
        {busy && mutation.variables?.action === 'start' ? pendingIcon : <Play className="ic ic-sm" />}Démarrer
      </button>
      <button className="btn btn-warn" disabled={busy || !running || service.protected} onClick={() => setConfirm('restart')}>
        {busy && mutation.variables?.action === 'restart' ? pendingIcon : <RotateCw className="ic ic-sm" />}Redémarrer
      </button>
      <button className="btn btn-err" disabled={busy || !running || service.protected} onClick={() => setConfirm('stop')}>
        {busy && mutation.variables?.action === 'stop' ? pendingIcon : <Square className="ic ic-sm" />}Arrêter
      </button>
      {dialogs}
    </>
  );
}

/** Lien vers l'interface d'origine de l'outil, quand le navigateur peut la joindre. */
export function originalUiUrl(service: Service, toolsExposed: boolean): string | null {
  if (!service.ui || service.state === 'missing') return null;
  const host = window.location.hostname;
  const local = host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  if (!service.ui.lan && !toolsExposed && !local) return null;
  return `${window.location.protocol}//${host}:${service.ui.port}${service.ui.path}`;
}

export function OriginalUiLink({ service, toolsExposed }: { service: Service; toolsExposed: boolean }) {
  const url = originalUiUrl(service, toolsExposed);
  if (!url) return null;
  return (
    <a className="btn btn-ghost" href={url} target="_blank" rel="noreferrer" title={`Ouvrir ${service.tool}`}>
      <ExternalLink className="ic ic-sm" /><span className="hide-sm">Interface d'origine</span>
    </a>
  );
}
