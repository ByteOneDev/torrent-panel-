// Plex : connexion au compte (flux officiel « code PIN » de plex.tv), réclamation du
// serveur, bibliothèques Films et Séries.
//
// 1. Le panel demande un PIN à plex.tv et ouvre la page de connexion Plex.
// 2. L'utilisateur se connecte ; le panel récupère le jeton de son compte.
// 3. Avec ce jeton, le panel obtient un code de réclamation et l'envoie au serveur local
//    (POST /myplex/claim) : le serveur appartient alors au compte, sans recréer le conteneur.
import { randomUUID } from 'node:crypto';
import type { PlexPin } from '@motflix/shared';
import type { Settings } from '../settings.ts';
import type { Agent } from './agent.ts';

const PLEX_TV = 'https://plex.tv';
const TIMEOUT_MS = 15_000;

export class PlexClient {
  private settings: Settings;
  private serverUrl: string;
  private agent: Agent | null;

  constructor(settings: Settings, serverUrl: string, agent: Agent | null = null) {
    this.settings = settings;
    this.serverUrl = serverUrl;
    this.agent = agent;
  }

  private clientId(): string {
    let id = this.settings.get('plex_client_id');
    if (!id) { id = randomUUID(); this.settings.set('plex_client_id', id); }
    return id;
  }

  private headers(token?: string): Record<string, string> {
    return {
      Accept: 'application/json',
      'X-Plex-Product': 'Motflix',
      'X-Plex-Version': '0.1.0',
      'X-Plex-Client-Identifier': this.clientId(),
      ...(token ? { 'X-Plex-Token': token } : {}),
    };
  }

  private async req<T>(method: string, url: string, token?: string): Promise<T> {
    const res = await fetch(url, { method, headers: this.headers(token), signal: AbortSignal.timeout(TIMEOUT_MS) });
    const text = await res.text();
    if (!res.ok) throw new Error(`Plex a répondu ${res.status}${text ? ` : ${text.slice(0, 160)}` : ''}`);
    return (text ? JSON.parse(text) : {}) as T;
  }

  get accountToken(): string | null { return this.settings.get('plex_token'); }
  get accountName(): string | null { return this.settings.get('plex_account'); }

  // ─── Connexion au compte ──────────────────────────────────────────────

  async createPin(): Promise<PlexPin> {
    const pin = await this.req<{ id: number; code: string }>('POST', `${PLEX_TV}/api/v2/pins?strong=true`);
    const qs = new URLSearchParams({ clientID: this.clientId(), code: pin.code, 'context[device][product]': 'Motflix' });
    return { id: pin.id, code: pin.code, authUrl: `https://app.plex.tv/auth#?${qs}` };
  }

  /** Vrai une fois l'utilisateur connecté sur plex.tv ; le jeton est alors enregistré. */
  async checkPin(id: number): Promise<boolean> {
    const pin = await this.req<{ authToken: string | null }>('GET', `${PLEX_TV}/api/v2/pins/${id}`);
    if (!pin.authToken) return false;
    const user = await this.req<{ username?: string; email?: string }>('GET', `${PLEX_TV}/api/v2/user`, pin.authToken);
    this.settings.set('plex_token', pin.authToken);
    this.settings.set('plex_account', user.username || user.email || 'compte Plex');
    return true;
  }

  // ─── Serveur local ────────────────────────────────────────────────────

  async identity(): Promise<{ claimed: boolean } | null> {
    try {
      const r = await this.req<{ MediaContainer: { claimed: boolean } }>('GET', `${this.serverUrl}/identity`);
      return { claimed: r.MediaContainer.claimed };
    } catch {
      return null;
    }
  }

  private async claim(token: string): Promise<void> {
    const { token: claimToken } = await this.req<{ token: string }>('GET', `${PLEX_TV}/api/claim/token.json`, token);
    try {
      await this.req('POST', `${this.serverUrl}/myplex/claim?token=${encodeURIComponent(claimToken)}`);
    } catch (e) {
      // Plex n'accepte la réclamation que depuis sa propre machine : l'agent hôte s'en charge.
      if (!this.agent || !/401/.test((e as Error).message)) throw e;
      const id = this.agent.submit({ PLEX_CLAIM: claimToken });
      const result = await this.agent.waitFor(id, 60_000);
      if (!result) {
        throw new Error(this.agent.installed()
          ? "L'agent de Motflix n'a pas répondu à temps. Réessayez."
          : `Pour lier Plex, lancez dans un terminal : ${this.agent.applyCommand()} (puis réessayez).`);
      }
      if (!result.ok) throw new Error(result.message);
    }
    for (let i = 0; i < 20; i++) {
      if ((await this.identity())?.claimed) return;
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error("Le serveur Plex n'a pas confirmé la liaison au compte.");
  }

  /** Lie le serveur au compte si besoin, puis crée les bibliothèques manquantes. */
  async setUpServer(): Promise<string> {
    const token = this.accountToken;
    if (!token) throw new Error('Compte Plex non connecté.');
    const id = await this.identity();
    if (!id) throw new Error('Le serveur Plex ne répond pas.');
    const steps: string[] = [];
    if (!id.claimed) { await this.claim(token); steps.push('serveur lié au compte'); }

    let sections: { title: string; type: string }[];
    try {
      sections = (await this.req<{ MediaContainer: { Directory?: { title: string; type: string }[] } }>(
        'GET', `${this.serverUrl}/library/sections`, token)).MediaContainer.Directory ?? [];
    } catch {
      throw new Error('Ce serveur Plex appartient à un autre compte que celui connecté.');
    }

    const wanted = [
      { title: 'Films', type: 'movie', agent: 'tv.plex.agents.movie', scanner: 'Plex Movie', location: '/data/media/films' },
      { title: 'Séries', type: 'show', agent: 'tv.plex.agents.series', scanner: 'Plex TV Series', location: '/data/media/series' },
    ];
    for (const w of wanted) {
      if (sections.some((s) => s.type === w.type && s.title === w.title)) continue;
      const qs = new URLSearchParams({ name: w.title, type: w.type, agent: w.agent, scanner: w.scanner, language: 'fr-FR', location: w.location });
      await this.req('POST', `${this.serverUrl}/library/sections?${qs}`, token);
      steps.push(`bibliothèque « ${w.title} » créée`);
    }
    return steps.length ? steps.join(' · ') : 'Bibliothèques Films et Séries déjà en place';
  }

  /** Adresse que Radarr / Sonarr utilisent pour joindre Plex (même hôte que le panel). */
  arrTarget(): { host: string; port: number } {
    const u = new URL(this.serverUrl);
    return { host: u.hostname, port: Number(u.port) || 32400 };
  }
}
