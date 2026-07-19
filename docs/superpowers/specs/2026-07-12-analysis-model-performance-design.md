# Analysis Page Redesign

## Goal

Replace the legacy manual 1X2 calculator with a read-only model-performance surface backed by the canonical `/api/backtest` response.

## Scope

### Remove

- Bankroll, Kelly fraction, stake cap, and global value-threshold controls from the Analysis page.
- Browser-facing The Odds API key, league and region controls.
- Manual 1X2 entry form and entered-odds list.
- Legacy 1X2 analysis table.

These controls serve the old manual workflow and are not part of the current API-backed Dashboard/History flow.

### Keep elsewhere

- Dashboard remains the decision surface for `買…` / `唔買` cards.
- History remains the per-fixture settlement audit surface.
- Background collectors remain the only automatic provider polling owners.

## Information architecture

### Market overview

Show four selectable cards:

- 主客和
- 角球
- 大細波
- 亞洲讓球

Each card shows only canonical settled data for that market:

- settled sample count
- hit rate
- ROI when priced rows exist
- priced sample count

The selected market has a clear active state. Empty markets show `未有可評估樣本`, not zero-performance styling.

### Selected-market detail

Show three compact sections:

1. **Model versions**
   - Group settled snapshots by `modelVersion`.
   - Display sample count, hit rate, and ROI per version.
   - Label missing versions as `legacy-v0`.
   - This prevents old one-sided rows being presented as current-model performance.

2. **Prediction direction**
   - Group settled rows by canonical prediction label.
   - Display count and percentage within the selected market.
   - Use text plus a native CSS progress bar; do not rely on colour alone.

3. **Probability calibration**
   - Reuse canonical backtest probability buckets relevant to the selected market where available.
   - Display predicted range, sample count, and actual hit rate.
   - If the backend buckets are not market-scoped, derive them from the selected rows with one pure helper.
   - Rows without a valid probability are excluded and counted in an explanatory note.

## Data flow

- Reuse the existing `loadBacktest()` request and `/api/backtest` source of truth.
- Store the complete backtest payload rather than only `rows` so `byMarket` and `buckets` remain available.
- Analysis must not call The Odds API, API-Football, or HKJC directly.
- No new endpoint, dependency, chart library, router, or persistence layer.

## States

- Loading: existing spinner pattern.
- Error: cause plus `重新載入` button.
- No settled rows: honest market-specific empty state.
- Small sample: show `樣本少，暫未適合調整策略` when settled sample is below 30.
- ROI unavailable: show `未有足夠有效賠率`, never `0%`.

## Accessibility and responsive behavior

- Market cards are real buttons with `aria-pressed`.
- Progress bars include visible labels and accessible text.
- Controls remain at least 44px high.
- Desktop uses a four-card overview; mobile stacks cards and detail sections without horizontal scrolling.
- Existing dark HKJC-green visual language remains unchanged.

## Verification

- Pure helper tests cover market summaries, legacy model labeling, prediction distribution, missing prices, and empty markets.
- Full test suite and production build pass.
- Browser smoke checks all four market cards, loading/error/empty states, mobile layout, and zero console errors.
- Browser resource audit confirms the Analysis page makes no paid provider requests.

## Deliberate omissions

- No manual calculator or API administration fallback.
- No bankroll/stake recommendation until Dashboard cards have a validated stake-sizing contract.
- No trend chart until snapshots have enough time-series depth.
- No strategy tuning controls until each current model has at least 30 settled rows.
