import { NextResponse } from "next/server";
import { getSessionUser, readSessionToken } from "../../../db/auth";
import { readStoredHistory } from "../../../db/market";
import {
  collectMarkets,
  definitions,
  fetchJson,
  fetchNa,
  fetchText,
  NOTICIAS_BASE,
  type FetchResult,
} from "../../../lib/market-collect";
import {
  classifyNews,
  cleanHtml,
  extractState,
  isoToPtDate,
  mergeHistory,
  monthDayYear,
  ptDateToIso,
  ptNumber,
  sourceStatus,
  stableId,
} from "../../../lib/market-parsers";
import type {
  CurrencyItem,
  FutureContract,
  MarketResponse,
  NewsItem,
  RegionalQuote,
  SourceItem,
} from "../../../lib/market-types";

export const dynamic = "force-dynamic";

const CONAB_NEWS = "https://www.gov.br/conab/pt-br/assuntos/noticias";
const BCB_DATASET = "https://dadosabertos.bcb.gov.br/pt_BR/dataset/dolar-americano-usd-todos-os-boletins-diarios";

// Coleta dos indicadores físicos (definitions, fetch helpers, parseMarket e a
// redundância NA → CEPEA) vive em lib/market-collect.ts, compartilhada com o
// coletor agendado (instrumentation.ts).

function parseFutures(definition: (typeof definitions)[number], quoteResult: FetchResult): FutureContract[] {
  if (!quoteResult.ok) return [];
  const text = cleanHtml(quoteResult.text);
  const start = text.indexOf("B3 (Pregão Regular)");
  if (start < 0) return [];
  const updatedIndex = text.indexOf("Atualizado em:", start);
  if (updatedIndex < 0) return [];
  const block = text.slice(start, updatedIndex);
  const referenceMatch = text.slice(updatedIndex, updatedIndex + 80).match(/Atualizado em:\s*(\d{2}\/\d{2}\/\d{4})/);
  const unitMatch = block.match(/Fechamento \(([^)]+)\)/);
  const unit = unitMatch?.[1]?.replace("US$", "US$") ?? definition.unit;
  const rows: FutureContract[] = [];
  const seen = new Set<string>();
  const pattern = /([A-Za-zÀ-ÿçÇ]+\/\d{4})\s+([0-9.]+,[0-9]+)\s+([+-]?[0-9.,]+|-)/g;
  for (const match of block.matchAll(pattern)) {
    const value = ptNumber(match[2]);
    if (value === null || value <= 0 || seen.has(match[1])) continue;
    seen.add(match[1]);
    rows.push({
      commodity: definition.id,
      contract: match[1],
      value,
      change: match[3] === "-" ? null : ptNumber(match[3]),
      unit,
      source: "B3",
      provider: "Notícias Agrícolas",
      reference: referenceMatch?.[1] ?? "Fechamento público",
      href: definition.quoteUrl,
      status: "delayed",
    });
  }
  return rows.slice(0, 8);
}

function parseRegionalQuotes(definition: (typeof definitions)[number], quoteResult: FetchResult): RegionalQuote[] {
  if (!quoteResult.ok) return [];
  const text = cleanHtml(quoteResult.text);
  const start = text.indexOf(definition.regionalAnchor);
  if (start < 0) return [];
  const updatedIndex = text.indexOf("Atualizado em:", start);
  const fallbackEnd = definition.id === "boi" ? text.indexOf("Carne", start + 100) : -1;
  const end = updatedIndex > start
    ? updatedIndex
    : fallbackEnd > start
      ? fallbackEnd
      : Math.min(text.length, start + 8000);
  let block = text.slice(start, end);
  const headerEnd = block.indexOf("Variação (%)");
  if (headerEnd >= 0) block = block.slice(headerEnd + "Variação (%)".length);
  const reference = definition.id === "boi"
    ? "Tabela pública consultada"
    : text.slice(updatedIndex, updatedIndex + 80).match(/Atualizado em:\s*(\d{2}\/\d{2}\/\d{4})/)?.[1] ?? "Consulta atual";

  if (definition.id === "boi") return parseBoiRegional(block, definition, reference);

  const rows: RegionalQuote[] = [];
  const pattern = /(.+?)\s+([0-9.]+,[0-9]{2})\s+([+-]?[0-9.,]+|-)(?=\s|$)/g;
  for (const match of block.matchAll(pattern)) {
    const location = match[1].replace(/^\s+|\s+$/g, "").replace(/s\/ cotação\s*-\s*/gi, "").trim();
    const value = ptNumber(match[2]);
    if (value === null || location.length < 3 || location.length > 120 || /s\/ cotação/i.test(match[1])) continue;
    rows.push({
      commodity: definition.id,
      location,
      state: extractState(location),
      value,
      change: match[3] === "-" ? null : ptNumber(match[3]),
      unit: definition.unit,
      source: "Notícias Agrícolas",
      reference,
    });
  }
  return rows.slice(0, 35);
}

function parseBoiRegional(block: string, definition: (typeof definitions)[number], reference: string) {
  const rows: RegionalQuote[] = [];
  const pattern = /\b([A-Z]{2}|Alagoas|Acre|Roraima)\s+([A-Za-zÀ-ÿ.* ]+?)\s+([0-9]+,[0-9]{2})\s+([0-9]+,[0-9]{2})\s+([0-9]+,[0-9]{2})/g;
  for (const match of block.matchAll(pattern)) {
    const value = ptNumber(match[3]);
    if (value === null) continue;
    const state = match[1].length === 2 ? match[1] : null;
    rows.push({
      commodity: definition.id,
      location: `${match[1]} ${match[2].trim()}`,
      state,
      value,
      change: null,
      unit: definition.unit,
      source: "Scot Consultoria via Notícias Agrícolas",
      reference,
    });
  }
  return rows.slice(0, 35);
}

function parseNoticiasAgricolas(html: string): NewsItem[] {
  const items: NewsItem[] = [];
  const seen = new Set<string>();
  const pattern = /<a[^>]+href="(\/noticias\/(?:soja|milho|boi|agronegocio|tempo-e-clima|politica-agricola|politica-economia|graos)[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(pattern)) {
    const href = `${NOTICIAS_BASE}${match[1]}`;
    if (seen.has(href)) continue;
    const content = match[2];
    const titleMatch = content.match(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/i);
    const title = cleanHtml(titleMatch?.[1] ?? content);
    if (title.length < 25 || title.length > 240) continue;
    const summaryMatch = content.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const summary = summaryMatch ? cleanHtml(summaryMatch[1]) : null;
    const classification = classifyNews(title, href);
    seen.add(href);
    items.push({
      id: stableId(href),
      title,
      summary: summary && summary !== title ? summary.slice(0, 260) : null,
      href,
      source: "Notícias Agrícolas",
      publishedAt: null,
      ...classification,
    });
  }
  return items.slice(0, 16);
}

function parseConabNews(html: string): NewsItem[] {
  const items: NewsItem[] = [];
  const relevant = /(milho|soja|boi|gr[aã]os|safra|pre[cç]os|mercado|estoque|produ[cç][aã]o)/i;
  for (const article of html.matchAll(/<article class="tileItem[\s\S]*?<\/article>/gi)) {
    const href = article[0].match(/<a[^>]+class="summary url"[^>]+href="([^"]+)"/i)?.[1];
    const title = cleanHtml(article[0].match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)?.[1] ?? "");
    if (!href || !title || !relevant.test(title)) continue;
    const summary = cleanHtml(article[0].match(/<span class="description">([\s\S]*?)<\/span>/i)?.[1] ?? "") || null;
    const date = article[0].match(/icon-day[^>]*><\/i>\s*(\d{2}\/\d{2}\/\d{4})/i)?.[1] ?? null;
    const time = article[0].match(/icon-hour[^>]*><\/i>\s*([0-9]{1,2}h[0-9]{2})/i)?.[1] ?? null;
    const classification = classifyNews(title, href);
    items.push({
      id: stableId(href),
      title,
      summary,
      href,
      source: "Conab",
      publishedAt: date ? `${date}${time ? ` ${time}` : ""}` : null,
      ...classification,
    });
  }
  return items.slice(0, 8);
}

async function fetchCurrency(): Promise<CurrencyItem> {
  const end = new Date();
  // ~100 dias corridos para cobrir ~90 dias úteis reais de PTAX (dado oficial BCB).
  const start = new Date(end.getTime() - 100 * 24 * 60 * 60 * 1000);
  const api = `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)?%40dataInicial='${monthDayYear(start)}'&%40dataFinalCotacao='${monthDayYear(end)}'&%24format=json`;
  const data = await fetchJson<{ value?: Array<{ cotacaoCompra: number; cotacaoVenda: number; dataHoraCotacao: string; tipoBoletim?: string }> }>(api);
  const rows = (data?.value ?? []).slice().sort((a, b) => a.dataHoraCotacao.localeCompare(b.dataHoraCotacao));
  const daily = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const date = row.dataHoraCotacao.slice(0, 10);
    const existing = daily.get(date);
    if (!existing || row.tipoBoletim === "Fechamento" || row.dataHoraCotacao > existing.dataHoraCotacao) daily.set(date, row);
  }
  const closings = [...daily.entries()].sort(([a], [b]) => b.localeCompare(a));
  const latest = closings[0];
  const previous = closings[1];
  if (!latest || !Number.isFinite(latest[1].cotacaoVenda)) {
    return {
      symbol: "USD/BRL",
      name: "Dólar PTAX",
      value: null,
      change: null,
      source: "Banco Central do Brasil",
      reference: "Sem fechamento validado",
      observedAt: null,
      status: "unavailable",
      directUrl: BCB_DATASET,
      history: [],
    };
  }
  const change = previous
    ? ((latest[1].cotacaoVenda / previous[1].cotacaoVenda) - 1) * 100
    : null;
  return {
    symbol: "USD/BRL",
    name: "Dólar PTAX",
    value: latest[1].cotacaoVenda,
    change,
    source: "Banco Central do Brasil",
    reference: isoToPtDate(latest[0]),
    observedAt: latest[0],
    status: "verified",
    directUrl: BCB_DATASET,
    history: closings.map(([date, row], index) => ({
      date: isoToPtDate(date),
      value: row.cotacaoVenda,
      change: index < closings.length - 1
        ? ((row.cotacaoVenda / closings[index + 1][1].cotacaoVenda) - 1) * 100
        : null,
    })),
  };
}

export async function GET(request: Request) {
  const user = await getSessionUser(readSessionToken(request));
  if (!user) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  const collectedAt = new Date().toISOString();
  const nextRefreshAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  // Os indicadores físicos (com redundância NA → CEPEA) e a persistência da janela
  // ficam em collectMarkets; aqui buscamos em paralelo o resto da resposta ao vivo.
  const [collected, quoteResults, noticiasResult, conabResult, currency] = await Promise.all([
    collectMarkets(collectedAt),
    Promise.all(definitions.map((definition) => fetchNa(definition.quoteUrl))),
    fetchNa(NOTICIAS_BASE),
    fetchText(CONAB_NEWS),
    fetchCurrency(),
  ]);

  let markets = collected;
  const futures = definitions.flatMap((definition, index) => parseFutures(definition, quoteResults[index]));
  const regionalQuotes = definitions.flatMap((definition, index) => parseRegionalQuotes(definition, quoteResults[index]));
  const news = [
    ...(noticiasResult.ok ? parseNoticiasAgricolas(noticiasResult.text) : []),
    ...(conabResult.ok ? parseConabNews(conabResult.text) : []),
  ].filter((item, index, list) => list.findIndex((candidate) => candidate.href === item.href) === index).slice(0, 24);

  // Camada 3: junta a janela ao vivo com o histórico salvo no banco; se nem NA nem
  // CEPEA responderam, mostra o último fechamento salvo ("última consulta").
  try {
    const storedHistories = await Promise.all(markets.map((market) => readStoredHistory(market.id)));
    markets = markets.map((market, index) => {
      const history = mergeHistory(market.history, storedHistories[index]);
      // Camada 3: se nem NA nem CEPEA responderam, mostra o último fechamento
      // salvo (com data e marcado como "última consulta") — nunca perde tudo.
      if (market.value === null && history.length > 0) {
        const last = history[0];
        return {
          ...market,
          history,
          value: last.value,
          change: last.change,
          status: "delayed",
          reference: `${last.date} · última consulta`,
          observedAt: ptDateToIso(last.date),
        };
      }
      return { ...market, history };
    });
  } catch {
    // The live payload remains usable if the historical store is temporarily unavailable.
  }

  const physicalCount = markets.filter((market) => market.status === "verified").length;
  const sources: SourceItem[] = [
    {
      name: "CEPEA/Esalq",
      role: "Indicadores físicos diários (com redundância)",
      href: "https://www.cepea.esalq.usp.br/br/indicador/",
      status: sourceStatus(markets.some((market) => market.value !== null), markets.some((market) => market.value === null || market.status === "delayed")),
      message: `${physicalCount}/3 indicadores ao vivo. Redundância em 3 camadas: Notícias Agrícolas (beta/www) → widget oficial do CEPEA (milho, boi e soja/Paranaguá) → último fechamento salvo no banco.`,
      checkedAt: collectedAt,
      frequency: "Fechamento diário",
    },
    {
      name: "B3",
      role: "Contratos futuros",
      href: "https://www.b3.com.br/pt_br/market-data-e-indices/servicos-de-dados/market-data/",
      status: futures.length ? "delayed" : "unavailable",
      message: futures.length
        ? "Fechamentos públicos D-1. Feed intradiário licenciado ainda não ativado."
        : "Nenhum contrato público foi validado nesta consulta.",
      checkedAt: collectedAt,
      frequency: "Fechamento D-1",
    },
    {
      name: "Banco Central",
      role: "Dólar PTAX",
      href: BCB_DATASET,
      status: currency.status,
      message: currency.value !== null ? `PTAX oficial de ${currency.reference}.` : "API oficial indisponível nesta consulta.",
      checkedAt: collectedAt,
      frequency: "Fechamento diário",
    },
    {
      name: "Conab",
      role: "Safra, preços e fundamentos",
      href: CONAB_NEWS,
      status: conabResult.ok ? "verified" : "unavailable",
      message: conabResult.ok ? "Notícias e fundamentos oficiais conectados." : "Portal oficial indisponível nesta consulta.",
      checkedAt: collectedAt,
      frequency: "Conforme publicação oficial",
    },
    {
      name: "Notícias Agrícolas",
      role: "Cotações públicas e notícias",
      href: NOTICIAS_BASE,
      status: noticiasResult.ok && quoteResults.some((result) => result.ok) ? "verified" : "partial",
      message: `${news.filter((item) => item.source === "Notícias Agrícolas").length} notícias com link direto; atua também como provedor das páginas públicas de cotações.`,
      checkedAt: collectedAt,
      frequency: "Consulta a cada 10 minutos",
    },
    {
      name: "Safras & Scot",
      role: "Análises comerciais licenciadas",
      href: "https://safras.com.br/plataformas/",
      status: "partial",
      message: "Integração editorial completa preparada, mas depende de contrato e autorização de redistribuição.",
      checkedAt: collectedAt,
      frequency: "Aguardando licenciamento",
    },
  ];

  const mode: MarketResponse["mode"] = physicalCount === 3 && currency.value !== null && news.length > 0
    ? "verified"
    : physicalCount > 0 || currency.value !== null || news.length > 0
      ? "partial"
      : "unavailable";

  const payload: MarketResponse = {
    markets,
    futures,
    regionalQuotes,
    currency,
    news,
    sources,
    updatedAt: collectedAt,
    mode,
    nextRefreshAt,
    disclosures: [
      "Indicadores físicos são fechamentos diários, não cotações intradiárias.",
      "Contratos B3 exibidos usam fechamento público D-1 via Notícias Agrícolas; tempo real exige licença comercial.",
      "O score executivo é uma regra transparente de apoio e não uma ordem automática de compra ou venda.",
    ],
  };

  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "public, max-age=0, s-maxage=600, stale-while-revalidate=600",
      "X-Grisomaq-Data-Mode": mode,
    },
  });
}
