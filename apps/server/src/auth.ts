// Comptes et sessions — facultatifs.
//
// Par défaut les comptes sont désactivés : le panel s'ouvre directement, et chaque
// requête agit en tant qu'administrateur. Ils s'activent dans Réglages › Utilisateurs,
// en définissant l'identifiant et le mot de passe de l'administrateur.
//
// Une fois activés : mot de passe haché en argon2id ; la session est un jeton aléatoire
// dans un cookie httpOnly, dont seul le hash SHA-256 est stocké en base.
import { createHash, randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthState, Role, UserInfo } from '@motflix/shared';
import type { Config } from './config.ts';
import type { Db } from './db.ts';
import { isAllowedHost, isSameOrigin } from './security.ts';
import { canAccess } from './permissions.ts';

export const SESSION_COOKIE = 'motflix_session';
const SESSION_DAYS = 30;
const USERNAME_RE = /^[a-zA-Z0-9._-]{3,32}$/;
const MIN_PASSWORD = 8;

// Limite des tentatives de connexion par adresse IP.
const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 15 * 60_000;

export interface SessionUser { id: number; username: string; role: Role }

const ROLES: Role[] = ['admin', 'member', 'viewer'];

/** Utilisateur implicite quand les comptes sont désactivés. */
const IMPLICIT_ADMIN: SessionUser = { id: 0, username: 'admin', role: 'admin' };

declare module 'fastify' {
  interface FastifyRequest { user: SessionUser | null }
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export class AuthError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function validateCredentials(username: string, password: string): void {
  if (!USERNAME_RE.test(username)) {
    throw new AuthError(400, "Nom d'utilisateur : 3 à 32 caractères (lettres, chiffres, . _ -).");
  }
  if (password.length < MIN_PASSWORD) {
    throw new AuthError(400, `Mot de passe : ${MIN_PASSWORD} caractères minimum.`);
  }
}

export class AuthStore {
  private db: Db;
  // Hash factice : vérifier un compte inexistant prend le même temps qu'un vrai.
  private dummyHash: Promise<string>;

  constructor(db: Db) {
    this.db = db;
    this.dummyHash = hash(randomBytes(16).toString('hex'));
  }

  setupDone(): boolean {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = 'setup_done'").get() as { value: string } | undefined;
    return row?.value === '1';
  }

  authEnabled(): boolean {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = 'auth_enabled'").get() as { value: string } | undefined;
    return row?.value === '1';
  }

  /**
   * Active les comptes avec cet administrateur (créé, ou son mot de passe remplacé
   * s'il existe déjà). Les autres comptes sont conservés ; les sessions sont fermées.
   */
  async enable(username: string, password: string): Promise<SessionUser> {
    validateCredentials(username, password);
    const passwordHash = await hash(password);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (this.authEnabled()) throw new AuthError(409, 'Les comptes sont déjà activés.');
      this.db.exec('DELETE FROM sessions');
      const existing = this.db.prepare('SELECT id FROM users WHERE username = ?').get(username) as { id: number } | undefined;
      let id: number;
      if (existing) {
        this.db.prepare("UPDATE users SET password_hash = ?, role = 'admin' WHERE id = ?").run(passwordHash, existing.id);
        id = existing.id;
      } else {
        id = Number(this.db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')").run(username, passwordHash).lastInsertRowid);
      }
      this.db.prepare("INSERT INTO settings (key, value) VALUES ('auth_enabled', '1') ON CONFLICT(key) DO UPDATE SET value = '1'").run();
      this.db.exec('COMMIT');
      return { id, username, role: 'admin' };
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  /** Désactive les comptes : le panel redevient accessible sans connexion. */
  disable(): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare("INSERT INTO settings (key, value) VALUES ('auth_enabled', '0') ON CONFLICT(key) DO UPDATE SET value = '0'").run();
      this.db.exec('DELETE FROM sessions');
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  async checkPassword(username: string, password: string): Promise<SessionUser | null> {
    const row = this.db
      .prepare('SELECT id, username, role, password_hash FROM users WHERE username = ?')
      .get(username) as { id: number; username: string; role: Role; password_hash: string } | undefined;
    const ok = await verify(row?.password_hash ?? (await this.dummyHash), password).catch(() => false);
    if (!row || !ok) return null;
    return { id: row.id, username: row.username, role: row.role };
  }

  createSession(userId: number): { token: string; expiresAt: number } {
    const token = randomBytes(32).toString('base64url');
    const now = Date.now();
    const expiresAt = now + SESSION_DAYS * 86_400_000;
    this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
    this.db
      .prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(sha256(token), userId, now, expiresAt);
    return { token, expiresAt };
  }

  sessionUser(token: string | undefined): SessionUser | null {
    if (!token) return null;
    const row = this.db
      .prepare(`SELECT u.id, u.username, u.role FROM sessions s JOIN users u ON u.id = s.user_id
                WHERE s.token_hash = ? AND s.expires_at > ?`)
      .get(sha256(token), Date.now()) as SessionUser | undefined;
    return row ?? null;
  }

  // ─── Comptes (Réglages › Utilisateurs) ────────────────────────────────

  listUsers(): UserInfo[] {
    return (this.db.prepare('SELECT id, username, role, created_at FROM users ORDER BY username').all() as
      { id: number; username: string; role: Role; created_at: string }[])
      .map((u) => ({ id: u.id, username: u.username, role: u.role, createdAt: `${u.created_at.replace(' ', 'T')}Z` }));
  }

  async createUser(username: string, password: string, role: Role): Promise<UserInfo> {
    validateCredentials(username, password);
    if (!ROLES.includes(role)) throw new AuthError(400, 'Rôle inconnu.');
    if (this.db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
      throw new AuthError(409, 'Ce nom d’utilisateur existe déjà.');
    }
    const id = Number(this.db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
      .run(username, await hash(password), role).lastInsertRowid);
    return this.listUsers().find((u) => u.id === id)!;
  }

  private adminCount(exceptId?: number): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND id != ?").get(exceptId ?? -1) as { n: number }).n;
  }

  async updateUser(id: number, changes: { role?: Role; password?: string }): Promise<void> {
    const user = this.db.prepare('SELECT id, role FROM users WHERE id = ?').get(id) as { id: number; role: Role } | undefined;
    if (!user) throw new AuthError(404, 'Utilisateur introuvable.');
    if (changes.role !== undefined) {
      if (!ROLES.includes(changes.role)) throw new AuthError(400, 'Rôle inconnu.');
      if (user.role === 'admin' && changes.role !== 'admin' && this.adminCount(id) === 0) {
        throw new AuthError(409, 'Il faut au moins un administrateur.');
      }
      this.db.prepare('UPDATE users SET role = ? WHERE id = ?').run(changes.role, id);
    }
    if (changes.password !== undefined) {
      if (changes.password.length < MIN_PASSWORD) throw new AuthError(400, `Mot de passe : ${MIN_PASSWORD} caractères minimum.`);
      this.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hash(changes.password), id);
      this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id); // reconnexion obligatoire
    }
  }

  deleteUser(id: number): void {
    const user = this.db.prepare('SELECT role FROM users WHERE id = ?').get(id) as { role: Role } | undefined;
    if (!user) throw new AuthError(404, 'Utilisateur introuvable.');
    if (user.role === 'admin' && this.adminCount(id) === 0) throw new AuthError(409, 'Il faut au moins un administrateur.');
    this.db.prepare('DELETE FROM users WHERE id = ?').run(id);
  }

  deleteSession(token: string | undefined): void {
    if (token) this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  }
}

/** Routes accessibles sans session quand les comptes sont activés. */
const PUBLIC_ROUTES = new Set(['/api/health', '/api/auth/state', '/api/auth/login']);

export function registerAuth(app: FastifyInstance, store: AuthStore, config: Config): void {
  const failures = new Map<string, { count: number; since: number }>();

  const cookieOptions = {
    path: '/',
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: config.secureCookies,
  };

  function startSession(reply: FastifyReply, user: SessionUser) {
    const { token, expiresAt } = store.createSession(user.id);
    reply.setCookie(SESSION_COOKIE, token, { ...cookieOptions, expires: new Date(expiresAt) });
  }

  function readCredentials(body: unknown): { username: string; password: string } {
    const b = (body ?? {}) as Record<string, unknown>;
    const username = typeof b.username === 'string' ? b.username.trim() : '';
    const password = typeof b.password === 'string' ? b.password : '';
    return { username, password };
  }

  app.decorateRequest('user', null);

  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    // Nom de domaine inconnu : probable « DNS rebinding » depuis un site malveillant.
    if (!isAllowedHost(req.headers.host, config.allowedHostnames)) {
      return reply.code(421).send({ error: 'Adresse non autorisée. Ajoutez ce nom à PANEL_HOSTNAMES dans le .env.' });
    }
    // Une requête qui modifie quelque chose doit venir de la page du panel elle-même.
    if (req.method !== 'GET' && req.method !== 'HEAD' && !isSameOrigin(req.headers.origin, req.headers.host)) {
      return reply.code(403).send({ error: 'Origine refusée.' });
    }
    if (!store.authEnabled()) {
      req.user = IMPLICIT_ADMIN;
      return;
    }
    req.user = store.sessionUser(req.cookies[SESSION_COOKIE]);
    const url = req.url.split('?')[0] ?? '';
    if (url.startsWith('/api/') && !PUBLIC_ROUTES.has(url) && !req.user) {
      return reply.code(401).send({ error: 'Connexion requise.' });
    }
    if (req.user && !canAccess(req.user.role, req.method, req.url)) {
      return reply.code(403).send({ error: 'Réservé à l’administrateur.' });
    }
  });

  app.get('/api/auth/state', async (req): Promise<AuthState> => ({
    authEnabled: store.authEnabled(),
    user: req.user ? { username: req.user.username, role: req.user.role } : null,
    setupDone: store.setupDone(),
  }));

  app.post('/api/auth/login', async (req, reply) => {
    if (!store.authEnabled()) return reply.code(400).send({ error: 'Les comptes ne sont pas activés.' });
    const ip = req.ip;
    const now = Date.now();
    const f = failures.get(ip);
    if (f && now - f.since < FAILURE_WINDOW_MS && f.count >= MAX_FAILURES) {
      return reply.code(429).send({ error: 'Trop de tentatives. Réessayez dans quelques minutes.' });
    }
    const { username, password } = readCredentials(req.body);
    const user = username && password ? await store.checkPassword(username, password) : null;
    if (!user) {
      const fresh = !f || now - f.since >= FAILURE_WINDOW_MS;
      failures.set(ip, { count: fresh ? 1 : f.count + 1, since: fresh ? now : f.since });
      return reply.code(401).send({ error: 'Identifiants incorrects.' });
    }
    failures.delete(ip);
    startSession(reply, user);
    return { username: user.username };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    store.deleteSession(req.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, cookieOptions);
    return { ok: true };
  });

  // Réglages › Utilisateurs : activer les comptes en créant l'administrateur.
  app.post('/api/auth/enable', async (req, reply) => {
    const { username, password } = readCredentials(req.body);
    try {
      const user = await store.enable(username, password);
      req.log.info({ username }, 'Comptes activés');
      startSession(reply, user); // l'administrateur reste connecté
      return { username: user.username };
    } catch (e) {
      if (e instanceof AuthError) return reply.code(e.status).send({ error: e.message });
      throw e;
    }
  });

  // ─── Comptes (administrateur) ──────────────────────────────────────────
  const fail = (reply: FastifyReply, e: unknown) => {
    if (e instanceof AuthError) return reply.code(e.status).send({ error: e.message });
    throw e;
  };

  app.get('/api/users', async () => store.listUsers());

  app.post('/api/users', async (req, reply) => {
    const b = (req.body ?? {}) as { username?: unknown; password?: unknown; role?: unknown };
    try {
      return await store.createUser(String(b.username ?? '').trim(), String(b.password ?? ''), b.role as Role);
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.post<{ Params: { id: string } }>('/api/users/:id', async (req, reply) => {
    const b = (req.body ?? {}) as { role?: unknown; password?: unknown };
    try {
      await store.updateUser(Number(req.params.id), {
        role: b.role === undefined ? undefined : (b.role as Role),
        password: typeof b.password === 'string' ? b.password : undefined,
      });
      return { ok: true };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.delete<{ Params: { id: string } }>('/api/users/:id', async (req, reply) => {
    try {
      store.deleteUser(Number(req.params.id));
      return { ok: true };
    } catch (e) {
      return fail(reply, e);
    }
  });

  // Seul un administrateur connecté peut désactiver les comptes (la route exige une session).
  app.post('/api/auth/disable', async (req, reply) => {
    if (!store.authEnabled()) return reply.code(409).send({ error: 'Les comptes sont déjà désactivés.' });
    store.disable();
    req.log.info({ by: req.user?.username }, 'Comptes désactivés');
    reply.clearCookie(SESSION_COOKIE, cookieOptions);
    return { ok: true };
  });
}
