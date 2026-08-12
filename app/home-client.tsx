"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppSidebar } from "./components/AppSidebar";
import { Modal } from "./components/Modal";
import {
  buildAlerts,
  buildDecisionSignal,
  commodityLabel,
  comparableFuture,
  formatMoney,
  formatPercent,
  marketTrend,
} from "../lib/market-insights";
import type {
  CommodityId,
  DecisionSignal,
  MarketAlert,
  MarketItem,
  MarketPoint,
  MarketResponse,
} from "../lib/market-types";

type PeriodDays = 7 | 30 | 90;
type AlertPreferences = { price: boolean; basis: boolean; news: boolean; source: boolean };
type PriceTarget = { commodity: CommodityId; direction: "above" | "below"; value: number };
type Note = { id: number; commodity: CommodityId; body: string; createdAt: string };

const TARGETS_KEY = "grisomaq-price-targets-v1";

const EMPTY_DATA: MarketResponse = {
  markets: [],
  futures: [],
  regionalQuotes: [],
  currency: {
    symbol: "USD/BRL",
    name: "Dólar PTAX",
    value: null,
    change: null,
    source: "Banco Central do Brasil",
    reference: "Aguardando consulta",
    observedAt: null,
    status: "unavailable",
    directUrl: "https://dadosabertos.bcb.gov.br/pt_BR/dataset/dolar-americano-usd-todos-os-boletins-diarios",
    history: [],
  },
  news: [],
  sources: [],
  updatedAt: "",
  nextRefreshAt: "",
  mode: "unavailable",
  disclosures: [],
};

const DEFAULT_ALERT_PREFERENCES: AlertPreferences = { price: true, basis: true, news: true, source: true };

function ptDateValue(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return Date.parse(`${value}T12:00:00Z`);
  const [day, month, year] = value.split("/").map(Number);
  return day && month && year ? Date.UTC(year, month - 1, day, 12) : 0;
}

function visibleHistory(history: MarketPoint[], days: PeriodDays) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return history
    .filter((point) => ptDateValue(point.date) >= cutoff)
    .slice()
    .sort((a, b) => ptDateValue(a.date) - ptDateValue(b.date));
}

function SeriesChart({ id, points, ariaLabel }: { id: string; points: MarketPoint[]; ariaLabel: string }) {
  if (points.length < 2) {
    return (
      <div className="chart-empty" role="status">
        <strong>Série ainda insuficiente</strong>
        <span>O gráfico será preenchido somente com fechamentos reais e armazenados.</span>
      </div>
    );
  }

  const width = 760;
  const height = 245;
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = Math.max(max - min, Math.max(max * 0.01, 1));
  const polyline = points.map((point, index) => {
    const x = 20 + (index / (points.length - 1)) * (width - 40);
    const y = 20 + ((max - point.value) / spread) * (height - 55);
    return `${x},${y}`;
  }).join(" ");
  const lastCoordinates = polyline.split(" ").at(-1)?.split(",") ?? [width - 20, height / 2];
  const area = `20,${height - 35} ${polyline} ${width - 20},${height - 35}`;

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}>
        <defs>
          <linearGradient id={`chart-fill-${id}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#5fe29a" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#5fe29a" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[50, 100, 150, 200].map((y) => <line key={y} x1="20" x2={width - 20} y1={y} y2={y} className="chart-grid" />)}
        <polygon points={area} fill={`url(#chart-fill-${id})`} />
        <polyline points={polyline} className="chart-line" />
        <circle cx={Number(lastCoordinates[0])} cy={Number(lastCoordinates[1])} r="5" className="chart-dot" />
      </svg>
      <div className="chart-axis">
        <span>{points[0].date.slice(0, 5)}</span>
        <span>{points[Math.floor((points.length - 1) / 2)].date.slice(0, 5)}</span>
        <span>{points.at(-1)!.date.slice(0, 5)}</span>
      </div>
    </div>
  );
}

function TrendChart({ market, days }: { market: MarketItem; days: PeriodDays }) {
  const points = visibleHistory(market.history, days);
  return <SeriesChart id={market.id} points={points} ariaLabel={`Fechamentos reais de ${market.name} nos últimos ${days} dias`} />;
}

function currencyHistoryAsc(history: MarketPoint[]) {
  return history.slice().sort((a, b) => ptDateValue(a.date) - ptDateValue(b.date));
}

function statusLabel(status: MarketItem["status"]) {
  if (status === "verified") return "Fechamento validado";
  if (status === "delayed") return "Dado com atraso";
  if (status === "partial") return "Cobertura parcial";
  return "Indisponível";
}

function formatDateTime(value: string) {
  if (!value) return "Aguardando primeira consulta";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(value));
}

export default function Home() {
  const [data, setData] = useState<MarketResponse>(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeCommodity, setActiveCommodity] = useState<CommodityId>("milho");
  const [period, setPeriod] = useState<PeriodDays>(30);
  const [toast, setToast] = useState("");
  const [selectedSignal, setSelectedSignal] = useState<DecisionSignal | null>(null);
  const [selectedAlert, setSelectedAlert] = useState<MarketAlert | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [currencyOpen, setCurrencyOpen] = useState(false);
  const [activeSection, setActiveSection] = useState("visao-geral");
  const [alertPreferences, setAlertPreferences] = useState<AlertPreferences>(DEFAULT_ALERT_PREFERENCES);
  const [targets, setTargets] = useState<PriceTarget[]>([]);
  const [targetCommodity, setTargetCommodity] = useState<CommodityId>("milho");
  const [targetDirection, setTargetDirection] = useState<"above" | "below">("above");
  const [targetValue, setTargetValue] = useState("");
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | "unsupported">("default");
  const [volume, setVolume] = useState(1000);
  const [unitCost, setUnitCost] = useState(52);
  const [freight, setFreight] = useState(3.5);
  const [protectedShare, setProtectedShare] = useState(30);
  const [notes, setNotes] = useState<Note[]>([]);
  const [noteDraft, setNoteDraft] = useState("");
  const [notesLoading, setNotesLoading] = useState(false);
  const [notesSaving, setNotesSaving] = useState(false);

  const refreshData = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const response = await fetch("/api/market", { cache: "no-store" });
      if (!response.ok) throw new Error("Não foi possível consultar as fontes.");
      const result = await response.json() as MarketResponse;
      setData(result);
      if (!silent) setToast(result.mode === "verified" ? "Dados e fontes consultados com sucesso." : "Consulta concluída com cobertura parcial; veja a governança das fontes.");
    } catch {
      if (!silent) setToast("As fontes não responderam. Nenhum valor antigo foi apresentado como novo.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Guarda o updatedAt atual num ref para o efeito de polling lê-lo sem que ele
  // vire dependência (senão o efeito re-executaria a cada consulta → refetch em loop).
  const updatedAtRef = useRef("");
  useEffect(() => {
    updatedAtRef.current = data.updatedAt;
  }, [data.updatedAt]);

  useEffect(() => {
    const startup = window.setTimeout(() => void refreshData(true), 0);
    const interval = window.setInterval(() => void refreshData(true), 10 * 60 * 1000);
    const onVisible = () => {
      const updatedAt = updatedAtRef.current;
      if (document.visibilityState === "visible" && updatedAt && Date.now() - Date.parse(updatedAt) >= 10 * 60 * 1000) {
        void refreshData(true);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(startup);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshData]);

  useEffect(() => {
    const startup = window.setTimeout(() => {
      try {
        const saved = window.localStorage.getItem("grisomaq-alert-preferences-v2");
        if (saved) setAlertPreferences({ ...DEFAULT_ALERT_PREFERENCES, ...JSON.parse(saved) });
      } catch {
        window.localStorage.removeItem("grisomaq-alert-preferences-v2");
      }
      try {
        const savedTargets = window.localStorage.getItem(TARGETS_KEY);
        if (savedTargets) {
          const parsed = JSON.parse(savedTargets);
          if (Array.isArray(parsed)) setTargets(parsed.filter((t: PriceTarget) => t && typeof t.value === "number"));
        }
      } catch {
        window.localStorage.removeItem(TARGETS_KEY);
      }
      setNotificationPermission("Notification" in window ? Notification.permission : "unsupported");
    }, 0);
    return () => window.clearTimeout(startup);
  }, []);

  // Anotações do usuário (privadas, no servidor) para a commodity ativa.
  useEffect(() => {
    let cancelled = false;
    const startup = window.setTimeout(() => {
      setNotesLoading(true);
      fetch(`/api/notes?commodity=${activeCommodity}`, { cache: "no-store" })
        .then((response) => (response.ok ? response.json() : { notes: [] }))
        .then((result) => { if (!cancelled) setNotes(Array.isArray(result.notes) ? result.notes : []); })
        .catch(() => { if (!cancelled) setNotes([]); })
        .finally(() => { if (!cancelled) setNotesLoading(false); });
    }, 0);
    return () => { cancelled = true; window.clearTimeout(startup); };
  }, [activeCommodity]);

  useEffect(() => {
    const sections = ["visao-geral", "cotacoes", "recomendacoes", "operacoes", "radar", "anotacoes", "fontes"]
      .map((id) => document.getElementById(id))
      .filter((section): section is HTMLElement => Boolean(section));
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible) setActiveSection(visible.target.id);
    }, { rootMargin: "-18% 0px -65% 0px", threshold: [0, 0.1, 0.35] });
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  const activeMarket = data.markets.find((market) => market.id === activeCommodity) ?? data.markets[0] ?? null;
  const activeFuture = activeMarket ? comparableFuture(activeMarket, data.futures, data.currency) : null;
  const activeTrend = activeMarket ? marketTrend(activeMarket, period) : null;
  const trendPoints = activeMarket ? visibleHistory(activeMarket.history, period) : [];
  const trendSpanDays = trendPoints.length >= 2
    ? Math.max(1, Math.round((ptDateValue(trendPoints.at(-1)!.date) - ptDateValue(trendPoints[0]!.date)) / (24 * 60 * 60 * 1000)))
    : 0;
  // O histórico é armazenado dia a dia; janelas maiores só se completam com o tempo.
  const trendCoversLess = trendPoints.length >= 2 && trendSpanDays < period - 2;
  const signal = useMemo(
    () => activeMarket ? buildDecisionSignal(activeMarket, data.futures, data.news, data.currency) : null,
    [activeMarket, data.futures, data.news, data.currency],
  );
  const allAlerts = useMemo(() => buildAlerts(data.markets, data.futures, data.news, data.currency), [data.markets, data.futures, data.news, data.currency]);
  // Alertas de alvo definido pelo usuário: dispara quando o fechamento atual cruza o limite.
  const targetAlerts = useMemo<MarketAlert[]>(() => {
    const out: MarketAlert[] = [];
    for (const target of targets) {
      const market = data.markets.find((m) => m.id === target.commodity);
      if (!market || market.value === null || market.status === "unavailable") continue;
      const crossed = target.direction === "above" ? market.value >= target.value : market.value <= target.value;
      if (!crossed) continue;
      out.push({
        id: `target-${target.commodity}-${target.direction}-${target.value}`,
        commodity: target.commodity,
        level: "high",
        category: "price",
        title: `${market.name}: alvo ${target.direction === "above" ? "atingido" : "atingido para baixo"} (R$ ${formatMoney(target.value)})`,
        description: `Fechamento atual R$ ${formatMoney(market.value)} ${target.direction === "above" ? "≥" : "≤"} seu alvo de R$ ${formatMoney(target.value)}.`,
        action: "Avalie proteção ou execução conforme sua estratégia; o alvo permanece salvo neste dispositivo.",
      });
    }
    return out;
  }, [targets, data.markets]);
  const visibleAlerts = useMemo(
    () => [...targetAlerts, ...allAlerts.filter((alert) => alertPreferences[alert.category])],
    [targetAlerts, allAlerts, alertPreferences],
  );
  const regional = data.regionalQuotes.filter((quote) => quote.commodity === activeCommodity).slice(0, 8);
  const futures = data.futures.filter((future) => future.commodity === activeCommodity).slice(0, 6);
  const relatedNews = data.news.filter((item) => item.tag.toLowerCase() === commodityLabel(activeCommodity).toLowerCase());
  const topNews = [...relatedNews, ...data.news.filter((item) => !relatedNews.includes(item))].slice(0, 5);
  const simulatedPrice = activeMarket?.value !== null && activeMarket?.value !== undefined
    ? activeMarket.value * (1 - protectedShare / 100) + (activeFuture?.value ?? activeMarket.value) * (protectedShare / 100)
    : null;
  const currentMargin = activeMarket?.value !== null && activeMarket?.value !== undefined
    ? (activeMarket.value - unitCost - freight) * volume
    : null;
  const simulatedMargin = simulatedPrice !== null ? (simulatedPrice - unitCost - freight) * volume : null;

  useEffect(() => {
    if (notificationPermission !== "granted" || !data.updatedAt || !visibleAlerts.length) return;
    const key = visibleAlerts.map((alert) => alert.id).sort().join("|");
    const previous = window.localStorage.getItem("grisomaq-last-alert-set");
    window.localStorage.setItem("grisomaq-last-alert-set", key);
    if (previous && previous !== key) {
      const newest = visibleAlerts[0];
      new Notification(`Grisomaq · ${newest.title}`, { body: newest.description });
    }
  }, [data.updatedAt, notificationPermission, visibleAlerts]);

  function selectCommodity(id: CommodityId) {
    setActiveCommodity(id);
    if (id === "milho") { setUnitCost(52); setFreight(3.5); }
    if (id === "soja") { setUnitCost(112); setFreight(5); }
    if (id === "boi") { setUnitCost(292); setFreight(4); }
    document.getElementById("cotacoes")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function persistTargets(next: PriceTarget[]) {
    setTargets(next);
    try {
      window.localStorage.setItem(TARGETS_KEY, JSON.stringify(next));
    } catch {
      // localStorage indisponível; alvos ficam só em memória nesta sessão.
    }
  }

  function addTarget() {
    const value = Math.round((Number(targetValue.replace(",", ".")) || 0) * 100) / 100;
    if (value <= 0) {
      setToast("Informe um valor de alvo maior que zero.");
      return;
    }
    const next = [
      ...targets.filter((t) => !(t.commodity === targetCommodity && t.direction === targetDirection)),
      { commodity: targetCommodity, direction: targetDirection, value },
    ];
    persistTargets(next);
    setTargetValue("");
    setToast(`Alvo salvo: ${commodityLabel(targetCommodity)} ${targetDirection === "above" ? "≥" : "≤"} R$ ${formatMoney(value)}.`);
  }

  function removeTarget(target: PriceTarget) {
    persistTargets(targets.filter((t) => !(t.commodity === target.commodity && t.direction === target.direction && t.value === target.value)));
  }

  async function addNoteEntry() {
    const text = noteDraft.trim();
    if (!text || notesSaving) return;
    setNotesSaving(true);
    try {
      const response = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commodity: activeCommodity, body: text }),
      });
      const result = await response.json().catch(() => ({}));
      if (response.ok && result.note) {
        setNotes((current) => [result.note as Note, ...current]);
        setNoteDraft("");
      } else {
        setToast(result?.error ?? "Não foi possível salvar a anotação.");
      }
    } catch {
      setToast("Falha de conexão ao salvar a anotação.");
    } finally {
      setNotesSaving(false);
    }
  }

  async function removeNoteEntry(id: number) {
    setNotes((current) => current.filter((note) => note.id !== id));
    try {
      await fetch("/api/notes", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
    } catch {
      // Se falhar, a próxima troca de commodity recarrega a lista real do servidor.
    }
  }

  function saveAlertPreferences() {
    window.localStorage.setItem("grisomaq-alert-preferences-v2", JSON.stringify(alertPreferences));
    setSettingsOpen(false);
    setToast("Preferências aplicadas aos alertas deste dispositivo.");
  }

  async function enableNotifications() {
    if (!("Notification" in window)) {
      setNotificationPermission("unsupported");
      setToast("Este navegador não oferece notificações para o painel.");
      return;
    }
    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
    setToast(permission === "granted" ? "Avisos do navegador ativados." : "Permissão de notificações não concedida.");
  }

  const today = new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    timeZone: "America/Sao_Paulo",
  }).format(new Date());

  return (
    <main className="app-shell">
      <AppSidebar data={data} activeSection={activeSection} />

      <section className="workspace">
        <header className="topbar" id="visao-geral">
          <div>
            <p className="eyebrow">{today}</p>
            <h1>Painel de decisão</h1>
          </div>
          <div className="top-actions">
            <div className="freshness">
              <span className={`status-dot ${data.mode}`} />
              <span><b>{data.mode === "verified" ? "Cobertura validada" : data.mode === "partial" ? "Cobertura parcial" : "Fontes indisponíveis"}</b><small>{formatDateTime(data.updatedAt)} · ciclo de 10 min</small></span>
            </div>
            <button className="icon-button" onClick={() => void refreshData(false)} disabled={refreshing} aria-label="Atualizar todas as fontes">{refreshing ? "…" : "↻"}</button>
            <Link className="primary-button" href={`/relatorios?commodity=${activeCommodity}`}><span aria-hidden="true">⇩</span> Novo relatório</Link>
          </div>
        </header>

        {toast && <div className="toast" role="status"><span>{toast}</span><button onClick={() => setToast("")} aria-label="Fechar aviso">×</button></div>}
        {data.mode !== "verified" && !loading && (
          <div className="integrity-banner" role="status">
            <span aria-hidden="true">!</span>
            <div><strong>O painel está protegendo a integridade da leitura</strong><p>Dados sem fechamento ou fonte validável aparecem como indisponíveis. Consulte a governança no fim da página.</p></div>
            <a href="#fontes">Ver fontes</a>
          </div>
        )}

        <section className="briefing" aria-labelledby="briefing-title">
          <div><span className="section-kicker">Briefing calculado</span><h2 id="briefing-title">O que exige atenção agora</h2></div>
          <p>{signal ? signal.summary : loading ? "Consultando indicadores físicos, futuros, câmbio e notícias…" : "Ainda não há dados suficientes para gerar um sinal."}</p>
          <span className="briefing-score"><b>{visibleAlerts.length}</b> alertas ativos</span>
        </section>

        <section className="market-strip" id="cotacoes" aria-label="Principais cotações">
          {loading && [0, 1, 2].map((item) => <div className="market-card skeleton-card" key={item} aria-hidden="true" />)}
          {data.markets.map((market) => (
            <button key={market.id} className={`market-card ${activeCommodity === market.id ? "is-selected" : ""}`} onClick={() => selectCommodity(market.id)} aria-pressed={activeCommodity === market.id}>
              <div className="market-card-top"><span className={`commodity-dot ${market.id}`} /><span>{market.shortName}</span><em className={`trust-pill ${market.status}`}>{statusLabel(market.status)}</em></div>
              <div className="market-value"><strong>{market.value === null ? "—" : `R$ ${formatMoney(market.value)}`}</strong><small>{market.unit.replace("R$/", "")}</small></div>
              <div className="market-meta"><span className={(market.change ?? 0) >= 0 ? "positive" : "negative"}>{formatPercent(market.change)}</span><small>{market.source} · {market.reference}</small></div>
            </button>
          ))}
          <button className="market-card dollar-card" onClick={() => setCurrencyOpen(true)} aria-haspopup="dialog">
            <div className="market-card-top"><span className="commodity-dot dolar" /><span>{data.currency.name}</span><em className={`trust-pill ${data.currency.status}`}>{statusLabel(data.currency.status)}</em></div>
            <div className="market-value"><strong>{data.currency.value === null ? "—" : `R$ ${formatMoney(data.currency.value, 4)}`}</strong><small>USD/BRL</small></div>
            <div className="market-meta"><span className={(data.currency.change ?? 0) >= 0 ? "positive" : "negative"}>{formatPercent(data.currency.change)}</span><small>{data.currency.source} · {data.currency.reference}</small></div>
          </button>
        </section>


        {activeMarket && (
          <section className="decision-grid">
            <article className="panel trend-panel">
              <div className="panel-head">
                <div><span className="section-kicker">Série de fechamentos reais</span><h2>{activeMarket.name} · {activeMarket.unit}</h2></div>
                <div className="segmented" aria-label="Período do gráfico">
                  {([7, 30, 90] as PeriodDays[]).map((days) => <button key={days} className={period === days ? "is-active" : ""} onClick={() => setPeriod(days)} aria-pressed={period === days}>{days} dias</button>)}
                </div>
              </div>
              <div className="trend-summary"><strong>{activeMarket.value === null ? "—" : `R$ ${formatMoney(activeMarket.value)}`}</strong><span className={(activeTrend ?? 0) >= 0 ? "positive" : "negative"}>{formatPercent(activeTrend)}{trendSpanDays > 0 ? ` em ${trendSpanDays} ${trendSpanDays === 1 ? "dia" : "dias"}` : " no período disponível"}</span><small>{trendPoints.length} fechamentos</small></div>
              {trendCoversLess && (
                <div className="chart-notice" role="status">
                  <span aria-hidden="true">ⓘ</span>
                  <p>O histórico armazenado ainda cobre <b>{trendSpanDays} {trendSpanDays === 1 ? "dia" : "dias"}</b>, não {period}. O painel guarda os fechamentos reais dia a dia — a janela de {period} dias vai se completar com o tempo, sem preencher com dados estimados.</p>
                </div>
              )}
              <TrendChart market={activeMarket} days={period} />
              <div className="chart-legend"><span><i className="legend-line" /> Fechamento CEPEA</span><a href={activeMarket.directUrl} target="_blank" rel="noreferrer">Abrir histórico original ↗</a></div>
            </article>

            {signal && (
              <article className={`recommendation-card signal-${signal.action}`} id="recomendacoes">
                <div className="recommendation-head"><span className="recommendation-icon" aria-hidden="true">◎</span><span className="section-kicker">Sinal explicável</span><span className="confidence">score {signal.score}/100</span></div>
                <h2>{signal.title}</h2>
                <p>{signal.summary}</p>
                <ul>{signal.components.slice(0, 3).map((component) => <li key={component.label}><span className={`signal-dot ${component.effect}`} /> <div><strong>{component.label}</strong><small>{component.value}</small></div></li>)}</ul>
                <div className="recommendation-foot"><span>Regra transparente · não é ordem automática</span><button onClick={() => setSelectedSignal(signal)}>Ver critérios <span aria-hidden="true">→</span></button></div>
              </article>
            )}
          </section>
        )}

        <section className="operations-grid" id="operacoes">
          <article className="panel contracts-panel">
            <div className="panel-head"><div><span className="section-kicker">Curva pública</span><h2>Contratos futuros</h2></div><span className="data-delay">Fechamento D-1</span></div>
            {futures.length ? <div className="contract-table" role="table" aria-label={`Contratos futuros de ${activeMarket?.name ?? "commodity"}`}>
              <div className="table-row table-head" role="row"><span>Vencimento</span><span>Preço</span><span>Variação</span></div>
              {futures.map((future) => <a className="table-row" role="row" href={future.href} target="_blank" rel="noreferrer" key={`${future.commodity}-${future.contract}`}><strong>{future.contract}</strong><span>{formatMoney(future.value)} <small>{future.unit}</small></span><span className={(future.change ?? 0) >= 0 ? "positive" : "negative"}>{formatPercent(future.change)}</span></a>)}
            </div> : <div className="empty-state">Nenhum vencimento comparável foi validado nesta consulta.</div>}
          </article>

          <article className="panel simulator-panel">
            <div className="panel-head"><div><span className="section-kicker">Simulador de margem</span><h2>Teste uma proteção parcial</h2></div><span className="calculator-badge">Cenário</span></div>
            <div className="simulator-fields">
              <label>Volume<input type="number" min="0" value={volume} onChange={(event) => setVolume(Math.max(0, Math.floor(Number(event.target.value) || 0)))} /></label>
              <label>Custo por unidade<input type="number" min="0" step="0.01" value={unitCost} onChange={(event) => setUnitCost(Math.max(0, Number(event.target.value) || 0))} /></label>
              <label>Frete por unidade<input type="number" min="0" step="0.01" value={freight} onChange={(event) => setFreight(Math.max(0, Number(event.target.value) || 0))} /></label>
              <label>Parcela protegida<select value={protectedShare} onChange={(event) => setProtectedShare(Number(event.target.value))}><option value={0}>0%</option><option value={20}>20%</option><option value={30}>30%</option><option value={50}>50%</option><option value={70}>70%</option></select></label>
            </div>
            <div className="simulation-results">
              <div><small>Margem no físico</small><strong>{currentMargin === null ? "—" : `R$ ${formatMoney(currentMargin)}`}</strong></div>
              <div><small>Cenário combinado</small><strong>{simulatedMargin === null || !activeFuture ? "Não comparável" : `R$ ${formatMoney(simulatedMargin)}`}</strong></div>
              <div><small>Diferença simulada</small><strong className={(simulatedMargin ?? 0) - (currentMargin ?? 0) >= 0 ? "positive" : "negative"}>{simulatedMargin === null || currentMargin === null || !activeFuture ? "—" : `R$ ${formatMoney(simulatedMargin - currentMargin)}`}</strong></div>
            </div>
            <p className="simulation-note">Simulação bruta, sem corretagem, impostos, ajustes ou risco de base.{activeFuture?.converted ? ` Contrato ${activeFuture.future.contract} convertido de US$ para R$ pelo dólar PTAX (R$ ${formatMoney(activeFuture.rate, 4)}).` : ""} Valide com a política comercial.</p>
          </article>
        </section>

        <section className="lower-grid" id="radar">
          <article className="panel alerts-panel">
            <div className="panel-head"><div><span className="section-kicker">Radar calculado</span><h2>Alertas prioritários</h2></div><button className="text-button" onClick={() => setSettingsOpen(true)}>Configurar</button></div>
            <div className="alert-list">
              {visibleAlerts.length ? visibleAlerts.slice(0, 5).map((alert) => (
                <button className="alert-row" key={alert.id} onClick={() => setSelectedAlert(alert)}>
                  <span className={`alert-symbol ${alert.level}`} aria-hidden="true">{alert.level === "high" ? "!" : alert.level === "medium" ? "•" : "✓"}</span>
                  <span><small>{alert.category === "basis" ? "Prêmio" : alert.category === "price" ? "Preço" : alert.category === "news" ? "Notícia" : "Fonte"}</small><strong>{alert.title}</strong><p>{alert.description}</p></span>
                  <b aria-hidden="true">→</b>
                </button>
              )) : <div className="empty-state">Nenhum alerta corresponde às preferências atuais.</div>}
            </div>
          </article>

          <article className="panel news-panel">
            <div className="panel-head"><div><span className="section-kicker">Links diretos e fonte original</span><h2>Notícias que movem o mercado</h2></div><Link className="text-button" href="/noticias">Central de notícias</Link></div>
            <div className="news-list">
              {topNews.length ? topNews.map((item) => (
                <a className="news-row" key={item.id} href={item.href} target="_blank" rel="noreferrer">
                  <span className={`news-tag ${item.tag.toLowerCase()}`}>{item.tag}</span>
                  <span><strong>{item.title}</strong><small>{item.source}{item.publishedAt ? ` · ${item.publishedAt}` : " · consulta atual"}</small></span>
                  <em className={`impact-badge ${item.impact}`}>{item.impact === "high" ? "alto" : item.impact === "medium" ? "médio" : "baixo"}</em>
                </a>
              )) : <div className="empty-state">As fontes editoriais não responderam nesta consulta.</div>}
            </div>
          </article>
        </section>

        <section className="regional-panel panel" aria-labelledby="regional-title">
          <div className="panel-head"><div><span className="section-kicker">Praças públicas</span><h2 id="regional-title">Referências regionais de {activeMarket?.name.toLowerCase() ?? "mercado"}</h2></div><span className="data-delay">Não substitui proposta comercial</span></div>
          {regional.length ? <div className="regional-grid">{regional.map((quote) => (
            <div className="regional-card" key={`${quote.commodity}-${quote.location}`}><div><span>{quote.state ?? "BR"}</span><strong>{quote.location}</strong></div><b>R$ {formatMoney(quote.value)}</b><small>{quote.source} · {quote.reference}</small></div>
          ))}</div> : <div className="empty-state">Nenhuma praça regional foi validada para esta commodity.</div>}
        </section>

        <section className="notes-panel panel" id="anotacoes" aria-labelledby="notes-title">
          <div className="panel-head"><div><span className="section-kicker">Diário do usuário</span><h2 id="notes-title">Minhas anotações de {activeMarket?.name.toLowerCase() ?? "mercado"}</h2></div><span className="data-delay">Privado — só você vê</span></div>
          <div className="notes-form">
            <textarea
              value={noteDraft}
              onChange={(event) => setNoteDraft(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void addNoteEntry(); }}
              placeholder={`Ex.: vendi 100 sc a ${activeMarket?.value ? formatMoney(activeMarket.value) : "65,00"}; esperar subir pra proteger o restante.`}
              maxLength={2000}
              rows={3}
              aria-label="Nova anotação"
            />
            <button type="button" className="primary-button" onClick={() => void addNoteEntry()} disabled={!noteDraft.trim() || notesSaving}>{notesSaving ? "Salvando…" : "Adicionar"}</button>
          </div>
          {notesLoading ? (
            <div className="empty-state">Carregando anotações…</div>
          ) : notes.length ? (
            <ul className="notes-list">
              {notes.map((note) => (
                <li key={note.id}>
                  <div><time>{formatDateTime(note.createdAt)}</time><p>{note.body}</p></div>
                  <button type="button" onClick={() => void removeNoteEntry(note.id)} aria-label="Remover anotação">×</button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="empty-state">Nenhuma anotação de {activeMarket?.name.toLowerCase() ?? "mercado"} ainda. Registre suas decisões aqui.</div>
          )}
        </section>

        <section className="sources-panel" id="fontes" aria-labelledby="sources-title">
          <div><span className="section-kicker">Governança de dados</span><h2 id="sources-title">Estado real das integrações</h2><p>Cada fonte informa função, frequência, cobertura e limitações.</p></div>
          <div className="sources-list">{data.sources.map((source) => (
            <a href={source.href} target="_blank" rel="noreferrer" key={source.name} className={`source-card ${source.status}`}>
              <span className={`status-dot ${source.status}`} />
              <span><strong>{source.name}</strong><small>{source.role} · {source.frequency}</small><p>{source.message}</p></span>
              <b aria-hidden="true">↗</b>
            </a>
          ))}</div>
        </section>

        <section className="report-center" aria-labelledby="reports-title">
          <div className="report-intro"><span className="report-icon" aria-hidden="true">▧</span><div><span className="section-kicker">Central de relatórios</span><h2 id="reports-title">Leve dados rastreáveis para a reunião</h2><p>Prévia, filtros reais, notícias, critérios e arquivos executivos.</p></div></div>
          <Link className="secondary-button" href="/noticias">Revisar notícias</Link>
          <Link className="primary-button" href={`/relatorios?commodity=${activeCommodity}`}>Abrir central de relatórios</Link>
        </section>

        <footer className="dashboard-footer"><span>Grisomaq Inteligência de Mercado</span><p>{data.disclosures[0] ?? "Dados sem validação não são apresentados como atuais."}</p><span>v2.0</span></footer>
      </section>

      {selectedSignal && <Modal titleId="signal-title" onClose={() => setSelectedSignal(null)} wide>
        <div className="modal-head"><div><span className="section-kicker">Metodologia do sinal</span><h2 id="signal-title">{selectedSignal.title}</h2></div><button className="icon-button" onClick={() => setSelectedSignal(null)} aria-label="Fechar">×</button></div>
        <p>{selectedSignal.summary}</p>
        <div className="detail-metrics"><div><small>Commodity</small><strong>{commodityLabel(selectedSignal.commodity)}</strong></div><div><small>Score de atenção</small><strong>{selectedSignal.score}/100</strong></div><div><small>Ação sugerida</small><strong>{selectedSignal.action}</strong></div></div>
        <div className="method-list">{selectedSignal.components.map((component) => <div key={component.label}><span className={`signal-dot ${component.effect}`} /><span><strong>{component.label}</strong><small>{component.value}</small><p>{component.explanation}</p></span></div>)}</div>
        <div className="modal-disclaimer">O score organiza sinais públicos; não representa probabilidade estatística nem ordem automática.</div>
        <div className="modal-actions"><button className="secondary-button" onClick={() => setSelectedSignal(null)}>Fechar</button><Link className="primary-button" href={`/relatorios?commodity=${selectedSignal.commodity}&include=signal`}>Adicionar ao relatório</Link></div>
      </Modal>}

      {selectedAlert && <Modal titleId="alert-title" onClose={() => setSelectedAlert(null)} wide>
        <div className="modal-head"><div><span className="section-kicker">Detalhe do alerta</span><h2 id="alert-title">{selectedAlert.title}</h2></div><button className="icon-button" onClick={() => setSelectedAlert(null)} aria-label="Fechar">×</button></div>
        <div className="alert-detail-status"><span className={`alert-symbol ${selectedAlert.level}`} aria-hidden="true">{selectedAlert.level === "high" ? "!" : "•"}</span><div><small>{selectedAlert.category}</small><strong>{selectedAlert.description}</strong></div></div>
        <div className="detail-copy"><div><small>Ação sugerida</small><p>{selectedAlert.action}</p></div><div><small>Regra</small><p>Alerta gerado automaticamente a partir de variação, prêmio, título de notícia ou disponibilidade da fonte.</p></div></div>
        <div className="modal-actions"><button className="secondary-button" onClick={() => setSelectedAlert(null)}>Fechar</button>{selectedAlert.commodity && <button className="primary-button" onClick={() => { selectCommodity(selectedAlert.commodity!); setSelectedAlert(null); }}>Ver mercado relacionado</button>}</div>
      </Modal>}

      {settingsOpen && <Modal titleId="settings-title" onClose={() => setSettingsOpen(false)}>
        <div className="modal-head"><div><span className="section-kicker">Preferências deste dispositivo</span><h2 id="settings-title">Configurar alertas</h2></div><button className="icon-button" onClick={() => setSettingsOpen(false)} aria-label="Fechar">×</button></div>
        <p>Escolha quais regras aparecem no radar. Os dados continuam sendo monitorados.</p>
        <div className="settings-list">
          {([
            ["price", "Movimentos de preço", "Variações relevantes no fechamento"],
            ["basis", "Prêmio físico x futuro", "Janelas de proteção comparáveis"],
            ["news", "Notícias de alto impacto", "Títulos classificados por regras transparentes"],
            ["source", "Falhas de fonte", "Dados ausentes ou sem validação"],
          ] as const).map(([key, title, description]) => (
            <label className="setting-row" key={key}><span><strong>{title}</strong><small>{description}</small></span><input type="checkbox" checked={alertPreferences[key]} onChange={(event) => setAlertPreferences((current) => ({ ...current, [key]: event.target.checked }))} /></label>
          ))}
        </div>
        <div className="targets-block">
          <div className="targets-head"><strong>Alvos de preço</strong><small>Avisa quando o fechamento cruzar o valor que você definir. Salvo neste dispositivo.</small></div>
          <div className="targets-form">
            <select aria-label="Commodity do alvo" value={targetCommodity} onChange={(e) => setTargetCommodity(e.target.value as CommodityId)}>
              <option value="milho">Milho</option>
              <option value="soja">Soja</option>
              <option value="boi">Boi</option>
            </select>
            <select aria-label="Direção do alvo" value={targetDirection} onChange={(e) => setTargetDirection(e.target.value as "above" | "below")}>
              <option value="above">subir até / passar de (≥)</option>
              <option value="below">cair até / abaixo de (≤)</option>
            </select>
            <input inputMode="decimal" placeholder="R$ 0,00" value={targetValue} onChange={(e) => setTargetValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addTarget(); }} aria-label="Valor do alvo" />
            <button type="button" className="secondary-button" onClick={addTarget}>Adicionar</button>
          </div>
          {targets.length > 0 && (
            <ul className="targets-list">
              {targets.map((t) => (
                <li key={`${t.commodity}-${t.direction}-${t.value}`}>
                  <span>{commodityLabel(t.commodity)} {t.direction === "above" ? "≥" : "≤"} <b>R$ {formatMoney(t.value)}</b></span>
                  <button type="button" onClick={() => removeTarget(t)} aria-label={`Remover alvo de ${commodityLabel(t.commodity)}`}>×</button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button className="notification-option" onClick={() => void enableNotifications()} disabled={notificationPermission === "granted"}><span aria-hidden="true">◉</span><span><strong>{notificationPermission === "granted" ? "Avisos do navegador ativos" : "Ativar avisos do navegador"}</strong><small>O navegador solicitará permissão; não envia dados para terceiros.</small></span></button>
        <div className="modal-actions"><button className="secondary-button" onClick={() => setSettingsOpen(false)}>Cancelar</button><button className="primary-button" onClick={saveAlertPreferences}>Salvar preferências</button></div>
      </Modal>}

      {currencyOpen && <Modal titleId="currency-title" onClose={() => setCurrencyOpen(false)} wide>
        <div className="modal-head"><div><span className="section-kicker">Série de fechamentos reais · PTAX</span><h2 id="currency-title">{data.currency.name} · USD/BRL</h2></div><button className="icon-button" onClick={() => setCurrencyOpen(false)} aria-label="Fechar">×</button></div>
        <div className="trend-summary"><strong>{data.currency.value === null ? "—" : `R$ ${formatMoney(data.currency.value, 4)}`}</strong><span className={(data.currency.change ?? 0) >= 0 ? "positive" : "negative"}>{formatPercent(data.currency.change)} no último fechamento</span><small>{currencyHistoryAsc(data.currency.history).length} fechamentos · {data.currency.reference}</small></div>
        <SeriesChart id="dolar" points={currencyHistoryAsc(data.currency.history)} ariaLabel="Fechamentos reais do dólar PTAX (USD/BRL)" />
        <div className="chart-legend"><span><i className="legend-line" /> Fechamento PTAX de venda</span><a href={data.currency.directUrl} target="_blank" rel="noreferrer">Abrir histórico original ↗</a></div>
        <div className="modal-disclaimer">PTAX oficial de venda do Banco Central. Câmbio de referência, não é cotação de operação comercial.</div>
        <div className="modal-actions"><button className="secondary-button" onClick={() => setCurrencyOpen(false)}>Fechar</button><a className="primary-button" href={data.currency.directUrl} target="_blank" rel="noreferrer">Ver fonte no BCB ↗</a></div>
      </Modal>}
    </main>
  );
}
