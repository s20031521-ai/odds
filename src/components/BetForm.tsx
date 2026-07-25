import { useState } from "react";
import type { BetCreateRequest } from "../apiClient";
import { ALL_MARKETS, MARKET_LABELS, type MarketKey } from "../market";

type Prefill = Partial<BetCreateRequest>;

export function BetForm(props: {
  prefill?: Partial<BetCreateRequest>;
  onSave: (bet: BetCreateRequest) => void;
  onCancel: () => void;
  saving?: boolean;
}): React.ReactElement {
  const [market, setMarket] = useState<MarketKey | "">((props.prefill?.market as MarketKey) ?? "");
  const [selection, setSelection] = useState(props.prefill?.selection ?? "");
  const [odds, setOdds] = useState(String(props.prefill?.odds ?? ""));
  const [stake, setStake] = useState(String(props.prefill?.stake ?? ""));

  const selectionOptions = market === "totals" || market === "corners"
    ? [{ value: "over", label: "大" }, { value: "under", label: "細" }]
    : [{ value: "home", label: "主" }, { value: "away", label: "客" }, { value: "draw", label: "和" }];

  const valid = market !== "" && selection !== "" && Number(odds) > 1 && Number(stake) > 0;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || !market) return;
    props.onSave({
      ...props.prefill,
      market,
      selection,
      odds: Number(odds),
      stake: Number(stake),
    });
  }

  return (
    <form className="bet-form" onSubmit={handleSubmit}>
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
