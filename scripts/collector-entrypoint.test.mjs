import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const entrypoint = path.resolve("deploy/collector-entrypoint.sh");

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
