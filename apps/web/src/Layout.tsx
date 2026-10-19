import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  BookOpen, Download, Film, FolderInput, Inbox, Headphones, LayoutDashboard, LogOut, Menu, Moon, Search, Server, Settings, Shield, Sun, Tv, Wand2,
  type LucideIcon,
} from 'lucide-react';
import { api } from './api.ts';
import { useAuthState, useDashboard, useRole, useServices } from './hooks.ts';
import type { Role } from '@motflix/shared';
import { useQuery } from '@tanstack/react-query';
import { api as apiClient } from './api.ts';
import { Logo } from './icons.tsx';

interface NavEntry { to: string; label: string; icon: LucideIcon; soon?: boolean; roles?: Role[] }

const NAV: { label: string; items: NavEntry[] }[] = [
  { label: 'Général', items: [
    { to: '/', label: 'Tableau de bord', icon: LayoutDashboard, roles: ['admin'] },
    { to: '/services', label: 'Services', icon: Server, roles: ['admin'] },
  ] },
  { label: 'Médias', items: [
    { to: '/recherche', label: 'Rechercher', icon: Search, roles: ['admin', 'member'] },
    { to: '/films', label: 'Films', icon: Film },
    { to: '/series', label: 'Séries', icon: Tv },
    { to: '/livres', label: 'Livres', icon: BookOpen },
    { to: '/livres-audio', label: 'Livres audio', icon: Headphones },
    { to: '/importer', label: 'Importer', icon: FolderInput, roles: ['admin'] },
  ] },
  { label: 'Activité', items: [
    { to: '/demandes', label: 'Demandes', icon: Inbox, roles: ['admin', 'member'] },
    { to: '/telechargements', label: 'Téléchargements', icon: Download },
  ] },
  { label: 'Configuration', items: [
    { to: '/reglages', label: 'Réglages', icon: Settings, roles: ['admin'] },
    { to: '/assistant', label: 'Assistant', icon: Wand2, roles: ['admin'] },
  ] },
];

function useTheme() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme ?? 'dark');
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('motflix-theme', theme); } catch { /* navigation privée */ }
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0c0f15' : '#f3f5f9');
  }, [theme]);
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))] as const;
}

function ServerPill() {
  const { data } = useServices(useRole() === 'admin');
  const installed = data?.services.filter((s) => s.state !== 'missing') ?? [];
  const online = installed.filter((s) => s.state === 'online').length;
  const problems = installed.filter((s) => s.state === 'unhealthy' || s.state === 'stopped').length;
  const dot = !data ? 'dot off' : problems ? 'dot err' : online < installed.length ? 'dot warn' : 'dot';
  return (
    <div className="server-pill">
      <span className={dot} />
      <div>
        <b>Serveur Motflix</b>
        <span>{data ? `${online} sur ${installed.length} services en ligne` : 'Connexion…'}</span>
      </div>
    </div>
  );
}

function VpnBadge() {
  const role = useRole();
  const { data } = useDashboard(role === 'admin');
  if (!data?.vpn.enabled) return null;
  const { connected, country } = data.vpn;
  return (
    <span className={`badge ${connected ? 'ok' : 'err'}`} title={connected ? 'VPN connecté' : 'VPN déconnecté'}>
      <Shield className="ic ic-sm" />
      <span className="hide-sm">{connected ? `VPN${country ? ` · ${country}` : ''}` : 'VPN coupé'}</span>
    </span>
  );
}

export function Layout({ title, children }: { title: string; children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, toggleTheme] = useTheme();
  const { data: auth } = useAuthState();
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();

  useEffect(() => setMenuOpen(false), [location.pathname]);
  useEffect(() => { document.title = `${title} · Motflix`; }, [title]);

  async function logout() {
    await api.logout().catch(() => {});
    qc.clear();
    navigate('/connexion');
  }

  const username = auth?.user?.username ?? '';
  const role = auth?.user?.role ?? 'viewer';
  const pending = useQuery({
    queryKey: ['requests'], queryFn: apiClient.requests.list, enabled: role !== 'viewer', refetchInterval: 30_000,
  }).data?.filter((r) => r.status === 'pending').length ?? 0;
  const ROLE_LABEL: Record<Role, string> = { admin: 'Administrateur', member: 'Membre', viewer: 'Lecture seule' };

  return (
    <div className="app">
      <aside className={`sidebar ${menuOpen ? 'open' : ''}`} aria-label="Navigation">
        <div className="brand">
          <div className="brand-logo"><Logo /></div>
          <div className="brand-name">Motflix</div>
        </div>
        {role === 'admin' && <ServerPill />}
        <nav className="nav">
          {NAV.map((group) => ({ ...group, items: group.items.filter((i) => !i.roles || i.roles.includes(role)) }))
            .filter((group) => group.items.length > 0).map((group) => (
            <div key={group.label}>
              <div className="nav-label">{group.label}</div>
              {group.items.map(({ to, label, icon: Icon, soon }) =>
                soon ? (
                  <span key={to} className="nav-item soon" title="Arrive dans une prochaine version">
                    <Icon className="ic" strokeWidth={1.8} />{label}<span className="count">bientôt</span>
                  </span>
                ) : (
                  <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                    <Icon className="ic" strokeWidth={1.8} />{label}
                    {to === '/demandes' && pending > 0 && <span className="count accent-count">{pending}</span>}
                  </NavLink>
                ),
              )}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="avatar">{username.slice(0, 1) || '?'}</div>
          <div className="who"><b>{username}</b><span>{ROLE_LABEL[role]}</span></div>
          <button className="icon-btn sm" onClick={toggleTheme} title="Changer de thème" aria-label="Changer de thème">
            {theme === 'dark' ? <Sun className="ic ic-sm" /> : <Moon className="ic ic-sm" />}
          </button>
          {auth?.authEnabled && (
            <button className="icon-btn sm" onClick={logout} title="Se déconnecter" aria-label="Se déconnecter">
              <LogOut className="ic ic-sm" />
            </button>
          )}
        </div>
      </aside>
      {menuOpen && <div className="scrim" onClick={() => setMenuOpen(false)} />}

      <div className="main">
        <header className="topbar">
          <button className="icon-btn menu-btn" onClick={() => setMenuOpen(true)} aria-label="Ouvrir le menu">
            <Menu className="ic" />
          </button>
          <h1>{title}</h1>
          {location.pathname !== '/recherche' && role !== 'viewer' && (
            <form className="top-search" role="search" onSubmit={(e) => {
              e.preventDefault();
              const q = new FormData(e.currentTarget).get('q')?.toString().trim();
              if (q) navigate(`/recherche?kind=movie&q=${encodeURIComponent(q)}`);
            }}>
              <Search className="ic ic-sm dim" />
              <input name="q" placeholder="Rechercher un film, une série, un livre…" aria-label="Rechercher" />
            </form>
          )}
          <div className="right" style={location.pathname !== '/recherche' ? { marginLeft: 0 } : undefined}><VpnBadge /></div>
        </header>
        <main className="content" key={location.pathname}>{children}</main>
      </div>
    </div>
  );
}
