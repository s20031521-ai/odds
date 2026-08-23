export const CSRF_HEADER = "x-csrf-token";

export function hasExactOrigin(req, publicOrigin) {
  return req.headers.origin === publicOrigin;
}

export async function verifyMutationSecurity({ req, auth, session, publicOrigin }) {
  if (!hasExactOrigin(req, publicOrigin)) return false;
  const csrf = req.headers[CSRF_HEADER];
  if (typeof csrf !== "string" || !csrf) return false;
  return auth.verifyCsrf(session.id, csrf);
}
