import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { Pause, Play, Search, Terminal } from 'lucide-react';
import type { LogLevel, Service } from '@motflix/shared';
import { bytes, clock, percent, since } from '../format.ts';
import { serviceHistory, useLogs, useServices, type LogStatus } from '../hooks.ts';
import { ServiceIcon } from '../icons.tsx';
import { Layout } from '../Layout.tsx';
import { OriginalUiLink, ServiceActions, Spark, StateBadge, stateDotClass } from '../ui.tsx';

const LEVEL_FILTERS: { id: 'all' | LogLevel; label: string }[] = [
  { id: 'all', label: 'Tout' },
  { id: 'warn', label: 'Avertissements' },
  { id: 'error', label: 'Erreurs' },
];

const STATUS_BADGE: Record<LogStatus, { cls: string; label: string }> = {
  connecting: { cls: 'warn', label: 'Connexion…' },
  live: { cls: 'ok', label: 'En direct' },
  ended: { cls: '', label: 'Service arrêté' },
  error: { cls: 'err', label: 'Déconnecté' },
};

function Console({ service }: { service: Service }) {
  const running = service.state !== 'stopped' && service.state !== 'missing';
  // Relance le flux quand le conteneur redémarre.
  const { lines, status } = useLogs(running ? `${service.id}` : undefined);
  const [level, setLevel] = useState<'all' | LogLevel>('all');
  const [query, setQuery] = useState('');
  const [follow, setFollow] = useState(true);
  const box = useRef<HTMLDivElement>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return lines.filter((l) =>
      (level === 'all' || l.level === level || (level === 'warn' && l.level === 'error')) &&
      (!q || l.text.toLowerCase().includes(q)));
  }, [lines, level, query]);

  useLayoutEffect(() => {
    if (follow && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [visible, follow]);

  const badge = running ? STATUS_BADGE[status] : STATUS_BADGE.ended;

  return (
    <div className="card">
      <div className="card-head">
        <Terminal className="ic" /><h3>Console</h3>
        <div className="right chips">
          {LEVEL_FILTERS.map((f) => (
            <button key={f.id} className={`chip ${level === f.id ? 'active' : ''}`} onClick={() => setLevel(f.id)}>{f.label}</button>
          ))}
        </div>
      </div>
      <div className="console" ref={box} role="log" aria-live="off"
        onScroll={(e) => {
          const el = e.currentTarget;
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
          if (atBottom !== follow) setFollow(atBottom);
        }}>
        {!running && <div className="t">Le service est arrêté : démarrez-le pour voir ses logs.</div>}
        {running && !visible.length && <div className="t">{lines.length ? 'Aucune ligne ne correspond.' : 'En attente des logs…'}</div>}
        {visible.map((l, i) => (
          <div key={i}>
            <span className="t">{clock(l.time)}</span>{' '}
            <span className={l.level === 'info' ? '' : l.level}>{l.text}</span>
          </div>
        ))}
      </div>
      <div className="console-bar">
        <Search className="ic ic-sm dim" />
        <input placeholder="Filtrer les logs…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Filtrer les logs" />
        <button className="btn btn-ghost btn-sm" onClick={() => setFollow((f) => !f)} title={follow ? 'Figer le défilement' : 'Suivre les nouvelles lignes'}>
          {follow ? <Pause className="ic ic-sm" /> : <Play className="ic ic-sm" />}{follow ? 'Figer' : 'Suivre'}
        </button>
        <span className={`badge ${badge.cls}`}><span className={`dot flat ${badge.cls === 'ok' ? '' : badge.cls || 'off'}`} />{badge.label}</span>
      </div>
    </div>
  );
}

function ServiceDetail({ service, toolsExposed }: { service: Service; toolsExposed: boolean }) {
  const h = serviceHistory(service.id);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 30_000); return () => clearInterval(t); }, []);

  const running = service.state !== 'stopped' && service.state !== 'missing';
  return (
    <div className="svc-detail">
      <div className="card">
        <div className="svc-detail-head">
          <span className="svc-icon"><ServiceIcon name={service.icon} /></span>
          <div>
            <h2>{service.name}</h2>
            <span className="dim">
              {service.tool}
              {running && service.startedAt ? ` · en marche depuis ${since(service.startedAt)}` : ''}
            </span>
          </div>
          <StateBadge state={service.state} />
          <div className="actions">
            <ServiceActions service={service} />
            <OriginalUiLink service={service} toolsExposed={toolsExposed} />
          </div>
        </div>
        <div className="row" style={{ borderTop: '1px solid var(--border)' }}>
          <div className="row-main"><span>{service.description}</span></div>
          {service.containerName && <span className="dim mono hide-sm" style={{ fontSize: 12 }}>{service.containerName}</span>}
        </div>
      </div>

      {service.state === 'missing' ? (
        <div className="card empty">Ce service n'est pas installé. Il s'active depuis l'installation ({service.optional ? 'option facultative' : 'relancez install.sh'}).</div>
      ) : (
        <>
          <div className="grid g2">
            <div className="card spark-card">
              <div className="lbl"><span>Processeur</span><b className="num">{percent(service.cpuPercent)}</b></div>
              <Spark values={h.cpu} />
            </div>
            <div className="card spark-card">
              <div className="lbl"><span>Mémoire</span><b className="num">{bytes(service.memoryBytes, 0)}</b></div>
              <Spark values={h.mem} />
            </div>
          </div>
          <Console key={`${service.id}-${service.startedAt}`} service={service} />
        </>
      )}
    </div>
  );
}

export function ServicesPage() {
  const { id } = useParams();
  const { data, error } = useServices();
  const services = data?.services.filter((s) => !(s.optional && s.state === 'missing')) ?? [];

  if (data && !id && services[0]) return <Navigate to={`/services/${services[0].id}`} replace />;
  const current = services.find((s) => s.id === id);

  return (
    <Layout title={current ? `Services · ${current.name}` : 'Services'}>
      {error && <div className="alert" role="alert">{(error as Error).message}</div>}
      <div className="svc-layout">
        <nav className="card svc-list" aria-label="Services">
          {services.map((s) => (
            <Link key={s.id} to={`/services/${s.id}`} className={s.id === id ? 'active' : ''}>
              <span className={stateDotClass(s.state)} />{s.name}<small>{s.tool}</small>
            </Link>
          ))}
        </nav>
        {current
          ? <ServiceDetail service={current} toolsExposed={data?.toolsExposed ?? false} />
          : <div className="card empty">{data ? 'Service introuvable.' : 'Chargement…'}</div>}
      </div>
    </Layout>
  );
}
