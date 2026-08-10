import type {
  CommodityId,
  CurrencyItem,
  DecisionSignal,
  FutureContract,
  MarketAlert,
  MarketItem,
  NewsItem,
} from "./market-types";

export function formatMoney(value: number | null, digits = 2) {
  if (value === null || !Number.isFinite(value)) return "Indisponível";
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}

export function marketTrend(market: MarketItem, days = 30) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const ordered = market.history
    .filter((point) => {
      const parsed = parseBrazilianDate(point.date);
      return parsed === null || parsed >= cutoff;
    })
    .slice()
    .sort((a, b) => dateValue(a.date) - dateValue(b.date));

  if (ordered.length < 2) return null;
  const first = ordered[0].value;
  const last = ordered.at(-1)!.value;
  return first === 0 ? null : ((last / first) - 1) * 100;
}

export type ComparableFuture = {
  future: FutureContract;
  value: number;
  converted: boolean;
  rate: number | null;
};

// Medida física da unidade ("sc" ou "@"), ignorando a moeda.
function unitMeasure(unit: string) {
  if (unit.includes("/sc")) return "sc";
  if (unit.includes("/@")) return "@";
  return null;
}

// Expressa o preço de um contrato futuro na moeda do indicador físico (R$),
// convertendo contratos cotados em US$ pelo dólar PTAX quando a medida coincide.
function futureValueInMarketCurrency(
  future: FutureContract,
  marketUnit: string,
  currency?: CurrencyItem | null,
): { value: number; converted: boolean; rate: number | null } | null {
  if (comparableUnits(marketUnit, future.unit)) {
    return { value: future.value, converted: false, rate: null };
  }
  const measure = unitMeasure(marketUnit);
  const rate = currency?.value ?? null;
  if (
    marketUnit.startsWith("R$/") &&
    future.unit.startsWith("US$/") &&
    measure !== null &&
    measure === unitMeasure(future.unit) &&
    rate !== null &&
    rate > 0 &&
    currency?.status !== "unavailable"
  ) {
    return { value: future.value * rate, converted: true, rate };
  }
  return null;
}

// Primeiro vencimento cujo preço é comparável ao físico, já expresso em R$.
export function comparableFuture(
  market: MarketItem,
  futures: FutureContract[],
  currency?: CurrencyItem | null,
): ComparableFuture | null {
  for (const future of futures) {
    if (future.commodity !== market.id || future.value <= 0) continue;
    const priced = futureValueInMarketCurrency(future, market.unit, currency);
    if (priced) return { future, value: priced.value, converted: priced.converted, rate: priced.rate };
  }
  return null;
}

export function marketBasis(
  market: MarketItem,
  futures: FutureContract[],
  currency?: CurrencyItem | null,
) {
  if (market.value === null || market.value === 0) return null;
  const comparable = comparableFuture(market, futures, currency);
  if (!comparable) return null;
  return ((comparable.value / market.value) - 1) * 100;
}

export function buildDecisionSignal(
  market: MarketItem,
  futures: FutureContract[],
  news: NewsItem[],
  currency?: CurrencyItem | null,
): DecisionSignal {
  const trend = marketTrend(market, 30);
  const comparable = comparableFuture(market, futures, currency);
  const basis = market.value !== null && market.value !== 0 && comparable
    ? ((comparable.value / market.value) - 1) * 100
    : null;
  const relatedNews = news.filter((item) => item.tag.toLowerCase() === commodityLabel(market.id).toLowerCase());
  const highImpactNews = relatedNews.filter((item) => item.impact === "high").length;
  const components: DecisionSignal["components"] = [];
  let score = 50;

  if (trend !== null) {
    const effect = trend > 1.5 ? "positive" : trend < -1.5 ? "negative" : "neutral";
    score += trend < -1.5 ? 10 : trend > 1.5 ? -5 : 0;
    components.push({
      label: "Tendência observada",
      value: formatPercent(trend),
      effect,
      explanation: `${market.history.length} fechamentos públicos compõem a leitura disponível.`,
    });
  } else {
    components.push({
      label: "Tendência observada",
      value: "Série insuficiente",
      effect: "neutral",
      explanation: "O sistema não inventa uma tendência quando faltam fechamentos.",
    });
  }

  if (basis !== null && comparable) {
    const effect = basis >= 3 ? "positive" : basis <= 0 ? "negative" : "neutral";
    score += basis >= 3 ? 25 : basis >= 1 ? 12 : basis <= 0 ? -8 : 0;
    components.push({
      label: "Prêmio futuro x físico",
      value: formatPercent(basis),
      effect,
      explanation: comparable.converted
        ? `Contrato ${comparable.future.contract} convertido de US$ para R$ pelo dólar PTAX (R$ ${formatMoney(comparable.rate, 4)}) e comparado ao indicador físico.`
        : "Comparação entre o primeiro vencimento público compatível e o indicador físico.",
    });
  } else {
    components.push({
      label: "Prêmio futuro x físico",
      value: "Não comparável",
      effect: "neutral",
      explanation: market.id === "soja"
        ? "O contrato de soja está em US$/saca; a comparação depende do dólar PTAX, indisponível nesta consulta."
        : "Nenhum vencimento compatível foi validado nesta consulta.",
    });
  }

  components.push({
    label: "Notícias relevantes",
    value: `${relatedNews.length} monitoradas`,
    effect: highImpactNews > 0 ? "negative" : "neutral",
    explanation: highImpactNews > 0
      ? `${highImpactNews} notícia(s) recebeu(ram) impacto alto por regras de palavras-chave.`
      : "Nenhum título de alto impacto foi identificado nesta consulta.",
  });
  score += highImpactNews > 0 ? 5 : 0;
  score = Math.max(20, Math.min(92, Math.round(score)));

  if (basis !== null && basis >= 3) {
    return {
      commodity: market.id,
      action: "proteger",
      title: `Simular proteção parcial de ${market.name.toLowerCase()}`,
      summary: `O primeiro vencimento comparável apresenta prêmio de ${formatPercent(basis)} sobre o físico. Antes de executar, valide custos, volume e política comercial.`,
      score,
      basis,
      trend,
      components,
    };
  }

  if (trend !== null && trend < -1.5) {
    return {
      commodity: market.id,
      action: "acompanhar",
      title: `Revisar exposição de ${market.name.toLowerCase()}`,
      summary: `A série pública recua ${formatPercent(Math.abs(trend))} no período disponível. O sinal recomenda revisão, não uma venda automática.`,
      score,
      basis,
      trend,
      components,
    };
  }

  return {
    commodity: market.id,
    action: "aguardar",
    title: `Aguardar confirmação para ${market.name.toLowerCase()}`,
    summary: "Os dados disponíveis ainda não formam uma combinação forte de tendência e prêmio. Mantenha o monitoramento e simule cenários antes de decidir.",
    score,
    basis,
    trend,
    components,
  };
}

export function buildAlerts(
  markets: MarketItem[],
  futures: FutureContract[],
  news: NewsItem[],
  currency?: CurrencyItem | null,
): MarketAlert[] {
  const alerts: MarketAlert[] = [];

  for (const market of markets) {
    if (market.status === "unavailable" || market.value === null) {
      alerts.push({
        id: `source-${market.id}`,
        commodity: market.id,
        level: "high",
        category: "source",
        title: `${market.name}: dado indisponível`,
        description: "A fonte não devolveu um fechamento validável nesta consulta.",
        action: "Não tomar decisão com base no último valor conhecido.",
      });
      continue;
    }

    if (market.change !== null && Math.abs(market.change) >= 1) {
      alerts.push({
        id: `price-${market.id}-${market.reference}`,
        commodity: market.id,
        level: Math.abs(market.change) >= 2 ? "high" : "medium",
        category: "price",
        title: `${market.name}: movimento de ${formatPercent(market.change)}`,
        description: `Variação do fechamento informado por ${market.source}.`,
        action: "Comparar o movimento com a praça e o vencimento utilizados pela Grisomaq.",
      });
    }

    const basis = marketBasis(market, futures, currency);
    if (basis !== null && basis >= 3) {
      alerts.push({
        id: `basis-${market.id}-${basis.toFixed(2)}`,
        commodity: market.id,
        level: basis >= 5 ? "high" : "medium",
        category: "basis",
        title: `${market.name}: prêmio futuro de ${formatPercent(basis)}`,
        description: "O primeiro vencimento comparável está acima do indicador físico.",
        action: "Abrir o simulador e testar uma proteção parcial de margem.",
      });
    }
  }

  for (const item of news.filter((newsItem) => newsItem.impact === "high").slice(0, 2)) {
    alerts.push({
      id: `news-${item.id}`,
      commodity: tagToCommodity(item.tag),
      level: "medium",
      category: "news",
      title: `${item.tag}: notícia de alto impacto`,
      description: item.title,
      action: "Abrir a notícia original e validar o efeito sobre preço, oferta ou demanda.",
    });
  }

  return alerts.slice(0, 8);
}

export function commodityLabel(id: CommodityId) {
  return id === "milho" ? "Milho" : id === "soja" ? "Soja" : "Boi";
}

function comparableUnits(spot: string, future: string) {
  return spot.includes("R$/sc") && future.includes("R$/sc") || spot === "R$/@" && future === "R$/@";
}

function parseBrazilianDate(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return Date.UTC(year, month - 1, day);
  }
  const [day, month, year] = value.split("/").map(Number);
  if (!day || !month || !year) return null;
  return Date.UTC(year, month - 1, day);
}

function dateValue(value: string) {
  return parseBrazilianDate(value) ?? 0;
}

function tagToCommodity(tag: NewsItem["tag"]): CommodityId | null {
  if (tag === "Milho") return "milho";
  if (tag === "Soja") return "soja";
  if (tag === "Boi") return "boi";
  return null;
}
