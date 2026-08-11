// Backup manual do SQLite: `npm run backup`.
// Gera uma cópia em data/backups/ e mostra o caminho.
import Database from "better-sqlite3";
import { mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const KEEP = 14;
const PREFIX = "grisomaq-";
const path = resolve(process.env.GRISOMAQ_DB_PATH ?? "./data/grisomaq.db");
const dir = join(dirname(path), "backups");
mkdirSync(dir, { recursive: true });

const p = (n) => String(n).padStart(2, "0");
const d = new Date();
const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
const dest = join(dir, `${PREFIX}${stamp}.db`);

const db = new Database(path, { readonly: true });
await db.backup(dest);
db.close();

const files = readdirSync(dir)
  .filter((f) => f.startsWith(PREFIX) && f.endsWith(".db"))
  .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
  .sort((a, b) => b.t - a.t);
for (const { f } of files.slice(KEEP)) {
  try {
    unlinkSync(join(dir, f));
  } catch {}
}

console.log("Backup criado:", dest);
