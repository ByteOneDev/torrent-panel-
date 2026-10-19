// Base SQLite du panel : réglages propres au panel, comptes et sessions.
// Les réglages des outils (Radarr, Sonarr…) restent dans les outils.
import { chmodSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

export function openDb(file: string): Db {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  // Contient le jeton Plex et des mots de passe : lisible par son seul propriétaire.
  if (file !== ':memory:') {
    for (const f of [file, `${file}-wal`, `${file}-shm`]) { try { chmodSync(f, 0o600); } catch { /* pas encore créé */ } }
  }
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY,
      username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT    NOT NULL,
      role          TEXT    NOT NULL DEFAULT 'admin',
      created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS requests (
      id          INTEGER PRIMARY KEY,
      user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
      username    TEXT    NOT NULL,
      kind        TEXT    NOT NULL,
      key         TEXT    NOT NULL,
      title       TEXT    NOT NULL,
      year        INTEGER,
      poster      TEXT,
      language    TEXT    NOT NULL DEFAULT 'default',
      formats     TEXT    NOT NULL DEFAULT '[]',
      status      TEXT    NOT NULL DEFAULT 'pending',
      note        TEXT,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      decided_at  TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT    PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
  `);
  return db;
}
