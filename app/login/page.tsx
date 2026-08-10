"use client";

import { useState } from "react";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? "Não foi possível entrar.");
        setLoading(false);
        return;
      }
      window.location.assign("/");
    } catch {
      setError("Falha de conexão. Tente novamente.");
      setLoading(false);
    }
  }

  return (
    <main className="login-shell">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">
          <span className="brand-mark" aria-hidden="true">G</span>
          <span><strong>GRISOMAQ</strong><small>Inteligência de Mercado</small></span>
        </div>
        <h1>Acesso ao painel</h1>
        <p className="login-sub">Área restrita. Entre com suas credenciais.</p>
        {error && <div className="login-error" role="alert">{error}</div>}
        <label className="login-field">Usuário
          <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus />
        </label>
        <label className="login-field">Senha
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
        </label>
        <button className="primary-button login-submit" type="submit" disabled={loading}>{loading ? "Entrando…" : "Entrar"}</button>
        <p className="login-foot">Novos acessos são criados pela administração, pelo terminal.</p>
      </form>
    </main>
  );
}
