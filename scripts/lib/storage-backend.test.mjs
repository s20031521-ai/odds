import assert from "node:assert/strict";
import test from "node:test";

import { createStorageBackend, resolveStorageBackend } from "./storage-backend.mjs";

test("resolveStorageBackend defaults to file when STORAGE_BACKEND is unset or empty", () => {
  assert.equal(resolveStorageBackend({}), "file");
  assert.equal(resolveStorageBackend({ STORAGE_BACKEND: "" }), "file");
  assert.equal(resolveStorageBackend({ STORAGE_BACKEND: "   " }), "file");
});

test("resolveStorageBackend accepts explicit file mode", () => {
  assert.equal(resolveStorageBackend({ STORAGE_BACKEND: "file" }), "file");
});

test("resolveStorageBackend accepts postgres mode only with DATABASE_URL", () => {
  assert.equal(
    resolveStorageBackend({ STORAGE_BACKEND: "postgres", DATABASE_URL: "postgresql://example/db" }),
    "postgres",
  );
  assert.throws(
    () => resolveStorageBackend({ STORAGE_BACKEND: "postgres" }),
    /requires DATABASE_URL/,
  );
});

test("resolveStorageBackend rejects unknown backend values", () => {
  assert.throws(
    () => resolveStorageBackend({ STORAGE_BACKEND: "sqlite", DATABASE_URL: "x" }),
    /must be "file" or "postgres"/,
  );
});

test("resolveStorageBackend refuses file mode in production", () => {
  assert.throws(
    () => resolveStorageBackend({ NODE_ENV: "production" }),
    /production requires STORAGE_BACKEND=postgres/,
  );
  assert.throws(
    () => resolveStorageBackend({ NODE_ENV: "production", STORAGE_BACKEND: "file" }),
    /production requires STORAGE_BACKEND=postgres/,
  );
  assert.equal(
    resolveStorageBackend({
      NODE_ENV: "production",
      STORAGE_BACKEND: "postgres",
      DATABASE_URL: "postgresql://example/db",
    }),
    "postgres",
  );
});

test("createStorageBackend file mode needs no database and closes cleanly", async () => {
  const storage = await createStorageBackend({});
  assert.equal(storage.backend, "file");
  assert.equal(storage.sink, null);
  assert.equal(storage.pool, null);
  await storage.close();
});
