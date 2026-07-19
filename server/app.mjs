import { buildBacktest } from "./domain/backtest.mjs";
import { readJsonBody } from "./http/body.mjs";
import { resolveClientIp } from "./http/client-ip.mjs";
import { clearSessionCookie, readSessionCookie, sessionCookie } from "./http/cookies.mjs";
import { json, safeError } from "./http/responses.mjs";
import { verifyMutationSecurity } from "./http/security.mjs";

const AUTH_BODY_LIMIT = 16 * 1024;
const PREDICTION_BODY_LIMIT = 1024 * 1024;

export function createApp({ repositories, auth, publicOrigin, trustedProxyCidrs = [], readinessCheck = async () => ({ ok: true }), clock = () => new Date(), logger = console } = {}) {
  if (!repositories?.snapshots || !repositories?.results || !repositories?.odds) throw new TypeError("repositories are required");
  if (!auth) throw new TypeError("auth is required");
  if (typeof publicOrigin !== "string" || !publicOrigin) throw new TypeError("publicOrigin is required");

  return async function app(req, res) {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const route = `${req.method ?? "GET"} ${url.pathname}`;

      if (route === "GET /internal/health/ready") return await handleReady(res, readinessCheck);
      if (isLegacyRoute(url.pathname)) return safeError(res, 404, "not_found");
      const routeStatus = routeInventoryStatus(req.method ?? "GET", url.pathname);
      if (routeStatus === 404) return safeError(res, 404, "not_found");
      if (routeStatus === 405) return safeError(res, 405, "method_not_allowed");

      if (route === "POST /api/v1/auth/login") return await handleLogin(req, res, auth, trustedProxyCidrs);
      if (route === "GET /api/v1/session") return await handleSession(req, res, auth);

      const session = await requireSession(req, auth);
      if (!session) return safeError(res, 401, "unauthorized");

      if (route === "POST /api/v1/auth/logout") return await handleLogout(req, res, { auth, session, publicOrigin });
      if (route === "GET /api/v1/odds/live") return await handleLiveOdds(res, repositories, clock);
      if (route === "GET /api/v1/results") return await handleResults(res, repositories);
      if (route === "GET /api/v1/backtest") return await handleBacktest(res, repositories, clock);
      if (route === "POST /api/v1/predictions") return await handlePredictions(req, res, { repositories, auth, session, publicOrigin });

      return safeError(res, 404, "not_found");
    } catch (error) {
      const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
      if (status >= 500) logger?.error?.(error);
      return safeError(res, status, status === 400 ? "bad_request" : status === 413 ? "body_too_large" : "server_error");
    }
  };
}

async function handleLogin(req, res, auth, trustedProxyCidrs) {
  const body = await readJsonBody(req, { limitBytes: AUTH_BODY_LIMIT });
  const result = await auth.login({
    username: body?.username,
    password: body?.password,
    clientIp: resolveClientIp(req.socket?.remoteAddress, req.headers["x-forwarded-for"], trustedProxyCidrs),
  });
  if (!result.ok) return json(res, result.reason === "rate_limited" ? 429 : 401, result);
  return json(res, 200, {
    authenticated: true,
    csrfToken: result.csrfToken,
    session: publicSession(result.session),
  }, { "set-cookie": sessionCookie(result.sessionToken) });
}

async function handleSession(req, res, auth) {
  const session = await requireSession(req, auth);
  if (!session) return json(res, 200, { authenticated: false });
  const csrfToken = await auth.issueCsrf(session.id);
  if (!csrfToken) return json(res, 200, { authenticated: false });
  return json(res, 200, { authenticated: true, csrfToken, session: publicSession(session) });
}

async function handleReady(res, readinessCheck) {
  const status = await readinessCheck();
  return json(res, 200, status);
}

async function handleLogout(req, res, { auth, session, publicOrigin }) {
  if (!await verifyMutationSecurity({ req, auth, session, publicOrigin })) return safeError(res, 403, "forbidden");
  await auth.logout(session.id);
  return json(res, 200, { authenticated: false }, { "set-cookie": clearSessionCookie() });
}

async function handleLiveOdds(res, repositories, clock) {
  const entries = await repositories.odds.listLive(new Date(clock()));
  return json(res, 200, { entries });
}

async function handleResults(res, repositories) {
  const resultEntries = await repositories.results.listAll();
  return json(res, 200, { resultEntries });
}

async function handleBacktest(res, repositories, clock) {
  const [snapshots, results] = await Promise.all([
    repositories.snapshots.listCurrent(),
    repositories.results.listAll(),
  ]);
  return json(res, 200, buildBacktest(snapshots, results, Date.parse(new Date(clock()).toISOString())));
}

async function handlePredictions(req, res, { repositories, auth, session, publicOrigin }) {
  if (!await verifyMutationSecurity({ req, auth, session, publicOrigin })) return safeError(res, 403, "forbidden");
  const body = await readJsonBody(req, { limitBytes: PREDICTION_BODY_LIMIT });
  const snapshots = Array.isArray(body) ? body : [body];
  const result = await repositories.snapshots.insertBatch(snapshots);
  return json(res, 200, result);
}

async function requireSession(req, auth) {
  const token = readSessionCookie(req.headers.cookie);
  if (!token) return null;
  return auth.authenticate(token);
}

function publicSession(session) {
  return {
    username: session.username,
    idleExpiresAt: session.idleExpiresAt,
    absoluteExpiresAt: session.absoluteExpiresAt,
  };
}

function routeInventoryStatus(method, pathname) {
  const allowed = ROUTES.get(pathname);
  if (!allowed) return 404;
  return allowed.has(method) ? null : 405;
}

function isLegacyRoute(pathname) {
  return pathname.startsWith("/api/import/")
    || pathname === "/api/odds"
    || pathname === "/api/hdc-live"
    || pathname === "/api/backtest"
    || pathname === "/api/predictions"
    || pathname === "/health";
}

const ROUTES = new Map([
  ["/api/v1/auth/login", new Set(["POST"])],
  ["/api/v1/session", new Set(["GET"])],
  ["/api/v1/auth/logout", new Set(["POST"])],
  ["/api/v1/odds/live", new Set(["GET"])],
  ["/api/v1/results", new Set(["GET"])],
  ["/api/v1/backtest", new Set(["GET"])],
  ["/api/v1/predictions", new Set(["POST"])],
  ["/internal/health/ready", new Set(["GET"])],
]);
