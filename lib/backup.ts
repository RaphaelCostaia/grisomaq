// Backup automático do SQLite. O banco (usuários + histórico de preços) fica num
// volume único no Easypanel; sem backup, corrupção = perda total. Aqui fazemos
// backup online (`.backup()` do better-sqlite3, seguro com WAL) para
// `data/backups/`, mantendo os últimos N e rodando a cada 24h.
import { rawDb, dbPath } from "./server-env";
import { mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";

const KEEP = 14; // últimos 14 backups (~2 semanas se diário)
const INTERVAL_MS = 24 * 60 * 60 * 1000;
const PREFIX = "grisomaq-";

function backupsDir(): string {
  return join(dirname(dbPath()), "backups");
}

function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

export async function runBackup(): Promise<string> {
  const dir = backupsDir();
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, `${PREFIX}${stamp()}.db`);
  await rawDb().backup(dest);
  pruneOldBackups();
  return dest;
}

function pruneOldBackups(): void {
  const dir = backupsDir();
  const files = readdirSync(dir)
    .filter((f) => f.startsWith(PREFIX) && f.endsWith(".db"))
    .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  for (const { f } of files.slice(KEEP)) {
    try {
      unlinkSync(join(dir, f));
    } catch {
      // ignora falha de remoção; não é crítico
    }
  }
}

let started = false;

// Inicia o agendador uma única vez (chamado pela instrumentation do Next.js).
export function startBackupScheduler(): void {
  if (started) return;
  started = true;
  // Primeiro backup logo após subir (dá tempo do banco abrir), depois a cada 24h.
  setTimeout(() => {
    void runBackup().catch((e) => console.error("[backup] falhou:", e));
  }, 30_000);
  const timer = setInterval(() => {
    void runBackup().catch((e) => console.error("[backup] falhou:", e));
  }, INTERVAL_MS);
  // Não segura o processo vivo por causa do timer.
  if (typeof timer.unref === "function") timer.unref();
}
