// Hook de inicialização do Next.js — roda uma vez quando o servidor sobe.
// Usamos para ligar o agendador de backup do SQLite (só no runtime Node).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startBackupScheduler } = await import("./lib/backup");
    startBackupScheduler();
  }
}
