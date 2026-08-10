"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { MarketResponse } from "../../lib/market-types";

type NavItem = { label: string; icon: string } & ({ hash: string } | { href: string });

// Âncoras apontam para seções da home; itens de rota levam às subpáginas.
export const NAV_ITEMS: NavItem[] = [
  { hash: "visao-geral", label: "Visão geral", icon: "◈" },
  { hash: "cotacoes", label: "Cotações", icon: "↗" },
  { hash: "recomendacoes", label: "Recomendações", icon: "◎" },
  { hash: "operacoes", label: "Futuros e simulador", icon: "⇄" },
  { hash: "radar", label: "Alertas e notícias", icon: "▤" },
  { hash: "fontes", label: "Fontes", icon: "◇" },
  { href: "/noticias", label: "Central de notícias", icon: "▦" },
  { href: "/relatorios", label: "Relatórios", icon: "▧" },
];

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

  return (
    <aside className="sidebar" aria-label="Navegação principal">
      <Link href="/" className="brand" aria-label="Grisomaq Inteligência de Mercado">
        <span className="brand-mark" aria-hidden="true">G</span>
        <span><strong>GRISOMAQ</strong><small>Inteligência de Mercado</small></span>
      </Link>
      <nav className="nav-list">
        {NAV_ITEMS.map((item) => {
          if ("hash" in item) {
            const active = isHome && activeSection === item.hash;
            return isHome ? (
              <a key={item.hash} className={`nav-item ${active ? "is-active" : ""}`} href={`#${item.hash}`} aria-current={active ? "page" : undefined}>
                <span aria-hidden="true">{item.icon}</span>{item.label}
              </a>
            ) : (
              <Link key={item.hash} className="nav-item" href={`/#${item.hash}`}>
                <span aria-hidden="true">{item.icon}</span>{item.label}
              </Link>
            );
          }
          const active = pathname === item.href;
          return (
            <Link key={item.href} className={`nav-item ${active ? "is-active" : ""}`} href={item.href} aria-current={active ? "page" : undefined}>
              <span aria-hidden="true">{item.icon}</span>{item.label}
            </Link>
          );
        })}
      </nav>
      <div className="sidebar-foot">
        <div className="source-mini"><span className={`status-dot ${mode}`} /> {responding} fontes com resposta</div>
        <p>Físico, futuro, câmbio e fundamentos com origem e horário identificados.</p>
        <div className="profile"><span>DR</span><div><strong>Diretoria</strong><small>Grisomaq</small></div></div>
        <button type="button" className="sidebar-logout" onClick={() => void logout()}><span aria-hidden="true">⏻</span> Sair</button>
      </div>
    </aside>
  );
}
