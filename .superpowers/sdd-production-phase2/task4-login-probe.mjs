import { readFile } from "node:fs/promises";

const base = process.env.TARGET || "http://caddy";
const origin = process.env.PUBLIC_ORIGIN || "https://odds.ballballchu.com.hk";
const username = process.env.OWNER_USERNAME;
const password = (await readFile("/run/owner_password", "utf8")).replace(/\r?\n$/, "");

const post = (path, body, cookie) =>
  fetch(base + path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

// 1. Wrong password -> generic 401
let r = await post("/api/v1/auth/login", { username, password: "definitely-wrong-0000" });
console.log("wrongLoginStatus=" + r.status);
console.log("wrongLoginBody=" + (await r.text()));

// 2. Correct password -> 200 + __Host- cookie with Phase 1 flags
r = await post("/api/v1/auth/login", { username, password });
console.log("loginStatus=" + r.status);
const setCookie = r.headers.get("set-cookie") || "";
console.log("setCookie=" + setCookie.replace(/(__Host-odds_session=)[^;]+/, "$1<redacted>"));
const pair = setCookie.split(";")[0];

// 3. Session with cookie -> authenticated
r = await fetch(base + "/api/v1/session", { headers: { cookie: pair } });
console.log("sessionStatus=" + r.status);
const sessionBody = await r.text();
console.log("sessionBody=" + sessionBody);
const csrfToken = JSON.parse(sessionBody).csrfToken;

// 3b. Logout WITHOUT CSRF token -> must be 403 (CSRF matrix)
r = await post("/api/v1/auth/logout", null, pair);
console.log("logoutNoCsrfStatus=" + r.status);

// 4. Logout with CSRF token -> revokes
r = await fetch(base + "/api/v1/auth/logout", {
  method: "POST",
  headers: { origin, cookie: pair, "x-csrf-token": csrfToken },
});
console.log("logoutStatus=" + r.status);

// 5. Session after logout -> no longer authenticated
r = await fetch(base + "/api/v1/session", { headers: { cookie: pair } });
console.log("postLogoutStatus=" + r.status);
console.log("postLogoutBody=" + (await r.text()));
