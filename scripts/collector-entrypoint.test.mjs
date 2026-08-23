import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const entrypoint = path.resolve("deploy/collector-entrypoint.sh");
const compose = path.resolve("deploy/compose.yaml");
const apiDockerfile = path.resolve("deploy/api.Dockerfile");
const dockerignore = path.resolve(".dockerignore");

test("collector supervisor runs providers independently then exactly one unified sampler", async () => {
  const source = await readFile(entrypoint, "utf8");
  const loop = source.slice(source.indexOf("while :; do"), source.indexOf("done", source.indexOf("while :; do")) + 4);

  assert.match(loop, /node scripts\/hdc-collector\.mjs \|\|/);
  assert.match(loop, /if \[ \$\(\(i % 3\)\) -eq 0 \]; then[\s\S]*node scripts\/hkjc-import\.mjs \|\|/);
  assert.equal((loop.match(/node scripts\/unified-sampler\.mjs/g) ?? []).length, 1);
  assert.match(loop, /node scripts\/unified-sampler\.mjs \|\|/);
  assert.ok(loop.indexOf("hdc-collector.mjs") < loop.indexOf("hkjc-import.mjs"));
  assert.ok(loop.indexOf("hkjc-import.mjs") < loop.indexOf("unified-sampler.mjs"));
  assert.ok(loop.indexOf("unified-sampler.mjs") < loop.indexOf("sleep 300"));
  assert.doesNotMatch(loop, /&&/i, "a provider failure must not gate the sampler");
});

test("collector supervisor keeps portable LF shell text and five-minute cadence", async () => {
  const bytes = await readFile(entrypoint);
  const source = bytes.toString("utf8");
  assert.equal(bytes.includes(13), false, "deploy shell must not contain CRLF bytes");
  assert.match(source, /^#!\/bin\/sh\n/);
  assert.match(source, /sleep 300/);
});

test("collector receives the rotating key pool and priority-team quota guard", async () => {
  const [entrypointSource, composeSource, dockerfileSource, dockerignoreSource] = await Promise.all([
    readFile(entrypoint, "utf8"),
    readFile(compose, "utf8"),
    readFile(apiDockerfile, "utf8"),
    readFile(dockerignore, "utf8"),
  ]);

  assert.match(entrypointSource, /export ODDS_API_KEYS="\$\(cat \/run\/secrets\/odds_api_keys\)"/);
  assert.match(composeSource, /odds_api_keys:\n\s+file: \.\/secrets\/odds_api_keys/);
  assert.match(composeSource, /source: odds_api_keys/);
  assert.match(dockerfileSource, /COPY data\/priority-teams\.json data\/priority-teams\.json/);
  assert.match(dockerignoreSource, /^data\/\*$/m);
  assert.match(dockerignoreSource, /^!data\/priority-teams\.json$/m);
});
