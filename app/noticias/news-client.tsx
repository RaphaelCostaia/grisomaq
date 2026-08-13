"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppSidebar } from "../components/AppSidebar";
import type { MarketResponse, NewsItem } from "../../lib/market-types";

const FILTERS = ["Todas", "Milho", "Soja", "Boi", "Clima", "Política", "Mercado", "Favoritas"] as const;

function formatDateTime(value: string) {
  if (!value) return "Aguardando consulta";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(value));
}

// Valor ordenável a partir de publishedAt ("DD/MM/AAAA" ou "DD/MM/AAAA HHhMM").
// Notícias sem data são do scrape ao vivo (as mais recentes) e vão para o topo.
function newsDateValue(item: NewsItem): number {
  if (!item.publishedAt) return Number.POSITIVE_INFINITY;
  const match = item.publishedAt.match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{1,2})h(\d{2}))?/);
  if (!match) return 0;
  const [, day, month, year, hour, minute] = match;
  return Date.UTC(Number(year), Number(month) - 1, Number(day), hour ? Number(hour) : 12, minute ? Number(minute) : 0);
}

function newsDateKey(item: NewsItem): string {
  return item.publishedAt ? item.publishedAt.slice(0, 10) : "atual";
}

export default function NewsPage() {
  const [data, setData] = useState<MarketResponse | null>(null);
  const [activeFilter, setActiveFilter] = useState<(typeof FILTERS)[number]>("Todas");
  const [search, setSearch] = useState("");
  const [favorites, setFavorites] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  // silent = carga automática (não mostra erro antes de uma tentativa do usuário).
  const refresh = useCallback(async (silent = false): Promise<boolean> => {
    setLoading(true);
    try {
      const response = await fetch("/api/market", { cache: "no-store" });
      if (!response.ok) throw new Error();
      setData(await response.json() as MarketResponse);
      setMessage("");
      return true;
    } catch {
      if (!silent) setMessage("As fontes editoriais não responderam. Nenhuma notícia antiga foi marcada como nova.");
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Carga inicial silenciosa: tenta algumas vezes antes de desistir, sem
    // exibir "erro" enquanto uma consulta real ainda não foi concluída.
    const loadInitial = async () => {
      for (let attempt = 0; attempt < 3 && !cancelled; attempt += 1) {
        if (await refresh(true)) return;
        await new Promise((resolve) => setTimeout(resolve, 2500));
      }
    };
    void loadInitial();
    const interval = window.setInterval(() => void refresh(true), 10 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [refresh]);

  useEffect(() => {
    const startup = window.setTimeout(() => {
      try {
        const saved = window.localStorage.getItem("grisomaq-news-favorites");
        if (saved) setFavorites(JSON.parse(saved));
      } catch {
        window.localStorage.removeItem("grisomaq-news-favorites");
      }
    }, 0);
    return () => window.clearTimeout(startup);
  }, []);

  const news = useMemo(() => data?.news ?? [], [data?.news]);
  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    return news.filter((item) => {
      const categoryMatch = activeFilter === "Todas"
        || activeFilter === "Favoritas" && favorites.includes(item.id)
        || item.tag === activeFilter;
      const searchMatch = !term || `${item.title} ${item.summary ?? ""} ${item.source}`.toLocaleLowerCase("pt-BR").includes(term);
      return categoryMatch && searchMatch;
    });
  }, [activeFilter, favorites, news, search]);

  const grouped = useMemo(() => {
    const sorted = filtered.slice().sort((a, b) => newsDateValue(b) - newsDateValue(a));
    const groups: Array<{ key: string; label: string; items: NewsItem[] }> = [];
    for (const item of sorted) {
      const key = newsDateKey(item);
      const last = groups.at(-1);
      if (last && last.key === key) last.items.push(item);
      // A capa da fonte não publica horário na listagem; o que sabemos com certeza
      // é o momento da consulta — o rótulo diz exatamente isso.
      else groups.push({ key, label: key === "atual" ? "Manchetes da capa (consulta atual)" : `Publicadas em ${key}`, items: [item] });
    }
    return groups;
  }, [filtered]);

  const highImpact = news.filter((item) => item.impact === "high").length;

  function toggleFavorite(item: NewsItem) {
    setFavorites((current) => {
      const next = current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id];
      window.localStorage.setItem("grisomaq-news-favorites", JSON.stringify(next));
      setMessage(current.includes(item.id) ? "Notícia removida dos favoritos." : "Notícia adicionada aos favoritos deste dispositivo.");
      return next;
    });
  }

  return (
    <main className="app-shell">
      <AppSidebar data={data} />

      <section className="workspace">
      <section className="page-hero">
        <div><span className="section-kicker">Curadoria com rastreabilidade</span><h1>Central de notícias</h1><p>Links diretos para a publicação original, filtros por commodity e uma classificação de impacto baseada em regras explícitas — sem inventar resumos ou datas.</p></div>
        <div className="hero-side">
          <div className="hero-stat"><div><small>Notícias conectadas</small><strong>{news.length}</strong></div><div><small>Impacto alto</small><strong>{highImpact}</strong></div></div>
          <Link className="secondary-button" href="/relatorios?include=favorites">Gerar relatório com favoritas</Link>
        </div>
      </section>

      {message && <div className="toast" role="status"><span>{message}</span><button onClick={() => setMessage("")} aria-label="Fechar aviso">×</button></div>}

      <section className="filter-bar" aria-label="Filtros de notícias">
        {FILTERS.map((filter) => <button key={filter} className={activeFilter === filter ? "is-active" : ""} onClick={() => setActiveFilter(filter)} aria-pressed={activeFilter === filter}>{filter}{filter === "Favoritas" ? ` (${favorites.length})` : ""}</button>)}
        <label className="search-field"><span aria-hidden="true">⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar título, resumo ou fonte" aria-label="Buscar notícias" /></label>
        <button onClick={() => void refresh(false)} disabled={loading}>{loading ? "Consultando…" : "Atualizar fontes"}</button>
      </section>

      {loading && !data && <div className="news-grid-page">{[0, 1, 2, 3, 4, 5].map((item) => <article className="news-card skeleton-card" key={item} aria-hidden="true" />)}</div>}
      {!loading && filtered.length === 0 && <div className="empty-state">Nenhuma notícia corresponde aos filtros selecionados.</div>}
      {grouped.map((group) => (
        <section className="news-group" key={group.key} aria-label={`Notícias de ${group.label}`}>
          <div className="news-group-head"><h2><span aria-hidden="true">▤</span>{group.label}</h2><span>{group.items.length} {group.items.length === 1 ? "notícia" : "notícias"}</span></div>
          <div className="news-grid-page">
            {group.items.map((item) => (
              <article className="news-card" key={item.id}>
                <div className="news-card-top"><span className={`news-tag ${item.tag.toLowerCase()}`}>{item.tag}</span><span className={`impact-badge ${item.impact}`}>impacto {item.impact === "high" ? "alto" : item.impact === "medium" ? "médio" : "baixo"}</span></div>
                <h2>{item.title}</h2>
                {item.summary && <p>{item.summary}</p>}
                <div className="impact-explanation">{item.impactReason}</div>
                <div className="news-card-meta"><span>{item.source}</span><span>{item.publishedAt ? `publicada em ${item.publishedAt}` : data?.updatedAt ? `consultada ${formatDateTime(data.updatedAt)}` : "consulta atual"}</span></div>
                <div className="news-card-actions"><button className={`favorite-button ${favorites.includes(item.id) ? "is-active" : ""}`} onClick={() => toggleFavorite(item)}>{favorites.includes(item.id) ? "★ Favorita" : "☆ Favoritar"}</button><a className="primary-button" href={item.href} target="_blank" rel="noreferrer">Abrir original ↗</a></div>
              </article>
            ))}
          </div>
        </section>
      ))}

      <footer className="dashboard-footer"><span>Grisomaq Inteligência de Mercado</span><p>Atualizado {formatDateTime(data?.updatedAt ?? "")}. A classificação de impacto é automática; a decisão exige leitura da fonte original.</p><span>v2.0</span></footer>
      </section>
    </main>
  );
}
