import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDecisionSignal,
  comparableFuture,
  marketBasis,
} from "../lib/market-insights.ts";

const RATE = 5.0666;

function market(overrides = {}) {
  return {
    id: "soja",
    name: "Soja",
    shortName: "Soja CEPEA",
    value: 140.26,
    change: 0.1,
    unit: "R$/sc 60 kg",
    source: "CEPEA/Esalq",
    provider: "Notícias Agrícolas",
    reference: "27/07/2026",
    observedAt: "2026-07-27",
    status: "verified",
    directUrl: "https://x",
    history: [],
    ...overrides,
  };
}

function future(overrides = {}) {
  return {
    commodity: "soja",
    contract: "Novembro/2026",
    value: 27.64,
    change: null,
    unit: "US$/sc 60 kg",
    source: "B3",
    provider: "Notícias Agrícolas",
    reference: "26/07/2026",
    href: "https://x",
    status: "delayed",
    ...overrides,
  };
}

function currency(overrides = {}) {
  return {
    symbol: "USD/BRL",
    name: "Dólar PTAX",
    value: RATE,
    change: null,
    source: "Banco Central do Brasil",
    reference: "26/07/2026",
    observedAt: "2026-07-26",
    status: "verified",
    directUrl: "https://x",
    history: [],
    ...overrides,
  };
}

function near(actual, expected, epsilon = 0.01) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `esperado ~${expected}, obtido ${actual}`);
}

test("comparableFuture converte o futuro de soja de US$ para R$ pelo PTAX", () => {
  const result = comparableFuture(market(), [future()], currency());
  assert.ok(result, "deve haver um futuro comparável");
  assert.equal(result.converted, true);
  assert.equal(result.rate, RATE);
  near(result.value, 27.64 * RATE);
  assert.equal(result.future.contract, "Novembro/2026");
});

test("comparableFuture não converte quando o físico e o futuro já estão em R$", () => {
  const milho = market({ id: "milho", value: 65.74 });
  const milhoFuture = future({ commodity: "milho", value: 70.61, unit: "R$/sc 60 kg" });
  const result = comparableFuture(milho, [milhoFuture], currency());
  assert.ok(result);
  assert.equal(result.converted, false);
  assert.equal(result.rate, null);
  assert.equal(result.value, 70.61);
});

test("comparableFuture ignora futuro em US$ quando o dólar está indisponível", () => {
  const result = comparableFuture(market(), [future()], currency({ value: null, status: "unavailable" }));
  assert.equal(result, null);
});

test("comparableFuture só compara futuros da mesma medida física", () => {
  const boiFutureEmSc = future({ commodity: "soja", unit: "US$/@" });
  assert.equal(comparableFuture(market(), [boiFutureEmSc], currency()), null);
});

test("marketBasis calcula o prêmio da soja usando o valor convertido", () => {
  const basis = marketBasis(market(), [future()], currency());
  assert.ok(basis !== null);
  near(basis, ((27.64 * RATE) / 140.26 - 1) * 100);
});

test("buildDecisionSignal produz o componente de prêmio da soja (não mais 'Não comparável')", () => {
  const signal = buildDecisionSignal(market(), [future()], [], currency());
  const premium = signal.components.find((component) => component.label === "Prêmio futuro x físico");
  assert.ok(premium);
  assert.notEqual(premium.value, "Não comparável");
  assert.match(premium.explanation, /PTAX/);
  assert.equal(signal.basis !== null, true);
});

test("buildDecisionSignal mantém 'Não comparável' para soja sem dólar", () => {
  const signal = buildDecisionSignal(market(), [future()], [], currency({ value: null, status: "unavailable" }));
  const premium = signal.components.find((component) => component.label === "Prêmio futuro x físico");
  assert.equal(premium.value, "Não comparável");
  assert.equal(signal.basis, null);
});
