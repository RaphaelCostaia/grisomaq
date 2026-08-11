// Núcleo de coleta dos indicadores físicos (milho/soja/boi) — compartilhado entre
// a rota /api/market (resposta ao vivo) e o coletor agendado (instrumentation.ts),
// para o histórico acumular no banco mesmo sem ninguém abrir o painel.
import { persistMarketSnapshots } from "../db/market";
import { cleanHtml, parseHistory, ptDateToIso, ptNumber } from "./market-parsers";
import type { CommodityId, MarketItem } from "./market-types";

export const NOTICIAS_BASE = "https://www.noticiasagricolas.com.br";
export const NOTICIAS_BETA = "https://beta.noticiasagricolas.com.br";
// Widget oficial e público do CEPEA (2ª fonte independente do Notícias Agrícolas).
const CEPEA_WIDGET = "https://www.cepea.org.br/br/widgetproduto.js.php?fonte=carousel&id_indicador%5B%5D=";

export const definitions: Array<{
  id: CommodityId;
  name: string;
  shortName: string;
  unit: string;
  quoteUrl: string;
  historyUrl: string;
  regionalAnchor: string;
  cepeaId?: string; // id do indicador no widget do CEPEA (fonte de fallback)
  cepeaNote?: string; // praça do CEPEA quando difere do indicador primário (transparência)
}> = [
  {
    id: "milho",
    name: "Milho",
    shortName: "Milho ESALQ/B3",
    unit: "R$/sc 60 kg",
    quoteUrl: `${NOTICIAS_BETA}/cotacoes/milho`,
    historyUrl: `${NOTICIAS_BETA}/cotacoes/milho/indicador-cepea-esalq-milho`,
    regionalAnchor: "Milho - Mercado Físico Fonte: Notícias Agrícolas",
    cepeaId: "77",
  },
  {
    id: "soja",
    name: "Soja",
    shortName: "Soja CEPEA/ESALQ Paraná",
    unit: "R$/sc 60 kg",
    quoteUrl: `${NOTICIAS_BETA}/cotacoes/soja`,
    historyUrl: `${NOTICIAS_BETA}/cotacoes/soja/indicador-cepea-esalq-soja-parana`,
    regionalAnchor: "Soja - Mercado Físico Fonte: Notícias Agrícolas",
    cepeaId: "92", // Soja CEPEA/ESALQ Paranaguá (sc 60kg) — praça alternativa, mesma unidade
    cepeaNote: "CEPEA Paranaguá",
  },
  {
    id: "boi",
    name: "Boi gordo",
    shortName: "Boi gordo CEPEA/B3 SP",
    unit: "R$/@",
    quoteUrl: `${NOTICIAS_BETA}/cotacoes/boi-gordo`,
    historyUrl: `${NOTICIAS_BETA}/cotacoes/boi-gordo/boi-gordo-indicador-esalq-bmf`,
    regionalAnchor: "Mercado Físico - Scot Consultoria",
    cepeaId: "2",
  },
];

export type FetchResult = { ok: boolean; text: string; status: number | null };

export async function fetchText(url: string): Promise<FetchResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6500);
  try {
    const response = await fetch(url, {
      headers: { "user-agent": "Grisomaq-Market-Intelligence/2.0 (+source-attribution)" },
      signal: controller.signal,
    });
    return { ok: response.ok, text: response.ok ? await response.text() : "", status: response.status };
  } catch {
    return { ok: false, text: "", status: null };
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchJson<T>(url: string): Promise<T | null> {
  const result = await fetchText(url);
  if (!result.ok) return null;
  try {
    return JSON.parse(result.text) as T;
  } catch {
    return null;
  }
}

// Redundância de endpoint: tenta o Notícias Agrícolas (beta) e, se falhar,
// o mesmo caminho no domínio www — sobrevive à queda de um dos dois.
export async function fetchNa(url: string): Promise<FetchResult> {
  const primary = await fetchText(url);
  if (primary.ok && primary.text) return primary;
  const alt = url.includes("beta.noticiasagricolas")
    ? url.replace("beta.noticiasagricolas", "www.noticiasagricolas")
    : url.replace("www.noticiasagricolas", "beta.noticiasagricolas");
  return alt === url ? primary : fetchText(alt);
}

// 2ª fonte independente: widget público oficial do CEPEA (valor + data do dia).
// Usa user-agent de navegador — o CEPEA bloqueia UAs não-navegador.
export async function fetchCepea(id: string): Promise<{ value: number; date: string } | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6500);
  try {
    const response = await fetch(`${CEPEA_WIDGET}${id}`, {
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "accept-language": "pt-BR,pt;q=0.9",
      },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const text = cleanHtml(await response.text());
    const valueMatch = text.match(/R\$\s*([\d.]+,\d{2})/);
    if (!valueMatch) return null;
    const value = ptNumber(valueMatch[1]);
    if (value === null || value <= 0) return null;
    return { value, date: text.match(/(\d{2}\/\d{2}\/\d{4})/)?.[1] ?? "" };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export function unavailableMarket(definition: (typeof definitions)[number]): MarketItem {
  return {
    id: definition.id,
    name: definition.name,
    shortName: definition.shortName,
    value: null,
    change: null,
    unit: definition.unit,
    source: "CEPEA/Esalq",
    provider: "Notícias Agrícolas",
    reference: "Sem fechamento validado",
    observedAt: null,
    status: "unavailable",
    directUrl: definition.historyUrl,
    history: [],
  };
}

export function parseMarket(definition: (typeof definitions)[number], historyResult: FetchResult): MarketItem {
  if (!historyResult.ok) return unavailableMarket(definition);
  const history = parseHistory(cleanHtml(historyResult.text));
  const latest = history[0];
  if (!latest) return unavailableMarket(definition);
  return {
    id: definition.id,
    name: definition.name,
    shortName: definition.shortName,
    value: latest.value,
    change: latest.change,
    unit: definition.unit,
    source: "CEPEA/Esalq",
    provider: "Notícias Agrícolas",
    reference: latest.date,
    observedAt: ptDateToIso(latest.date),
    status: "verified",
    directUrl: definition.historyUrl,
    history,
  };
}

// Busca os indicadores físicos (com redundância NA → CEPEA), persiste a janela no
// banco e retorna os markets. Usada pela rota e pelo coletor agendado.
export async function collectMarkets(collectedAt: string): Promise<MarketItem[]> {
  const [historyResults, cepeaResults] = await Promise.all([
    Promise.all(definitions.map((definition) => fetchNa(definition.historyUrl))),
    Promise.all(definitions.map((definition) => (definition.cepeaId ? fetchCepea(definition.cepeaId) : Promise.resolve(null)))),
  ]);

  let markets = definitions.map((definition, index) => parseMarket(definition, historyResults[index]));

  // Camada 2 de redundância: se o Notícias Agrícolas não trouxe o valor físico,
  // usa o widget oficial do CEPEA (fonte independente): milho, boi e soja (Paranaguá).
  markets = markets.map((market, index) => {
    if (market.value !== null) return market;
    const cepea = cepeaResults[index];
    if (!cepea) return market;
    const note = definitions[index].cepeaNote;
    return {
      ...market,
      // Se a praça do CEPEA difere do indicador primário (soja: Paranaguá),
      // deixa explícito no nome curto para não representar Paranaguá como Paraná.
      shortName: note ? `${market.name} · ${note}` : market.shortName,
      value: cepea.value,
      change: null,
      status: "delayed",
      provider: note ? `CEPEA (${note})` : "CEPEA (widget oficial)",
      reference: note ? `${note} · ${cepea.date || "fechamento"}` : (cepea.date || "Fechamento CEPEA"),
      observedAt: cepea.date ? ptDateToIso(cepea.date) : null,
      history: cepea.date ? [{ date: cepea.date, value: cepea.value, change: null }] : market.history,
    };
  });

  // A resposta ao vivo continua utilizável mesmo se o armazenamento falhar.
  try {
    await persistMarketSnapshots(markets, collectedAt);
  } catch (error) {
    console.error("[collect] persistência falhou:", error);
  }
  return markets;
}

let collectorStarted = false;

// Coletor no servidor: roda sozinho (independe de acesso ao painel), captando o
// fechamento diário assim que a fonte publica. 1ª coleta ~30s após subir, depois 6/6h.
export function startMarketCollector(): void {
  if (collectorStarted) return;
  collectorStarted = true;
  const run = () => {
    void collectMarkets(new Date().toISOString()).then(
      (markets) => console.log(`[collect] ${markets.filter((m) => m.value !== null).length}/3 indicadores coletados`),
      (error) => console.error("[collect] coleta falhou:", error),
    );
  };
  setTimeout(run, 30_000);
  const timer = setInterval(run, 6 * 60 * 60 * 1000);
  if (typeof timer.unref === "function") timer.unref();
}
