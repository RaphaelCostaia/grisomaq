import { env } from "../lib/server-env";
import type { CommodityId } from "../lib/market-types";

export type NoteEntry = { id: number; commodity: CommodityId; body: string; createdAt: string };

const COMMODITIES = new Set<CommodityId>(["milho", "soja", "boi"]);
const MAX_BODY = 2000;

let initialized = false;

async function ensureNotesTable() {
  if (initialized || !env.DB) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS user_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      commodity TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS user_notes_idx ON user_notes (username, commodity, created_at)"),
  ]);
  initialized = true;
}

function isCommodity(value: string): value is CommodityId {
  return COMMODITIES.has(value as CommodityId);
}

// Lista as anotações do usuário para uma commodity (mais recentes primeiro).
export async function listNotes(username: string, commodity: string): Promise<NoteEntry[]> {
  if (!env.DB || !isCommodity(commodity)) return [];
  await ensureNotesTable();
  const result = await env.DB
    .prepare("SELECT id, commodity, body, created_at AS createdAt FROM user_notes WHERE username = ? AND commodity = ? ORDER BY created_at DESC, id DESC")
    .bind(username.trim().toLowerCase(), commodity)
    .all<NoteEntry>();
  return result.results;
}

// Adiciona uma anotação. Retorna a entrada criada, ou null se inválida.
export async function addNote(username: string, commodity: string, body: string): Promise<NoteEntry | null> {
  if (!env.DB || !isCommodity(commodity)) return null;
  const text = body.trim().slice(0, MAX_BODY);
  if (!text) return null;
  await ensureNotesTable();
  const createdAt = new Date().toISOString();
  const info = await env.DB
    .prepare("INSERT INTO user_notes (username, commodity, body, created_at) VALUES (?, ?, ?, ?)")
    .bind(username.trim().toLowerCase(), commodity, text, createdAt)
    .run();
  return { id: Number(info.meta.last_row_id), commodity, body: text, createdAt };
}

// Remove uma anotação — escopada pelo dono (não apaga nota de outro usuário).
export async function deleteNote(username: string, id: number): Promise<void> {
  if (!env.DB || !Number.isFinite(id)) return;
  await ensureNotesTable();
  await env.DB
    .prepare("DELETE FROM user_notes WHERE id = ? AND username = ?")
    .bind(id, username.trim().toLowerCase())
    .run();
}
