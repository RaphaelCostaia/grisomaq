// Funções puras de parsing e normalização usadas pela rota /api/market.
// Isoladas aqui (sem dependências de Cloudflare/Next) para permitir testes
// unitários de comportamento e proteger o scraping contra mudanças de layout.
import type { DataStatus, ImpactLevel, MarketPoint, NewsItem } from "./market-types";

export function decodeEntities(value: string) {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#34;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

export function cleanHtml(html: string) {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

export function ptNumber(value: string) {
  const parsed = Number(value.replace(/\./g, "").replace(",", ".").replace("+", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseHistory(text: string): MarketPoint[] {
  const starts = [text.indexOf("Data Valor"), text.indexOf("Data à vista")].filter((index) => index >= 0);
  if (!starts.length) return [];
  const start = Math.min(...starts);
  const chicago = text.indexOf("CHICAGO", start);
  const block = text.slice(start, chicago > start ? chicago : Math.min(text.length, start + 6000));
  const points: MarketPoint[] = [];
  const seen = new Set<string>();
  const pattern = /(\d{2}\/\d{2}\/\d{4})\s+([0-9.]+,[0-9]+)\s+([+-]?[0-9.,]+)/g;
  for (const match of block.matchAll(pattern)) {
    const value = ptNumber(match[2]);
    const change = ptNumber(match[3]);
    if (value === null || seen.has(match[1])) continue;
    seen.add(match[1]);
    points.push({ date: match[1], value, change });
  }
  return points.slice(0, 60);
}

export function classifyNews(title: string, href: string) {
  const value = `${title} ${href}`.toLowerCase();
  const tag: NewsItem["tag"] = value.includes("milho")
    ? "Milho"
    : value.includes("soja")
      ? "Soja"
      : value.includes("boi") || value.includes("carne") || value.includes("pecu")
        ? "Boi"
        : value.includes("clima") || value.includes("seca") || value.includes("chuva") || value.includes("el niño")
          ? "Clima"
          : value.includes("política") || value.includes("tarifa") || value.includes("governo")
            ? "Política"
            : "Mercado";
  const highKeywords = ["embargo", "tarifa", "seca", "geada", "guerra", "usda", "recorde", "proibição"];
  const mediumKeywords = ["safra", "colheita", "exporta", "preço", "b3", "cepea", "câmbio", "estoque"];
  const high = highKeywords.filter((keyword) => value.includes(keyword));
  const medium = mediumKeywords.filter((keyword) => value.includes(keyword));
  const impact: ImpactLevel = high.length ? "high" : medium.length ? "medium" : "low";
  const matched = high.length ? high : medium;
  return {
    tag,
    impact,
    impactReason: matched.length
      ? `Classificação automática por termos: ${matched.slice(0, 3).join(", ")}.`
      : "Título sem gatilho forte nas regras atuais.",
  };
}

export function extractState(location: string) {
  return location.match(/\/([A-Z]{2})\b/)?.[1] ?? location.match(/\b(DF)\b/)?.[1] ?? null;
}

export function sourceStatus(condition: boolean, partial = false): DataStatus {
  return condition ? (partial ? "partial" : "verified") : "unavailable";
}

export function stableId(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0).toString(36);
}

export function ptDateToIso(value: string) {
  const [day, month, year] = value.split("/");
  return day && month && year ? `${year}-${month}-${day}` : value;
}

export function isoToPtDate(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-");
  return day && month && year ? `${day}/${month}/${year}` : value;
}

export function monthDayYear(date: Date) {
  return `${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}-${date.getUTCFullYear()}`;
}

export function mergeHistory(primary: MarketPoint[], stored: MarketPoint[]) {
  const merged = [...primary, ...stored.map((point) => ({ ...point, date: point.date.includes("-") ? isoToPtDate(point.date) : point.date }))];
  const unique = new Map<string, MarketPoint>();
  for (const point of merged) if (!unique.has(point.date)) unique.set(point.date, point);
  return [...unique.values()].sort((a, b) => ptDateToIso(b.date).localeCompare(ptDateToIso(a.date))).slice(0, 180);
}
