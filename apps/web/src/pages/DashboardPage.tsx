import { Link } from 'react-router';
import {
  AlertTriangle, ArrowDownToLine, Check, Download, Film, HardDrive, Info, Shield, ShieldOff, Terminal, Trash2,
} from 'lucide-react';
import type { ActivityItem, DashboardResponse, Service } from '@motflix/shared';
import { bytes, ago, duration, percent, speed } from '../format.ts';
import { useDashboard, useServices } from '../hooks.ts';
import { ServiceIcon } from '../icons.tsx';
import { Layout } from '../Layout.tsx';
import { Bar, ServiceActions, StateBadge } from '../ui.tsx';

function StatCard({ icon, tone = '', label, value, sub, children }: {
  icon: React.ReactNode; tone?: string; label: string; value: React.ReactNode; sub?: React.ReactNode; children?: React.ReactNode;
}) {
  return (
    <div className="card stat">
      <div className="stat-top"><span className={`stat-icon ${tone}`}>{icon}</span>{label}</div>
      <div className="stat-value num">{value}</div>
      {children}
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

function Stats({ d }: { d: DashboardResponse | undefined }) {
  if (!d) {
    return <div className="grid g4">{[0, 1, 2, 3].map((i) => <div key={i} className="card skeleton" style={{ height: 130 }} />)}</div>;
  }
  const used = d.disk.totalBytes - d.disk.freeBytes;
  const usedPct = d.disk.totalBytes ? (used / d.disk.totalBytes) * 100 : 0;
  const diskTone = usedPct > 90 ? 'err' : usedPct > 75 ? 'warn' : '';

  return (
    <div className="grid g4">
      <StatCard icon={<Download className="ic" />} label="Téléchargements"
        value={d.downloads.available ? `${d.downloads.active} en cours` : '—'}
        sub={d.downloads.available
          ? `↓ ${speed(d.downloads.downloadSpeed)} · ↑ ${speed(d.downloads.uploadSpeed)}`
          : 'qBittorrent ne répond pas'} />

      <StatCard icon={<HardDrive className="ic" />} tone={diskTone || 'warn'} label="Stockage"
        value={d.disk.available ? <>{bytes(used, 0)} <small>/ {bytes(d.disk.totalBytes, 0)}</small></> : '—'}
        sub={d.disk.available ? `${bytes(d.disk.freeBytes, 0)} libres` : 'Dossier des médias introuvable'}>
        {d.disk.available && <Bar value={usedPct} tone={diskTone} />}
      </StatCard>

      {d.vpn.enabled ? (
        <StatCard icon={d.vpn.connected ? <Shield className="ic" /> : <ShieldOff className="ic" />}
          tone={d.vpn.connected ? 'ok' : 'err'} label="VPN"
          value={d.vpn.connected ? 'Protégé' : 'Coupé'}
          sub={d.vpn.connected
            ? [d.vpn.publicIp && `IP ${d.vpn.publicIp}`, d.vpn.forwardedPort ? `port ${d.vpn.forwardedPort} ouvert` : null].filter(Boolean).join(' · ') || 'IP masquée'
            : 'Téléchargements suspendus, aucune fuite'} />
      ) : (
        <StatCard icon={<ShieldOff className="ic" />} tone="off" label="VPN" value="Désactivé"
          sub="Les téléchargements utilisent votre connexion" />
      )}

      <StatCard icon={<Film className="ic" />} label="Bibliothèque"
        value={d.library.movies !== null ? `${d.library.moviesOnDisk ?? 0} film${(d.library.moviesOnDisk ?? 0) > 1 ? 's' : ''}` : '—'}
        sub={[
          d.library.movies !== null && `${d.library.movies} suivi${d.library.movies > 1 ? 's' : ''}`,
          d.library.series !== null && `${d.library.series} série${d.library.series > 1 ? 's' : ''}`,
        ].filter(Boolean).join(' · ') || 'Radarr et Sonarr ne répondent pas'} />
    </div>
  );
}

function ServiceCard({ service }: { service: Service }) {
  const memPct = service.memoryBytes && service.memoryLimitBytes ? (service.memoryBytes / service.memoryLimitBytes) * 100 : 0;
  return (
    <div className="card svc">
      <div className="svc-head">
        <span className="svc-icon"><ServiceIcon name={service.icon} /></span>
        <div className="svc-name"><b>{service.name}</b><span>{service.tool}</span></div>
        <StateBadge state={service.state} />
      </div>
      <div className="svc-metrics">
        <div className="svc-metric">
          <b className="num">{percent(service.cpuPercent)}</b>Processeur
          <Bar value={Math.max((service.cpuPercent ?? 0) * 4, service.cpuPercent ? 3 : 0)} />
        </div>
        <div className="svc-metric">
          <b className="num">{bytes(service.memoryBytes, 0)}</b>Mémoire
          <Bar value={Math.max(memPct * 4, service.memoryBytes ? 3 : 0)} />
        </div>
      </div>
      <div className="svc-actions">
        <ServiceActions service={service} compact />
        <Link className="btn btn-sm" to={`/services/${service.id}`}><Terminal className="ic ic-sm" />Console</Link>
      </div>
    </div>
  );
}

const KIND_ICON: Record<ActivityItem['kind'], { icon: React.ReactNode; tone: string; verb: string }> = {
  grabbed: { icon: <ArrowDownToLine className="ic ic-sm" />, tone: '', verb: 'Envoyé au téléchargement' },
  imported: { icon: <Check className="ic ic-sm" />, tone: 'ok', verb: 'Ajouté à la bibliothèque' },
  failed: { icon: <AlertTriangle className="ic ic-sm" />, tone: 'err', verb: 'Échec' },
  deleted: { icon: <Trash2 className="ic ic-sm" />, tone: 'warn', verb: 'Supprimé' },
  other: { icon: <Info className="ic ic-sm" />, tone: '', verb: 'Événement' },
};

function Activity({ items }: { items: ActivityItem[] }) {
  if (!items.length) return <div className="empty">Rien pour l'instant. Les ajouts et téléchargements apparaîtront ici.</div>;
  return (
    <>
      {items.map((a, i) => {
        const k = KIND_ICON[a.kind];
        return (
          <div key={`${a.date}-${i}`} className="row">
            <span className={`type-ic ${k.tone}`}>{k.icon}</span>
            <div className="row-main">
              <b>{a.title}</b>
              <span>{k.verb} · {a.source}{a.detail ? ` · ${a.detail}` : ''}</span>
            </div>
            <span className="timeline-time">{ago(a.date)}</span>
          </div>
        );
      })}
    </>
  );
}

function Queue({ d }: { d: DashboardResponse }) {
  if (!d.downloads.available) return <div className="empty">qBittorrent ne répond pas.</div>;
  if (!d.downloads.items.length) return <div className="empty">Aucun téléchargement en cours.</div>;
  return (
    <>
      {d.downloads.items.map((t) => (
        <div key={t.name} className="row">
          <span className="type-ic"><Download className="ic ic-sm" /></span>
          <div className="row-main">
            <b>{t.name}</b>
            <Bar value={t.progress * 100} />
            <span className="num">
              {percent(t.progress * 100)} · {speed(t.downloadSpeed)} · {bytes(t.size)}
              {t.etaSeconds !== null && ` · reste ${duration(t.etaSeconds)}`}
            </span>
          </div>
        </div>
      ))}
    </>
  );
}

export function DashboardPage() {
  const services = useServices();
  const dashboard = useDashboard();
  const visible = services.data?.services.filter((s) => !(s.optional && s.state === 'missing') && !s.protected) ?? [];
  const installed = visible.filter((s) => s.state !== 'missing');
  const allOnline = installed.length > 0 && installed.every((s) => s.state === 'online');

  return (
    <Layout title="Tableau de bord">
      {services.error && <div className="alert" role="alert"><AlertTriangle className="ic ic-sm" />{(services.error as Error).message}</div>}

      <Stats d={dashboard.data} />

      <div className="section-title">
        <h2>Services</h2>
        {services.data && (allOnline
          ? <span className="badge ok"><span className="dot flat" />Tout fonctionne</span>
          : <span className="badge warn"><span className="dot flat warn" />À surveiller</span>)}
        <div className="right"><Link className="btn btn-ghost" to="/services"><Terminal className="ic ic-sm" />Consoles</Link></div>
      </div>
      <div className="grid g3">
        {services.data
          ? visible.map((s) => <ServiceCard key={s.id} service={s} />)
          : [0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="card skeleton" style={{ height: 168 }} />)}
      </div>

      <div className="grid g-main" style={{ marginTop: 30 }}>
        <div className="card">
          <div className="card-head"><h3>En cours de téléchargement</h3></div>
          {dashboard.data ? <Queue d={dashboard.data} /> : <div className="empty">Chargement…</div>}
        </div>
        <div className="card">
          <div className="card-head"><h3>Activité récente</h3></div>
          {dashboard.data ? <Activity items={dashboard.data.activity} /> : <div className="empty">Chargement…</div>}
        </div>
      </div>
    </Layout>
  );
}
