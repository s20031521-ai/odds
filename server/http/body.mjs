export async function readJsonBody(req, { limitBytes }) {
  const raw = await readBody(req, { limitBytes });
  if (!raw.length) return null;
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    const error = new Error("malformed_json");
    error.statusCode = 400;
    throw error;
  }
}

async function readBody(req, { limitBytes }) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) {
      const error = new Error("body_too_large");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
