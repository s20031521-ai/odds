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

test("buildTeamLogos stops at maxCalls and reports remaining teams", async (t) => {
  const root = await fixtureRoot(t);
  const calls = [];
  const fetchImpl = fakeFetch([
    ["search=Arsenal", apiPayload([{ id: 42, name: "Arsenal", logo: "https://cdn/42.png" }])],
    ["search=Chelsea", apiPayload([{ id: 49, name: "Chelsea", logo: "https://cdn/49.png" }])],
    ["search=Liverpool", apiPayload([{ id: 50, name: "Liverpool", logo: "https://cdn/50.png" }])],
    ["https://cdn/42.png", null, true],
  ], calls);

  const summary = await buildTeamLogos({ root, apiKey: "test-key", fetchImpl, sleepImpl: async () => {}, maxCalls: 1 });

  assert.equal(calls.filter((call) => call.url.includes("search=")).length, 1);
  assert.equal(summary.written, 1);
  assert.deepEqual(summary.remaining, ["Chelsea", "Liverpool"]);
  const written = JSON.parse(await readFile(path.join(root, "public", "team-logos.json"), "utf8"));
  assert.deepEqual(written.teams.Arsenal, { id: 42, logo: "/team-logos/42.png" });
  assert.equal(written.teams.Chelsea, undefined);
  assert.equal(written.teams.Liverpool, undefined);
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
