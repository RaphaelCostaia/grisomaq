// Cria (ou atualiza a senha de) um usuário do painel Grisomaq no banco SQLite.
// Uso:
//   npm run criar-usuario -- <usuario> [senha]
// Se a senha for omitida, ela é solicitada de forma oculta.
// O banco é o mesmo do servidor (GRISOMAQ_DB_PATH ou ./data/grisomaq.db).
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import readline from "node:readline";
import { hashPassword } from "../lib/auth-hash.ts";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const username = (args[0] ?? "").trim().toLowerCase();
let password = args[1] ?? "";

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

if (!username) fail("Informe o usuário: npm run criar-usuario -- <usuario> [senha]");
if (!/^[a-z0-9._-]{2,40}$/.test(username)) {
  fail("Usuário inválido. Use de 2 a 40 caracteres: letras minúsculas, números, ponto, hífen ou sublinhado.");
}

function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl._writeToOutput = (str) => {
      if (str.includes("\n")) rl.output.write("\n");
      else if (str.startsWith(question)) rl.output.write(question);
      else rl.output.write("*");
    };
    rl.question(question, (answer) => { rl.close(); resolve(answer); });
  });
}

if (!password) password = await promptHidden(`Senha para "${username}": `);
if (password.length < 6) fail("A senha deve ter ao menos 6 caracteres.");

const dbPath = resolve(process.env.GRISOMAQ_DB_PATH ?? "./data/grisomaq.db");
mkdirSync(dirname(dbPath), { recursive: true });

const hash = await hashPassword(password);
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.prepare(`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
)`).run();
db.prepare(
  `INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)
   ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash`,
).run(username, hash, new Date().toISOString());
db.close();

console.log(`\n✔ Usuário "${username}" criado/atualizado em ${dbPath}\n`);
