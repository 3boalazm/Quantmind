/**
 * Session cookie: `<expiry-seconds>.<hex HMAC-SHA256>`.
 * Uses Web Crypto only, so the same code runs in middleware (edge) and in route handlers (node).
 */
export const SESSION_COOKIE = "qm_session";
export const SESSION_DAYS = 30;

const encoder = new TextEncoder();

/** The signing key is derived from the password, so changing the password signs everyone out. */
function secret(): string | null {
  const password = process.env.APP_PASSWORD;
  if (!password) return null;
  return `${process.env.SESSION_SECRET ?? ""}|qm-session-v1|${password}`;
}

export function authConfigured(): boolean {
  return Boolean(process.env.APP_PASSWORD);
}

async function hmac(message: string, key: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey("raw", encoder.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message));
  return Array.from(new Uint8Array(signature), (b) => b.toString(16).padStart(2, "0")).join("");
}

function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

export async function createSession(now = Date.now()): Promise<string | null> {
  const key = secret();
  if (!key) return null;
  const expiry = Math.floor(now / 1000) + SESSION_DAYS * 86_400;
  return `${expiry}.${await hmac(String(expiry), key)}`;
}

export async function verifySession(token: string | undefined, now = Date.now()): Promise<boolean> {
  const key = secret();
  if (!key || !token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const expiry = token.slice(0, dot);
  if (!/^\d{1,12}$/.test(expiry) || Number(expiry) * 1000 < now) return false;
  return sameString(token.slice(dot + 1), await hmac(expiry, key));
}

/** Constant-time password check (compares digests, so length is not leaked either). */
export async function passwordMatches(candidate: string): Promise<boolean> {
  const password = process.env.APP_PASSWORD;
  if (!password) return false;
  const [a, b] = await Promise.all([hmac(candidate, "qm-compare"), hmac(password, "qm-compare")]);
  return sameString(a, b);
}
