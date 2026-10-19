// Audiobookshelf : compte administrateur (créé à la première utilisation) et bibliothèques.
// Ce compte sert aussi à se connecter depuis l'appli mobile : l'assistant l'affiche.
import type { Settings } from '../settings.ts';

const TIMEOUT_MS = 15_000;

interface Library { id: string; name: string; folders: { fullPath: string }[] }

export class AudiobookshelfClient {
  private url: string;
  private settings: Settings;

  constructor(settings: Settings, url: string) {
    this.settings = settings;
    this.url = url;
  }

  private async req<T>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
    const res = await fetch(this.url + path, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Audiobookshelf a répondu ${res.status}${text ? ` : ${text.slice(0, 160)}` : ''}`);
    // Certaines routes (/init) répondent « OK » en texte brut.
    try { return (text ? JSON.parse(text) : {}) as T; } catch { return {} as T; }
  }

  async status(): Promise<{ initialized: boolean } | null> {
    try {
      const s = await this.req<{ isInit: boolean }>('GET', '/status');
      return { initialized: s.isInit };
    } catch {
      return null;
    }
  }

  get credentials(): { username: string; password: string } | null {
    const username = this.settings.get('abs_username');
    const password = this.settings.get('abs_password');
    return username && password ? { username, password } : null;
  }

  saveCredentials(username: string, password: string): void {
    this.settings.set('abs_username', username);
    this.settings.set('abs_password', password);
  }

  async setUp(): Promise<string> {
    const status = await this.status();
    if (!status) throw new Error('Audiobookshelf ne répond pas.');
    const creds = this.credentials;
    if (!creds) throw new Error('Aucun identifiant choisi pour Audiobookshelf.');

    const steps: string[] = [];
    if (!status.initialized) {
      await this.req('POST', '/init', { newRoot: { username: creds.username, password: creds.password } });
      this.settings.set('abs_managed', '1');
      steps.push(`compte « ${creds.username} » créé`);
    }

    const login = await this.req<{ user: { token?: string; accessToken?: string } }>('POST', '/login', creds)
      .catch(() => { throw new Error('Audiobookshelf existait déjà avec un autre mot de passe : bibliothèques non créées.'); });
    const token = login.user.accessToken ?? login.user.token;
    if (!token) throw new Error("Audiobookshelf n'a pas renvoyé de jeton de connexion.");

    const { libraries } = await this.req<{ libraries: Library[] }>('GET', '/api/libraries', undefined, token);
    const wanted = [
      { name: 'Livres audio', path: '/data/media/livres-audio', icon: 'audiobookshelf', provider: 'audible.fr' },
      { name: 'Livres', path: '/data/media/livres', icon: 'books-1', provider: 'google' },
    ];
    for (const w of wanted) {
      if (libraries.some((l) => l.folders.some((f) => f.fullPath === w.path))) continue;
      await this.req('POST', '/api/libraries', {
        name: w.name, folders: [{ fullPath: w.path }], icon: w.icon, mediaType: 'book', provider: w.provider,
      }, token);
      steps.push(`bibliothèque « ${w.name} »`);
    }
    return steps.length ? steps.join(' · ') : 'Bibliothèques déjà en place';
  }
}
