import { env } from "../lib/server-env";
import { hashPassword, verifyPassword } from "../lib/auth-hash";

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
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS login_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      ip TEXT NOT NULL,
      at TEXT NOT NULL
    )`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS login_attempts_idx ON login_attempts (username, at)"),
  ]);
  initialized = true;
}

export function readSessionToken(request: Request): string | null {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)gq_session=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function readClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") ?? "desconhecido";
}

const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX_ATTEMPTS = 5; // por usuário
const RATE_MAX_PER_IP = 20; // por IP (cobre ataque que varia o nome de usuário)

// Bloqueia força-bruta em 15 min: 5 tentativas falhas no mesmo usuário OU 20
// tentativas falhas vindas do mesmo IP (barra quem varia o nome de usuário).
export async function checkLoginRateLimit(username: string, ip?: string): Promise<{ blocked: boolean; retryAfterSec: number }> {
  if (!env.DB) return { blocked: false, retryAfterSec: 0 };
  await ensureAuthTables();
  const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();

  const byUser = await env.DB
    .prepare("SELECT COUNT(*) AS count, MIN(at) AS oldest FROM login_attempts WHERE username = ? AND at >= ?")
    .bind(username.trim().toLowerCase(), since)
    .first<{ count: number; oldest: string | null }>();

  const byIp = ip && ip !== "desconhecido"
    ? await env.DB
        .prepare("SELECT COUNT(*) AS count, MIN(at) AS oldest FROM login_attempts WHERE ip = ? AND at >= ?")
        .bind(ip, since)
        .first<{ count: number; oldest: string | null }>()
    : null;

  const userBlocked = Number(byUser?.count ?? 0) >= RATE_MAX_ATTEMPTS;
  const ipBlocked = Number(byIp?.count ?? 0) >= RATE_MAX_PER_IP;
  if (!userBlocked && !ipBlocked) return { blocked: false, retryAfterSec: 0 };

  // Usa a tentativa mais antiga da dimensão que bloqueou para calcular o Retry-After.
  const oldestCandidates = [
    userBlocked && byUser?.oldest ? Date.parse(byUser.oldest) : null,
    ipBlocked && byIp?.oldest ? Date.parse(byIp.oldest) : null,
  ].filter((v): v is number => v !== null);
  const oldestMs = oldestCandidates.length ? Math.min(...oldestCandidates) : Date.now();
  return { blocked: true, retryAfterSec: Math.max(1, Math.ceil((oldestMs + RATE_WINDOW_MS - Date.now()) / 1000)) };
}

export async function recordFailedLogin(username: string, ip: string) {
  if (!env.DB) return;
  await ensureAuthTables();
  await env.DB
    .prepare("INSERT INTO login_attempts (username, ip, at) VALUES (?, ?, ?)")
    .bind(username.trim().toLowerCase(), ip, new Date().toISOString())
    .run();
  await env.DB
    .prepare("DELETE FROM login_attempts WHERE at < ?")
    .bind(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .run();
}

export async function clearLoginAttempts(username: string) {
  if (!env.DB) return;
  await ensureAuthTables();
  await env.DB.prepare("DELETE FROM login_attempts WHERE username = ?").bind(username.trim().toLowerCase()).run();
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

// Troca de senha: exige a senha atual correta. Retorna motivo do erro ou null (ok).
export async function updatePassword(
  username: string,
  currentPassword: string,
  newPassword: string,
): Promise<"invalid_current" | "weak" | null> {
  if (!env.DB) return "invalid_current";
  await ensureAuthTables();
  if (newPassword.length < 8) return "weak";
  const user = await verifyCredentials(username, currentPassword);
  if (!user) return "invalid_current";
  const hash = await hashPassword(newPassword);
  await env.DB
    .prepare("UPDATE users SET password_hash = ? WHERE username = ?")
    .bind(hash, username.trim().toLowerCase())
    .run();
  return null;
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

// Encerra todas as sessões do usuário, exceto a atual (usado após trocar senha).
export async function deleteOtherSessions(username: string, keepToken: string) {
  if (!env.DB) return;
  await env.DB
    .prepare("DELETE FROM sessions WHERE username = ? AND token != ?")
    .bind(username.trim().toLowerCase(), keepToken)
    .run();
}
