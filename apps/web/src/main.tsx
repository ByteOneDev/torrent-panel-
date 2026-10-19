import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from './api.ts';
import type { Role } from '@motflix/shared';
import { RequestsPage } from './pages/RequestsPage.tsx';
import { useAuthState } from './hooks.ts';
import { LoginPage } from './pages/AuthPage.tsx';
import { DashboardPage } from './pages/DashboardPage.tsx';
import { ServicesPage } from './pages/ServicesPage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';
import { WizardPage } from './pages/WizardPage.tsx';
import { DownloadsPage } from './pages/DownloadsPage.tsx';
import { LibraryPage } from './pages/LibraryPage.tsx';
import { SearchPage } from './pages/SearchPage.tsx';
import { ImportPage } from './pages/ImportPage.tsx';
import { ToastProvider } from './ui.tsx';
import './styles.css';

// Session expirée : on revient à l'écran de connexion.
const onError = (e: unknown) => {
  if (e instanceof ApiError && e.status === 401) void queryClient.invalidateQueries({ queryKey: ['auth'] });
};
const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({ onError }),
  mutationCache: new MutationCache({ onError }),
  defaultOptions: { queries: { retry: (n, e) => !(e instanceof ApiError && e.status === 401) && n < 2 } },
});

function Loading() {
  return <div className="auth-page"><div className="dim">Chargement…</div></div>;
}

const ADMIN: Role[] = ['admin'];
const MEMBERS: Role[] = ['admin', 'member'];

function Gate({ children, setup = false, roles }: { children: ReactNode; setup?: boolean; roles?: Role[] }) {
  const { data, error } = useAuthState();
  if (error) return <div className="auth-page"><div className="alert">{(error as Error).message}</div></div>;
  if (!data) return <Loading />;
  // Comptes désactivés (par défaut) : le serveur nous traite déjà en administrateur.
  if (!data.user) return <Navigate to="/connexion" replace />;
  // Page réservée : les membres et la lecture seule arrivent sur les films.
  if (roles && !roles.includes(data.user.role)) return <Navigate to="/films" replace />;
  // Premier lancement : l'assistant d'abord (administrateur seulement).
  if (!data.setupDone && !setup && data.user.role === 'admin') return <Navigate to="/assistant" replace />;
  return children;
}

function LoginRoute() {
  const { data } = useAuthState();
  if (!data) return <Loading />;
  if (data.user) return <Navigate to="/" replace />;
  return <LoginPage />;
}

// Application installable : le service worker n'est accepté par les navigateurs qu'en
// HTTPS ou sur localhost. Sur une adresse locale en HTTP, « Ajouter à l'écran d'accueil »
// reste possible (raccourci plein écran), sans le mode hors ligne.
if (import.meta.env.PROD && 'serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => { void navigator.serviceWorker.register('/sw.js'); });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/connexion" element={<LoginRoute />} />
            <Route path="/assistant" element={<Gate setup roles={ADMIN}><WizardPage /></Gate>} />
            <Route path="/" element={<Gate roles={ADMIN}><DashboardPage /></Gate>} />
            <Route path="/services" element={<Gate roles={ADMIN}><ServicesPage /></Gate>} />
            <Route path="/services/:id" element={<Gate roles={ADMIN}><ServicesPage /></Gate>} />
            <Route path="/recherche" element={<Gate roles={MEMBERS}><SearchPage /></Gate>} />
            <Route path="/demandes" element={<Gate roles={MEMBERS}><RequestsPage /></Gate>} />
            <Route path="/films" element={<Gate><LibraryPage key="films" kind="movie" title="Films" /></Gate>} />
            <Route path="/series" element={<Gate><LibraryPage key="series" kind="series" title="Séries" /></Gate>} />
            <Route path="/livres" element={<Gate><LibraryPage key="livres" kind="book" format="eBook" title="Livres" /></Gate>} />
            <Route path="/livres-audio" element={<Gate><LibraryPage key="audio" kind="book" format="AudioBook" title="Livres audio" /></Gate>} />
            <Route path="/importer" element={<Gate roles={ADMIN}><ImportPage /></Gate>} />
            <Route path="/telechargements" element={<Gate><DownloadsPage /></Gate>} />
            <Route path="/reglages" element={<Navigate to="/reglages/langue" replace />} />
            <Route path="/reglages/:section" element={<Gate roles={ADMIN}><SettingsPage /></Gate>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
