export const SESSION_COOKIE = "__Host-odds_session";

export function readSessionCookie(header) {
  if (typeof header !== "string" || !header) return "";
  for (const part of header.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === SESSION_COOKIE) return rawValue.join("=");
  }
  return "";
}

export function sessionCookie(value) {
  return `${SESSION_COOKIE}=${value}; Path=/; Secure; HttpOnly; SameSite=Strict`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict`;
}
