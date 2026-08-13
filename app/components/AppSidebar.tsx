"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type MouseEvent } from "react";
import { Modal } from "./Modal";
import type { MarketResponse } from "../../lib/market-types";

type NavItem = { label: string; icon: string } & ({ hash: string } | { href: string });

// Âncoras apontam para seções da home; itens de rota levam às subpáginas.
export const NAV_ITEMS: NavItem[] = [
  { hash: "visao-geral", label: "Visão geral", icon: "◈" },
  { hash: "cotacoes", label: "Cotações", icon: "↗" },
  { hash: "recomendacoes", label: "Recomendações", icon: "◎" },
  { hash: "operacoes", label: "Futuros e simulador", icon: "⇄" },
  { hash: "radar", label: "Alertas e notícias", icon: "▤" },
  { hash: "anotacoes", label: "Anotações", icon: "✎" },
  { hash: "fontes", label: "Fontes", icon: "◇" },
  { href: "/noticias", label: "Central de notícias", icon: "▦" },
  { href: "/relatorios", label: "Relatórios", icon: "▧" },
];

// Rolagem programática até a seção: a âncora nativa não move o document neste
// layout (sidebar fixa + hidratação), então rolamos explicitamente e refletimos a
// URL sem novo salto. Mesmo padrão de selectCommodity em home-client.
// Offset do topo: no mobile a sidebar vira barra fixa (sticky) e cobre o topo, então
// descontamos a altura real dela; no desktop a sidebar é lateral (só uma folga).
export function headerOffset(): number {
  const mobile = window.matchMedia("(max-width: 900px)").matches;
  if (!mobile) return 20;
  const bar = document.querySelector(".mobile-topbar");
  return (bar ? bar.getBoundingClientRect().height : 56) + 8;
}

function scrollToSection(event: MouseEvent<HTMLAnchorElement>, hash: string) {
  const target = document.getElementById(hash);
  if (!target) return;
  event.preventDefault();
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const top = target.getBoundingClientRect().top + window.scrollY - headerOffset();
  window.scrollTo({ top: Math.max(0, top), behavior: reduce ? "auto" : "smooth" });
  history.replaceState(null, "", `#${hash}`);
}

async function logout() {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } catch {
    // Ainda assim seguimos para a tela de login.
  }
  window.location.assign("/login");
}

export function AppSidebar({ data, activeSection }: { data: MarketResponse | null; activeSection?: string }) {
  const pathname = usePathname();
  const isHome = pathname === "/";
  const responding = data ? data.sources.filter((source) => source.status !== "unavailable").length : 0;
  const mode = data?.mode ?? "unavailable";

  const [menuOpen, setMenuOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [feedback, setFeedback] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  // Fecha o drawer ao trocar de rota (clicar numa subpágina / back-forward).
  useEffect(() => {
    const t = window.setTimeout(() => setMenuOpen(false), 0);
    return () => window.clearTimeout(t);
  }, [pathname]);

  // Enquanto o drawer está aberto: trava a rolagem do fundo e fecha com Esc.
  useEffect(() => {
    if (!menuOpen) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setMenuOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = original;
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const activeItem = isHome
    ? NAV_ITEMS.find((item) => "hash" in item && item.hash === activeSection)
    : NAV_ITEMS.find((item) => "href" in item && item.href === pathname);
  const currentLabel = activeItem?.label ?? "Painel de decisão";

  function closePassword() {
    setPasswordOpen(false);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setFeedback(null);
    setSaving(false);
  }

  async function submitPassword() {
    if (newPassword !== confirmPassword) {
      setFeedback({ type: "error", text: "A confirmação não confere com a nova senha." });
      return;
    }
    if (newPassword.length < 8) {
      setFeedback({ type: "error", text: "A nova senha precisa ter ao menos 8 caracteres." });
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setFeedback({ type: "error", text: result?.error ?? "Não foi possível trocar a senha." });
        setSaving(false);
        return;
      }
      setFeedback({ type: "ok", text: "Senha alterada. As demais sessões foram encerradas." });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch {
      setFeedback({ type: "error", text: "Falha de conexão ao trocar a senha." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <header className="mobile-topbar">
        <Link href="/" className="mobile-brand" aria-label="Grisomaq Inteligência de Mercado">
          <span className="brand-mark" aria-hidden="true">G</span>
        </Link>
        <span className="mobile-section">{currentLabel}</span>
        <button type="button" className="mobile-menu-btn" aria-label={menuOpen ? "Fechar menu" : "Abrir menu"} aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>
          <span aria-hidden="true">{menuOpen ? "✕" : "☰"}</span>
        </button>
      </header>

      {menuOpen && <div className="drawer-backdrop" role="presentation" onClick={() => setMenuOpen(false)} />}

      <aside className={`sidebar ${menuOpen ? "is-open" : ""}`} aria-label="Navegação principal">
      <Link href="/" className="brand" aria-label="Grisomaq Inteligência de Mercado" onClick={() => setMenuOpen(false)}>
        <span className="brand-mark" aria-hidden="true">G</span>
        <span><strong>GRISOMAQ</strong><small>Inteligência de Mercado</small></span>
      </Link>
      <nav className="nav-list">
        {NAV_ITEMS.map((item) => {
          if ("hash" in item) {
            const active = isHome && activeSection === item.hash;
            return isHome ? (
              <a key={item.hash} className={`nav-item ${active ? "is-active" : ""}`} href={`#${item.hash}`} onClick={(event) => { scrollToSection(event, item.hash); setMenuOpen(false); }} aria-current={active ? "page" : undefined}>
                <span aria-hidden="true">{item.icon}</span>{item.label}
              </a>
            ) : (
              <Link key={item.hash} className="nav-item" href={`/#${item.hash}`} onClick={() => setMenuOpen(false)}>
                <span aria-hidden="true">{item.icon}</span>{item.label}
              </Link>
            );
          }
          const active = pathname === item.href;
          return (
            <Link key={item.href} className={`nav-item ${active ? "is-active" : ""}`} href={item.href} onClick={() => setMenuOpen(false)} aria-current={active ? "page" : undefined}>
              <span aria-hidden="true">{item.icon}</span>{item.label}
            </Link>
          );
        })}
      </nav>
      <div className="sidebar-foot">
        <div className="source-mini"><span className={`status-dot ${mode}`} /> {responding} fontes com resposta</div>
        <p>Físico, futuro, câmbio e fundamentos com origem e horário identificados.</p>
        <div className="profile"><span>DR</span><div><strong>Diretoria</strong><small>Grisomaq</small></div></div>
        <div className="sidebar-account">
          <button type="button" className="sidebar-account-btn" onClick={() => setPasswordOpen(true)}><span aria-hidden="true">⚿</span> Trocar senha</button>
          <button type="button" className="sidebar-logout" onClick={() => void logout()}><span aria-hidden="true">⏻</span> Sair</button>
        </div>
      </div>

      {passwordOpen && (
        <Modal titleId="password-title" onClose={closePassword}>
          <div className="modal-head"><div><span className="section-kicker">Conta</span><h2 id="password-title">Trocar senha</h2></div><button className="icon-button" onClick={closePassword} aria-label="Fechar">×</button></div>
          <p>Defina uma nova senha de acesso ao painel. As outras sessões abertas serão encerradas.</p>
          <div className="password-form">
            <label>Senha atual<input type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} /></label>
            <label>Nova senha (mín. 8 caracteres)<input type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} /></label>
            <label>Confirmar nova senha<input type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void submitPassword(); }} /></label>
          </div>
          {feedback && <div className={`password-feedback ${feedback.type}`} role="status">{feedback.text}</div>}
          <div className="modal-actions"><button className="secondary-button" onClick={closePassword}>Fechar</button><button className="primary-button" onClick={() => void submitPassword()} disabled={saving}>{saving ? "Salvando…" : "Salvar nova senha"}</button></div>
        </Modal>
      )}
      </aside>
    </>
  );
}
