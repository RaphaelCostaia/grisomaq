import { env } from "../lib/server-env";
import { verifyPassword } from "../lib/auth-hash";

export type AuthUser = { id: number; username: string };

let initialized = false;

async function ensureAuthTables() {
  if (initialized || !env.DB) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      username TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id)"),
  ]);
  initialized = true;
}

export function readSessionToken(request: Request): string | null {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)gq_session=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export async function verifyCredentials(username: string, password: string): Promise<AuthUser | null> {
  if (!env.DB) return null;
  await ensureAuthTables();
  const row = await env.DB
    .prepare("SELECT id, username, password_hash FROM users WHERE username = ?")
    .bind(username.trim().toLowerCase())
    .first<{ id: number; username: string; password_hash: string }>();
  if (!row) return null;
  const ok = await verifyPassword(password, row.password_hash);
  return ok ? { id: row.id, username: row.username } : null;
}

export async function createSession(user: AuthUser, days = 7): Promise<{ token: string; expiresAt: string }> {
  await ensureAuthTables();
  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
  const now = Date.now();
  const expiresAt = new Date(now + days * 24 * 60 * 60 * 1000).toISOString();
  await env.DB
    .prepare("INSERT INTO sessions (token, user_id, username, expires_at, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(token, user.id, user.username, expiresAt, new Date(now).toISOString())
    .run();
  // Limpeza oportunista de sessões expiradas.
  await env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(new Date(now).toISOString()).run();
  return { token, expiresAt };
}

export async function getSessionUser(token: string | null): Promise<AuthUser | null> {
  if (!env.DB || !token) return null;
  await ensureAuthTables();
  const row = await env.DB
    .prepare("SELECT user_id, username, expires_at FROM sessions WHERE token = ?")
    .bind(token)
    .first<{ user_id: number; username: string; expires_at: string }>();
  if (!row) return null;
  if (Date.parse(row.expires_at) < Date.now()) {
    await deleteSession(token);
    return null;
  }
  return { id: row.user_id, username: row.username };
}

export async function deleteSession(token: string | null) {
  if (!env.DB || !token) return;
  await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
}
