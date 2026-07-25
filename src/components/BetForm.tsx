import { useMemo, useState } from "react";
import type { BetCreateRequest } from "../apiClient";
import { ALL_MARKETS, MARKET_LABELS, type MarketKey } from "../market";
import {
  filterFixturePicks,
  formatFixturePickLabel,
  fixturePickFromPrefill,
  type FixturePick,
} from "../fixtureSearch";
import { formatKickoff } from "./PickCard";

export type { FixturePick };

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
  const [market, setMarket] = useState<MarketKey | "">((props.prefill?.market as MarketKey) ?? "");
  const [selection, setSelection] = useState(props.prefill?.selection ?? "");
  const [odds, setOdds] = useState(String(props.prefill?.odds ?? ""));
  const [stake, setStake] = useState(String(props.prefill?.stake ?? ""));

  const fixtures = props.fixtures ?? [];
  const hits = useMemo(
    () => filterFixturePicks(fixtures, query, 12),
    [fixtures, query],
  );

  const selectionOptions = market === "totals" || market === "corners"
    ? [{ value: "over", label: "大" }, { value: "under", label: "細" }]
    : [{ value: "home", label: "主" }, { value: "away", label: "客" }, { value: "draw", label: "和" }];

  const valid = market !== "" && selection !== "" && Number(odds) > 1 && Number(stake) > 0;

  function selectFixture(f: FixturePick) {
    setSelected(f);
    setPicking(false);
    setQuery("");
  }

  function clearFixture() {
    setSelected(null);
    setPicking(true);
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
      source: props.prefill?.source ?? (selected ? "manual" : "manual"),
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
              {selected.commenceTime ? (
                <span className="subtext">{formatKickoff(selected.commenceTime)}</span>
              ) : null}
            </div>
            {fixtures.length > 0 ? (
              <button type="button" className="secondary-button compact" onClick={clearFixture}>
                更改
              </button>
            ) : null}
          </div>
        ) : (
          <div className="bet-form__fixture-picker">
            {fixtures.length === 0 ? (
              <p className="muted bet-form__fixture-empty">暫無已知賽程可揀，可直接填盤口（無 link）</p>
            ) : (
              <>
                <input
                  type="search"
                  className="bet-form__fixture-search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜隊名／賽事 ID…"
                  autoComplete="off"
                  aria-label="搜尋賽事"
                />
                {hits.length === 0 ? (
                  <p className="muted bet-form__fixture-empty">搵唔到相符賽事</p>
                ) : (
                  <ul className="bet-form__fixture-list" role="listbox" aria-label="賽事結果">
                    {hits.map((f) => (
                      <li key={f.matchId || `${f.homeTeam}-${f.awayTeam}-${f.commenceTime}`}>
                        <button
                          type="button"
                          className="bet-form__fixture-option"
                          onClick={() => selectFixture(f)}
                          role="option"
                        >
                          <span className="bet-form__fixture-option-name">{formatFixturePickLabel(f)}</span>
                          <span className="subtext">
                            {f.commenceTime ? formatKickoff(f.commenceTime) : f.matchId}
                          </span>
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
          onChange={(e) => setOdds(e.target.value)} placeholder="1.80" />
      </div>
      <div className="bet-form__field">
        <label>注碼</label>
        <input type="number" step="1" min="1" value={stake}
          onChange={(e) => setStake(e.target.value)} placeholder="100" />
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
