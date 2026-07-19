import { readFile } from "node:fs/promises";

const base = process.env.TARGET || "http://caddy";
const origin = process.env.PUBLIC_ORIGIN || "https://odds.ballballchu.com.hk";
const username = process.env.OWNER_USERNAME;
const password = (await readFile("/run/owner_password", "utf8")).replace(/\r?\n$/, "");

let pass = 0, fail = 0;
const leaks = [];
function check(name, cond, actual) {
  const ok = !!cond;
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name} :: ${actual}`);
}
function leakScan(name, body) {
  if (/(sql|postgres|pg_|\/app\/|node_modules|at \w+ \(|stack)/i.test(body)) leaks.push(name);
}
const j = (r) => r.text();

// --- Unauthenticated denial on 4 protected routes ---
for (const [method, path] of [["GET","/api/v1/odds/live"],["GET","/api/v1/results"],["GET","/api/v1/backtest"],["POST","/api/v1/predictions"]]) {
  const r = await fetch(base + path, { method });
  const b = await j(r); leakScan(path, b);
  check(`unauth ${method} ${path} -> 401`, r.status === 401, `${r.status} ${b.slice(0,60)}`);
}

// --- Session without cookie ---
let r = await fetch(base + "/api/v1/session");
let b = await j(r);
check("GET session no cookie -> 200 authenticated:false", r.status === 200 && b.includes('"authenticated":false'), `${r.status} ${b}`);

// --- Identical 401 for wrong types / wrong pw / nonexistent user ---
const bodies = [];
for (const cred of [{u:1,p:2}, {username, password:"wrong-wrong-wrong"}, {username:"no-such-user-xyz", password:"whatever-12345"}]) {
  const rr = await fetch(base + "/api/v1/auth/login", { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(cred.username !== undefined ? cred : cred) });
  bodies.push(rr.status + "|" + (await j(rr)));
}
check("3 bad logins -> identical 401", bodies.every((x) => x === bodies[0]) && bodies[0].startsWith("401"), bodies[0]);

// --- Malformed JSON ---
r = await fetch(base + "/api/v1/auth/login", { method: "POST", headers: { "content-type": "application/json", origin }, body: "{not json" });
b = await j(r); leakScan("malformed", b);
check("malformed JSON -> 400 generic", r.status === 400, `${r.status} ${b.slice(0,60)}`);

// --- Oversized login body >16 KiB ---
r = await fetch(base + "/api/v1/auth/login", { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ username, password: "x".repeat(20 * 1024) }) });
b = await j(r); leakScan("16k", b);
check("login body >16KiB -> 413", r.status === 413, `${r.status} ${b.slice(0,60)}`);

// --- Correct login ---
r = await fetch(base + "/api/v1/auth/login", { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ username, password }) });
const setCookie = r.headers.get("set-cookie") || "";
check("login -> 200 + __Host cookie flags", r.status === 200 && /^__Host-odds_session=[^;]+; Path=\/; Secure; HttpOnly; SameSite=Strict/.test(setCookie) && !/Domain=/i.test(setCookie), `${r.status} ${setCookie.replace(/=[^;]+;/, "=<redacted>;")}`);
const pair = setCookie.split(";")[0];

r = await fetch(base + "/api/v1/session", { headers: { cookie: pair } });
const sessBody = await j(r);
const csrf = JSON.parse(sessBody).csrfToken;
check("session with cookie -> authenticated + csrf", r.status === 200 && sessBody.includes('"authenticated":true') && csrf, `${r.status}`);

// --- Origin/CSRF matrix on logout (403 x3) ---
r = await fetch(base + "/api/v1/auth/logout", { method: "POST", headers: { cookie: pair } });
check("logout no Origin -> 403", r.status === 403, `${r.status}`);
r = await fetch(base + "/api/v1/auth/logout", { method: "POST", headers: { cookie: pair, origin: "https://evil.example.com", "x-csrf-token": csrf } });
check("logout foreign Origin -> 403", r.status === 403, `${r.status}`);
r = await fetch(base + "/api/v1/auth/logout", { method: "POST", headers: { cookie: pair, origin } });
check("logout no CSRF -> 403", r.status === 403, `${r.status}`);

// --- Oversized authed predictions body >1 MiB ---
r = await fetch(base + "/api/v1/predictions", { method: "POST", headers: { "content-type": "application/json", origin, cookie: pair, "x-csrf-token": csrf }, body: JSON.stringify({ pad: "x".repeat(1024 * 1024 + 1024) }) });
b = await j(r); leakScan("1m", b);
check("authed predictions >1MiB -> 413", r.status === 413, `${r.status} ${b.slice(0,60)}`);

// --- Unknown route / wrong method ---
r = await fetch(base + "/api/v1/definitely-not-a-route", { headers: { cookie: pair } });
check("unknown /api/v1 route -> 404", r.status === 404, `${r.status}`);
r = await fetch(base + "/api/v1/results", { method: "DELETE", headers: { cookie: pair, origin, "x-csrf-token": csrf } });
check("wrong method -> 405", r.status === 405, `${r.status}`);

// --- /internal/* through caddy ---
r = await fetch(base + "/internal/health/ready");
check("/internal/* through caddy -> 404", r.status === 404, `${r.status}`);

// --- Legacy paths fail closed ---
for (const p of ["/hkjc-odds.json", "/api/backtest", "/api/hdc-live", "/api/predictions", "/health", "/api/import/anything"]) {
  const rr = await fetch(base + p);
  const bb = await j(rr);
  check(`legacy ${p} -> 404`, rr.status === 404, `${rr.status} ${bb.slice(0,40)}`);
}

// --- Authed data probes ---
r = await fetch(base + "/api/v1/results", { headers: { cookie: pair } });
b = await j(r);
const resultsCount = (b.match(/"id"/g) || []).length;
check("GET results -> 200 with imported data", r.status === 200 && b.length > 1000, `${r.status} bytes=${b.length} idFields~${resultsCount}`);

r = await fetch(base + "/api/v1/backtest", { headers: { cookie: pair } });
b = await j(r);
check("GET backtest -> 200, 0 settlements", r.status === 200 && /"settlements?"\s*:\s*(0|\[)/.test(b) || (r.status === 200 && b.includes("0")), `${r.status} bytes=${b.length} ${b.slice(0,120)}`);

r = await fetch(base + "/api/v1/odds/live", { headers: { cookie: pair } });
b = await j(r);
check("GET odds/live -> 200 valid payload", r.status === 200 && (b.startsWith("{") || b.startsWith("[")), `${r.status} bytes=${b.length}`);

// --- Logout with correct Origin + CSRF -> revoke ---
r = await fetch(base + "/api/v1/auth/logout", { method: "POST", headers: { cookie: pair, origin, "x-csrf-token": csrf } });
check("logout Origin+CSRF -> 200", r.status === 200, `${r.status}`);
r = await fetch(base + "/api/v1/session", { headers: { cookie: pair } });
b = await j(r);
check("post-logout session -> authenticated:false", b.includes('"authenticated":false'), b.slice(0,50));

// --- Throttle probe LAST (fake username, throwaway container IP) ---
let throttle = [];
for (let i = 1; i <= 5; i++) {
  const rr = await fetch(base + "/api/v1/auth/login", { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ username: "throttle-probe-nobody", password: "probe-probe-probe" }) });
  throttle.push(rr.status);
}
check("throttle: 4x401 then 429 on 5th", throttle.slice(0,4).every((s) => s === 401) && throttle[4] === 429, throttle.join(","));

console.log(`SUMMARY pass=${pass} fail=${fail} leaks=${leaks.length}${leaks.length ? " (" + leaks.join(",") + ")" : ""}`);
process.exit(fail || leaks.length ? 1 : 0);
