import { useState } from "react";
import type { BuyableOpportunity, BuyableQuote, PredictionObservationsResponse, RecommendationObservation } from "../apiClient";

export type ObservationLoader = (sampleId: number) => Promise<PredictionObservationsResponse>;

export function BuyableOddsRange(props: {
  opportunity: BuyableOpportunity;
  loadObservations?: ObservationLoader;
}): React.ReactElement {
  const { opportunity } = props;
  const selection = selectionLabel(opportunity);
  return (
    <article className="buyable-odds-range">
      <div className="buyable-odds-range__summary">
        <strong>{selection}</strong>
        <span className="buyable-odds-range__range">{formatOdds(opportunity.quoteRange.min)}–{formatOdds(opportunity.quoteRange.max)}</span>
        <span>最佳 {formatOdds(opportunity.bestQuote.odds)}</span>
        <span>{opportunity.quoteRange.count} 間莊</span>
        <time dateTime={opportunity.lastEvaluatedAt}>{formatDateTime(opportunity.lastEvaluatedAt)}</time>
      </div>
      <p className="buyable-odds-range__warning">只適用於完全相同選項及盤口（{selection}）；其他盤口不可直接套用。</p>
      <details className="buyable-odds-range__quotes">
        <summary>逐莊可買價</summary>
        <QuoteList quotes={opportunity.quotes} />
      </details>
      {props.loadObservations ? <RecommendationObservationHistory sampleId={opportunity.sampleId} loadObservations={props.loadObservations} /> : null}
    </article>
  );
}

export function RecommendationObservationHistory(props: {
  sampleId: number;
  loadObservations: ObservationLoader;
}): React.ReactElement {
  const [response, setResponse] = useState<PredictionObservationsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function loadWhenOpened(event: React.SyntheticEvent<HTMLDetailsElement>): void {
    if (!event.currentTarget.open || loading || response) return;
    setLoading(true);
    setError("");
    void props.loadObservations(props.sampleId)
      .then(setResponse)
      .catch(() => setError("未能載入完整採樣時間線。"))
      .finally(() => setLoading(false));
  }

  return (
    <details className="recommendation-observations" onToggle={loadWhenOpened}>
      <summary>完整採樣時間線</summary>
      {loading ? <p role="status">載入中…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {response ? (
        response.observations.length > 0
          ? <ObservationTimeline observations={response.observations} />
          : <p>未有採樣批次。</p>
      ) : null}
    </details>
  );
}

export function ObservationTimeline(props: { observations: RecommendationObservation[] }): React.ReactElement {
  return (
    <ol className="recommendation-observations__timeline">
      {props.observations.map((observation, index) => (
        <li key={observation.id}>
          <strong>批次 {index + 1}</strong>
          <span>
            <time dateTime={observation.firstEvaluatedAt}>{formatDateTime(observation.firstEvaluatedAt)}</time>
            {" → "}
            <time dateTime={observation.lastEvaluatedAt}>{formatDateTime(observation.lastEvaluatedAt)}</time>
          </span>
          <code>{observation.fingerprint}</code>
          {observation.buyableQuotes.length > 0 ? (
            <QuoteList quotes={observation.buyableQuotes} />
          ) : <p>呢個批次已無可買報價。</p>}
          <details>
            <summary>Audit inputs（{observation.inputs.length}）</summary>
            <pre>{JSON.stringify(observation.inputs, null, 2)}</pre>
          </details>
        </li>
      ))}
    </ol>
  );
}

function QuoteList({ quotes }: { quotes: BuyableQuote[] }): React.ReactElement {
  return (
    <div className="buyable-odds-range__quote-list">
      {quotes.map((quote) => (
        <div className="buyable-odds-range__quote" key={`${quote.bookmaker}|${quote.provider}|${quote.observedAt}`}>
          <strong>{quote.bookmaker}</strong>
          <span>{providerLabel(quote.provider)}</span>
          <span>採樣 {formatOdds(quote.odds)}</span>
          <span>最低 {formatOdds(quote.minimumBuyOdds)}</span>
          <span>Edge +{formatPercent(quote.edge)}</span>
          <time dateTime={quote.observedAt}>{formatDateTime(quote.observedAt)}</time>
        </div>
      ))}
    </div>
  );
}

export function selectionLabel(
  opportunity: Pick<BuyableOpportunity, "market" | "selection" | "line" | "homeTeamZh" | "awayTeamZh" | "homeTeam" | "awayTeam">,
  includeLine = true,
): string {
  const selection = opportunity.selection === "home"
    ? (opportunity.homeTeamZh ?? opportunity.homeTeam)
    : opportunity.selection === "away"
      ? (opportunity.awayTeamZh ?? opportunity.awayTeam)
      : opportunity.selection === "draw"
        ? "和"
        : opportunity.selection === "over"
          ? (opportunity.market === "corners" ? "大角" : "大")
          : (opportunity.market === "corners" ? "細角" : "細");
  return !includeLine || opportunity.line === undefined ? selection : `${selection} ${formatLine(opportunity.line)}`;
}

function providerLabel(provider: string): string {
  const normalized = provider.trim().toLowerCase();
  if (normalized === "hkjc") return "HKJC";
  if (normalized === "the-odds-api" || normalized === "the_odds_api") return "The Odds API";
  if (normalized === "api-football" || normalized === "api_football") return "API-Football";
  return provider;
}

function formatOdds(value: number): string { return value.toFixed(2); }
function formatLine(value: number): string { return Number.isInteger(value) ? value.toFixed(1) : String(value); }
function formatPercent(value: number): string { return `${(value * 100).toFixed(2)}%`; }
function formatDateTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("zh-HK", { hour12: false });
}
