// Hash de senha com PBKDF2 via Web Crypto — funciona tanto no Cloudflare Worker
// quanto no Node (o global `crypto` existe nos dois), então o mesmo formato é
// gerado pelo script de terminal e verificado em produção.
// O Web Crypto do Cloudflare Workers limita o PBKDF2 a 100000 iterações (máx).
const ITERATIONS = 100000;
const KEY_BYTES = 32;

function toHex(bytes: Uint8Array) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number) {
  const keyData = new TextEncoder().encode(password) as BufferSource;
  const key = await crypto.subtle.importKey("raw", keyData, "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" }, key, KEY_BYTES * 8);
  return new Uint8Array(bits);
}

// Retorna "pbkdf2$<iterações>$<salt hex>$<hash hex>".
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${toHex(salt)}$${toHex(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number(parts[1]);
  if (!Number.isFinite(iterations) || iterations <= 0) return false;
  const hash = await pbkdf2(password, fromHex(parts[2]), iterations);
  return timingSafeEqualHex(toHex(hash), parts[3]);
}

function timingSafeEqualHex(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
