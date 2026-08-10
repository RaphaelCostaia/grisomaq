"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppSidebar } from "../components/AppSidebar";
import {
  buildAlerts,
  buildDecisionSignal,
  commodityLabel,
  formatMoney,
  formatPercent,
} from "../../lib/market-insights";
import type {
  CommodityId,
  DecisionSignal,
  MarketAlert,
  MarketItem,
  MarketResponse,
  NewsItem,
} from "../../lib/market-types";

type ReportSection = "prices" | "history" | "futures" | "signals" | "alerts" | "news" | "sources";
type ReportHistory = {
  id: string;
  format: "PDF" | "Excel";
  title: string;
  scope: string;
  createdAt: string;
};

const SECTION_OPTIONS: Array<{ id: ReportSection; label: string }> = [
  { id: "prices", label: "Cotações físicas" },
  { id: "history", label: "Histórico de preços" },
  { id: "futures", label: "Contratos futuros B3 (D-1)" },
  { id: "signals", label: "Sinais de apoio à decisão" },
  { id: "alerts", label: "Alertas objetivos" },
  { id: "news", label: "Notícias relacionadas" },
  { id: "sources", label: "Fontes e ressalvas" },
];

const INITIAL_SECTIONS: Record<ReportSection, boolean> = {
  prices: true,
  history: true,
  futures: true,
  signals: true,
  alerts: true,
  news: true,
  sources: true,
};

function formatDateTime(value: string | null | undefined) {
  if (!value) return "Não informado";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(value));
}

function historyDate(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T12:00:00-03:00`).getTime();
  const [day, month, year] = value.split("/").map(Number);
  return day && month && year ? new Date(year, month - 1, day, 12).getTime() : 0;
}

function scopeName(scope: "all" | CommodityId) {
  return scope === "all" ? "Milho, soja e boi" : commodityLabel(scope);
}

// Rastreabilidade: quando a fonte não fornece a data de publicação, usamos o
// horário da consulta (quando o dado foi coletado) em vez de "não informada".
function newsDate(item: NewsItem, updatedAt: string | null | undefined) {
  return item.publishedAt ?? `Consulta de ${formatDateTime(updatedAt)}`;
}

function statusText(status: MarketItem["status"]) {
  if (status === "verified") return "Validado";
  if (status === "delayed") return "Defasado";
  if (status === "partial") return "Parcial";
  return "Indisponível";
}

export default function ReportsPage() {
  const [data, setData] = useState<MarketResponse | null>(null);
  const [scope, setScope] = useState<"all" | CommodityId>("all");
  const [period, setPeriod] = useState(30);
  const [sections, setSections] = useState(INITIAL_SECTIONS);
  const [notes, setNotes] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [history, setHistory] = useState<ReportHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<"PDF" | "Excel" | null>(null);
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/market", { cache: "no-store" });
      if (!response.ok) throw new Error();
      setData(await response.json() as MarketResponse);
    } catch {
      setMessage("As fontes não responderam. O relatório não será preenchido com valores antigos ou simulados.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const startup = window.setTimeout(() => {
      const query = new URLSearchParams(window.location.search);
      const commodity = query.get("commodity");
      if (commodity === "milho" || commodity === "soja" || commodity === "boi") setScope(commodity);
      if (query.get("include") === "favorites") setFavoritesOnly(true);

      try {
        const savedFavorites = window.localStorage.getItem("grisomaq-news-favorites");
        const savedHistory = window.localStorage.getItem("grisomaq-report-history");
        if (savedFavorites) setFavoriteIds(JSON.parse(savedFavorites));
        if (savedHistory) setHistory(JSON.parse(savedHistory));
      } catch {
        window.localStorage.removeItem("grisomaq-news-favorites");
        window.localStorage.removeItem("grisomaq-report-history");
      }
    }, 0);
    return () => window.clearTimeout(startup);
  }, []);

  useEffect(() => {
    const startup = window.setTimeout(() => void refresh(), 0);
    const interval = window.setInterval(() => void refresh(), 10 * 60 * 1000);
    return () => {
      window.clearTimeout(startup);
      window.clearInterval(interval);
    };
  }, [refresh]);

  const markets = useMemo(
    () => (data?.markets ?? []).filter((market) => scope === "all" || market.id === scope),
    [data, scope],
  );

  const futures = useMemo(
    () => (data?.futures ?? []).filter((future) => scope === "all" || future.commodity === scope),
    [data, scope],
  );

  const news = useMemo(() => {
    const scoped = (data?.news ?? []).filter((item) => scope === "all" || item.tag === commodityLabel(scope));
    return favoritesOnly ? scoped.filter((item) => favoriteIds.includes(item.id)) : scoped;
  }, [data, favoriteIds, favoritesOnly, scope]);

  const signals = useMemo(
    () => markets.map((market) => buildDecisionSignal(market, data?.futures ?? [], data?.news ?? [], data?.currency)),
    [data, markets],
  );

  const alerts = useMemo(() => {
    const allAlerts = buildAlerts(data?.markets ?? [], data?.futures ?? [], data?.news ?? [], data?.currency);
    return allAlerts.filter((alert) => scope === "all" || alert.commodity === null || alert.commodity === scope);
  }, [data, scope]);

  const histories = useMemo(() => {
    const reference = data?.updatedAt ? Date.parse(data.updatedAt) : 0;
    const cutoff = reference - period * 24 * 60 * 60 * 1000;
    return markets.flatMap((market) => market.history
      .filter((point) => historyDate(point.date) >= cutoff)
      .map((point) => ({ market, point })));
  }, [data, markets, period]);

  const reportTitle = `Relatório executivo — ${scopeName(scope)}`;

  function toggleSection(section: ReportSection) {
    setSections((current) => ({ ...current, [section]: !current[section] }));
  }

  function saveHistory(format: "PDF" | "Excel") {
    const item: ReportHistory = {
      id: `${Date.now()}-${format}`,
      format,
      title: reportTitle,
      scope: scopeName(scope),
      createdAt: new Date().toISOString(),
    };
    setHistory((current) => {
      const next = [item, ...current].slice(0, 12);
      window.localStorage.setItem("grisomaq-report-history", JSON.stringify(next));
      return next;
    });
  }

  function deleteHistory(id: string) {
    setHistory((current) => {
      const next = current.filter((item) => item.id !== id);
      window.localStorage.setItem("grisomaq-report-history", JSON.stringify(next));
      return next;
    });
  }

  async function exportExcel() {
    if (!data || markets.length === 0) return;
    setExporting("Excel");
    setMessage("");
    try {
      const { default: writeXlsxFile } = await import("write-excel-file/browser");
      const header = (labels: string[]) => labels.map((value) => ({
        value,
        type: String,
        fontWeight: "bold" as const,
        backgroundColor: "DCEFE3",
      }));
      const sheets = [];

      if (sections.prices) {
        sheets.push({
          sheet: "Cotações",
          columns: [{ width: 18 }, { width: 16 }, { width: 14 }, { width: 16 }, { width: 22 }, { width: 18 }],
          data: [
            header(["Mercado", "Preço", "Variação (%)", "Unidade", "Referência", "Fonte"]),
            ...markets.map((market) => [
              market.name,
              market.value,
              market.change,
              market.unit,
              market.reference,
              `${market.source} — ${statusText(market.status)}`,
            ]),
          ],
        });
      }

      if (sections.history) {
        sheets.push({
          sheet: "Histórico",
          columns: [{ width: 18 }, { width: 15 }, { width: 16 }, { width: 16 }],
          data: [
            header(["Mercado", "Data", "Preço", "Variação (%)"]),
            ...histories.map(({ market, point }) => [market.name, point.date, point.value, point.change]),
          ],
        });
      }

      if (sections.futures) {
        sheets.push({
          sheet: "Futuros B3 D-1",
          columns: [{ width: 18 }, { width: 18 }, { width: 16 }, { width: 14 }, { width: 22 }],
          data: [
            header(["Mercado", "Contrato", "Preço", "Unidade", "Referência"]),
            ...futures.map((future) => [commodityLabel(future.commodity), future.contract, future.value, future.unit, future.reference]),
          ],
        });
      }

      if (sections.signals) {
        sheets.push({
          sheet: "Sinais",
          columns: [{ width: 18 }, { width: 18 }, { width: 42 }, { width: 12 }, { width: 16 }],
          data: [
            header(["Mercado", "Ação sugerida", "Leitura", "Score de apoio", "Tendência"]),
            ...signals.map((signal) => [commodityLabel(signal.commodity), signal.action, signal.summary, signal.score, signal.trend]),
          ],
        });
      }

      if (sections.alerts) {
        sheets.push({
          sheet: "Alertas",
          columns: [{ width: 14 }, { width: 22 }, { width: 45 }, { width: 40 }],
          data: [
            header(["Nível", "Alerta", "Descrição", "Ação de verificação"]),
            ...alerts.map((alert) => [alert.level, alert.title, alert.description, alert.action]),
          ],
        });
      }

      if (sections.news) {
        sheets.push({
          sheet: "Notícias",
          columns: [{ width: 18 }, { width: 55 }, { width: 18 }, { width: 18 }, { width: 70 }],
          data: [
            header(["Categoria", "Título", "Fonte", "Data", "Link original"]),
            ...news.map((item) => [item.tag, item.title, item.source, newsDate(item, data.updatedAt), item.href]),
          ],
        });
      }

      if (sections.sources) {
        sheets.push({
          sheet: "Fontes e ressalvas",
          columns: [{ width: 24 }, { width: 24 }, { width: 18 }, { width: 50 }, { width: 60 }],
          data: [
            header(["Fonte", "Papel", "Status", "Mensagem", "Endereço"]),
            ...(data.sources ?? []).map((source) => [source.name, source.role, statusText(source.status), source.message, source.href]),
            [],
            ["Ressalvas"],
            ...data.disclosures.map((disclosure) => [disclosure]),
            ...(notes.trim() ? [["Notas da diretoria"], [notes.trim()]] : []),
          ],
        });
      }

      if (sheets.length === 0) throw new Error("Selecione ao menos uma seção.");
      // write-excel-file aceita o formato multi-aba {sheet, columns, data} em runtime,
      // mas os tipos publicados não cobrem essa sobrecarga — cast pontual.
      const writeXlsx = writeXlsxFile as unknown as (sheets: unknown, options: { fileName: string }) => Promise<void>;
      await writeXlsx(sheets, { fileName: `grisomaq-${scope}-${new Date().toISOString().slice(0, 10)}.xlsx` });
      saveHistory("Excel");
      setMessage("Planilha Excel gerada com os filtros atuais.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível gerar a planilha.");
    } finally {
      setExporting(null);
    }
  }

  async function exportPdf() {
    if (!data || markets.length === 0) return;
    setExporting("PDF");
    setMessage("");
    try {
      const [{ jsPDF }, { autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
      const doc = new jsPDF({ unit: "mm", format: "a4" });
      const pageWidth = doc.internal.pageSize.getWidth();
      let y = 18;
      const addTitle = (title: string) => {
        if (y > 267) { doc.addPage(); y = 18; }
        doc.setTextColor(23, 73, 47);
        doc.setFontSize(12);
        doc.setFont("helvetica", "bold");
        doc.text(title, 15, y);
        y += 6;
      };
      const addTable = (head: string[], body: Array<Array<string | number>>) => {
        autoTable(doc, {
          startY: y,
          head: [head],
          body,
          margin: { left: 15, right: 15 },
          styles: { fontSize: 7, cellPadding: 2.2, textColor: [37, 52, 44] },
          headStyles: { fillColor: [30, 108, 67], textColor: [255, 255, 255] },
          alternateRowStyles: { fillColor: [241, 246, 242] },
        });
        y = ((doc as typeof doc & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 9;
      };

      doc.setTextColor(23, 73, 47);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.text("GRISOMAQ | INTELIGÊNCIA DE MERCADO", 15, y);
      y += 9;
      doc.setFontSize(18);
      doc.text(reportTitle, 15, y);
      y += 7;
      doc.setFont("helvetica", "normal");
      doc.setTextColor(90, 105, 96);
      doc.setFontSize(8);
      doc.text(`Gerado em ${formatDateTime(new Date().toISOString())} | Dados consultados em ${formatDateTime(data.updatedAt)}`, 15, y);
      y += 10;

      if (sections.prices) {
        addTitle("Cotações físicas");
        addTable(
          ["Mercado", "Preço", "Variação", "Referência", "Fonte / status"],
          markets.map((market) => [market.name, `${formatMoney(market.value)} ${market.unit}`, formatPercent(market.change), market.reference, `${market.source} / ${statusText(market.status)}`]),
        );
      }
      if (sections.history && histories.length) {
        addTitle(`Histórico público — janela de ${period} dias (${histories.length} fechamentos reais)`);
        addTable(
          ["Mercado", "Data", "Preço", "Variação"],
          histories.map(({ market, point }) => [market.name, point.date, `${formatMoney(point.value)} ${market.unit}`, formatPercent(point.change)]),
        );
      }
      if (sections.futures && futures.length) {
        addTitle("Contratos futuros públicos B3 — referência D-1");
        addTable(
          ["Mercado", "Contrato", "Preço", "Referência"],
          futures.map((future) => [commodityLabel(future.commodity), future.contract, `${formatMoney(future.value)} ${future.unit}`, future.reference]),
        );
      }
      if (sections.signals) {
        addTitle("Sinais transparentes de apoio à decisão");
        for (const signal of signals) {
          if (y > 260) { doc.addPage(); y = 18; }
          doc.setTextColor(29, 83, 52);
          doc.setFont("helvetica", "bold");
          doc.setFontSize(9);
          doc.text(`${commodityLabel(signal.commodity)} — ${signal.title} — score ${signal.score}/100`, 15, y);
          y += 5;
          doc.setTextColor(65, 78, 70);
          doc.setFont("helvetica", "normal");
          doc.setFontSize(7.5);
          const lines = doc.splitTextToSize(signal.summary, pageWidth - 30) as string[];
          doc.text(lines, 15, y);
          y += lines.length * 4 + 5;
        }
      }
      if (sections.alerts && alerts.length) {
        addTitle("Alertas objetivos");
        addTable(
          ["Nível", "Alerta", "Ação de verificação"],
          alerts.map((alert) => [alert.level, `${alert.title}: ${alert.description}`, alert.action]),
        );
      }
      if (sections.news && news.length) {
        addTitle(favoritesOnly ? "Notícias favoritas relacionadas" : "Notícias relacionadas");
        addTable(
          ["Categoria", "Título", "Fonte / data"],
          news.slice(0, 12).map((item) => [item.tag, item.title, `${item.source} / ${newsDate(item, data.updatedAt)}`]),
        );
      }
      if (notes.trim()) {
        addTitle("Notas da diretoria");
        doc.setTextColor(55, 69, 61);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        const lines = doc.splitTextToSize(notes.trim(), pageWidth - 30) as string[];
        doc.text(lines, 15, y);
        y += lines.length * 4 + 7;
      }
      if (sections.sources) {
        addTitle("Fontes, frequência e ressalvas");
        addTable(
          ["Fonte", "Papel", "Status", "Frequência"],
          data.sources.map((source) => [source.name, source.role, statusText(source.status), source.frequency]),
        );
        doc.setTextColor(85, 98, 90);
        doc.setFontSize(7);
        for (const disclosure of data.disclosures) {
          if (y > 275) { doc.addPage(); y = 18; }
          const lines = doc.splitTextToSize(`• ${disclosure}`, pageWidth - 30) as string[];
          doc.text(lines, 15, y);
          y += lines.length * 3.5 + 2;
        }
      }

      const pageCount = doc.getNumberOfPages();
      for (let page = 1; page <= pageCount; page += 1) {
        doc.setPage(page);
        doc.setTextColor(120, 130, 124);
        doc.setFontSize(6.5);
        doc.text("Documento de apoio. Confirme praça, liquidez, custos e política comercial antes de executar decisões.", 15, 290);
        doc.text(`${page}/${pageCount}`, pageWidth - 15, 290, { align: "right" });
      }
      doc.save(`grisomaq-${scope}-${new Date().toISOString().slice(0, 10)}.pdf`);
      saveHistory("PDF");
      setMessage("PDF executivo gerado com os filtros atuais.");
    } catch {
      setMessage("Não foi possível gerar o PDF. Tente novamente após atualizar as fontes.");
    } finally {
      setExporting(null);
    }
  }

  return (
    <main className="app-shell">
      <AppSidebar data={data} />

      <section className="workspace">
      <section className="page-hero no-print">
        <div><span className="section-kicker">Documento rastreável</span><h1>Centro de relatórios</h1><p>Monte a visão da diretoria, confira a prévia e gere arquivos PDF ou Excel com os mesmos filtros, referências e ressalvas exibidos na tela.</p></div>
        <div className="hero-stat"><div><small>Mercados selecionados</small><strong>{markets.length}</strong></div><div><small>Atualização</small><strong>{data ? formatDateTime(data.updatedAt) : "Consultando"}</strong></div></div>
      </section>

      {message && <div className="toast no-print" role="status"><span>{message}</span><button onClick={() => setMessage("")} aria-label="Fechar aviso">×</button></div>}

      <div className="report-layout">
        <aside className="report-builder no-print" aria-label="Configurar relatório">
          <span className="section-kicker">Configuração</span>
          <div className="builder-section">
            <h2>Escopo e período</h2>
            <div className="builder-grid">
              <label className="report-field">Mercados<select value={scope} onChange={(event) => setScope(event.target.value as "all" | CommodityId)}><option value="all">Milho, soja e boi</option><option value="milho">Milho</option><option value="soja">Soja</option><option value="boi">Boi gordo</option></select></label>
              <label className="report-field">Histórico<select value={period} onChange={(event) => setPeriod(Number(event.target.value))}><option value={7}>7 dias</option><option value={30}>30 dias</option><option value={90}>90 dias</option></select></label>
              <label className="checkbox-option full"><input type="checkbox" checked={favoritesOnly} onChange={(event) => setFavoritesOnly(event.target.checked)} /><span>Somente notícias favoritas deste dispositivo</span></label>
            </div>
          </div>

          <div className="builder-section">
            <h2>Seções do documento</h2>
            <div className="checkbox-list">
              {SECTION_OPTIONS.map((option) => <label className="checkbox-option" key={option.id}><input type="checkbox" checked={sections[option.id]} onChange={() => toggleSection(option.id)} /><span>{option.label}</span></label>)}
            </div>
          </div>

          <div className="builder-section">
            <h2>Notas da diretoria</h2>
            <label className="report-field"><span>Observações opcionais</span><textarea rows={5} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Registre cenário, premissas ou pontos para a reunião." /></label>
          </div>

          <div className="builder-section">
            <h2>Gerar arquivo</h2>
            <div className="report-toolbar"><button className="primary-button" onClick={() => void exportPdf()} disabled={!data || loading || exporting !== null}>{exporting === "PDF" ? "Gerando…" : "PDF"}</button><button className="secondary-button" onClick={() => void exportExcel()} disabled={!data || loading || exporting !== null}>{exporting === "Excel" ? "Gerando…" : "Excel"}</button></div>
            <button className="text-button full-button" onClick={() => window.print()} disabled={!data}>Imprimir a prévia</button>
            <p className="builder-note">O histórico abaixo fica somente neste dispositivo. Os arquivos são gerados no navegador e não são enviados para terceiros.</p>
          </div>

          <div className="report-history">
            <h2>Histórico neste dispositivo</h2>
            <div className="history-list">
              {history.length === 0 && <div className="empty-state compact">Nenhum arquivo gerado ainda.</div>}
              {history.map((item) => <div className="history-item" key={item.id}><span><strong>{item.format} · {item.scope}</strong><small>{formatDateTime(item.createdAt)}</small></span><button onClick={() => deleteHistory(item.id)} aria-label={`Remover registro ${item.title}`}>×</button></div>)}
            </div>
          </div>
        </aside>

        <section className="report-preview-page" aria-label="Prévia do relatório">
          <article className="preview-sheet">
            <div className="report-brand"><span><strong>GRISOMAQ</strong><small>INTELIGÊNCIA DE MERCADO</small></span><span>Gerado em {formatDateTime(new Date().toISOString())}<br />Dados consultados em {formatDateTime(data?.updatedAt)}</span></div>
            <h1>{reportTitle}</h1>
            <p className="report-subtitle">Documento de apoio à decisão · janela de histórico: {period} dias · atualização automática a cada 10 minutos</p>

            {!data && <div className="empty-state">{loading ? "Consultando fontes seguras…" : "Dados indisponíveis. Atualize as fontes antes de gerar o relatório."}</div>}

            {data && <>
              <div className="report-summary-grid">
                <div><small>Qualidade da consulta</small><strong>{data.mode === "verified" ? "Fontes principais validadas" : data.mode === "partial" ? "Consulta parcial" : "Fontes indisponíveis"}</strong></div>
                <div><small>Cotações disponíveis</small><strong>{markets.filter((market) => market.value !== null).length} de {markets.length}</strong></div>
                <div><small>Alertas no escopo</small><strong>{alerts.length}</strong></div>
              </div>

              {sections.prices && <ReportPrices markets={markets} />}
              {sections.history && <ReportHistoryTable histories={histories} period={period} />}
              {sections.futures && <ReportFutures futures={futures} />}
              {sections.signals && <ReportSignals signals={signals} />}
              {sections.alerts && <ReportAlerts alerts={alerts} />}
              {sections.news && <ReportNews news={news} favoritesOnly={favoritesOnly} updatedAt={data.updatedAt} />}

              {notes.trim() && <section className="report-section"><h2>Notas da diretoria</h2><div className="report-signal"><p>{notes}</p></div></section>}

              {sections.sources && <section className="report-section"><h2>Fontes e rastreabilidade</h2><table className="report-table"><thead><tr><th>Fonte</th><th>Papel</th><th>Status</th><th>Frequência</th></tr></thead><tbody>{data.sources.map((source) => <tr key={source.name}><td><a href={source.href} target="_blank" rel="noreferrer">{source.name}</a></td><td>{source.role}</td><td>{statusText(source.status)}</td><td>{source.frequency}</td></tr>)}</tbody></table><div className="source-footnote">{data.disclosures.map((disclosure) => <div key={disclosure}>• {disclosure}</div>)}<div>• Este documento não substitui validação de praça, liquidez, custos, mandato de risco ou aconselhamento profissional.</div></div></section>}
            </>}
          </article>
        </section>
      </div>
      </section>
    </main>
  );
}

function ReportPrices({ markets }: { markets: MarketItem[] }) {
  return <section className="report-section"><h2>Cotações físicas</h2><table className="report-table"><thead><tr><th>Mercado</th><th>Referência</th><th>Fonte</th><th>Preço</th></tr></thead><tbody>{markets.map((market) => <tr key={market.id}><td>{market.name}</td><td>{market.reference}</td><td>{market.source} · {statusText(market.status)}</td><td>{formatMoney(market.value)} {market.unit} ({formatPercent(market.change)})</td></tr>)}</tbody></table></section>;
}

function ReportHistoryTable({ histories, period }: { histories: Array<{ market: MarketItem; point: MarketItem["history"][number] }>; period: number }) {
  return <section className="report-section"><h2>Histórico público · janela de {period} dias · {histories.length} fechamentos reais</h2>{histories.length === 0 ? <div className="empty-state compact">A série disponível não cobre o período selecionado.</div> : <table className="report-table"><thead><tr><th>Mercado</th><th>Data</th><th>Variação</th><th>Preço</th></tr></thead><tbody>{histories.map(({ market, point }, index) => <tr key={`${market.id}-${point.date}-${index}`}><td>{market.name}</td><td>{point.date}</td><td>{formatPercent(point.change)}</td><td>{formatMoney(point.value)} {market.unit}</td></tr>)}</tbody></table>}</section>;
}

function ReportFutures({ futures }: { futures: NonNullable<MarketResponse["futures"]> }) {
  return <section className="report-section"><h2>Contratos futuros públicos B3 · referência D-1</h2>{futures.length === 0 ? <div className="empty-state compact">Nenhum contrato público compatível foi validado.</div> : <table className="report-table"><thead><tr><th>Mercado</th><th>Contrato</th><th>Referência</th><th>Preço</th></tr></thead><tbody>{futures.map((future, index) => <tr key={`${future.commodity}-${future.contract}-${index}`}><td>{commodityLabel(future.commodity)}</td><td>{future.contract}</td><td>{future.reference}</td><td>{formatMoney(future.value)} {future.unit}</td></tr>)}</tbody></table>}</section>;
}

function ReportSignals({ signals }: { signals: DecisionSignal[] }) {
  return <section className="report-section"><h2>Sinais transparentes de apoio à decisão</h2>{signals.map((signal) => <div className="report-signal" key={signal.commodity}><strong>{commodityLabel(signal.commodity)} · {signal.title} · score {signal.score}/100</strong><p>{signal.summary}</p><p>Tendência: {formatPercent(signal.trend)} · Prêmio futuro: {formatPercent(signal.basis)}. Score calculado por regras públicas; não representa probabilidade de acerto.</p></div>)}</section>;
}

function ReportAlerts({ alerts }: { alerts: MarketAlert[] }) {
  return <section className="report-section"><h2>Alertas objetivos</h2>{alerts.length === 0 ? <div className="empty-state compact">Nenhum gatilho objetivo foi acionado nesta consulta.</div> : <table className="report-table"><thead><tr><th>Nível</th><th>Alerta e descrição</th><th>Ação</th></tr></thead><tbody>{alerts.map((alert) => <tr key={alert.id}><td>{alert.level}</td><td><strong>{alert.title}</strong><br />{alert.description}</td><td>{alert.action}</td></tr>)}</tbody></table>}</section>;
}

function ReportNews({ news, favoritesOnly, updatedAt }: { news: NewsItem[]; favoritesOnly: boolean; updatedAt: string | null | undefined }) {
  return <section className="report-section"><h2>{favoritesOnly ? "Notícias favoritas relacionadas" : "Notícias relacionadas"}</h2>{news.length === 0 ? <div className="empty-state compact">Nenhuma notícia corresponde ao escopo atual.</div> : <div className="report-news-list">{news.slice(0, 12).map((item) => <a href={item.href} target="_blank" rel="noreferrer" key={item.id}><span className={`impact-badge ${item.impact}`}>{item.tag}</span><span><strong>{item.title}</strong><small>{item.source} · {newsDate(item, updatedAt)} · abrir publicação original ↗</small></span></a>)}</div>}</section>;
}
