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
  maxCalls,
} = {}) {
  if (!apiKey) throw new Error("API_FOOTBALL_KEY missing (.env.local)");
  const publicDir = path.join(root, "public");
  const logosDir = path.join(publicDir, "team-logos");
  const jsonPath = path.join(publicDir, "team-logos.json");
  await mkdir(logosDir, { recursive: true });

  const existing = await readExisting(jsonPath);
  const names = await collectTeamNames(root);
  const pending = refresh ? names : names.filter((name) => !existing[name]);
  const summary = { written: 0, skipped: names.length - pending.length, misses: [], needsReview: [], downloadFailed: [], remaining: [] };

  console.log(`[team-logos] pending=${pending.length} maxCalls=${typeof maxCalls === "number" ? maxCalls : "unlimited"}`);

  let callsUsed = 0;
  let stoppedAtMaxCalls = false;
  for (let index = 0; index < pending.length; index += 1) {
    if (typeof maxCalls === "number" && callsUsed >= maxCalls) {
      summary.remaining = pending.slice(index);
      stoppedAtMaxCalls = true;
      break;
    }
    const name = pending[index];
    await sleepImpl();
    callsUsed += 1;
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

  if (stoppedAtMaxCalls) {
    console.log(`[team-logos] stopped at maxCalls; remaining=${summary.remaining.length} — 聽日再跑會繼續`);
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

function parseMaxCalls(argv) {
  const index = argv.indexOf("--max-calls");
  if (index === -1) return undefined;
  const value = Number.parseInt(argv[index + 1], 10);
  return Number.isNaN(value) ? undefined : value;
}

const isMain = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isMain) {
  try {
    process.loadEnvFile(path.join(PROJECT_ROOT, ".env.local"));
  } catch {
    // .env.local 唔存在就用 process.env 現有值
  }
  buildTeamLogos({ refresh: process.argv.includes("--refresh"), maxCalls: parseMaxCalls(process.argv) }).catch((error) => {
    console.error(`[team-logos] failed: ${error.message}`);
    process.exitCode = 1;
  });
}
