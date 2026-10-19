import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from './api.ts';
import { useAuthState } from './hooks.ts';
import { LoginPage } from './pages/AuthPage.tsx';
import { DashboardPage } from './pages/DashboardPage.tsx';
import { ServicesPage } from './pages/ServicesPage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';
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

function Gate({ children }: { children: ReactNode }) {
  const { data, error } = useAuthState();
  if (error) return <div className="auth-page"><div className="alert">{(error as Error).message}</div></div>;
  if (!data) return <Loading />;
  // Comptes désactivés (par défaut) : le serveur nous traite déjà en administrateur.
  if (!data.user) return <Navigate to="/connexion" replace />;
  return children;
}

function LoginRoute() {
  const { data } = useAuthState();
  if (!data) return <Loading />;
  if (data.user) return <Navigate to="/" replace />;
  return <LoginPage />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/connexion" element={<LoginRoute />} />
            <Route path="/" element={<Gate><DashboardPage /></Gate>} />
            <Route path="/services" element={<Gate><ServicesPage /></Gate>} />
            <Route path="/services/:id" element={<Gate><ServicesPage /></Gate>} />
            <Route path="/reglages" element={<Navigate to="/reglages/utilisateurs" replace />} />
            <Route path="/reglages/utilisateurs" element={<Gate><SettingsPage /></Gate>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
