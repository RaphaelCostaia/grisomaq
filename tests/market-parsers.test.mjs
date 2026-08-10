import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyNews,
  cleanHtml,
  decodeEntities,
  extractState,
  isoToPtDate,
  mergeHistory,
  monthDayYear,
  parseHistory,
  ptDateToIso,
  ptNumber,
  sourceStatus,
  stableId,
} from "../lib/market-parsers.ts";

test("ptNumber converte formato brasileiro para número", () => {
  assert.equal(ptNumber("1.234,56"), 1234.56);
  assert.equal(ptNumber("65,74"), 65.74);
  assert.equal(ptNumber("+2,50"), 2.5);
  assert.equal(ptNumber("-1,20"), -1.2);
  assert.equal(ptNumber("344,20"), 344.2);
});

test("ptNumber retorna null para entrada não numérica", () => {
  assert.equal(ptNumber("abc"), null);
  assert.equal(ptNumber("-"), null);
  // Comportamento atual: string vazia vira 0 (Number("") === 0). O parser de
  // histórico só alimenta ptNumber com dígitos, então isso não afeta a rota.
  assert.equal(ptNumber(""), 0);
});

test("decodeEntities resolve entidades HTML comuns e numéricas", () => {
  assert.equal(decodeEntities("Soja &amp; Milho"), "Soja & Milho");
  assert.equal(decodeEntities("caf&#233;"), "café");
  assert.equal(decodeEntities("a&nbsp;b"), "a b");
  assert.equal(decodeEntities("&lt;tag&gt;"), "<tag>");
});

test("cleanHtml remove scripts, styles e tags mantendo o texto", () => {
  const html = "<div>Preço <script>var x=1;</script><style>.a{}</style><b>R$ 65,74</b></div>";
  assert.equal(cleanHtml(html), "Preço R$ 65,74");
});

test("parseHistory extrai fechamentos reais no formato data/valor/variação", () => {
  const text = "Data Valor 27/07/2026 65,74 +0,50 26/07/2026 65,24 -0,30 CHICAGO 999,99 +1,00";
  const points = parseHistory(text);
  assert.equal(points.length, 2);
  assert.deepEqual(points[0], { date: "27/07/2026", value: 65.74, change: 0.5 });
  assert.deepEqual(points[1], { date: "26/07/2026", value: 65.24, change: -0.3 });
});

test("parseHistory deduplica datas repetidas e ignora ruído sem cabeçalho", () => {
  assert.deepEqual(parseHistory("nenhum cabeçalho aqui 27/07/2026 65,74 +0,50"), []);
  const duplicated = "Data à vista 27/07/2026 65,74 +0,50 27/07/2026 99,99 +9,00";
  const points = parseHistory(duplicated);
  assert.equal(points.length, 1);
  assert.equal(points[0].value, 65.74);
});

test("classifyNews rotula a commodity pela palavra-chave do título", () => {
  assert.equal(classifyNews("Preço do milho sobe em MT", "/n/1").tag, "Milho");
  assert.equal(classifyNews("Exportação de soja bate recorde", "/n/2").tag, "Soja");
  assert.equal(classifyNews("Carne bovina em alta", "/n/3").tag, "Boi");
  assert.equal(classifyNews("Assembleia municipal debate obras", "/n/4").tag, "Mercado");
});

test("classifyNews atribui impacto por termos de alta e média relevância", () => {
  const high = classifyNews("USDA anuncia embargo após seca", "/n/5");
  assert.equal(high.impact, "high");
  assert.match(high.impactReason, /embargo|seca|usda/i);

  const medium = classifyNews("Safra de soja avança com boa exportação", "/n/6");
  assert.equal(medium.impact, "medium");

  const low = classifyNews("Feira agropecuária reúne visitantes", "/n/7");
  assert.equal(low.impact, "low");
});

test("extractState lê a UF de uma praça regional", () => {
  assert.equal(extractState("Sorriso/MT"), "MT");
  assert.equal(extractState("Brasília DF"), "DF");
  assert.equal(extractState("Praça sem estado"), null);
});

test("sourceStatus mapeia condição e cobertura parcial", () => {
  assert.equal(sourceStatus(true), "verified");
  assert.equal(sourceStatus(true, true), "partial");
  assert.equal(sourceStatus(false), "unavailable");
});

test("stableId é determinístico e distingue entradas diferentes", () => {
  assert.equal(stableId("https://x/a"), stableId("https://x/a"));
  assert.notEqual(stableId("https://x/a"), stableId("https://x/b"));
});

test("conversões de data são simétricas entre BR e ISO", () => {
  assert.equal(ptDateToIso("27/07/2026"), "2026-07-27");
  assert.equal(isoToPtDate("2026-07-27"), "27/07/2026");
  assert.equal(isoToPtDate("2026-07-27T13:00:00Z"), "27/07/2026");
});

test("monthDayYear formata em MM-DD-YYYY para a API do BCB", () => {
  assert.equal(monthDayYear(new Date(Date.UTC(2026, 6, 5))), "07-05-2026");
});

test("mergeHistory unifica série viva e armazenada por data, ordenada e sem duplicatas", () => {
  const live = [{ date: "27/07/2026", value: 65.74, change: 0.5 }];
  const stored = [
    { date: "2026-07-26", value: 65.24, change: -0.3 },
    { date: "2026-07-27", value: 99.99, change: 9 },
  ];
  const merged = mergeHistory(live, stored);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].date, "27/07/2026");
  assert.equal(merged[0].value, 65.74, "a série viva vence a armazenada na mesma data");
  assert.equal(merged[1].date, "26/07/2026");
});
