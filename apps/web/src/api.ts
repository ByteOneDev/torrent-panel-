import type {
  AddRequest, ApplyResult, AuthState, MediaRequest, NewRequest, Role, UserInfo, BookFormat, ImportJobState, ImportMode, ImportSource, LanguagePreset, LibraryItem, MediaKind, SearchResult, TorrentAction, TorrentsResponse, ConfiguredIndexer, DashboardResponse, DownloadSettings, ServiceAccess, IndexerAddResult, IndexerDefinition, MediaPreferences, PlexPin, ServiceAction,
  ServicesResponse, SetupInfo, SetupRun, VpnSettings,
} from '@motflix/shared';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function call<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
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
  serviceAccess: (id: string) => call<ServiceAccess>('GET', `/api/services/${id}/access`),

  search: (kind: MediaKind, q: string) => call<SearchResult[]>('GET', `/api/search?kind=${kind}&q=${encodeURIComponent(q)}`),
  library: {
    add: (r: AddRequest) => call<{ detail: string }>('POST', '/api/library', r),
    movies: () => call<LibraryItem[]>('GET', '/api/library/movies'),
    series: () => call<LibraryItem[]>('GET', '/api/library/series'),
    books: (format: BookFormat) => call<LibraryItem[]>('GET', `/api/library/books?format=${format}`),
    searchAgain: (kind: MediaKind, id: string, format?: BookFormat) =>
      call<{ ok: true }>('POST', `/api/library/${kind}/${encodeURIComponent(id)}/search${format ? `?format=${format}` : ''}`, {}),
    setLanguage: (kind: MediaKind, id: string, language: LanguagePreset) =>
      call<{ ok: true }>('PUT', `/api/library/${kind}/${encodeURIComponent(id)}/language`, { language }),
    remove: (kind: MediaKind, id: string, deleteFiles: boolean, format?: BookFormat) =>
      call<{ ok: true }>('DELETE', `/api/library/${kind}/${encodeURIComponent(id)}?deleteFiles=${deleteFiles}${format ? `&format=${format}` : ''}`),
  },
  users: {
    list: () => call<UserInfo[]>('GET', '/api/users'),
    create: (username: string, password: string, role: Role) => call<UserInfo>('POST', '/api/users', { username, password, role }),
    update: (id: number, changes: { role?: Role; password?: string }) => call<{ ok: true }>('POST', `/api/users/${id}`, changes),
    remove: (id: number) => call<{ ok: true }>('DELETE', `/api/users/${id}`),
  },
  requests: {
    list: () => call<MediaRequest[]>('GET', '/api/requests'),
    create: (r: NewRequest) => call<MediaRequest>('POST', '/api/requests', r),
    approve: (id: number) => call<MediaRequest>('POST', `/api/requests/${id}/approve`, {}),
    reject: (id: number, note?: string) => call<MediaRequest>('POST', `/api/requests/${id}/reject`, { note }),
    cancel: (id: number) => call<{ ok: true }>('DELETE', `/api/requests/${id}`),
    settings: () => call<{ autoApprove: boolean }>('GET', '/api/settings/requests'),
    saveSettings: (autoApprove: boolean) => call<{ autoApprove: boolean }>('POST', '/api/settings/requests', { autoApprove }),
  },
  import: {
    sources: () => call<ImportSource[]>('GET', '/api/import/sources'),
    status: () => call<ImportJobState>('GET', '/api/import/status'),
    analyze: (sourceId: string) => call<ImportJobState>('POST', '/api/import/analyze', { sourceId }),
    run: (movies: string[], series: string[], mode: ImportMode, upgrade: boolean) =>
      call<ImportJobState>('POST', '/api/import/run', { movies, series, mode, upgrade }),
    reset: () => call<ImportJobState>('POST', '/api/import/reset', {}),
  },
  downloads: {
    list: () => call<TorrentsResponse>('GET', '/api/downloads'),
    act: (hash: string, action: TorrentAction, deleteFiles = false) =>
      call<{ ok: true }>('POST', `/api/downloads/${hash}/${action}${action === 'delete' ? `?deleteFiles=${deleteFiles}` : ''}`, {}),
  },

  settings: {
    preferences: () => call<MediaPreferences>('GET', '/api/settings/preferences'),
    savePreferences: (p: MediaPreferences) => call<ApplyResult>('POST', '/api/settings/preferences', p),
    downloads: () => call<DownloadSettings>('GET', '/api/settings/downloads'),
    saveDownloads: (d: DownloadSettings) => call<DownloadSettings>('POST', '/api/settings/downloads', d),
    indexers: () => call<ConfiguredIndexer[]>('GET', '/api/settings/indexers'),
    setIndexer: (id: number, enabled: boolean) => call<{ ok: true }>('POST', `/api/settings/indexers/${id}`, { enabled }),
    deleteIndexer: (id: number) => call<{ ok: true }>('DELETE', `/api/settings/indexers/${id}`),
    applyPlex: () => call<ApplyResult>('POST', '/api/settings/plex', {}),
  },

  setup: {
    info: () => call<SetupInfo>('GET', '/api/setup'),
    savePreferences: (p: MediaPreferences) => call<MediaPreferences>('POST', '/api/setup/preferences', p),
    plexPin: () => call<PlexPin>('POST', '/api/setup/plex/pin', {}),
    plexPinStatus: (id: number) => call<{ linked: boolean; account: string | null }>('GET', `/api/setup/plex/pin/${id}`),
    plexUnlink: () => call<{ ok: true }>('POST', '/api/setup/plex/unlink', {}),
    audiobookshelf: (username: string, password: string) =>
      call<{ ok: true }>('POST', '/api/setup/audiobookshelf', { username, password }),
    vpnProviders: () => call<string[]>('GET', '/api/setup/vpn/providers'),
    applyVpn: (v: VpnSettings) =>
      call<{ id: string; agentInstalled: boolean; applyCommand: string }>('POST', '/api/setup/vpn', v),
    indexerDefinitions: () => call<IndexerDefinition[]>('GET', '/api/setup/indexers'),
    addIndexers: (names: string[]) => call<IndexerAddResult[]>('POST', '/api/setup/indexers', { names }),
    run: () => call<SetupRun>('POST', '/api/setup/run', {}),
    runStatus: () => call<SetupRun>('GET', '/api/setup/run'),
    finish: () => call<{ ok: true }>('POST', '/api/setup/finish', {}),
  },
};
