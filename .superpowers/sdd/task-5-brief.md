### Task 5: `scripts/build-team-logos.mjs`

**Files:**
- Create: `scripts/build-team-logos.mjs`
- Test: `scripts/build-team-logos.test.mjs`

**Interfaces:**
- Consumes: `.env.local` 嘅 `API_FOOTBALL_KEY`(runtime);`public/hkjc-odds.json`、`data/*.json` 入面嘅 `homeTeam`/`awayTeam` 字串
- Produces(operator 用):
  - CLI:`node scripts/build-team-logos.mjs` / `--refresh`
  - `public/team-logos.json`:`{ generatedAt: string, teams: Record<string, { id: number, logo: "/team-logos/<id>.png", needsReview?: boolean }> }`
  - `public/team-logos/<id>.png`
  - Export 俾測試:`collectTeamNames(root: string): Promise<string[]>`、`pickTeamResult(teamName: string, payload: unknown): { id: number, name: string, logoUrl: string, needsReview: boolean } | null`、`buildTeamLogos(options): Promise<BuildSummary>`

API 細節(跟 `scripts/hkjc-import.mjs` 現有 pattern):endpoint `https://v3.football.api-sports.io`,header `x-apisports-key: <key>`,`GET /teams?search=<name>`,response shape `{ response: [{ team: { id, name, logo } }] }`。

- [ ] **Step 1: 寫 failing test** — 建立 `scripts/build-team-logos.test.mjs`:

```js
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildTeamLogos, collectTeamNames, pickTeamResult } from "./build-team-logos.mjs";

function apiPayload(teams) {
  return { response: teams.map((team) => ({ team })) };
}

async function fixtureRoot(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "team-logos-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "public"), { recursive: true });
  await mkdir(path.join(root, "data"), { recursive: true });
  await writeFile(path.join(root, "public", "hkjc-odds.json"), JSON.stringify({
    entries: [{ homeTeam: "Arsenal", awayTeam: "Chelsea" }],
  }));
  await writeFile(path.join(root, "data", "background-hdc-odds.json"), JSON.stringify({
    items: [{ homeTeam: "Arsenal", awayTeam: "Liverpool" }],
  }));
  return root;
}

function fakeFetch(routes, calls = []) {
  return async (url, init) => {
    calls.push({ url: String(url), init });
    const key = routes.find(([match]) => String(url).includes(match));
    if (!key) throw new Error("network down");
    const [, payload, isPng] = key;
    return {
      ok: true,
      json: async () => payload,
      arrayBuffer: async () => new TextEncoder().encode("PNG-BYTES").buffer,
      headers: new Headers({ "content-type": isPng ? "image/png" : "application/json" }),
    };
  };
}

test("collectTeamNames finds unique home/away names across public and data JSON", async (t) => {
  const root = await fixtureRoot(t);
  const names = await collectTeamNames(root);
  assert.deepEqual(names, ["Arsenal", "Chelsea", "Liverpool"]);
});

test("pickTeamResult adopts exact matches without needsReview", () => {
  const picked = pickTeamResult("Arsenal", apiPayload([{ id: 42, name: "Arsenal", logo: "https://cdn/42.png" }]));
  assert.deepEqual(picked, { id: 42, name: "Arsenal", logoUrl: "https://cdn/42.png", needsReview: false });
});

test("pickTeamResult flags near-name matches for review", () => {
  const picked = pickTeamResult("Arsenal", apiPayload([{ id: 42, name: "Arsenal FC", logo: "https://cdn/42.png" }]));
  assert.equal(picked.needsReview, true);
});

test("pickTeamResult returns null when there are no results", () => {
  assert.equal(pickTeamResult("Nowhere FC", apiPayload([])), null);
});

test("buildTeamLogos writes local-path entries, downloads PNGs and is idempotent", async (t) => {
  const root = await fixtureRoot(t);
  const calls = [];
  const fetchImpl = fakeFetch([
    ["search=Arsenal", apiPayload([{ id: 42, name: "Arsenal", logo: "https://cdn/42.png" }])],
    ["search=Chelsea", apiPayload([{ id: 49, name: "Chelsea FC", logo: "https://cdn/49.png" }])],
    ["search=Liverpool", apiPayload([])],
    ["https://cdn/42.png", null, true],
    ["https://cdn/49.png", null, true],
  ], calls);

  const summary = await buildTeamLogos({ root, apiKey: "test-key", fetchImpl, sleepImpl: async () => {} });

  const written = JSON.parse(await readFile(path.join(root, "public", "team-logos.json"), "utf8"));
  assert.deepEqual(written.teams.Arsenal, { id: 42, logo: "/team-logos/42.png" });
  assert.deepEqual(written.teams.Chelsea, { id: 49, logo: "/team-logos/49.png", needsReview: true });
  assert.equal(written.teams.Liverpool, undefined);
  assert.deepEqual(summary.misses, ["Liverpool"]);
  assert.deepEqual(summary.needsReview, ["Chelsea"]);
  const png = await readFile(path.join(root, "public", "team-logos", "42.png"));
  assert.equal(png.toString(), "PNG-BYTES");

  // 第二次跑:已有 entry(Arsenal/Chelsea)唔再叫 API;Liverpool 冇 entry 會再試
  const again = await buildTeamLogos({ root, apiKey: "test-key", fetchImpl, sleepImpl: async () => {} });
  assert.equal(calls.filter((call) => call.url.includes("search=Arsenal")).length, 1);
  assert.equal(calls.filter((call) => call.url.includes("search=Chelsea")).length, 1);
  assert.deepEqual(again.misses, ["Liverpool"]);
});

test("buildTeamLogos skips entries whose logo download fails and keeps going", async (t) => {
  const root = await fixtureRoot(t);
  const fetchImpl = fakeFetch([
    ["search=Arsenal", apiPayload([{ id: 42, name: "Arsenal", logo: "https://cdn/42.png" }])],
    ["search=Chelsea", apiPayload([{ id: 49, name: "Chelsea", logo: "https://cdn/49.png" }])],
    ["search=Liverpool", apiPayload([{ id: 50, name: "Liverpool", logo: "https://cdn/50.png" }])],
    ["https://cdn/49.png", null, true],
    ["https://cdn/50.png", null, true],
    // 42.png 故意唔俾 route → download 失敗
  ]);

  const summary = await buildTeamLogos({ root, apiKey: "test-key", fetchImpl, sleepImpl: async () => {} });

  const written = JSON.parse(await readFile(path.join(root, "public", "team-logos.json"), "utf8"));
  assert.equal(written.teams.Arsenal, undefined);
  assert.deepEqual(written.teams.Chelsea, { id: 49, logo: "/team-logos/49.png" });
  assert.deepEqual(summary.downloadFailed, ["Arsenal"]);
});
```

注意:測試入面嘅 `"test-key"` 係假值,唔係真 key。

- [ ] **Step 2: 行測試確認 fail**

Run: `node --test scripts/build-team-logos.test.mjs`
Expected: FAIL,`Cannot find module './build-team-logos.mjs'`

- [ ] **Step 3: 實作** — 建立 `scripts/build-team-logos.mjs`:

```js
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const API_FOOTBALL_ENDPOINT = "https://v3.football.api-sports.io";
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_DIRS = ["public", "data"];
const SKIP_FILES = new Set(["team-logos.json"]);

export async function collectTeamNames(root, readDirImpl = readdir, readFileImpl = readFile) {
  const names = new Set();
  for (const dir of SCAN_DIRS) {
    let files;
    try {
      files = await readDirImpl(path.join(root, dir));
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith(".json") || SKIP_FILES.has(file)) continue;
      try {
        collectNamesFromValue(JSON.parse(await readFileImpl(path.join(root, dir, file), "utf8")), names);
      } catch {
        // 唔係 JSON 或者讀唔到:跳過,唔阻住其他檔
      }
    }
  }
  return [...names].sort((left, right) => (left < right ? -1 : 1));
}

function collectNamesFromValue(value, names) {
  if (Array.isArray(value)) {
    for (const item of value) collectNamesFromValue(item, names);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (typeof value.homeTeam === "string" && value.homeTeam.trim()) names.add(value.homeTeam.trim());
  if (typeof value.awayTeam === "string" && value.awayTeam.trim()) names.add(value.awayTeam.trim());
  for (const item of Object.values(value)) {
    if (item && typeof item === "object") collectNamesFromValue(item, names);
  }
}

export function pickTeamResult(teamName, payload) {
  const first = payload?.response?.[0]?.team;
  if (!first?.id || !first?.logo) return null;
  const exact = String(first.name ?? "").toLowerCase() === teamName.toLowerCase();
  return { id: first.id, name: String(first.name ?? teamName), logoUrl: String(first.logo), needsReview: !exact };
}

export async function buildTeamLogos({
  root = PROJECT_ROOT,
  apiKey = process.env.API_FOOTBALL_KEY,
  fetchImpl = fetch,
  sleepImpl = defaultSleep,
  refresh = false,
} = {}) {
  if (!apiKey) throw new Error("API_FOOTBALL_KEY missing (.env.local)");
  const publicDir = path.join(root, "public");
  const logosDir = path.join(publicDir, "team-logos");
  const jsonPath = path.join(publicDir, "team-logos.json");
  await mkdir(logosDir, { recursive: true });

  const existing = await readExisting(jsonPath);
  const names = await collectTeamNames(root);
  const pending = refresh ? names : names.filter((name) => !existing[name]);
  const summary = { written: 0, skipped: names.length - pending.length, misses: [], needsReview: [], downloadFailed: [] };

  for (const name of pending) {
    await sleepImpl();
    let picked = null;
    try {
      const url = `${API_FOOTBALL_ENDPOINT}/teams?search=${encodeURIComponent(name)}`;
      const response = await fetchImpl(url, { headers: { "x-apisports-key": apiKey } });
      if (!response.ok) throw new Error(`API-Football ${response.status}`);
      picked = pickTeamResult(name, await response.json());
    } catch (error) {
      console.warn(`[team-logos] search failed for ${name}: ${error.message}`);
    }
    if (!picked) {
      summary.misses.push(name);
      continue;
    }
    const pngPath = path.join(logosDir, `${picked.id}.png`);
    try {
      const logoResponse = await fetchImpl(picked.logoUrl);
      if (!logoResponse.ok) throw new Error(`logo ${logoResponse.status}`);
      await writeFile(pngPath, Buffer.from(await logoResponse.arrayBuffer()));
    } catch (error) {
      console.warn(`[team-logos] download failed for ${name}: ${error.message}`);
      summary.downloadFailed.push(name);
      continue;
    }
    existing[name] = {
      id: picked.id,
      logo: `/team-logos/${picked.id}.png`,
      ...(picked.needsReview ? { needsReview: true } : {}),
    };
    if (picked.needsReview) summary.needsReview.push(name);
    summary.written += 1;
  }

  const sorted = Object.fromEntries(Object.entries(existing).sort(([a], [b]) => (a < b ? -1 : 1)));
  await writeFile(jsonPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), teams: sorted }, null, 2)}\n`);
  console.log(`[team-logos] written=${summary.written} skipped=${summary.skipped} misses=${summary.misses.length} downloadFailed=${summary.downloadFailed.length} needsReview=${summary.needsReview.length}`);
  if (summary.needsReview.length) console.log(`[team-logos] needsReview: ${summary.needsReview.join(", ")}`);
  return summary;
}

async function readExisting(jsonPath) {
  try {
    const payload = JSON.parse(await readFile(jsonPath, "utf8"));
    return payload?.teams && typeof payload.teams === "object" ? payload.teams : {};
  } catch {
    return {};
  }
}

function defaultSleep() {
  return new Promise((resolve) => setTimeout(resolve, 120));
}

const isMain = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isMain) {
  try {
    process.loadEnvFile(path.join(PROJECT_ROOT, ".env.local"));
  } catch {
    // .env.local 唔存在就用 process.env 現有值
  }
  buildTeamLogos({ refresh: process.argv.includes("--refresh") }).catch((error) => {
    console.error(`[team-logos] failed: ${error.message}`);
    process.exitCode = 1;
  });
}
```

- [ ] **Step 4: 行測試確認 pass**

Run: `node --test scripts/build-team-logos.test.mjs`
Expected: PASS,6 個 test 全過

- [ ] **Step 5: Commit**

```bash
git add scripts/build-team-logos.mjs scripts/build-team-logos.test.mjs
git commit -m "feat: add team logo builder script (self-hosted PNGs)"
```
