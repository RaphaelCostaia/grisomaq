export type CommodityId = "milho" | "soja" | "boi";
export type DataStatus = "verified" | "delayed" | "partial" | "unavailable";
export type ImpactLevel = "high" | "medium" | "low";

export type MarketPoint = {
  date: string;
  value: number;
  change: number | null;
};

export type MarketItem = {
  id: CommodityId;
  name: string;
  shortName: string;
  value: number | null;
  change: number | null;
  unit: string;
  source: string;
  provider: string;
  reference: string;
  observedAt: string | null;
  status: DataStatus;
  directUrl: string;
  history: MarketPoint[];
};

export type FutureContract = {
  commodity: CommodityId;
  contract: string;
  value: number;
  change: number | null;
  unit: string;
  source: string;
  provider: string;
  reference: string;
  href: string;
  status: DataStatus;
};

export type RegionalQuote = {
  commodity: CommodityId;
  location: string;
  state: string | null;
  value: number;
  change: number | null;
  unit: string;
  source: string;
  reference: string;
};

export type CurrencyItem = {
  symbol: "USD/BRL";
  name: string;
  value: number | null;
  change: number | null;
  source: string;
  reference: string;
  observedAt: string | null;
  status: DataStatus;
  directUrl: string;
  history: MarketPoint[];
};

export type NewsItem = {
  id: string;
  title: string;
  summary: string | null;
  href: string;
  source: string;
  publishedAt: string | null;
  tag: "Milho" | "Soja" | "Boi" | "Clima" | "Política" | "Mercado";
  impact: ImpactLevel;
  impactReason: string;
};

export type SourceItem = {
  name: string;
  role: string;
  href: string;
  status: DataStatus;
  message: string;
  checkedAt: string;
  frequency: string;
};

export type MarketResponse = {
  markets: MarketItem[];
  futures: FutureContract[];
  regionalQuotes: RegionalQuote[];
  currency: CurrencyItem;
  news: NewsItem[];
  sources: SourceItem[];
  updatedAt: string;
  mode: "verified" | "partial" | "unavailable";
  nextRefreshAt: string;
  disclosures: string[];
};

export type SignalComponent = {
  label: string;
  value: string;
  effect: "positive" | "negative" | "neutral";
  explanation: string;
};

export type DecisionSignal = {
  commodity: CommodityId;
  action: "proteger" | "acompanhar" | "aguardar";
  title: string;
  summary: string;
  score: number;
  basis: number | null;
  trend: number | null;
  components: SignalComponent[];
};

export type MarketAlert = {
  id: string;
  commodity: CommodityId | null;
  level: ImpactLevel;
  category: "price" | "basis" | "news" | "source";
  title: string;
  description: string;
  action: string;
};
