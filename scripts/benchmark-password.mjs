import { randomBytes as nodeRandomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { APPROVED_ARGON2_OPTIONS, hashPassword } from "../server/auth/password.mjs";

export async function runBenchmark({
  argv = process.argv.slice(2),
  randomBytes = nodeRandomBytes,
  hash = hashPassword,
  now = () => performance.now(),
  stdout = console.log,
  stderr = console.error,
} = {}) {
  if (argv.length !== 0) {
    stderr("status=failed");
    return 1;
  }
  try {
    const throwaway = Buffer.from(randomBytes(32)).toString("base64url");
    const startedAt = now();
    await hash(throwaway);
    const elapsedMs = Math.max(0, Math.round(now() - startedAt));
    stdout(`algorithm=argon2id version=19 memoryKiB=${APPROVED_ARGON2_OPTIONS.memoryCost} timeCost=${APPROVED_ARGON2_OPTIONS.timeCost} parallelism=${APPROVED_ARGON2_OPTIONS.parallelism} outputBytes=${APPROVED_ARGON2_OPTIONS.outputLen} elapsedMs=${elapsedMs}`);
    return 0;
  } catch {
    stderr("status=failed");
    return 1;
  }
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  process.exitCode = await runBenchmark();
}
