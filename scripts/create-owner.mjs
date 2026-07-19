import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

import { hashPassword, normalizeUsername } from "../server/auth/password.mjs";
import { createPool } from "../server/db/pool.mjs";

const OWNER_LOCK_KEY = 734_625_193;

export async function runCreateOwner({
  argv = process.argv.slice(2),
  env = process.env,
  poolFactory = createPool,
  closePool = true,
  readPasswordFile = readFile,
  promptPassword = readHiddenPassword,
  stdout = console.log,
  stderr = console.error,
  clock = () => new Date(),
} = {}) {
  let pool;
  let client;
  let transactionOpen = false;
  let committed = false;
  let poolCloseAttempted = false;
  let primaryError;
  try {
    if (argv.length !== 0 || env.OWNER_PASSWORD !== undefined) throw new Error("invalid invocation");
    if (typeof env.DATABASE_URL !== "string" || !env.DATABASE_URL) throw new Error("missing database configuration");
    const username = normalizeUsername(env.OWNER_USERNAME);
    const password = env.OWNER_PASSWORD_FILE
      ? stripOneLineEnding(await readPasswordFile(env.OWNER_PASSWORD_FILE, "utf8"))
      : await promptPassword();
    const passwordHash = await hashPassword(password);

    pool = poolFactory(env.DATABASE_URL);
    client = await pool.connect();
    await client.query("BEGIN");
    transactionOpen = true;
    await client.query("SELECT pg_advisory_xact_lock($1)", [OWNER_LOCK_KEY]);
    const existing = await client.query("SELECT id FROM owners LIMIT 1");
    if (existing.rowCount !== 0) throw new Error("owner already exists");
    await client.query(
      "INSERT INTO owners (id, username, password_hash, created_at) VALUES ($1, $2, $3, $4)",
      [randomUUID(), username, passwordHash, new Date(clock())],
    );
    await client.query("COMMIT");
    transactionOpen = false;
    committed = true;
    try { client.release(); } catch (cleanupError) { attachCleanupError(primaryError, "releaseError", cleanupError); } finally { client = undefined; }
    if (closePool) {
      poolCloseAttempted = true;
      try { await pool.end(); } catch (cleanupError) { attachCleanupError(primaryError, "cleanupError", cleanupError); }
    }
    try { stdout("status=created"); } catch (outputError) { attachCleanupError(primaryError, "outputError", outputError); }
    return 0;
  } catch (error) {
    primaryError = error;
    if (committed) return 0;
    if (client) {
      if (transactionOpen) {
        try { await client.query("ROLLBACK"); } catch (rollbackError) { attachCleanupError(primaryError, "rollbackError", rollbackError); }
      }
      try { client.release(primaryError.rollbackError); } catch (releaseError) { attachCleanupError(primaryError, "releaseError", releaseError); }
    }
    if (pool && closePool && !poolCloseAttempted) {
      try { await pool.end(); } catch (cleanupError) { attachCleanupError(primaryError, "cleanupError", cleanupError); }
    }
    stderr("status=failed");
    return 1;
  }
}

function attachCleanupError(primaryError, property, cleanupError) {
  if (primaryError && (typeof primaryError === "object" || typeof primaryError === "function")) {
    primaryError[property] = cleanupError;
  }
}

function stripOneLineEnding(value) {
  return String(value).replace(/\r?\n$/u, "");
}

export async function readHiddenPassword({ input = process.stdin, output = process.stderr } = {}) {
  if (!input.isTTY || typeof input.setRawMode !== "function") throw new Error("hidden terminal required");
  return new Promise((resolve, reject) => {
    let value = "";
    const wasRaw = Boolean(input.isRaw);
    const finish = (error) => {
      input.off("keypress", onKeypress);
      input.setRawMode(wasRaw);
      input.pause();
      output.write("\n");
      if (error) reject(error); else resolve(value);
    };
    const onKeypress = (character, key = {}) => {
      if (key.ctrl && key.name === "c") return finish(new Error("cancelled"));
      if (key.name === "return" || key.name === "enter") return finish();
      if (key.name === "backspace") value = [...value].slice(0, -1).join("");
      else if (typeof character === "string" && !key.ctrl && !key.meta) value += character;
    };
    output.write("Owner password: ");
    readline.emitKeypressEvents(input);
    input.setRawMode(true);
    input.resume();
    input.on("keypress", onKeypress);
  });
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  process.exitCode = await runCreateOwner();
}
