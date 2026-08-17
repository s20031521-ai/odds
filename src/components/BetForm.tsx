import { useMemo, useState } from "react";
import type { BetCreateRequest } from "../apiClient";
import { ALL_MARKETS, MARKET_LABELS, type MarketKey } from "../market";
import {
  filterFixturePicks,
  formatFixturePickLabel,
  fixturePickFromPrefill,
  type FixturePick,
  type FixturePickStatus,
} from "../fixtureSearch";
import { formatKickoff } from "./PickCard";

export type { FixturePick };

const LIST_LIMIT = 20;

function fixtureMetaLine(f: FixturePick): string {
  const parts: string[] = [];
  if (f.commenceTime) parts.push(formatKickoff(f.commenceTime));
  if (f.status === "finished" && f.score) parts.push(f.score);
  if (f.status === "finished") parts.push("已完場");
  if (f.hasModel) parts.push("模型");
  if (parts.length === 0 && f.matchId) parts.push(f.matchId);
  return parts.join(" · ");
}

export function BetForm(props: {
  prefill?: Partial<BetCreateRequest>;
  fixtures?: FixturePick[];
  onSave: (bet: BetCreateRequest) => void;
  onCancel: () => void;
  saving?: boolean;
}): React.ReactElement {
  const initialPick = fixturePickFromPrefill(props.prefill);
  const [selected, setSelected] = useState<FixturePick | null>(initialPick);
  const [query, setQuery] = useState("");
  const [picking, setPicking] = useState(!initialPick);
  const [listTab, setListTab] = useState<FixturePickStatus>(
    initialPick?.status === "finished" ? "finished" : "upcoming",
  );
  const [market, setMarket] = useState<MarketKey | "">((props.prefill?.market as MarketKey) ?? "");
  const [selection, setSelection] = useState(props.prefill?.selection ?? "");
  const [odds, setOdds] = useState(String(props.prefill?.odds ?? ""));
  const [stake, setStake] = useState(String(props.prefill?.stake ?? ""));

  const fixtures = props.fixtures ?? [];
  const upcomingCount = useMemo(
    () => fixtures.filter((f) => (f.status ?? "upcoming") === "upcoming").length,
    [fixtures],
  );
  const finishedCount = useMemo(
    () => fixtures.filter((f) => f.status === "finished").length,
    [fixtures],
  );
  const hits = useMemo(
    () => filterFixturePicks(fixtures, query, { limit: LIST_LIMIT }, listTab),
    [fixtures, query, listTab],
  );
  const hasAnyFixtures = fixtures.length > 0;

  const selectionOptions = market === "totals" || market === "corners"
    ? [{ value: "over", label: "大" }, { value: "under", label: "細" }]
    : [{ value: "home", label: "主" }, { value: "away", label: "客" }, { value: "draw", label: "和" }];

  const valid = market !== "" && selection !== "" && Number(odds) > 1 && Number(stake) > 0;
  const oddsHint = odds.trim() !== "" && !(Number(odds) > 1)
    ? "賠率要大于 1（例如 1.85）"
    : null;
  const stakeHint = stake.trim() !== "" && !(Number(stake) > 0)
    ? "注碼要大于 0"
    : null;

  function selectFixture(f: FixturePick) {
    setSelected(f);
    setPicking(false);
    setQuery("");
  }

  function clearFixture() {
    setSelected(null);
    setPicking(true);
    setQuery("");
    setListTab("upcoming");
  }

  function switchTab(tab: FixturePickStatus) {
    setListTab(tab);
    setQuery("");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || !market) return;
    props.onSave({
      ...props.prefill,
      ...(selected
        ? {
            matchId: selected.matchId || props.prefill?.matchId,
            fixtureId: selected.fixtureId ?? props.prefill?.fixtureId,
            homeTeam: selected.homeTeam || props.prefill?.homeTeam,
            homeTeamZh: selected.homeTeamZh ?? props.prefill?.homeTeamZh,
            awayTeam: selected.awayTeam || props.prefill?.awayTeam,
            awayTeamZh: selected.awayTeamZh ?? props.prefill?.awayTeamZh,
            commenceTime: selected.commenceTime || props.prefill?.commenceTime,
          }
        : {}),
      market,
      selection,
      odds: Number(odds),
      stake: Number(stake),
      source: props.prefill?.source ?? "manual",
    });
  }

  return (
    <form className="bet-form" onSubmit={handleSubmit}>
      <div className="bet-form__field">
        <label>賽事</label>
        {selected && !picking ? (
          <div className="bet-form__fixture-selected">
            <div className="bet-form__fixture-selected-text">
              <strong>{formatFixturePickLabel(selected)}</strong>
              <span className="subtext">{fixtureMetaLine(selected)}</span>
            </div>
            {hasAnyFixtures ? (
              <button type="button" className="secondary-button compact" onClick={clearFixture}>
                更改
              </button>
            ) : null}
          </div>
        ) : (
          <div className="bet-form__fixture-picker">
            {!hasAnyFixtures ? (
              <p className="muted bet-form__fixture-empty">暫無已知賽程可揀，可直接填盤口（無 link）</p>
            ) : (
              <>
                <div className="bet-form__fixture-tabs" role="tablist" aria-label="賽事狀態">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={listTab === "upcoming"}
                    className={listTab === "upcoming" ? "active" : undefined}
                    onClick={() => switchTab("upcoming")}
                  >
                    未完{upcomingCount > 0 ? ` (${upcomingCount})` : ""}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={listTab === "finished"}
                    className={listTab === "finished" ? "active" : undefined}
                    onClick={() => switchTab("finished")}
                  >
                    已完場{finishedCount > 0 ? ` (${finishedCount})` : ""}
                  </button>
                </div>
                <input
                  type="search"
                  className="bet-form__fixture-search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={listTab === "finished" ? "搜隊名（中／英）／賽事 ID…" : "搜隊名／賽事 ID…"}
                  autoComplete="off"
                  aria-label="搜尋賽事"
                />
                {hits.length === 0 ? (
                  <p className="muted bet-form__fixture-empty">
                    {listTab === "finished"
                      ? (query.trim()
                        ? "搵唔到相符已完場（可試英文隊名，例如 KuPS）"
                        : "最近 3 日暫未有模型結算；打隊名可搜全部完場（例如 古比斯）")
                      : (query.trim() ? "搵唔到相符賽事" : "暫時未有未完賽事")}
                  </p>
                ) : (
                  <ul className="bet-form__fixture-list" role="listbox" aria-label="賽事結果">
                    {hits.map((f) => (
                      <li key={`${f.status ?? "upcoming"}-${f.matchId || `${f.homeTeam}-${f.awayTeam}-${f.commenceTime}`}`}>
                        <button
                          type="button"
                          className="bet-form__fixture-option"
                          onClick={() => selectFixture(f)}
                          role="option"
                        >
                          <span className="bet-form__fixture-option-name">{formatFixturePickLabel(f)}</span>
                          <span className="subtext">{fixtureMetaLine(f)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {selected ? (
                  <button type="button" className="secondary-button compact" onClick={() => setPicking(false)}>
                    取消更改
                  </button>
                ) : null}
              </>
            )}
          </div>
        )}
      </div>

      <div className="bet-form__field">
        <label>盤口</label>
        <select value={market} onChange={(e) => { setMarket(e.target.value as MarketKey | ""); setSelection(""); }}>
          <option value="">— 揀盤口 —</option>
          {ALL_MARKETS.map((m) => (
            <option key={m} value={m}>{MARKET_LABELS[m]}</option>
          ))}
        </select>
      </div>
      {market ? (
        <div className="bet-form__field">
          <label>揀邊</label>
          <select value={selection} onChange={(e) => setSelection(e.target.value)}>
            <option value="">— 揀 —</option>
            {selectionOptions.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="bet-form__field">
        <label>賠率</label>
        <input type="number" step="0.01" min="1.01" value={odds}
          aria-invalid={oddsHint ? "true" : undefined}
          onChange={(e) => setOdds(e.target.value)} placeholder="1.80" />
        {oddsHint ? <p className="bet-form__hint">{oddsHint}</p> : null}
      </div>
      <div className="bet-form__field">
        <label>注碼</label>
        <input type="number" step="1" min="1" value={stake}
          aria-invalid={stakeHint ? "true" : undefined}
          onChange={(e) => setStake(e.target.value)} placeholder="100" />
        {stakeHint ? <p className="bet-form__hint">{stakeHint}</p> : null}
      </div>
      <div className="bet-form__actions">
        <button type="button" className="secondary-button" onClick={props.onCancel}>取消</button>
        <button type="submit" className="primary-button compact" disabled={!valid || props.saving}>
          {props.saving ? "儲存中…" : "記低"}
        </button>
      </div>
    </form>
  );
}
