# Chiikawa UI Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 將 Odds Tool 全 app UI 由深色交易台風格轉為沉浸式 pastel Chiikawa 風格（Chiikawa + 飛鼠 Momonga 主角），零邏輯改動。

**Architecture:** 以 `src/styles/tokens.css` 為單一主題來源，重寫色板；`src/styles.css` 做全面 pastel sweep（約 125 個 hardcoded hex 換成 tokens／新值）；新增 `src/components/Kawaii.tsx` 裝飾元件（Mascot 圖 + SVG 花瓣星星）；登入頁補上從未存在嘅樣式。素材圖下載到 `public/chiikawa/` 本地引用。

**Tech Stack:** Vite + React + TypeScript, Vitest（source-contract + `renderToStaticMarkup` SSR string tests）, Playwright (`npm run test:ui`)。

## Global Constraints

- **鎖死字串唔准改**（SSR/source-contract 測試逐字斷言）：`載入中...`、`正在載入模型表現。`、`正在載入完場對比。`、`暫時冇場次過關`、`資料未更新，暫停顯示買盤。`、`暫時未有賽事達到 3% Edge。`、`查看全部賽事`、`同步時間`、`未有成功同步`、LoginPage 三句錯誤訊息、`全部賽事` / `查看所有即將開賽賽事及市場分析。`、`OFFLINE_WARNING` 全文、App.tsx L43–44 嘅 `<h1 className="page-heading">完場對比</h1>` 及 `模型表現分析` JSX 原文。新增裝飾元素可以，改呢啲字串唔可以。
- **className 唔准改名**：現有 SSR 測試同 Playwright 斷言 class（`buy-dashboard__empty`、`login-panel`、`app-navigation--top/--bottom`、`empty-state`、`team-logo--badge` 等）。只加新 class，唔改舊名。
- **幾何唔准變**：`--touch-target` 保持 `44px`；dashboard grid 列數、nav display breakpoints 唔變（Playwright 斷言）。
- **離線可用**：唔好用 Google Fonts CDN 或 hotlink 圖片；字體用本地 font stack，圖片全部落 `public/chiikawa/`。
- **版權**：Chiikawa 圖僅限本地個人用途；README 要加來源同限制註明；唔可以 commit 到會對外發佈嘅地方以外用途。
- 每個 Task 完結跑 `npm test`，全綠先 commit。
- `npm run dev` 已係 `vite --host 127.0.0.1`，會 forward CLI host/port args — 唔好改 `package.json` scripts。

---

### Task 1: 下載並處理 Mascot 素材

**Files:**
- Create: `public/chiikawa/mascot-chiikawa-corner.png`
- Create: `public/chiikawa/mascot-chiikawa-empty.png`
- Create: `public/chiikawa/mascot-momonga-loading.png`
- Create: `public/chiikawa/mascot-login-duo.png`
- Modify: `README.md`（尾部加素材來源註明）

**Interfaces:**
- Produces: 四個固定檔名，Task 3 嘅 `Mascot` 元件直接引用 `/chiikawa/<檔名>`。檔名必須完全一致。

- [ ] **Step 1: 搵圖**

去 `https://chiikawa-wallpaper.com/zh-Hant`（或 chiikawawallpaper.com）揾以 **Chiikawa** 同 **飛鼠 Momonga** 為主嘅圖。分工：
- `mascot-chiikawa-corner` — Chiikawa 單人、簡單背景、細尺寸都睇得清（頁面角落常駐）
- `mascot-chiikawa-empty` — Chiikawa 悠閒 / 飲茶 / 瞓覺感（空白狀態）
- `mascot-momonga-loading` — Momonga 飛鼠（loading）
- `mascot-login-duo` — Chiikawa + Momonga 同框（登入頁）

用 `curl -L -o public/chiikawa/<檔名> <圖片直鏈>`（r2.chiikawa-wallpaper.com / r2.chiikawawallpaper.com 嘅直鏈）下載到 `public/chiikawa/`（先 `mkdir -p public/chiikawa`）。如果某張直鏈 404 或唔啱，換同類另一張，檔名唔變。

- [ ] **Step 2: 壓縮到合理大小**

每張 resize 到最長邊 ≤ 640px、檔案 ≤ 300KB（mascot 用途唔需要 4K）。用 managed Python + Pillow：

```python
from PIL import Image
from pathlib import Path

for p in Path("public/chiikawa").glob("*.png"):
    img = Image.open(p).convert("RGBA")
    img.thumbnail((640, 640), Image.LANCZOS)
    img.save(p, optimize=True)
    print(p.name, img.size, p.stat().st_size)
```

Run: `python scripts/resize-mascots.py`（script 用完即刪，或放 `scripts/` 一次性使用後喺 commit 前 `git rm`）。
Expected: 每張 ≤ 640px；如某張仍 > 300KB，再縮到 480px。

- [ ] **Step 3: README 加素材註明**

喺 `README.md` 嘅 `## Safety Rules` 之後加：

```markdown
## Artwork Assets

`public/chiikawa/` 內嘅 Chiikawa 插圖下載自 chiikawa-wallpaper.com，僅供本地個人用途，不得商用或對外發佈。版權屬原作者 Nagano 所有。
```

- [ ] **Step 4: Commit**

```bash
git add public/chiikawa README.md
git commit -m "feat: chiikawa mascot assets (local personal use only)"
```

---

### Task 2: 重寫 pastel 色板 tokens（TDD：先改 contract 測試）

**Files:**
- Test: `src/components/AppShell.test.tsx`（L119–133 token 值斷言）
- Modify: `src/styles/tokens.css`（全檔重寫）
- Test: `src/pwaConfig.test.ts`（L73 theme-color 斷言）
- Modify: `index.html:6`（theme-color meta）

**Interfaces:**
- Produces: 新 tokens，之後所有 Task 用呢啲名：`--color-bg`、`--color-surface`、`--color-primary`、`--color-accent-pink`、`--color-accent-yellow`、`--color-positive`、`--color-negative`、`--color-positive-text`、`--color-negative-text`、`--color-warning`、`--color-text`、`--color-muted`、`--color-border`、`--shadow-soft`、`--radius-card`、`--radius-card-lg`、`--font-rounded`、`--touch-target`。
- 注意 `layout.css` 用 `color-mix` 引用 `--color-primary`，`--touch-target` 必須保持 `44px`。

- [ ] **Step 1: 改 AppShell.test.tsx 斷言（fail first）**

將 L119–133 嘅舊值（`#11182b`、`#182038`、`#7c83c8`、`#9ce2cf`、`#f2c879`、`#f6f7ff`、`#8e9cba`、`16px`）改為斷言新值：

```ts
expect(tokens).toContain("--color-bg: #FFF8F0");
expect(tokens).toContain("--color-surface: #FFFEFC");
expect(tokens).toContain("--color-primary: #5E9FD4");
expect(tokens).toContain("--color-positive: #7FCFA9");
expect(tokens).toContain("--color-negative: #F2A0A0");
expect(tokens).toContain("--color-warning: #E8B45A");
expect(tokens).toContain("--color-text: #4A3F3F");
expect(tokens).toContain("--color-muted: #A89B91");
expect(tokens).toContain("--radius-card: 24px");
expect(tokens).toContain("--touch-target: 44px");
```

（保持測試原有嘅讀檔方式，只換斷言內容。）

- [ ] **Step 2: 改 pwaConfig.test.ts 斷言**

L73 嘅 `#11182B` 改為 `#FFF8F0`。

- [ ] **Step 3: 跑測試確認 fail**

Run: `npx vitest run src/components/AppShell.test.tsx src/pwaConfig.test.ts`
Expected: FAIL（tokens.css 仲係舊值）。

- [ ] **Step 4: 重寫 tokens.css**

全檔換成：

```css
:root {
  --color-bg: #FFF8F0;
  --color-surface: #FFFEFC;
  --color-primary: #5E9FD4;
  --color-accent-pink: #FFD9E0;
  --color-accent-yellow: #FFF1C9;
  --color-positive: #7FCFA9;
  --color-negative: #F2A0A0;
  --color-positive-text: #2F7D5F;
  --color-negative-text: #C05A5A;
  --color-warning: #E8B45A;
  --color-text: #4A3F3F;
  --color-muted: #A89B91;
  --color-border: #F0E2D4;
  --shadow-soft: 0 2px 8px rgba(74, 63, 63, 0.06), 0 8px 24px rgba(74, 63, 63, 0.05);
  --radius-card: 24px;
  --radius-card-lg: 28px;
  --font-rounded: "Baloo 2", "PingFang TC", "Hiragino Sans GB", "Microsoft JhengHei", sans-serif;
  --touch-target: 44px;
}
```

- [ ] **Step 5: 更新 index.html theme-color**

`index.html:6` 嘅 `<meta name="theme-color" content="#11182B">` 改為 `content="#FFF8F0"`。

- [ ] **Step 6: 跑測試確認 pass**

Run: `npx vitest run src/components/AppShell.test.tsx src/pwaConfig.test.ts`
Expected: PASS。

- [ ] **Step 7: 全量測試**

Run: `npm test`
Expected: 全綠（其他測試唔涉及 token 值）。如 `AppShell.test.tsx` L104–112 嘅 active-nav rule 斷言仍綠（佢斷言 rule 文字 `color: var(--color-bg);` / `background: var(--color-primary);`，唔係 literal hex），正確 — Task 6 先改佢。

- [ ] **Step 8: Commit**

```bash
git add src/styles/tokens.css src/components/AppShell.test.tsx src/pwaConfig.test.ts index.html
git commit -m "feat: pastel chiikawa color tokens"
```

---

### Task 3: Kawaii 裝飾元件（TDD）

**Files:**
- Create: `src/components/Kawaii.tsx`
- Test: `src/components/Kawaii.test.tsx`
- Create: `src/styles/kawaii.css`
- Modify: `src/main.tsx`（加 import，跟現有 CSS import pattern）

**Interfaces:**
- Consumes: Task 1 嘅四個圖檔路徑。
- Produces:
  - `Mascot(props: { pose: "chiikawa-corner" | "chiikawa-empty" | "momonga-loading" | "login-duo" }): React.ReactElement` — 輸出 `<img>`，`alt=""`（純裝飾），`loading="lazy"`，class 係 `mascot mascot--<pose>`。
  - `KawaiiDecor(): React.ReactElement` — 輸出 `<span className="kawaii-decor" aria-hidden="true">`，入面三個子 span：`kawaii-decor__petal--1`、`kawaii-decor__petal--2`、`kawaii-decor__star`。
  - 之後 Task 4 / 6 / 7 用呢兩個元件。

- [ ] **Step 1: 寫 failing test**

`src/components/Kawaii.test.tsx`：

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { KawaiiDecor, Mascot } from "./Kawaii";

describe("Mascot", () => {
  it("renders local chiikawa corner image as decorative", () => {
    const html = renderToStaticMarkup(<Mascot pose="chiikawa-corner" />);
    expect(html).toContain('src="/chiikawa/mascot-chiikawa-corner.png"');
    expect(html).toContain('alt=""');
    expect(html).toContain("mascot--corner");
  });

  it("renders each pose with its own image", () => {
    expect(renderToStaticMarkup(<Mascot pose="chiikawa-empty" />)).toContain("mascot-chiikawa-empty.png");
    expect(renderToStaticMarkup(<Mascot pose="momonga-loading" />)).toContain("mascot-momonga-loading.png");
    expect(renderToStaticMarkup(<Mascot pose="login-duo" />)).toContain("mascot-login-duo.png");
  });
});

describe("KawaiiDecor", () => {
  it("renders aria-hidden decorative petals and star", () => {
    const html = renderToStaticMarkup(<KawaiiDecor />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("kawaii-decor__petal");
    expect(html).toContain("kawaii-decor__star");
  });
});
```

- [ ] **Step 2: 跑測試確認 fail**

Run: `npx vitest run src/components/Kawaii.test.tsx`
Expected: FAIL（module 唔存在）。

- [ ] **Step 3: 實作 Kawaii.tsx**

```tsx
const mascotPoses = {
  "chiikawa-corner": { src: "/chiikawa/mascot-chiikawa-corner.png", modifier: "corner" },
  "chiikawa-empty": { src: "/chiikawa/mascot-chiikawa-empty.png", modifier: "empty" },
  "momonga-loading": { src: "/chiikawa/mascot-momonga-loading.png", modifier: "loading" },
  "login-duo": { src: "/chiikawa/mascot-login-duo.png", modifier: "login" },
} as const;

export type MascotPose = keyof typeof mascotPoses;

export function Mascot(props: { pose: MascotPose }): React.ReactElement {
  const mascot = mascotPoses[props.pose];
  return (
    <img
      className={`mascot mascot--${mascot.modifier}`}
      src={mascot.src}
      alt=""
      loading="lazy"
      width={160}
      height={160}
    />
  );
}

export function KawaiiDecor(): React.ReactElement {
  return (
    <span className="kawaii-decor" aria-hidden="true">
      <span className="kawaii-decor__petal kawaii-decor__petal--1" />
      <span className="kawaii-decor__petal kawaii-decor__petal--2" />
      <span className="kawaii-decor__star" />
    </span>
  );
}
```

- [ ] **Step 4: 寫 kawaii.css**

```css
.mascot {
  display: block;
  object-fit: contain;
  pointer-events: none;
  user-select: none;
}

.mascot--corner {
  position: fixed;
  right: 12px;
  bottom: calc(12px + env(safe-area-inset-bottom, 0px));
  width: 88px;
  height: 88px;
  opacity: 0.9;
  z-index: 5;
}

.mascot--loading {
  width: 120px;
  height: 120px;
  margin: 0 auto 8px;
}

.mascot--empty {
  width: 140px;
  height: 140px;
  margin: 0 auto 8px;
}

.mascot--login {
  width: 180px;
  height: 180px;
  margin: 0 auto 12px;
}

.kawaii-decor {
  position: fixed;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  z-index: 1;
}

.kawaii-decor__petal,
.kawaii-decor__star {
  position: absolute;
  display: block;
  opacity: 0.5;
}

.kawaii-decor__petal {
  width: 18px;
  height: 18px;
  background: var(--color-accent-pink);
  border-radius: 80% 0 80% 0;
}

.kawaii-decor__petal--1 {
  top: 12%;
  left: 4%;
  transform: rotate(24deg);
}

.kawaii-decor__petal--2 {
  top: 64%;
  right: 6%;
  transform: rotate(-40deg);
}

.kawaii-decor__star {
  top: 24%;
  right: 12%;
  width: 14px;
  height: 14px;
  background: var(--color-accent-yellow);
  clip-path: polygon(50% 0%, 63% 37%, 100% 50%, 63% 63%, 50% 100%, 37% 63%, 0% 50%, 37% 37%);
}

@media (max-width: 720px) {
  .mascot--corner {
    width: 64px;
    height: 64px;
  }
}
```

喺 `src/main.tsx` 跟現有 CSS import 加 `import "./styles/kawaii.css";`（放喺 `styles.css` 之後，等佢可以 override）。

- [ ] **Step 5: 跑測試確認 pass + 全量**

Run: `npx vitest run src/components/Kawaii.test.tsx && npm test`
Expected: PASS / 全綠。

- [ ] **Step 6: Commit**

```bash
git add src/components/Kawaii.tsx src/components/Kawaii.test.tsx src/styles/kawaii.css src/main.tsx
git commit -m "feat: kawaii mascot and decor components"
```

---

### Task 4: 登入頁 + auth boot splash 視覺

**Files:**
- Modify: `src/pages/LoginPage.tsx`（加 Mascot，字串唔變）
- Modify: `src/App.tsx:433-435`（boot splash 加 Mascot，保留 `載入中...`）
- Modify: `src/styles.css`（尾部加 login 樣式區塊）

**Interfaces:**
- Consumes: Task 3 嘅 `Mascot`。
- 注意：`.login-page` / `.login-panel` / `.login-kicker` / `.login-error` 而家**完全冇 CSS**，係 greenfield；Playwright 斷言 `.login-panel` 存在，className 唔准改。

- [ ] **Step 1: LoginPage.tsx 加 Mascot**

喺 `<p className="login-kicker">` 之前加：

```tsx
<Mascot pose="login-duo" />
```

（`import { Mascot } from "../components/Kawaii";` 加喺檔頭。其他 JSX 一字唔改 — LoginPage.test.tsx 斷言三句錯誤訊息同 `role="alert"`。）

- [ ] **Step 2: 跑 LoginPage 測試**

Run: `npx vitest run src/pages/LoginPage.test.tsx`
Expected: PASS（純加嘢，冇改字串）。

- [ ] **Step 3: App.tsx boot splash 加 Mascot**

L433–435 嘅 early return 改成（保留 `載入中...` 原文）：

```tsx
    return (
      <main className="login-page">
        <div className="login-panel" role="status">
          <Mascot pose="momonga-loading" />
          <p>載入中...</p>
        </div>
      </main>
    );
```

`import { Mascot } from "./components/Kawaii";` 加喺 App.tsx 檔頭。注意：先睇清楚 L433–435 而家嘅實際 JSX 再改，保持 `login-page` / `login-panel` class 名。

- [ ] **Step 4: styles.css 尾部加 login 樣式**

```css
/* Chiikawa login */
.login-page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  background:
    radial-gradient(circle at 15% 20%, var(--color-accent-pink) 0%, transparent 32%),
    radial-gradient(circle at 85% 80%, var(--color-accent-yellow) 0%, transparent 30%),
    var(--color-bg);
  padding: 24px;
}

.login-panel {
  width: min(360px, 100%);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card-lg);
  box-shadow: var(--shadow-soft);
  padding: 32px 28px;
  text-align: center;
}

.login-kicker {
  font-family: var(--font-rounded);
  color: var(--color-primary);
  font-weight: 700;
  letter-spacing: 0.04em;
  margin: 0 0 4px;
}

.login-panel h1 {
  font-family: var(--font-rounded);
  color: var(--color-text);
  margin: 0 0 20px;
}

.login-error {
  background: var(--color-accent-pink);
  color: var(--color-negative-text);
  border-radius: 12px;
  padding: 10px 14px;
  margin: 0 0 12px;
}
```

- [ ] **Step 5: 全量測試 + build**

Run: `npm test && npm run build`
Expected: 全綠 + build 成功。

- [ ] **Step 6: Commit**

```bash
git add src/pages/LoginPage.tsx src/App.tsx src/styles.css
git commit -m "feat: chiikawa login page and boot splash"
```

---

### Task 5: styles.css pastel sweep（核心工程）

**Files:**
- Modify: `src/styles.css`（約 125 個 hardcoded 色值換 tokens／新值）

**Interfaces:**
- Consumes: Task 2 嘅 tokens。
- 注意：**className、selector 名一個都唔准改**；只改 declaration 嘅值。`layout.css` / `dashboard.css` 已全 token-based，唔使郁。

- [ ] **Step 1: 盤點現況**

Run: `grep -nE '#[0-9a-fA-F]{3,8}\b|rgba?\(' src/styles.css > /tmp/hex-before.txt; wc -l /tmp/hex-before.txt`
Expected: 約 125 行，作為對照清單。

- [ ] **Step 2: 按 mapping table 逐組改**

逐個 selector group 改（行號係改之前嘅參考，改嘅時候以 selector 搵位）：

| 位置 | 舊值 | 新值 |
|---|---|---|
| `.eyebrow` (L52) | `#93c5fd` | `var(--color-primary)` |
| `h1` (L67) | `#f8fafc` | `var(--color-text)` |
| `.market-tabs` (L148–169) | 深色底 / 邊 | 底 `var(--color-surface)`，邊 `var(--color-border)`，active tab 底 `var(--color-accent-pink)`、字 `var(--color-text)` |
| `.hkjc-card` (L217–220) | `#22c55e` + rgba glow | 邊 `var(--color-positive)`，glow 改 `0 0 0 3px rgba(127, 207, 169, 0.25)` |
| `.simple-pick` (L222–236) | `#dff7e8` / `#0c5132`；neutral `#e2e8f0` / `#334155` | 值博：底 `#DFF5EA`、字 `var(--color-positive-text)`；neutral：底 `var(--color-surface)`、字 `var(--color-muted)`、邊 `var(--color-border)` |
| `.other-lines` / `.line-item` (L238–265) | `#dbe4ee` / `#f1f5f9` | 字 `var(--color-text)`，底 `var(--color-surface)`，邊 `var(--color-border)` |
| `.history-*` (L267–323) | 深色系 | 底 `var(--color-surface)`，字 `var(--color-text)`，弱化字 `var(--color-muted)`，邊 `var(--color-border)` |
| `.source-badge` (L325–332) | 深色 | 底 `var(--color-accent-yellow)`，字 `var(--color-text)` |
| `.panel` (L350–356) | `rgba(15,29,50,0.94)` | `var(--color-surface)` + `border: 1px solid var(--color-border)` + `box-shadow: var(--shadow-soft)` |
| `.field` / `input` (L395–423) | 深色 input | 底 `var(--color-surface)`，字 `var(--color-text)`，邊 `var(--color-border)`，focus 邊 `var(--color-primary)` |
| `.primary-button` (L447–467) | 舊 primary | 底 `var(--color-primary)`，字 `#FFFFFF`，圓角 `999px`（pill），hover 加深至 `#4A8BC0` |
| `.secondary-button` (L469–483) | 深色 | 底 `var(--color-surface)`，字 `var(--color-text)`，邊 `var(--color-border)`，圓角 `999px`；順手補 `.secondary-button.compact` 規則（padding 縮細，min-height 保持 `var(--touch-target)`） |
| `.fixture-*` (L580–672) | 深色系 | 卡片底 `var(--color-surface)`，邊 `var(--color-border)`，圓角 `var(--radius-card)`，陰影 `var(--shadow-soft)`，hover `transform: translateY(-2px)` + `transition: transform 150ms ease, box-shadow 150ms ease` |
| `.empty-state` (L674–676, 757–766) | dashed `#27466f` | dashed `var(--color-border)`，字 `var(--color-muted)`，圓角 `var(--radius-card)` |
| tables (L685–713) | 深色 | 表頭字 `var(--color-muted)`，行邊 `var(--color-border)`，字 `var(--color-text)` |
| `.subtext` (L715–720) | 灰藍 | `var(--color-muted)` |
| `.positive` / `.negative` (L722–729) | `#4ade80` / `#f87171` | `var(--color-positive-text)` / `var(--color-negative-text)` |
| `.badge.value` / `.watch` / `.avoid` (L731–755) | 深色 badge | value：底 `#DFF5EA` 字 `var(--color-positive-text)`；watch：底 `var(--color-accent-yellow)` 字 `var(--color-text)`；avoid：底 `var(--color-accent-pink)` 字 `var(--color-negative-text)`；全部圓角 `999px` |
| `.performance-*` (L782–944) | 深色 | 卡片底 `var(--color-surface)`，字 `var(--color-text)`，邊 `var(--color-border)`；`.sample-warning` 底 `var(--color-accent-yellow)`、字 `var(--color-text)`；`.health-tags` tag 底 `var(--color-accent-pink)` 字 `var(--color-text)` |
| `.page-heading`（App.tsx 用緊但冇規則） | — | 新增：`.page-heading { font-family: var(--font-rounded); color: var(--color-text); }` |
| `body` / 標題字體 | — | `h1, h2, h3 { font-family: var(--font-rounded); }` |

卡片 / panel 圓角統一用 `var(--radius-card)`，陰影統一 `var(--shadow-soft)`。

- [ ] **Step 3: 殘餘檢查**

Run: `grep -nE '#[0-9a-fA-F]{3,8}\b' src/styles.css`
Expected: 只剩 mapping table 入面指明嘅新 hex（`#DFF5EA`、`#4A8BC0`、`#FFFFFF`）同 Task 4 加嘅 login 區塊（全用 var）。如有其他殘餘舊 hex，返 Step 2 補改。

- [ ] **Step 4: 全量測試 + build**

Run: `npm test && npm run build`
Expected: 全綠（SSR 測試唔斷言 CSS 值；如意外有斷言舊 hex 嘅測試 fail，睇清楚係咪漏改，唔好改測試遷就 — 除咗 Task 2 已處理嘅兩個 contract 測試）。

- [ ] **Step 5: Commit**

```bash
git add src/styles.css
git commit -m "feat: pastel sweep across base stylesheet"
```

---

### Task 6: AppShell 常駐裝飾 + nav active pill

**Files:**
- Modify: `src/components/AppShell.tsx`
- Test: `src/components/AppShell.test.tsx`（L104–112 active-nav 斷言）
- Modify: `src/styles/layout.css`（L108 附近 active-nav rule）

**Interfaces:**
- Consumes: Task 3 嘅 `Mascot` / `KawaiiDecor`。
- 注意：AppShell.test.tsx 斷言 skip link、`#main-content`、無 warning 時冇 `role="alert"`、PWA hint — 新元素唔准影響呢啲。

- [ ] **Step 1: 改 active-nav 斷言（fail first）**

AppShell.test.tsx L104–112 嘅斷言由 `color: var(--color-bg);` + `background: var(--color-primary);` 改為斷言：

```ts
expect(layout).toContain("background: var(--color-accent-pink);");
expect(layout).toContain("color: var(--color-text);");
```

- [ ] **Step 2: 跑測試確認 fail**

Run: `npx vitest run src/components/AppShell.test.tsx`
Expected: FAIL。

- [ ] **Step 3: 改 layout.css active-nav rule**

搵到而家含 `color: var(--color-bg);` + `background: var(--color-primary);` 嘅 `[aria-current="page"]` rule（L108 附近），改為：

```css
background: var(--color-accent-pink);
color: var(--color-text);
border-radius: 999px;
```

（保留原有 selector 同其他 declaration；如有 `color-mix` hover 變體，hover 底改 `color-mix(in srgb, var(--color-accent-pink) 60%, transparent)`。）

- [ ] **Step 4: AppShell.tsx 掛裝飾**

喺 `.application-shell__content` 入面、`</main>` 之後加：

```tsx
        <KawaiiDecor />
        <Mascot pose="chiikawa-corner" />
```

`import { KawaiiDecor, Mascot } from "./Kawaii";` 加喺檔頭。

- [ ] **Step 5: 跑測試確認 pass + 全量**

Run: `npx vitest run src/components/AppShell.test.tsx && npm test`
Expected: PASS / 全綠。

- [ ] **Step 6: Commit**

```bash
git add src/components/AppShell.tsx src/components/AppShell.test.tsx src/styles/layout.css
git commit -m "feat: persistent chiikawa corner mascot and pastel nav pill"
```

---

### Task 7: Loading / 空白狀態加 Mascot + 微文案

**Files:**
- Modify: `src/App.tsx`（L464–465, 504–507, 547, 550–551, 590–591, 604–605, 618–619, 662–670 — 行號為參考，以字串搵位）
- Modify: `src/pages/SimpleDashboard.tsx`（L19–22）
- Modify: `src/pages/BuyDashboard.tsx`（L63–69）

**Interfaces:**
- Consumes: Task 3 嘅 `Mascot`。
- **鎖死字串一個字都唔准改**（見 Global Constraints）；Mascot 係加喺現有文字**之前**，微文案係**新增**嘅 `<p className="empty-state__note">`，唔係替換。

- [ ] **Step 1: App.tsx 各狀態加 Mascot**

逐處喺 empty/loading 區塊嘅文字之前加 Mascot（text 保持原樣）：

| 位置（以字串搵） | 加嘅嘢 |
|---|---|
| `未有賽事。輸入或拉取賠率後會出現喺呢度。` | `<Mascot pose="chiikawa-empty" />` + 文字後加 `<p className="empty-state__note">飲杯茶先～</p>` |
| `正在載入模型表現。` | `<Mascot pose="momonga-loading" />` |
| `正在載入完場對比。` | `<Mascot pose="momonga-loading" />` |
| `暫時未有已收集嘅大細波盤。` | `<Mascot pose="chiikawa-empty" />` |
| `暫時未有開賽前 30 分鐘內嘅角球盤。` | `<Mascot pose="chiikawa-empty" />` |
| `暫時未有已收集嘅亞洲讓球盤。` | `<Mascot pose="chiikawa-empty" />` |
| `暫時未有{market}完場記錄。` / `未有附帶賽前 snapshot 嘅{market}記錄。` | `<Mascot pose="chiikawa-empty" />` |
| `暫時未有{analysisMarket}可評估樣本。` | `<Mascot pose="chiikawa-empty" />` |

每處改嘅時候保持 `empty-state` / `empty-state compact` class、`role="status"` / `role="alert"`、`重新載入` button 原樣。

- [ ] **Step 2: SimpleDashboard / BuyDashboard 加 Mascot**

- `SimpleDashboard.tsx` L21–22 `暫時冇場次過關` 區塊：文字前加 `<Mascot pose="chiikawa-empty" />`，文字後加 `<p className="empty-state__note">飲杯茶先～</p>`。
- `SimpleDashboard.tsx` L19–20 `資料未更新，暫停顯示買盤。`：文字前加 `<Mascot pose="momonga-loading" />`（唔加 note，呢個係警示）。
- `BuyDashboard.tsx` L65–69 `暫時未有賽事達到 3% Edge。`：文字前加 `<Mascot pose="chiikawa-empty" />`；`查看全部賽事` link 保持原樣。
- `BuyDashboard.tsx` L63–64 `資料未更新，暫停顯示買盤。`：文字前加 `<Mascot pose="momonga-loading" />`（唔加 note）。

兩個檔各自加 `import { Mascot } from "../components/Kawaii";`。

- [ ] **Step 3: empty-state__note 樣式**

`src/styles.css` 嘅 `.empty-state` 區塊附近加：

```css
.empty-state__note {
  color: var(--color-muted);
  font-size: 0.9em;
  margin: 4px 0 0;
}
```

- [ ] **Step 4: 全量測試 + build**

Run: `npm test && npm run build`
Expected: 全綠（所有鎖死字串嘅 SSR 測試應照過，因為字串冇郁）。如有測試 fail，一定係改嘅時候碰咗鎖死字串或 class — 修正 JSX，唔好改測試。

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/pages/SimpleDashboard.tsx src/pages/BuyDashboard.tsx src/styles.css
git commit -m "feat: mascots and notes on loading and empty states"
```

---

### Task 8: 視覺驗證 + Playwright 回歸

**Files:**
- 可能需微调： `src/styles.css` / `src/styles/kawaii.css`（只限對比度或遮擋修正）

- [ ] **Step 1: Playwright 回歸**

Run: `npm run test:ui`
Expected: 全綠。如 geometry / display 斷言 fail，檢查係咪改咗 nav display、grid columns 或 44px touch target — 修 CSS 遷就測試（呢啲係 Global Constraints）。

- [ ] **Step 2: 起 dev server 目測**

Run: `npm run dev`（前台短暫運行驗證，完咗要停返，唔好留背景進程）
逐頁目測（`#/dashboard`、`#/fixtures`、`#/history`、`#/analysis`、登入頁）：
- 賠率數字 / 表格喺奶油白底上對比清晰（目標 WCAG AA）
- `.positive` / `.negative` 分得清
- corner mascot 唔遮內容、唔遮底部 nav
- badge / button 圓角 pastel 風一致

如對比唔夠，優先調深文字色（`--color-positive-text` / `--color-negative-text` / `--color-muted`），唔好加粗或加大字。

- [ ] **Step 3: 離線檢查**

Dev tools Network 離線模式 reload，確認：圖片全部本地 `/chiikawa/*`，冇外部字體 / 圖片 request。

- [ ] **Step 4: 最終全量**

Run: `npm test && npm run build`
Expected: 全綠。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: visual verification fixes for chiikawa theme"
```

（如 Step 1–3 冇任何改動，skip 呢個 commit。）
