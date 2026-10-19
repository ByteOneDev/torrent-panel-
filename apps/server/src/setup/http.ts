// Petit client HTTP pour les API des outils (Radarr, Sonarr, Prowlarr…).

const TIMEOUT_MS = 30_000;

export class ToolError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Les *arr renvoient les erreurs de validation sous forme de liste. */
function errorMessage(status: number, text: string): string {
  try {
    const data = JSON.parse(text) as unknown;
    if (Array.isArray(data)) {
      const msgs = data.map((e) => (e as { errorMessage?: string }).errorMessage).filter(Boolean);
      if (msgs.length) return msgs.join(' ; ');
    }
    const d = data as { message?: string; error?: string; description?: string };
    if (d.message || d.error || d.description) return String(d.message ?? d.error ?? d.description);
  } catch { /* texte brut */ }
  return text.slice(0, 300) || `Réponse ${status}`;
}

export interface JsonClient {
  get<T>(path: string, timeoutMs?: number): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  put<T>(path: string, body?: unknown): Promise<T>;
  del(path: string): Promise<void>;
}

export function jsonClient(baseUrl: string, headers: Record<string, string> = {}): JsonClient {
  async function call<T>(method: string, path: string, body?: unknown, timeoutMs = TIMEOUT_MS): Promise<T> {
    let res: Response;
    try {
      res = await fetch(baseUrl + path, {
        method,
        headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      const timedOut = (e as Error).name === 'TimeoutError';
      throw new ToolError(0, `${new URL(baseUrl).host} ${timedOut ? 'met trop de temps à répondre' : `ne répond pas (${(e as Error).message})`}`);
    }
    const text = await res.text();
    if (!res.ok) throw new ToolError(res.status, errorMessage(res.status, text));
    return (text ? JSON.parse(text) : undefined) as T;
  }
  return {
    get: (p, t) => call('GET', p, undefined, t),
    post: (p, b) => call('POST', p, b ?? {}),
    put: (p, b) => call('PUT', p, b ?? {}),
    del: async (p) => { await call('DELETE', p); },
  };
}

/** Champs « fields » des *arr : [{ name, value }]. */
export interface FieldsObject {
  fields: { name: string; value?: unknown }[];
  [key: string]: unknown;
}

export function setFields<T extends FieldsObject>(obj: T, values: Record<string, unknown>): T {
  for (const f of obj.fields) if (f.name in values) f.value = values[f.name];
  return obj;
}

export function fieldValue(obj: FieldsObject, name: string): unknown {
  return obj.fields.find((f) => f.name === name)?.value;
}
