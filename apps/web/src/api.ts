import type { AuthState, DashboardResponse, ServiceAction, ServicesResponse } from '@motflix/shared';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Le panel ne répond pas. Vérifiez que Motflix est démarré.');
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Erreur ${res.status}`);
  return data as T;
}

export const api = {
  authState: () => call<AuthState>('GET', '/api/auth/state'),
  enableAccounts: (username: string, password: string) =>
    call<{ username: string }>('POST', '/api/auth/enable', { username, password }),
  disableAccounts: () => call<{ ok: true }>('POST', '/api/auth/disable', {}),
  login: (username: string, password: string) => call<{ username: string }>('POST', '/api/auth/login', { username, password }),
  logout: () => call<{ ok: true }>('POST', '/api/auth/logout', {}),
  services: () => call<ServicesResponse>('GET', '/api/services'),
  serviceAction: (id: string, action: ServiceAction) => call<{ ok: true }>('POST', `/api/services/${id}/${action}`, {}),
  dashboard: () => call<DashboardResponse>('GET', '/api/dashboard'),
};
